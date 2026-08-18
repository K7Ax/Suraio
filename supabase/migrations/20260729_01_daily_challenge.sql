-- Round 4 (2026-07-29). Applied to prod via Supabase MCP apply_migration.
--
-- WHY: Sura has no reason to come back tomorrow. Every board is derived from
-- the player's own campaign level and a bank compiled into app.js, so nothing
-- changes when the date does. `daily_puzzles` exists but nothing ever schedules
-- a FUTURE date — rows only appear lazily, on the first request of that day,
-- and only for 4 of the 14 game types.
--
-- This table is «تحدي اليوم»: a date-pinned daily mode that sits ALONGSIDE the
-- 21-level campaign and never touches it. Difficulty comes from the weekday
-- (Sun/Mon easy · Tue/Wed medium · Thu/Sat hard · Fri «التحدي الكبير»), and
-- Friday carries one row per live game — «يوم الجمعة العب كل الألعاب».
--
-- TWO DELIBERATE CHOICES, both load-bearing:
--
--   1. `band` IS CONSTRAINED 0..2, NOT 0..3. Friday is the hard band wearing
--      modifiers, not a fourth band. progression.mjs:66 `pickBankIndex` filters
--      on `item.difficulty === band` and every bank file carries only 0/1/2, so
--      a band 3 would select an EMPTY pool, fall back to the whole bank, and
--      make Friday EASIER. The check is here so the database refuses it even if
--      someone later edits the client. See src/core/daily.mjs.
--
--   2. `mode='recipe'` IS THE DEFAULT, and `solution` IS NEVER SERVED. Every
--      game builds its board from three calls — L.level / L.levelSeed /
--      L.diffFor — so the client needs a RECIPE (game, band, seed, mods:
--      ~120 bytes), not a payload. It already owns the content. That also means
--      the client can derive the identical board with no network at all, so a
--      signed-out or offline player is never blocked: this table is an override
--      and a provenance record, not the source of the board.
--
-- NOT A REPLACEMENT FOR daily_puzzles. `get-todays-puzzle` lazily INSERTs into
-- daily_puzzles and stamps puzzle_bank.used_on; a second writer for the same
-- (game_type, puzzle_date) would collide on its UNIQUE index. The two systems
-- stay on separate tables behind separate endpoints.
--
-- Additive and re-runnable. No existing object is modified.

create table if not exists public.daily_challenge (
  puzzle_date    date     not null,
  game_type      text     not null,
  tier           text     not null check (tier in ('easy','medium','hard','hardest')),
  band           smallint not null check (band between 0 and 2),   -- never 3, see above
  is_featured    boolean  not null default false,
  mode           text     not null default 'recipe' check (mode in ('recipe','payload')),
  recipe         jsonb    not null default '{}'::jsonb,   -- {seed, bank_ref, mods}
  payload        jsonb,                                   -- novel content only
  solution       jsonb,                                   -- never leaves the server
  source_bank_id uuid references public.puzzle_bank(id),
  status         text     not null default 'draft'
                 check (status in ('draft','approved','published','rejected')),
  checks         jsonb    not null default '{}'::jsonb,   -- src/core/checks.mjs verdict
  ai_review      jsonb,                                   -- groq-review verdict
  generated_by   text,
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  -- Composite PK gives Friday its six rows AND makes `/genmonth` idempotent
  -- for free: re-running it is `on conflict do nothing`.
  primary key (puzzle_date, game_type)
);

alter table public.daily_challenge enable row level security;

-- NO CLIENT POLICIES, INTENTIONALLY — same posture as puzzle_bank and
-- level_keys. Rows are authored AHEAD of time, so a readable table would let
-- anyone fetch next Friday's board. All reads go through the
-- `get-daily-challenge` Edge Function, which refuses any future date outright.

create index if not exists daily_challenge_date_idx
  on public.daily_challenge (puzzle_date desc);

-- Exactly one headline game per date. A partial unique index rather than an
-- application check, so a buggy bot run cannot produce a day with two features.
create unique index if not exists daily_challenge_one_featured
  on public.daily_challenge (puzzle_date) where is_featured;

-- Covering index for the FK (matches the daily_puzzles_source_bank_idx pattern
-- added in Round 2 for the same advisor finding).
create index if not exists daily_challenge_source_bank_idx
  on public.daily_challenge (source_bank_id);
