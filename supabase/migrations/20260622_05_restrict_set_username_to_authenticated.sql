-- Round 2 (2026-06-22). Applied to prod via Supabase MCP apply_migration.
-- S3a: EXECUTE on functions is granted to PUBLIC by default, which anon inherits;
-- a plain `revoke ... from anon` is therefore ineffective. Revoke from PUBLIC and
-- grant back only to authenticated. set_username is only ever called from the
-- signed-in account screen, so anon loses nothing. (username_available and
-- get_leaderboard_today intentionally keep their PUBLIC grant — they serve signup
-- and the public leaderboard function.)
revoke execute on function public.set_username(text) from public;
grant  execute on function public.set_username(text) to authenticated;
