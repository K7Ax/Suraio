# 0005 — The server, not the client, decides what a level is worth

**Status:** accepted · **Date:** 2026-07-22 · **Affects:** `supabase/functions/submit-progress/`, `player_progress`, `player_totals`

## Context

The campaign is 21 levels across six games, and finishing one awards XP that
feeds a **global leaderboard**. For most of the project's life, the client
computed its own XP and wrote it to the database, and the leaderboard read what
was written.

That is not a leaderboard. It is a form where players submit their own scores.
Anyone with a browser console could name their own rank, and nothing in the
system could tell the difference between that and a real win — because there
*was* no difference, structurally.

A leaderboard nobody can trust is worse than no leaderboard: it consumes the
same effort from honest players and returns nothing.

## Decision

Progress goes through one Edge Function, `submit-progress`, and the client's
claimed score is **not an input to it**. Every gate is structural:

| Gate | Rule |
|---|---|
| Identity | Valid session, and `email_confirmed_at` must be set — otherwise `403 email_not_verified` |
| XP amount | Server-side from a band table: `BAND_XP = [20, 35, 55]`, indexed by level band (6 easy / 9 medium / 6 hard). **The client cannot name a number.** |
| Ordering | `level <= contiguousFrontier(cleared) + 1`, otherwise `403 level_locked`. You cannot jump to level 20. |
| Replay | Idempotent per `(user, game, level)`. A repeat refreshes `best_time` and returns `{credited: false, already: true}` |
| Rate | 6 new clears per minute → `429 too_fast`; plus `bump_ai_usage(kind='progress', cap=60)` |

Client-write RLS on `submissions` and `streaks` was dropped in the same change,
and the `game_events` insert path was hardened against spoofing a different
user's id. Leaving the write paths open while adding a strict function would
have been theatre.

`player_totals` is **derived** from `player_progress` on every write rather than
incremented. That makes the totals self-healing: a row corrupted by any means is
corrected by the next legitimate submission, because the recomputation reads the
underlying facts rather than trusting the running tally.

## Consequences

**Ordering.** `bump_ai_usage` is called *after* the `already` early-return. This
is deliberate and load-bearing: a client retrying on a flaky connection must not
burn quota for a level it already cleared. Quota is spent on new work only.

**Honest limitation — this proves structure, not skill.** The server verifies
that a level was reached in a legal order at a legal rate. It does not verify
that a human solved the puzzle. A patient script that plays levels in sequence
at a believable pace is indistinguishable from a patient player, and that is
accepted: the goal was to close *trivial* forgery, and casual leaderboard
forgery is now impossible without effort exceeding just playing the game.

**Cost.** A round trip per level completion, and a failure mode where a real win
is rejected. That last one bit — see [0010](0010-versioned-migration-flags.md).

## Related

[0006](0006-rls-as-authorization.md) · [0010](0010-versioned-migration-flags.md)
