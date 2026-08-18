# Load test — 10 → 50 → 75 → 100 concurrent · 10 August 2026

**`npm run loadtest`** · `scripts/qa/loadtest.js` · read-only against production.

The question is not whether the site serves files fast. Cloudflare Pages serves
static assets off an edge cache with no request ceiling on the free plan. The
question is **Supabase**: one free-tier project, a 500,000 monthly invocation
quota, and — measured in the August security round — no effective rate limit on
the open endpoints. That is the part that can fall over, so that is what was
measured.

---

## Result

**All four waves passed at 100.00%.** Zero errors, zero timeouts, zero 429s,
zero 5xx. The gate was ≥99.7%.

| concurrent | requests | duration | rps | success | p50 | p95 | p99 | bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 90 | 23.6s | 3.8 | **100.00%** | 562ms | 955ms | 997ms | 32k |
| 50 | 450 | 27.1s | 16.6 | **100.00%** | 540ms | 1742ms | 3696ms | 158k |
| 75 | 675 | 25.6s | 26.3 | **100.00%** | 506ms | 1899ms | 2232ms | 238k |
| 100 | 900 | 25.9s | 34.8 | **100.00%** | 513ms | 1873ms | 2662ms | 317k |

Status distribution across all 2,115 requests: **`200 × 2115`**. Nothing else.

Quota spent: **2,115 invocations = 0.42%** of the monthly 500k.

---

## The number that matters most is p50, and it is flat

`562 → 540 → 506 → 513 ms` while concurrency goes up **tenfold**.

A service that is running out of capacity shows it in the median first: requests
begin queueing behind each other and the typical request gets slower. This median
does not move at all — the 100-player wave is served as quickly as the 10-player
wave. **There is no contention at 100 concurrent.** The waves were not a stress
test of the backend; they were a demonstration that 100 is nowhere near it.

The tail does move, and it is worth being precise about why rather than blaming
the endpoint.

## Per-endpoint p95 — and the thundering herd

| concurrent | `get-daily-challenge` | `get-leaderboard?board=global` | `get-leaderboard?game=` |
|---:|---:|---:|---:|
| 10 | 982ms | 651ms | 806ms |
| 50 | 1789ms | 885ms | 1607ms |
| 75 | 2070ms | 600ms | 604ms |
| 100 | **2493ms** | 604ms | 596ms |

The two leaderboard endpoints are **flat — ~600 ms at 75 and at 100**, no worse
than at 10. Only `get-daily-challenge` climbs.

That is not because it is a slower endpoint. It is because of **where it sits in
the session**: it is the first request every virtual player makes, so all N fire
it in the same instant, with no jitter in front of them. The other two arrive
after randomised human-length pauses and are therefore spread across the wave.

So the table is measuring two different things, and both are useful:

- **`get-daily-challenge` p95 = 2.5 s at 100** is the honest answer to *"a link
  goes round a group chat and a hundred people open it at the same second."*
  Nobody gets an error; the slowest few wait about two and a half seconds.
- **~600 ms flat** is the answer for load that is merely heavy rather than
  perfectly synchronised — which is what real traffic looks like.

Two mitigations already in the code keep the first case rarer than the number
suggests: `fetchDaily` caches the response for the day, so a player who opens a
second game makes no second request; and the daily plan is a pure function of the
date (`src/core/daily.mjs`), so a failure there costs provenance, not
playability. A player whose request is slow still gets a board.

---

## Zero writes — proven, not asserted

The plan permitted production testing only on the condition that it write
nothing. Two rules enforced that, and one of them is the interesting one:

1. Only GET endpoints that read.
2. **`get-todays-puzzle` is excluded even though it is a GET.** The security
   audit (A2) found it writes with the service key on an unauthenticated call —
   it upserts into `daily_puzzles` and stamps `puzzle_bank.used_on`. Hammering it
   at 100 concurrent would have burned through the puzzle bank. *A GET verb is
   not a promise of a read.*

Row counts taken immediately before and immediately after the run:

| table | before | after |
|---|---:|---:|
| `daily_puzzles` | 52 | **52** |
| `puzzle_bank` where `used_on is not null` | 52 | **52** |
| `submissions` | 0 | **0** |
| `game_events` | 1,721 | **1,721** |
| `player_totals` | 2 | **2** |
| `player_progress` | 20 | **20** |
| `daily_streaks` | 0 | **0** |

Identical on every row.

---

## One defect found — in the test, not the site

The first run reported **95.6% at 10 concurrent and 93.6% at 100** and failed the
gate at every wave. It looked like a capacity finding. It was not: the failure
rate was *flat* across a tenfold concurrency change, which a capacity problem
never is, and it was suspiciously close to 1-in-18 — exactly one of six game
names on one of three requests per session.

The نحلة key is **`spelling_bee`**, not `bee`. The server was right to return
400; the hardcoded list in the test was wrong.

The fix was not to correct the string. `scripts/qa/loadtest.js` now **reads
`LIVE_GAMES` out of the source** — `src/main.js` when this was written, and
`src/ui/meta.js` since the retention platform moved into its own module — the
same way it reads the project URL out of
`index.html`. A hardcoded list in a load test is worse than a hardcoded list
anywhere else, because it does not fail loudly — it quietly reports a healthy
service as broken, and the report gets believed.

---

## Headroom

At 3 invocations per session, the 500k monthly quota is roughly **166,000
sessions a month ≈ 5,500 a day**, and that is the ceiling that binds — not
latency, not concurrency. Phase د lowers the per-session count (the
`sessionStorage` daily cache and retiring `get-todays-puzzle`, which is currently
called twice per game open and returns 400 for the nine games it does not serve).

**What this test cannot tell you.** It is a single-machine client on one
residential connection, so it measures the backend under 100 concurrent
*sessions*, not 100 distinct IPs from 100 networks. That distinction matters for
exactly one thing: the per-IP rate limit — which the security round already
measured as ineffective on this platform, and which the Cloudflare rule (owner
action, 🟠) is there to fix. It does not affect the capacity conclusion.

---

## Gate

`npm test` 312/312 · `npm run lint` LINT_OK · `npm run build` PREFLIGHT_OK ·
`npm run loadtest` **LOADTEST_OK** (all waves ≥ 99.7%) · row counts identical
before and after.
