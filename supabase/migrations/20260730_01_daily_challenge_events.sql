-- Round 4, phase 4 (2026-07-30). Widens ONE content CHECK. Nothing else.
--
-- WHY: `game_events.event_type` is a closed list, and that closedness is the
-- point — it is what stops a typo becoming a silent third spelling of an event
-- nobody can then aggregate. But it also means «تحدي اليوم» could not be
-- measured at all: the client's insert came back 400 and the analytics simply
-- had no daily in them.
--
-- WHY NOT REUSE `level_started`: it would have needed no migration, and it is
-- the wrong answer. The daily runs at the band's REPRESENTATIVE level (0, 6 or
-- 15), so every daily play would have landed on those three rows of
-- `dash_level_health` and reported campaign levels as far busier and far more
-- abandoned than they are. Two names keep the two funnels separable; one name
-- would have quietly corrupted the number the Constitution's difficulty targets
-- are judged against.
--
-- Safety: additive only. Existing rows all satisfy the new list, no column is
-- dropped or retyped, and re-running is a no-op. Login/auth untouched.

alter table public.game_events drop constraint if exists game_events_event_type_check;

alter table public.game_events add constraint game_events_event_type_check
  check (event_type in (
    'site_visit','game_opened','level_started','level_completed',
    'level_failed','hint_used','level_quit','share_clicked','daily_return',
    -- «تحدي اليوم»: entered the day's board / finished it (won or out of guesses).
    -- `metadata` carries {tier, band, source} and, on finish, {won, rank}.
    'daily_started','daily_finished'));
