# Database

Postgres on Supabase (project `sura` / `uqgndtsfrbgmgpqhuaeh`). A full, read-only
snapshot of the live schema lives in
[`supabase/migrations/_current_schema_snapshot.sql`](../../supabase/migrations/_current_schema_snapshot.sql)
(reference only — not re-appliable). This page is the human summary.

## Tables (all have RLS enabled)

| Table | Owner column | Purpose | Public read? |
|---|---|---|---|
| `profiles` | `id = auth.uid()` | username / display name / avatar | yes (names are public) |
| `puzzle_bank` | — (service role only) | curated/generated puzzle pool + solutions | **no** (`USING false`) |
| `daily_puzzles` | — | the materialized puzzle per game per day | **no** — all client policies dropped in Round 2 (S1); service role only |
| `daily_challenge` | — | the weekday-graded «تحدي اليوم» board, kept apart from `daily_puzzles` | **no** |
| `submissions` | `user_id` | per-user attempts/score | **owner read only** — client writes dropped in Round 3 (S7) |
| `streaks` | `user_id` | per-game streak + totals | public read; **client writes dropped** in Round 3 (S8) |
| `player_progress` | `user_id` | one row per level cleared; PK is the idempotency key | owner read; service-role writes |
| `player_totals` | `user_id` | the global-leaderboard projection, recomputed from `player_progress` | public read; service-role writes |
| `level_keys` | — | optional per-level answer key; when a row exists `submit-progress` re-validates the proof | **no** (RLS on, no policies) |
| `game_events` | `user_id` (nullable) | analytics | **no** (insert-only) |
| `ai_usage` | `user_id` | per-user/day AI call counter (rate limiting) | **no** (RLS-locked, no policies) |

Key constraints: `profiles.username` unique + regex-checked (3–20 chars,
ASCII/Arabic), `submissions` unique `(user_id, puzzle_id)`, `daily_puzzles` unique
`(game_type, puzzle_date)`, `game_events.event_type` checked to 9 analytics types,
`puzzle_bank`/`daily_puzzles` `game_type` checked to all **10** game types
(widened in Round 2).

## RLS policy summary

- `submissions`: **read only**, gated `auth.uid() = user_id`. The client
  `INSERT`/`UPDATE` policies were dropped in Round 3 — they allowed any signed-in
  user to POST a forged result straight to `/rest/v1/submissions` and bypass
  `submit-guess`. All result writes now go through the Edge Function on the
  service role.
- `profiles`: public read; update only self.
- `streaks`: public read (leaderboard); **no client writes** — `streaks_write_self`
  was dropped in Round 3 (S8); `submit-guess` writes them on the service role.
- `player_progress` / `player_totals`: owner and public read respectively;
  writes are service-role only, from `submit-progress`.
- `puzzle_bank`: denied to anon + authenticated entirely.
- `daily_puzzles`: **no client policies** (Round 2 — S1 fixed). Read only by the
  service-role functions; client reads denied, so the `solution` column is safe.
- `game_events`: anon+auth INSERT only; no SELECT → reads denied.
- `ai_usage`: RLS enabled with **no policies** → unreachable via the public API;
  only `bump_ai_usage()` (SECURITY DEFINER) touches it.

## Functions & triggers

- **`get_leaderboard_today(game, limit)`** — DEFINER; the only sanctioned read of
  the leaderboard projection. limit clamped 1..100 in the calling function.
- **`is_sura_admin()`** — owner-email gate used by all `dash_*` functions.
- **`dash_overview/games/level_health/funnel/daily`** — admin analytics over
  `game_events`; each raises `not authorized` unless `is_sura_admin()`.
- **`normalize_arabic(text)`** — Arabic folding; **must stay in sync** with the JS
  `normalizeArabic()` in `submit-guess` or scoring will diverge.
- **`set_username` / `username_available`** + `enforce_username_rules`,
  `username_is_clean` triggers — username validation/uniqueness. (`set_username`
  is now `authenticated`-only; the other two have a pinned `search_path`.)
- **`bump_ai_usage(kind, cap)`** — DEFINER counter behind the AI rate limit;
  increments `ai_usage` for `auth.uid()` and returns whether under the cap.
- **`handle_new_user()`** — trigger that creates a `profiles` row on signup.
- **`submissions_guard()`** — submission-integrity trigger.

## Indexes

PKs on every table; useful secondary indexes on `daily_puzzles(puzzle_date)`,
`submissions(puzzle_id, completed, score DESC)` and `(user_id, submitted_at DESC)`,
and the `game_events` time/device indexes. Round 2 added the two missing FK
covering indexes (`daily_puzzles_source_bank_idx`, `game_events_user_idx`).

## Migration workflow

- SQL lives in two directories under `supabase/`, and they are not
  interchangeable — `supabase/sql/README.md` is the authority on which is which:
  - `supabase/migrations/` — the timestamped, CLI-shaped ledger.
  - `supabase/sql/` — scripts written to be pasted into the SQL Editor by hand
    (analytics table, dashboard RPCs, leaderboard, feedback). Formerly the
    top-level `migrations/` directory.

  Round 2 migrations were applied directly via Supabase MCP `apply_migration`
  (`allow_new_game_types`, `harden_daily_puzzles_solution_exposure`,
  `ai_usage_rate_limit`, `advisor_cleanups_round2`,
  `restrict_set_username_to_authenticated`).
- **Apply** via Supabase MCP `apply_migration` or the SQL Editor. The harness
  blocks destructive prod SQL — run deletes manually in the SQL Editor.
- The snapshot file (`_current_schema_snapshot.sql`) is **never** re-applied; it
  is documentation of the deployed state.
- `supabase/sql/seed.sql` seeds `puzzle_bank`. Apply manually. It is **generated
  and gitignored** — regenerate with `node scripts/bank/gen_seed_sql.js` rather
  than expecting it in a fresh clone, and note that the copy in the working tree
  can be older than the banks it was built from.

## Backend hardening — status

Round 2 (2026-06-22) is **done**: S1, A1, A2, A3, search_path, RLS-initplan, and
FK indexes are applied and verified. Remaining items are intentional or
owner-action only — see the "Remaining" table in [`security.md`](../security/security.md).
