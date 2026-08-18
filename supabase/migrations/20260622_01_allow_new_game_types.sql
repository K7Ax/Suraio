-- Round 2 (2026-06-22). Applied to prod via Supabase MCP apply_migration.
-- Widen the game_type CHECK on puzzle_bank + daily_puzzles to include all 10
-- games. Non-breaking: only relaxes a content constraint. Login/auth untouched.
DO $$
DECLARE
  r record;
  allowed text := '''wordle'',''connections'',''crossword'',''spelling_bee'',''sudoku'',''letterboxed'',''strands'',''tiles'',''pips'',''amthal''';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['public.puzzle_bank', 'public.daily_puzzles'] LOOP
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conrelid = tbl::regclass
        AND pg_get_constraintdef(oid) ILIKE '%game_type%'
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, r.conname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (game_type IN (%s))',
      tbl, replace(tbl, 'public.', '') || '_game_type_check', allowed
    );
  END LOOP;
END $$;
