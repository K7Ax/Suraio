-- Round 4, phase 4b (2026-07-30). «السلسلة اليوميّة» — the daily-challenge streak.
--
-- WHY A NEW TABLE AND NOT `streaks`:
--   `streaks` is keyed (user_id, game_type) and is written by `submit-guess` for
--   the server-backed puzzle flow. The daily challenge is not per-game — Friday
--   carries six games and is still ONE day — so hanging it off that key would
--   either count Friday six times or need a fake game_type sentinel. It is also
--   a different authority: `submit-guess` re-solves the puzzle server-side, and
--   the daily is checked in the browser like the campaign. Mixing the two would
--   quietly lower the trust level of a number that already means something.
--
-- AUTHORITY: exactly like `player_progress` — RLS on, **public SELECT, no client
-- INSERT/UPDATE/DELETE at all**. The only writer is the `submit-daily` Edge
-- Function via the service role. A client that could write this row could type
-- its own streak, and then the flame is decoration rather than a record.
--
-- THE DATE IS THE SERVER'S. `last_day` is only ever set from
-- `(now() at time zone 'Asia/Riyadh')::date` inside the function — never from a
-- value the client sent. Otherwise a device clock set forward by a day extends
-- the streak for free, which is the single cheapest way to forge this number.
--
-- Re-runnable. Additive. Login/auth untouched.

create table if not exists public.daily_streaks (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  current_streak int  not null default 0 check (current_streak >= 0),
  max_streak     int  not null default 0 check (max_streak >= 0),
  last_day       date,                                  -- Riyadh calendar day
  total_days     int  not null default 0 check (total_days >= 0),
  updated_at     timestamptz not null default now(),
  -- The max can never be below the current: the two are written together, and a
  -- row that violates this is a bug in the writer, not a state to tolerate.
  constraint daily_streaks_max_ge_current check (max_streak >= current_streak)
);

alter table public.daily_streaks enable row level security;

-- Read-only to everyone (same shape as `streaks`): a future «أطول سلسلة» board
-- needs it, and the row carries no secret — only how often someone showed up.
drop policy if exists daily_streaks_read_public on public.daily_streaks;
create policy daily_streaks_read_public on public.daily_streaks
  for select using (true);

-- No write policy of any kind, deliberately. Service role bypasses RLS.

create index if not exists daily_streaks_current_idx
  on public.daily_streaks (current_streak desc);
