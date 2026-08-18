-- ============================================================================
-- Sura — Phase 1 hardening: make gameplay results server-authoritative at the
-- RLS layer, and stop analytics user-id spoofing.
--
-- WHY (audit finding, 2026-07-22)
-- The `submissions` table had client-facing INSERT/UPDATE policies
-- (`submissions_insert_self` / `submissions_update_self`, both gated only on
-- `auth.uid() = user_id`). A signed-in user could therefore POST directly to
-- `/rest/v1/submissions`, bypassing the `submit-guess` Edge Function, and set
-- `completed`, `score`, and `time_seconds` to anything. The `submissions_guard`
-- trigger only checked the puzzle existed / wasn't >7 days old / attempts<=20 —
-- it never validated score or completion. Net effect: any account could forge a
-- perfect top-of-leaderboard entry.
--
-- The web/bot clients only ever READ submissions and streaks (they write results
-- exclusively through `submit-guess`, which uses the service role and bypasses
-- RLS). So revoking client write access to these tables closes the hole with
-- zero client impact.
--
-- Apply in: Supabase dashboard → SQL Editor (or MCP apply_migration).
-- Reversible: recreate the dropped policies to restore the old behaviour.
-- ============================================================================

begin;

-- 1a. Revoke direct client writes to result tables ---------------------------
-- submissions: keep read-own; remove client insert/update. All writes now go
-- through submit-guess (service role).
drop policy if exists submissions_insert_self on public.submissions;
drop policy if exists submissions_update_self on public.submissions;
-- submissions_read_self stays (a user reads only their own rows).

-- streaks: keep public read (leaderboard/stats); remove the self-write half of
-- the old FOR ALL policy. submit-guess writes streaks via the service role.
-- Bonus: also clears the `multiple_permissive_policies` perf advisor on streaks
-- (streaks_write_self + streaks_read_public both covered SELECT).
drop policy if exists streaks_write_self on public.streaks;
-- streaks_read_public stays.

-- Defense-in-depth: harden the integrity trigger so that even if a write policy
-- is ever reintroduced by mistake, completion/score remain server-only and
-- values stay in a sane range. (Also commits the trigger's source into the repo,
-- which was previously missing.)
create or replace function public.submissions_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  puzz_date  date;
  is_service boolean := coalesce(auth.role() = 'service_role', false)
                        or current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  select puzzle_date into puzz_date from public.daily_puzzles where id = new.puzzle_id;
  if puzz_date is null then
    raise exception 'invalid puzzle';
  end if;
  if puzz_date < (now() at time zone 'Asia/Riyadh')::date - interval '7 days' then
    raise exception 'puzzle too old to submit';
  end if;
  -- attempts upper bound (defense-in-depth; client enforces 6, server caps 20).
  if new.attempts is not null and new.attempts > 20 then
    raise exception 'too many attempts';
  end if;
  -- completion and score are server-authoritative: only submit-guess (service
  -- role) may mark a completion or record a non-zero score.
  if not is_service then
    if coalesce(new.completed, false) then
      raise exception 'completion is server-authoritative';
    end if;
    if coalesce(new.score, 0) <> 0 then
      raise exception 'score is server-authoritative';
    end if;
  end if;
  -- value sanity (applies to every writer, including the service role).
  if new.score is not null and (new.score < 0 or new.score > 100000) then
    raise exception 'score out of range';
  end if;
  if new.time_seconds is not null and new.time_seconds < 1 then
    raise exception 'invalid time';
  end if;
  return new;
end;
$function$;

-- 1b. Stop game_events user-id spoofing --------------------------------------
-- Analytics ingest stays open (anonymous events carry a null user_id), but a
-- signed-in actor may no longer attribute events to another user. Full
-- anti-poisoning would require server-side ingest; this is the cheap, high-value
-- guard. event_type is already CHECK-constrained on the column.
drop policy if exists game_events_insert_anyone on public.game_events;
create policy game_events_insert_anyone on public.game_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

commit;
