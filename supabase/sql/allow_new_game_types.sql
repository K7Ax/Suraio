-- ⛔ SUPERSEDED — DO NOT RUN. Kept as a record of the draft, nothing more.
--
-- The version that was actually applied to production is
-- `supabase/migrations/20260622_01_allow_new_game_types.sql`. That one allows
-- ten game types; this one allows nine — it predates «أمثال» and omits
-- 'amthal' from `allowed`.
--
-- Because the statement below DROPS the existing CHECK and re-adds its own,
-- running this file today would not be a no-op and would not merely "re-apply"
-- anything: it would NARROW the constraint, after which every insert of an
-- «أمثال» puzzle into `puzzle_bank` / `daily_puzzles` fails. The line marked
-- "Safe to re-run" below was true when written and is now false, which is
-- precisely why the file carries this header instead of being left to look
-- like an equal twin of the migration.
--
-- To change the allowed game types, write a new dated migration in
-- `supabase/migrations/`. See `supabase/sql/README.md`.
-- ---------------------------------------------------------------------------
--
-- Sura — allow the new game types in puzzle_bank + daily_puzzles.
-- The original CHECK allowed only: wordle, connections, crossword, spelling_bee.
-- This adds: sudoku, letterboxed, strands, tiles, pips.
--
-- LOGIN/AUTH UNTOUCHED. This only widens a content CHECK constraint.
-- Safe to re-run. Paste into Supabase → SQL Editor → Run.
--
-- It drops whatever CHECK constraint currently governs game_type (by inspecting
-- the catalog, so the exact constraint name doesn't matter) and re-adds an
-- expanded one.

BEGIN;

DO $$
DECLARE
  r record;
  allowed text := '''wordle'',''connections'',''crossword'',''spelling_bee'',''sudoku'',''letterboxed'',''strands'',''tiles'',''pips''';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['public.puzzle_bank', 'public.daily_puzzles'] LOOP
    -- drop existing CHECK constraints that mention game_type
    FOR r IN
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid = tbl::regclass
        AND pg_get_constraintdef(oid) ILIKE '%game_type%'
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, r.conname);
    END LOOP;

    -- re-add the widened constraint
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (game_type IN (%s))',
      tbl,
      replace(tbl, 'public.', '') || '_game_type_check',
      allowed
    );
  END LOOP;
END $$;

COMMIT;

-- Verify:
-- SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE contype='c' AND conrelid IN ('public.puzzle_bank'::regclass,'public.daily_puzzles'::regclass)
--   AND pg_get_constraintdef(oid) ILIKE '%game_type%';
