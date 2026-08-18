-- Round 2 (2026-06-22). Applied to prod via Supabase MCP apply_migration.
-- Behavior-preserving hardening/perf cleanups from the Supabase linter.

-- S2: pin search_path on the two flagged trigger functions.
alter function public.enforce_username_rules() set search_path = public, pg_catalog;
alter function public.username_is_clean(text)  set search_path = public, pg_catalog;

-- Perf (auth_rls_initplan): wrap auth.uid() in a scalar subquery so it is
-- evaluated once per statement instead of once per row. Identical semantics.
alter policy profiles_update_self    on public.profiles
  using ((select auth.uid()) = id);
alter policy submissions_read_self   on public.submissions
  using ((select auth.uid()) = user_id);
alter policy submissions_update_self on public.submissions
  using ((select auth.uid()) = user_id);
alter policy submissions_insert_self on public.submissions
  with check ((select auth.uid()) = user_id);
alter policy streaks_write_self      on public.streaks
  using ((select auth.uid()) = user_id);

-- Perf (unindexed_foreign_keys): covering indexes for the two FKs.
create index if not exists daily_puzzles_source_bank_idx on public.daily_puzzles(source_bank_id);
create index if not exists game_events_user_idx          on public.game_events(user_id);
