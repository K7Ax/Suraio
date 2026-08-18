# Security

This documents the **current** security posture, the live Supabase advisor
findings (captured 2026-06-22), and the prioritized remediation plan. It does not
itself change anything.

## Trust model (the load-bearing principles)

1. **The client is never trusted for results.** `submit-guess` re-evaluates every
   guess server-side against the secret solution and computes score itself.
2. **RLS is the real authorization layer**, not the frontend and not key secrecy.
   Every user-owned row is scoped to its owner via `auth.uid()`.
3. **The Supabase anon/publishable key is public by design.** It is safe in
   `index.html`. Never confuse it with the **service role key**, which bypasses
   RLS and must live only server-side (`bot.js`, Edge Function secrets).
4. **Secrets never enter the repo.** `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   and `BOT_TOKEN` are set in the environment / Supabase secrets only.

## Secret inventory

| Secret | Where it lives | Exposure |
|---|---|---|
| `SUPABASE_ANON_KEY` (`sb_publishable_…`) | `index.html`, `dashboard.html` | **Public — OK** (RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secrets + `bot.js` env | Server-only — must never reach the browser |
| `GROQ_API_KEY` | Supabase Edge Function secrets | Server-only |
| `BOT_TOKEN`, `ADMIN_IDS` | `bot.js` env | Server-only |
| `ADMIN_EMAIL` (owner) | `dashboard.js`, DB functions | Identity, not a secret |

Open items — anything not yet closed, plus the owner-side actions still
outstanding — are tracked in `docs/security/open-findings.md`, which is **not
published**. That file is a live list of what is currently weakest about a
running service, which is the one document that genuinely does help an attacker
more than it helps a reader. What is closed is below, with its mechanism.

## What is already good

- `submit-guess` requires `email_confirmed_at`, re-validates guesses, and upserts
  with a unique `(user_id, puzzle_id)` constraint (idempotent, dup-safe).
- RLS enabled on **all** public tables. `submissions` are owner-scoped (a user
  cannot read another user's submissions). `puzzle_bank` is fully locked
  (`USING (false)`) to anon + authenticated — solutions reachable only by the
  service role.
- `game_events` is insert-only (no SELECT policy ⇒ reads denied to the public API).
- Admin analytics (`dash_*`) are SECURITY DEFINER **and** gated by
  `is_sura_admin()` (owner-email check) **and** `revoke`d from anon.
- The security-critical functions (`submit-guess`, `groq-hint`, `groq-review`)
  have `verify_jwt = true`, so the platform verifies the token signature before
  the function runs — the in-function claim reads are therefore trustworthy.

## Round 2 — RESOLVED (2026-06-22)

Applied via migrations in `supabase/migrations/` and redeployed Edge Functions.
Re-ran the linter afterwards to confirm.

| # | Finding | Resolution |
|---|---|---|
| S1 | `daily_puzzles` exposed the `solution` column over REST | **Dropped** the public SELECT policy (`harden_daily_puzzles_solution_exposure`). The table is now read only by the service-role functions; RLS denies all client reads. Verified: 0 policies remain. |
| S2 | mutable `search_path` on two functions | `ALTER FUNCTION … SET search_path = public, pg_catalog` (`advisor_cleanups_round2`). Verified set. |
| S3a | `set_username` callable by **anon** | Revoked from `PUBLIC`, granted to `authenticated` only (`restrict_set_username_to_authenticated`). Verified anon = false. |
| A1 | `submit-guess` ignored `time_seconds` | Now reads it, clamps to 1s..24h, and records it on the **first completion only** (no re-posting a faster time). Redeployed (v4). |
| A2 | No AI rate limiting | New RLS-locked `ai_usage` table + `bump_ai_usage()` SECURITY DEFINER counter; `groq-hint` cap 40/user/day (→ local fallback), `groq-review` cap 200/day. Redeployed. |
| A3 | `allow_new_game_types` unapplied | Applied; the CHECK now allows all 10 game types. The newer games remain **client-side/offline by design** — see note below. |
| Perf | `auth_rls_initplan` on profiles/submissions/streaks | Policies rewrapped as `(select auth.uid())`. Verified. |
| Perf | unindexed FKs | Added `daily_puzzles_source_bank_idx`, `game_events_user_idx`. |

## Round 3 — RESOLVED (2026-07-22)

Applied via `supabase/sql/harden_result_writes.sql` (MCP `apply_migration`). Re-ran
the linter afterwards to confirm.

| # | Finding | Resolution |
|---|---|---|
| S7 | **Leaderboard forgery.** `submissions` had client `INSERT`/`UPDATE` RLS policies (`submissions_insert_self`/`_update_self`, gated only on `auth.uid()=user_id`), and `submissions_guard` never validated `score`/`completed`/`time_seconds`. Any signed-in user could POST directly to `/rest/v1/submissions`, bypass `submit-guess`, and forge a perfect top-of-board entry. | **Dropped** both write policies (kept `submissions_read_self`). All result writes now flow only through `submit-guess` (service role, bypasses RLS). **Hardened `submissions_guard`**: `completed`/non-zero `score` allowed only for the service role; `score` clamped 0..100000; `time_seconds >= 1`. The client only ever *read* these tables, so zero client impact. Verified: only the read policy remains. |
| S8 | `streaks_write_self` (`FOR ALL`) let a client forge their own streak totals, and duplicated SELECT coverage (perf advisor). | **Dropped** `streaks_write_self` (kept `streaks_read_public`). `submit-guess` writes streaks via the service role. Verified: `multiple_permissive_policies` advisor on `streaks` is gone. |
| S6 | `game_events` INSERT `WITH CHECK (true)` allowed a signed-in actor to attribute analytics events to another `user_id`. | Tightened to `WITH CHECK (user_id IS NULL OR user_id = (select auth.uid()))`. Anonymous ingest (null `user_id`) still works. (Previously listed as "intentional" — the user-id-spoofing angle was the real gap; full anti-poisoning would need server-side ingest.) |

## Remaining

Tracked in `open-findings.md` (unpublished, see above). Most entries there are
deliberate rather than defects — anon-callable RPCs that exist to serve signup
and the public leaderboard, and admin RPCs that enforce their own guard — but
the list also names what is not yet hardened, and that half is the reason the
file stays private.

## Reporting / rotation

To report a vulnerability, see [`SECURITY.md`](../../SECURITY.md) at the
repository root — it carries the contact address, the disclosure window, and the
rules for testing against a live service.

Operationally, if a secret is exposed the response is: rotate the key, redeploy,
and audit recent access. The step-by-step runbook (`docs/operations/incident-runbook.md`)
is **not published** — it names monitoring endpoints and the order of operations
during an incident, which is a description of when the service is least defended.
