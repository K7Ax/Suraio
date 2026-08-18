-- ============================================================================
-- 20260810_01_rls_tighten.sql — closing audit findings A10 and A11.
--
-- Apply in: Supabase dashboard → SQL Editor. (`supabase db push` is forbidden
-- in this project — see docs/ai-agent-rules.md.)
--
-- WHAT WAS WRONG. Four tables carried `USING (true)` SELECT policies, so the
-- publishable key alone — the one every visitor holds — returned:
--
--   profiles       → id (uuid), username, display_name, avatar_url, created_at
--   player_totals  → user_id, total_xp, rank_tier, max_streak, games_cleared
--   streaks        → user_id, game_type, streak counters
--   daily_streaks  → user_id (primary key), streak counters
--
-- Joined on the user id, that is a complete roster of every registered player,
-- when they signed up, and how much they have played. The leaderboard exposes
-- the top six DELIBERATELY and does it correctly — `get_global_leaderboard` is
-- projection-limited and never returns a user id. These four policies quietly
-- undid that care.
--
-- THE ONE THING THAT ACTUALLY NEEDED PUBLIC READ, and how it is replaced.
-- `src/main.js` computed the player's global rank as
--     select count(*) from player_totals where total_xp > mine
-- which needs to see every row. Restricting the table without replacing that
-- would not error — it would silently return 0 and rank every player #1. So the
-- count moves into `get_my_rank()`, a SECURITY DEFINER function that returns a
-- single integer and cannot be asked for anything else.
--
-- REVERSIBLE: re-create the four dropped policies with `using (true)`.
-- ============================================================================

begin;

-- ── A10 · profiles ──────────────────────────────────────────────────────────
-- Both client reads are `.eq('id', session.user.id)` — own row only. The
-- leaderboard reads profiles through SECURITY DEFINER functions, which bypass
-- RLS, so display names on the board are unaffected.
drop policy if exists profiles_read_public on public.profiles;

create policy profiles_read_self on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

-- ── A10 · player_totals ─────────────────────────────────────────────────────
drop policy if exists player_totals_read_public on public.player_totals;

create policy player_totals_read_self on public.player_totals
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The replacement for the public count. STABLE + SECURITY DEFINER, fixed
-- search_path, and it takes no arguments at all — there is no parameter to
-- probe with, and the only value it can ever return is the caller's own rank.
create or replace function public.get_my_rank()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select case
           when auth.uid() is null then null
           else (
             select count(*)::int + 1
             from public.player_totals t
             where t.total_xp > coalesce(
               (select total_xp from public.player_totals where user_id = auth.uid()), 0)
           )
         end;
$$;

revoke all on function public.get_my_rank() from public, anon;
grant execute on function public.get_my_rank() to authenticated;

-- ── A11 · streaks ───────────────────────────────────────────────────────────
-- Note this also FIXES a live client bug rather than only closing a hole:
-- `serverStreak()` in src/main.js queries streaks filtered on game_type ONLY,
-- with `.maybeSingle()`. Under `using (true)` that matched every player's row
-- for the game and `maybeSingle()` errored as soon as two people had played it.
-- Scoped to the caller, the same query is correct by construction.
drop policy if exists streaks_read_public on public.streaks;

create policy streaks_read_self on public.streaks
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ── A11 · daily_streaks ─────────────────────────────────────────────────────
drop policy if exists daily_streaks_read_public on public.daily_streaks;

create policy daily_streaks_read_self on public.daily_streaks
  for select to authenticated
  using ((select auth.uid()) = user_id);

commit;

-- ── Verification (run after applying) ───────────────────────────────────────
-- Expect four rows, every `qual` scoped to auth.uid(), and no `true`:
--
--   select tablename, policyname, cmd, qual from pg_policies
--   where schemaname='public'
--     and tablename in ('profiles','player_totals','streaks','daily_streaks')
--   order by tablename;
--
-- And with the publishable key alone, all four table reads must now return an
-- empty array instead of the full roster.
