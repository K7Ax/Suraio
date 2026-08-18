-- zayid_ghosts: recorded "past player" attempts that power «زايد»'s ghost
-- opponent. A player faces a real (or seed) human's recorded attempt instead of
-- an adaptive bot. Purely ADDITIVE — no existing object is touched, safe on prod.
--
-- Read is open to everyone (anon + auth) so every visitor always has an
-- opponent; write is limited to signed-in players inserting their OWN attempt.
-- The bundled bank (bank/saudi/zayid_ghosts.json) seeds gameplay until real
-- rows accrue here, and the client always falls back to it if this table is
-- empty or absent.

create table if not exists public.zayid_ghosts (
  id         bigint generated always as identity primary key,
  category   text not null,
  name       text,
  claimed    int  not null check (claimed   >= 0 and claimed   <= 200),
  delivered  int  not null check (delivered >= 0 and delivered <= 200),
  items      jsonb not null,
  player_id  uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists zayid_ghosts_category_idx on public.zayid_ghosts (category);

alter table public.zayid_ghosts enable row level security;

-- read: open to all (anon + authenticated) so everyone has an opponent
drop policy if exists zayid_ghosts_read on public.zayid_ghosts;
create policy zayid_ghosts_read on public.zayid_ghosts
  for select using (true);

-- write: signed-in players may only insert rows attributed to themselves
drop policy if exists zayid_ghosts_insert on public.zayid_ghosts;
create policy zayid_ghosts_insert on public.zayid_ghosts
  for insert to authenticated
  with check (player_id = auth.uid());

-- ── A9 (audit, August 2026) — content validation ────────────────────────────
--
-- STATUS FIRST: this table does NOT exist in production. `to_regclass` returns
-- null and there are zero policies on it, so this migration has never been
-- applied. A9 was reported as a live High; it is not. It is a defect in an
-- unapplied file, and the fix below is here so that applying it later is safe.
--
-- WHAT WAS WRONG. The ownership check above is correct and was never the
-- problem. The CONTENT was unchecked: `claimed`, `delivered` and `items` came
-- straight from the client bounded only by CHECK (0..200), while the read
-- policy is `using (true)`. Any signed-in account could therefore inject
-- fabricated ghost opponents that EVERY anonymous visitor then plays against —
-- a write by one user that changes the game for all of them, which is the one
-- shape a per-row ownership policy cannot catch.
--
-- Three constraints, chosen because each rules out a specific abuse rather than
-- being generically "stricter":
--
--   1. delivered <= claimed — a ghost cannot deliver more than it bid. This is
--      the rule of the game itself, and violating it makes an unbeatable
--      opponent.
--   2. `items` must be a JSON array of at most 200 short text entries. Without
--      a shape check, `items` is an unbounded jsonb the client chooses — both a
--      storage cost and a route for junk into every visitor's screen.
--   3. player_id NOT NULL. It defaulted to auth.uid(), and a default is not a
--      constraint: an explicit null passes `player_id = auth.uid()` in no useful
--      way and leaves an unattributable row. Ownership must be recorded, not
--      merely defaulted.
--
-- Note the text inside `items` still needs escaping on render. It gets it —
-- `escapeHtmlShared` covers that path — and this constraint does not replace it.

alter table public.zayid_ghosts
  add constraint zayid_ghosts_delivered_le_claimed
  check (delivered <= claimed) not valid;

alter table public.zayid_ghosts
  add constraint zayid_ghosts_items_shape
  check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= 200
    and not exists (
      select 1 from jsonb_array_elements(items) e
      where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 60
    )
  ) not valid;

alter table public.zayid_ghosts alter column player_id set not null;

-- `not valid` on the two CHECKs so the statements never fail against rows that
-- predate them. The table is empty today, so validate immediately; if it is not
-- empty when you run this, clean the offenders first and then validate.
alter table public.zayid_ghosts validate constraint zayid_ghosts_delivered_le_claimed;
alter table public.zayid_ghosts validate constraint zayid_ghosts_items_shape;

-- Per-player ceiling. Without it one account can fill the pool and become every
-- visitor's only opponent, which is the same defect as unvalidated content
-- arriving by a different door.
create unique index if not exists zayid_ghosts_one_per_player_category
  on public.zayid_ghosts (player_id, category);
