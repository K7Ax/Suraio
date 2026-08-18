# `supabase/sql/` — hand-applied SQL

There are two SQL directories in this repository and they are not
interchangeable. This one exists because the project has always applied schema
changes by pasting them into the Supabase SQL Editor, and pretending otherwise
would have meant renaming files to imply a migration history that was never run
by a migration tool.

| Directory | What it is | How it is applied | Ordering |
|---|---|---|---|
| `supabase/migrations/` | The CLI-shaped ledger. Timestamped `YYYYMMDD_NN_name.sql`. | Applied to production, in order. Some via the Supabase MCP `apply_migration`, some by hand. | Filename order is meaningful |
| `supabase/sql/` (here) | Scripts written to be pasted into **Supabase → SQL Editor → Run** by the owner. | Manually, one at a time, when the accompanying feature shipped. | **No global order.** Each file states its own prerequisites |

**Never run `supabase db push`.** It is not how this database has ever been
changed, and the local ledger is not a faithful replay of production. Migrations
stay a manual SQL-Editor paste. Only Edge Function deploys go through the CLI.

## Files

Everything here is either already applied, deliberately optional, or explicitly
marked never-run. The "Run?" column is the part to read first.

| File | Run? | What it does |
|---|---|---|
| `game_events.sql` | applied | Creates `game_events`, the analytics table — the only table a browser may write to. |
| `20260813_01_game_events_budget.sql` | applied | Adds a per-device insert budget to `game_events` (audit finding F1). |
| `dashboard_rpcs.sql` | applied | The admin dashboard's read API: `SECURITY DEFINER` aggregate functions, each gated on the owner's email, so no raw rows leave the database. |
| `harden_result_writes.sql` | applied | Makes gameplay results server-authoritative at the RLS layer and stops analytics user-id spoofing. |
| `leaderboard.sql` | applied | Server-authoritative leaderboard and stats foundation. |
| `email_available.sql` | applied | `email_available(text)` — backs the merged email-first auth gate. |
| `feedback_and_ratings.sql` | applied | `feedback_reports`, `game_ratings`, `dash_reports`, `dash_ratings`, `report_month`. |
| `20260815_01_site_settings.sql` | applied | Site settings table + opens analytics to the Telegram bot. |
| `20260815_02_honest_player_metric.sql` | applied | Separates two numbers that were both being called "players". |
| `20260815_03_fix_report_month_ratings.sql` | applied | Hotfix for a broken `/report`. |
| `migrations_pending.sql` | **check first** | A batch of three migrations bundled for one paste. Self-describing as pending; whether it still is depends on production, not on this file. Verify against the live schema before running anything in it. |
| `zayid_ghosts.sql` | **not applied** | Ghost-opponent table for «زايد». Confirmed unapplied (`to_regclass('public.zayid_ghosts') → null`). Its consumer `src/games/zayid.js` is not in `LIVE_GAMES`, so nothing is broken by leaving it. |
| `OPTIONAL_purge_pre_launch_events.sql` | **optional, destructive** | Deletes pre-launch analytics rows. Its own header says to read it in full first. Owner's decision, not a default. |
| `allow_new_game_types.sql` | ⛔ **never** | Superseded draft — see below. |
| `db-security-definer.sql` | ⛔ **never** | A photograph of four production `SECURITY DEFINER` function bodies, captured for audit finding A20 because their source existed nowhere in the repo. Like `_current_schema_snapshot.sql`, re-applying a photograph overwrites whatever changed since it was taken. |
| `seed.sql` | generated | Puzzle-bank seed. **Not tracked in git** — it is build output (regenerate with `node scripts/bank/gen_seed_sql.js`) and it is a 193 KB answer key, with the solution to every seeded puzzle in plaintext. |

### `seed.sql` was two months stale

The copy sitting in the repo on 2026-08-15 had been generated on 15 June and
never refreshed. It contained `letterboxed=30, strands=12`; regenerating it from
the current banks gives `letterboxed=78, strands=30`, because Round 8 rebuilt
both banks (صندوق الحروف to 78 calibrated boards, خيوط to 30 Saudi themes) and
nobody re-ran the generator afterwards.

Two things follow, and only the first is a fact about this repo:

1. A generated file that is not regenerated is a lie with a timestamp. It is now
   gitignored, so the generator is the only source and the staleness cannot
   recur silently.
2. **For the owner:** if `seed.sql` was ever pasted into production, it seeded
   the *June* boards. The newer Letter Boxed and Strands boards were never
   inserted into `puzzle_bank`. Whether that matters depends on whether
   `puzzle_bank` still feeds anything the players see, or whether
   `daily_challenge` has fully taken over — worth checking before launch, and
   not something this reorganization changed either way.

Re-running the generator is safe regardless: every INSERT is guarded by a
`WHERE NOT EXISTS` on a signature computed from *sorted, normalised* words, so
it is content-addressed and idempotent.

### The `allow_new_game_types.sql` trap

An earlier audit recorded this file as a duplicate of
`supabase/migrations/20260622_01_allow_new_game_types.sql` and recommended
deleting one of them "after verifying they are identical".

They are not identical. Verified during the 2026-08 reorganization:

```
8aefef7c6f0d5ae69382a0ae691f2ef7  supabase/sql/allow_new_game_types.sql
0e0ed2303101db3f1db3bf812ea47f7a  supabase/migrations/20260622_01_allow_new_game_types.sql
```

The migration allows ten game types. This file allows nine — it predates
«أمثال» and omits `'amthal'`. Since the script DROPs the existing CHECK before
re-adding its own, running it today would narrow the constraint and every
«أمثال» insert would start failing. It is kept, with a header saying so, rather
than deleted: the record of what was drafted is worth more than the tidiness of
removing it, and a file that looks like a harmless twin is worse than one
labelled as a trap.

## Adding a schema change

Write a new timestamped file in `supabase/migrations/`, apply it by hand, and
say in its header that it was applied and when. Do not add to this directory —
it is a record of how the schema got here, not the place new work goes.
