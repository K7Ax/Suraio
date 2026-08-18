-- ============================================================================
-- Captured SECURITY DEFINER function bodies — audit finding A20.
--
-- ⚠️  REFERENCE ONLY. DO NOT RUN THIS FILE. Like
--     `_current_schema_snapshot.sql`, it is a photograph of production, not a
--     migration. Re-applying a photograph overwrites whatever changed since it
--     was taken. To change one of these, write a new dated migration.
--
-- WHY IT EXISTS. Four SECURITY DEFINER functions were referenced by the
-- application and described in prose, but their source existed nowhere in the
-- repository — they lived only inside the production database. SECURITY DEFINER
-- means "run with the privileges of the owner, ignoring RLS", so these four are
-- among the most powerful objects in the system, and they were the four nobody
-- could review. Two of them, `set_username` and `handle_new_user`, are also
-- load-bearing for the XSS defence recorded in the audit — which meant that
-- defence was asserted from observed behaviour rather than from read code.
--
-- Captured from project `uqgndtsfrbgmgpqhuaeh` on 10 August 2026 via
-- `pg_get_functiondef`. What the reading found, recorded honestly:
--
--   • All four pin `search_path`. That is the single most important property
--     for a SECURITY DEFINER function and all four have it. Good.
--   • `get_leaderboard_today` is projection-limited and never selects user_id,
--     matching the care already visible in `get_global_leaderboard`.
--   • `p_game_type` is used only in an equality filter against a column, via a
--     parameterised plan — it is not concatenated into SQL. The A15 note about
--     it being "unvalidated" was about the caller passing null, which the
--     function handles explicitly (`p_game_type is null or …`). get-leaderboard
--     now validates it anyway.
--   • `set_username` enforces `^[a-z0-9_]{3,20}$` server-side and
--     `handle_new_user` strips `[<>\\\x00-\x1f"'`]` and caps display_name at 40
--     characters. The audit's "genuine defence in depth" claim is now backed by
--     source, not by probing.
--
-- One thing worth a future decision, recorded rather than changed: both
-- `username_available` and `get_leaderboard_today` retain a PUBLIC execute
-- grant. For `username_available` that is deliberate (A17 documents the
-- enumeration trade-off). For `get_leaderboard_today` it is simply how it was
-- created; the only caller is the get-leaderboard function using the anon key.
-- ============================================================================


-- ── get_leaderboard_today ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_leaderboard_today(p_game_type text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(game_type text, display_name text, score integer, attempts smallint, time_seconds integer, rank bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with todays as (
    select s.*, d.game_type as gtype, d.puzzle_date
    from public.submissions s
    join public.daily_puzzles d on d.id = s.puzzle_id
    where s.completed = true
      and d.puzzle_date = (now() at time zone 'Asia/Riyadh')::date
      and (p_game_type is null or d.game_type = p_game_type)
  )
  select
    t.gtype as game_type,
    coalesce(p.display_name, 'لاعب') as display_name,
    t.score,
    t.attempts,
    t.time_seconds,
    rank() over (partition by t.puzzle_id order by t.score desc, t.time_seconds asc nulls last) as rank
  from todays t
  left join public.profiles p on p.id = t.user_id
  order by score desc, time_seconds asc nulls last
  limit greatest(1, least(p_limit, 100));
$function$;


-- ── handle_new_user ─────────────────────────────────────────────────────────
-- Trigger on auth.users. This is the first line of the XSS defence: nothing a
-- new account supplies as a name reaches the database unstripped.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  raw_name text;
  clean_name text;
  raw_user text;
  clean_user text;
begin
  raw_name := coalesce(new.raw_user_meta_data->>'display_name',
                       new.raw_user_meta_data->>'full_name',
                       split_part(new.email, '@', 1));
  clean_name := substring(btrim(regexp_replace(coalesce(raw_name,''), '[<>\\\x00-\x1f"''`]', '', 'g')) for 40);
  if clean_name = '' then clean_name := 'لاعب'; end if;

  raw_user := lower(btrim(coalesce(new.raw_user_meta_data->>'username','')));
  if raw_user ~ '^[a-z0-9_]{3,20}$'
     and public.username_is_clean(raw_user)
     and not exists (select 1 from public.profiles where lower(username) = raw_user) then
    clean_user := raw_user;
  else
    clean_user := null;
  end if;

  insert into public.profiles (id, display_name, username)
  values (new.id, clean_name, clean_user)
  on conflict (id) do nothing;
  return new;
exception when unique_violation then
  -- username race: create profile without a username so signup still succeeds
  insert into public.profiles (id, display_name)
  values (new.id, clean_name);
  return new;
end;
$function$;


-- ── set_username ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_username(p text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  uid uuid := auth.uid();
  candidate text := lower(btrim(coalesce(p,'')));
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if candidate !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_username_format';
  end if;
  if not public.username_is_clean(candidate) then
    raise exception 'username_not_allowed';
  end if;
  if exists (select 1 from public.profiles where lower(username) = candidate and id <> uid) then
    raise exception 'username_taken';
  end if;
  -- Keep display_name in sync: it is what the nav button, leaderboard and account
  -- greeting all render, and there is no separate display-name editor, so the
  -- username IS the shown name.
  update public.profiles set username = candidate, display_name = candidate where id = uid;
  return candidate;
end;
$function$;


-- ── username_available ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.username_available(p text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select
    coalesce(p,'') ~ '^[a-z0-9_]{3,20}$'
    and public.username_is_clean(p)
    and not exists (select 1 from public.profiles where lower(username) = lower(p));
$function$;
