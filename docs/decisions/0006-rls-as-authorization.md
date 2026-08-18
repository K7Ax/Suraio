# 0006 — RLS is the authorization layer, and the anon key is public on purpose

**Status:** accepted · **Date:** 2026-06 · **Affects:** `supabase/migrations/`, `supabase/sql/`, `index.html`

## Context

`window.SURA_CONFIG` in `index.html` contains the Supabase project URL and the
**anon/publishable key**, in plain text, in a file served to everyone.

This reliably reads as a leaked credential. It is not one, and the distinction
matters enough to write down, because the wrong reaction to it — hiding the key
— produces a system that is less secure while feeling more so.

The anon key identifies the *project*, not a *user*. It grants exactly what
Postgres row-level security grants an unauthenticated role, which is why the
security boundary must live in the database rather than in the client's
possession of a string. A key that must be secret to be safe is a key that will
eventually be extracted from a bundle, a network tab, or a mobile app.

## Decision

**RLS is the authorization layer. Tighten it, never disable it.**

Every user-owned table scopes rows to their owner. Anything that must run with
elevated rights is a `SECURITY DEFINER` RPC with its own explicit checks — the
`dash_*` functions behind the admin dashboard are gated to the owner's email
inside the function, not by hiding the dashboard's URL. The service role key
exists only in the Supabase Edge Function environment and in an operator's local
`.env`; it never appears in a bundle, and `dist.js` scans for it
([0002](0002-deploy-whitelist.md)).

The client is never trusted for results either. `submit-guess` re-evaluates
every guess server-side against the secret solution rather than accepting a
verdict, and `get-todays-puzzle` does not return the answer.

Consequent rules, written into `docs/operations/ai-agent-rules.md` so that
automated contributors inherit them:

- RLS may be tightened, never disabled, not even temporarily to debug.
- `supabase/functions/` is the source of record; a function edited in the
  dashboard is a fact that exists nowhere in version control.
- Migrations are applied by hand through the SQL editor. `supabase db push` is
  never used, and the schema snapshot is never re-applied.

## Consequences

**A measured second-order benefit.** Because authorization lives in the database
and the games are generated client-side from content banks, the site degrades
gracefully rather than failing. With the backend fully unreachable, all six
games remain playable — what is lost is leaderboard, XP sync, and account state,
not the product. That was verified, not assumed.

**What it costs.** The security posture is only as good as the policies, and
policies are easy to get subtly wrong. This is why the test suite includes live
integration tests that attempt cross-user reads against the real backend, and
why those tests are skipped in CI (`SURA_SKIP_INTEGRATION`) but run locally —
hermetic CI is worth more than a policy check that hits production on every
push, but the check itself is not optional.

**An accepted trade-off elsewhere:** the merged email-first auth flow calls an
`email_available` RPC, which permits account enumeration. It was weighed against
the alternative — asking every user to declare "sign in or sign up" before
knowing which they are — and the usability win was judged larger than the
disclosure. Recorded here so it is a decision, not a hole.
