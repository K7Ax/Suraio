-- Authoring round (2026-08-01). `authored_items` — the staging table for AI
-- content PROPOSALS, before any of them is bank content.
--
-- WHY A STAGING TABLE AND NOT A DIRECT WRITE INTO bank/*.json:
--   Constitution §8 requires a human approval that no AI verdict replaces. If
--   `/author` wrote the file, the approval would be «the operator did not
--   immediately revert it», which is not an approval. A row that has to move
--   proposed → adopted by an explicit command IS one, and it leaves the record
--   of who adopted what and when — the same four-step shape `daily_challenge`
--   already uses (draft → approved → published).
--
-- WHY IT IS NOT `daily_challenge`:
--   That table schedules a DATE. This one holds content with no date at all: an
--   adopted proverb enters the bank and is then eligible for every future
--   rotation. Same reason `puzzle_bank` and `daily_puzzles` are two tables.
--
-- AUTHORITY: RLS on, **zero client policies** — exactly like `puzzle_bank`. The
-- only writer is bot.js via the service role. There is no reader either: nothing
-- in the browser has any business seeing unreviewed AI output, and a proposal
-- that leaked would be indistinguishable from shipped content to a player.
--
-- Re-runnable. Additive. Login/auth untouched.

create table if not exists public.authored_items (
  id           uuid primary key default gen_random_uuid(),
  game_type    text not null,
  band         smallint not null check (band between 0 and 2),   -- never 3
  -- The proposal exactly as it will enter the bank file. Stored whole so that
  -- adopting is a copy, not a re-derivation that could drift from what was
  -- reviewed.
  item         jsonb not null,
  -- Normalised identity (core/authoring foldKey). Carried as a column rather
  -- than recomputed on read so the unique index below can exist at all.
  fold_key     text not null,
  status       text not null default 'proposed'
               check (status in ('proposed','adopted','rejected')),
  -- The checker's verdict, recorded at proposal time. A row that never passed
  -- must still be inspectable: a recurring gate failure is the signal that the
  -- prompt is wrong, and deleting the evidence hides it.
  checks       jsonb not null default '{}'::jsonb,
  gate_ok      boolean not null default false,
  model        text,
  prompt_hash  text,          -- which prompt produced it, for A/B on quality
  generated_by text,
  created_at   timestamptz not null default now(),
  adopted_at   timestamptz,
  adopted_by   text,
  reject_reason text
);

-- One proposal per (game, identity). Re-running `/author` after a bad batch must
-- be a no-op on the items it already produced rather than a pile of duplicates
-- the operator has to read twice — the same idempotence `/genmonth` has, and for
-- the same reason: a command that is unsafe to re-run will be re-run anyway.
create unique index if not exists authored_items_identity
  on public.authored_items(game_type, fold_key);

-- The operator's actual query: «what is waiting for me in أمثال?»
create index if not exists authored_items_pending
  on public.authored_items(game_type, status, created_at desc);

alter table public.authored_items enable row level security;

-- No policies, deliberately. Not an oversight: with RLS enabled and no policy,
-- anon and authenticated get nothing at all, and the service role bypasses RLS.
-- That is precisely the intended reach — the operator's machine, and nothing else.

comment on table public.authored_items is
  'AI content proposals awaiting human adoption. Written only by bot.js /author via the service role; adopted rows are copied into bank/*.json in the repo. No client policies by design.';
