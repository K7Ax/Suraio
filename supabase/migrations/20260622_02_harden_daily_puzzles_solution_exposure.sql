-- Round 2 (2026-06-22). Applied to prod via Supabase MCP apply_migration.
-- S1: daily_puzzles had a public SELECT policy (USING true) that exposed the
-- `solution` column over REST, bypassing the get-todays-puzzle function's
-- solution-stripping. The client never reads daily_puzzles directly (only via the
-- get-todays-puzzle Edge Function, which uses the service role and bypasses RLS),
-- so removing the public read closes the leak with no client impact. RLS stays
-- enabled; with no SELECT policy, anon/authenticated reads are denied by default.
DROP POLICY IF EXISTS daily_puzzles_read_public ON public.daily_puzzles;
