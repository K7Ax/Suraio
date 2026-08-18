# 0010 — A persisted "done" flag needs a version, because fixing the writer is half a fix

**Status:** accepted · **Date:** 2026-08-17 · **Affects:** `backfillServerProgress` in `src/main.js`

## Context

Sura is playable signed out; progress lives in `localStorage`. On sign-in,
`backfillServerProgress` replays that local progress to the server so an
anonymous run is not lost, then writes a flag so it never runs twice:

```js
const done = `sura.${uid}.serverBackfill`;
if (localStorage.getItem(done)) return;
```

The report was that one specific account **stopped counting points entirely**,
while a brand-new account created minutes later on the same device counted
normally. That shape — one account broken, a fresh one fine — usually points at
corrupted server state for that user.

## The actual mechanism

It was not server state. An earlier build raised the flag **even when the
backfill failed partway through**.

Once raised, reading it is unconditional, so the failure became permanent. The
account's server-side frontier stayed at 0. And because `submit-progress` gates
on ordering — a level is allowed only if `level <= contiguousFrontier + 1`
([0005](0005-server-authoritative-xp.md)) — every genuine win afterwards was
answered `403 level_locked`.

**Silently.** The client had no branch for that response, so a real win produced
a normal win animation and zero XP, forever, with nothing in the UI to indicate
anything had gone wrong. A new account has no flag to burn, starts at frontier
0, and climbs normally — which is exactly why the fresh account looked healthy
and made the bug look account-specific.

## Decision

Two changes, and the second is the one worth recording:

1. The flag is now raised **only on success** — the obvious fix, which repairs
   every account that has not yet burned a flag.
2. **The key is versioned:** `sura.${uid}.serverBackfill.v2`. Accounts already
   poisoned by the old logic read a key that does not exist, so the corrected
   backfill runs once for them.

Fixing the writer does nothing for state that was already written. The data
outlives the bug, so the repair has to reach the data.

## Consequences

**Re-running is free, and that was checked before shipping.** `submit-progress`
is idempotent per `(user, game, level)`: a replay refreshes `best_time`,
credits no XP, returns `{already: true}`, and — because `bump_ai_usage` is
called *after* that early return — consumes no rate-limit quota. Versioning the
key is safe precisely because the server was built to tolerate exactly this.

**The generalizable rule.** A persisted flag is a promise about the past. When
the code that made the promise was wrong, changing that code changes only future
promises — every already-broken client keeps reading the old lie. Either the
flag gets a version, or a migration has to go find and clear it. Silently
leaving it is the option that looks like a fix and is not.

**The diagnostic lesson.** "One account broken, a new account fine" reads as
server-side user state. It was client-side persistence. The distinguishing test
was cheap and should have been first: clear that key and see if the account
recovers.

**Left open, deliberately:** the client still does not surface `403
level_locked`. A silent server rejection is exactly the condition that made this
invisible for weeks, and it should get a visible failure path. Recorded as a
known gap rather than claimed as fixed.
