# Architecture

## Overview

Sura is a **static single-page app** backed by **Supabase**. There is no build
step and no server-rendered frontend — `index.html` loads `app.js` (one large
vanilla-JS file) and `style.css`. Cache-busting is manual via `?v=NN` query
strings on the `<script>`/`<link>` tags.

Three runtime actors:

1. **Browser SPA** — gameplay, auth UI, analytics, AI-hint requests.
2. **Supabase** — Auth (email + password; Resend SMTP for reset/notifications only), Postgres (with RLS), Edge
   Functions, and SECURITY DEFINER RPCs.
3. **Telegram bot (`bot.js`)** — an *offline operator tool* that inserts curated
   puzzles into `puzzle_bank` using the service role. Runs on the operator's
   machine/server, never in the browser.

## Frontend layout

- `index.html` (~1,680 lines) — the SPA shell: hero, games grid, newsletter
  section, nav, leaderboard tables, all game-card markup, and inline
  `window.SURA_CONFIG` (public Supabase URL + anon key).
- `style.css` (~3,530 lines) — the full design system (CSS variables, glass
  morphism, animations, RTL layout). **Frozen** — do not restyle.
- `app.js` — the built bundle, **not a file anyone edits**. Its source is
  `src/main.js` plus everything that file imports.

`src/main.js` began as 7,241 lines inside one `DOMContentLoaded` callback, with no
importable surface at all — which is why nothing could unit-test it, which is why
it kept growing. It is being split module by module, each verified against a
behavioural fingerprint captured from the build that preceded the move (see
[`docs/decisions/0011-fingerprint-before-splitting.md`](../decisions/0011-fingerprint-before-splitting.md)).
It is now **1,823 lines** — 75% of it moved out across ten batches, with zero
behavioural drift — and no anonymous IIFEs are left in it.

**What `main.js` still owns**, in the order it runs:

| Region | Responsibility |
|---|---|
| init | Supabase client (`sb`) from `SURA_CONFIG`; `window.__sura` created |
| `PREFS` | accessibility prefs (zoom/font/theme) in `localStorage` — a live instance, built here, passed to modules, never imported |
| `LOOM` | the procedural Sadu weave, built here and passed the same way |
| `window.__sura.games` | shared infra: session, `submitResult`, leaderboard render, dict load |
| `mountGame` | game mounting; every game implementation itself lives in `src/games/` |
| the video engine + routing | the preloaded pool, scroll scenes, cards and story |
| the call order | every `init*()` below, at the position its IIFE used to occupy |

**What has moved out**, each exporting a single `init()` called at the exact
position its IIFE occupied — ordering is a contract, not formatting:

| Module | Responsibility |
|---|---|
| `ui/meta.js` | XP, levels, badges, coins, daily combo, countdown, per-user storage, the anon→account migration, and the offline hint engine. Registers `__sura.meta` + `__sura.hints`. **Holds `LIVE_GAMES`.** |
| `ui/levels.js` | The 21-level campaign, the daily-challenge seam, HUD controls and their inline SVG icons. Registers `__sura.levels` / `.ranks` / `.rush`. Takes `LOOM` as a parameter. |
| `ui/auth.js` | The single email gate that routes sign-in against register, the three-step wizard, OTP, password recovery, Google, the username claim. Registers `__sura.openAuth` / `openVerifyOtp` / `refreshNav`. Called **early**: it reads the Supabase session out of the URL hash at boot, so anything that touches the hash first would erase it. Guarded by `tests/auth.test.js` and the `auth` fingerprint probe. |
| `ui/feedback.js` | «أبلغ وقيّم» — the report and suggest panels. Reads `demo`, `meta`, `levels` and `track`, so it is called after all four. |
| `ui/weave.js` | `weaveIn()` — the single owner of `clip-path` on revealed text. Behaviour, not state, so it is imported by its three readers. |
| `ui/account.js` | Account panel; reads its collaborators off `__sura` at call time, not construction time |
| `ui/featuredDaily.js` · `ui/dailyStrip.js` · `ui/leaderboard.js` | The three surfaces on the home page |
| `ui/demo.js` · `ui/rules.js` | ▶ شرح walkthroughs · ⓘ rules modals |
| `ui/settings.js` · `ui/phaseCopy.js` | Take `PREFS` / `LOOM` as parameters |
| `ui/scrollBlur.js` · `ui/scrollLock.js` · `ui/focusTrap.js` · `ui/closeBead.js` · `ui/soloModals.js` · `ui/announcementStrip.js` | Cross-cutting UI behaviours |
| `core/analytics.js` | `window.__sura.track` → `game_events` (fire-and-forget) |
| `core/dictApi.js` | Mounts `__sura.dict`; `core/dict.mjs` loads the dictionary itself |
| `games/wordle.js` | «كَلِمة» — board, Arabic keyboard, `scoreRow`, the hint provider and its Groq context, the level-seeded word. Called **before** `initSuraMeta()`/`initLevels()` exist, which is why it registers itself lazily on the first `openWordle()`. Guarded by `tests/wordle_hint.test.js` and the `wordle` fingerprint probe. |

Two rules the split follows and the modules document at each call site:
**state is passed, data is imported** — `PREFS` and `LOOM` are single live
instances, so importing their factories would build a second one that silently
never syncs; and **order is part of the contract** — `ui/meta.js` registers what
almost everything else reads, so it runs before them.

> Still open: `games/wordle.js` carries a near-duplicate of the shared
> leaderboard/submit logic in `window.__sura.games` (`recordWordleResult`). It is
> now isolated in one file, which is the precondition for folding it into the
> shared path — but that fold changes behaviour and is not part of the split.

## Data flow — a game round

1. **Fetch puzzle.** Server-backed games call `get-todays-puzzle?game=…`, which
   materializes the day's puzzle from `puzzle_bank` into `daily_puzzles` and
   returns the payload **with solutions stripped** (except Wordle, by design).
   The 6 newer games currently run from client-side/offline banks.
2. **Play.** All interaction and the local win/loss check happen in the browser.
3. **Submit.** On a win, signed-in players POST to `submit-guess` with
   `{ puzzle_id, game_type, guess }`. The function requires a **verified email**,
   re-evaluates the guess against the secret solution, upserts the submission
   (unique on `user_id+puzzle_id`), computes score, and advances `streaks`.
   Anonymous players don't post — a signup prompt is offered instead.
4. **Leaderboard.** `get-leaderboard?game=…` reads the public projection via the
   `get_leaderboard_today` RPC.
5. **Analytics.** Throughout, `track()` writes events to `game_events` (insert-only
   under RLS; never blocks the UI).

## «تحدي اليوم» — the 24-hour daily mode

A second mode beside the 21-level campaign. It never writes campaign state:
`finish()` and `won()` branch to `finishDaily()` on their first line, because
`complete()` writes the progress mask at `level(game)` — and in daily mode
`level()` returns the *band's representative* level, so one win would otherwise
have silently gifted the player L6 or L15.

**One live day, no catch-up, no preview.** A puzzle sits for exactly 24 hours and
expires; the cutover is **00:00 Asia/Riyadh** — the same clock `suraDailySeed()`
uses in the browser and `(now() at time zone 'Asia/Riyadh')::date` uses in SQL,
so every player's day turns at the same instant worldwide. `get-daily-challenge`
answers 410 for a date that has passed and 400 for one that has not arrived;
refusing the future is a security property, since the whole month is drafted
weeks ahead and a leaked recipe is a leaked board.

**The board is derived, not delivered.** `src/core/daily.mjs` is a pure function
of the date, so a signed-out or offline player derives the identical plan with no
network. The server row is an override and a provenance record. Selection inside
a band's bucket walks it by appearance count (`pickDailyIndex`), never by a hash
of the seed — see the rotation note in `daily.mjs` for the measurement that
ruled the hash out.

**السلسلة اليوميّة.** `daily_streaks` (one row per user, not per game — Friday's
six games are still one day) is written only by `submit-daily` via the service
role; the table has a public SELECT policy and **no write policy at all**. The
date always comes from the server clock in Asia/Riyadh, never from the request,
because a device clock set forward a day is the cheapest way to forge a streak.
The rule lives once in `src/core/streak.mjs` and is mirrored in the function;
`tests/streak.test.js` reads both files so they cannot drift — the same
arrangement `normalize_arabic` already has. Anonymous players get a local streak
so the mode is not gated behind sign-in, and that local number is **never**
uploaded: the server row wins on sign-in, one-directionally.

**The band's ceiling, not its floor.** `bandRepLevel` returned `BANDS[b].start`
until 2026-08-01, so «صعب» meant level 15 of 15–20 and «متوسط» meant 6 of 6–14 —
every daily was the gentlest rung of its own band, which is exactly how it felt
to play. It now returns `start + size - 1` (5 / 14 / 20). Board *selection* is
unaffected (`pickBankIndex` filters on band, not level), so this changes how hard
a board plays, never which board it is — a generated month needs no regeneration.

The whole mode reaches the games through four substitutions — `level`,
`levelSeed`, `diffFor`/`decoysFor`, `budgetFor`, `pickBankIndex` — so no game
module needed daily-specific code. Friday's «التحدي الكبير» is the hard band
wearing modifiers (budget ×0.70, +4 decoys, **no free floor hint**), never a
fourth band.

**Every live game runs every day**, all at that weekday's band. It was one
rotating game per day until 2026-08-01, which meant five of the six games were
dark on any given day — a rota, not a daily. `featured` survives as the one game
the home card highlights (and the one `daily_challenge_one_featured` permits per
date), but it no longer decides who plays. The cost is real and worth stating:
each game now appears 365×/year instead of ~104, so the minimum gap before a
board repeats fell to wordle 43d, amthal/warmer 22, connections 18, lamha 16 —
and «نحلة» to **2 days**, because its band-2 bucket holds two boards. No
selector can fix that; only more content can, which is what `core/authoring.mjs`
exists for.

## Backend components (in `supabase/`)

| Function | `verify_jwt` | Purpose |
|---|---|---|
| `get-todays-puzzle` | false | serve/materialize the daily puzzle (service role; strips solutions) |
| `submit-guess` | true | **authoritative** result validation + streaks |
| `get-leaderboard` | false | public leaderboard read |
| `groq-hint` | true | graded AI hint (signed-in only; never reveals the answer) |
| `groq-review` | true | admin-only AI content QA (also accepts `x-sura-admin-secret` for the bot) |
| `get-daily-challenge` | false | «تحدي اليوم» for the ONE live day; recipe only, never a solution |
| `submit-daily` | true | the ONLY writer of `daily_streaks` (server owns the date) |
| `groq-author` | false | AI content **proposals** into `authored_items`; `x-sura-admin-secret` only |

RPCs and triggers: `get_leaderboard_today`, `is_sura_admin`, the `dash_*`
analytics functions, `set_username`/`username_available`, `handle_new_user`
(auth→profiles), `normalize_arabic` (mirrors the JS in `submit-guess`),
`submissions_guard` + username-rule triggers. See [`database.md`](database.md).

## Reliability posture (current)

- AI hints degrade gracefully (timeout → deterministic local hint).
- Analytics are fire-and-forget.
- Games fall back to client-side puzzles if the backend is unavailable.
- **Video failure is safe:** both `body` and `.video-container` fall back to
  `--clr-bg-fallback`, and the loader treats a video `error` as ready — so a failed
  clip never traps the user or breaks readability (the overlay scrim stays).
- **Structured errors (Phase 6):** `window.__sura.reportError(feature, err, ctx)`
  logs a tagged, secret-free line (never tokens/keys/payloads) and never throws.
  The backend-facing catches that used to fail silently — `fetchPuzzle`,
  `submitResult`, `hydrateLeaderboard`, `aiHint`, `serverStreak` — now report
  through it while keeping their existing fallback (game keeps working). Global
  `error` + `unhandledrejection` listeners route uncaught issues to the same
  reporter, log-only (no `preventDefault`), so the page can't be crashed by them.

## Performance posture

Already optimized for a no-build static app: the 2.5 MB dictionary and the
per-game banks load **on game open**, not at page init; only the active video
decodes at a time; video URLs use Cloudinary `f_auto,q_auto,w_1920`.

Phase 7 added (identical visuals):
- **Off-screen videos** (`#video-games`, `#video-newsletter`) use
  `preload="metadata"` — only the on-screen home clip preloads fully; the others
  load on first activation.
- **Below-the-fold archive images** (`media_1/2/3.jpg`, ~740 KB) are
  `loading="lazy" decoding="async"` — verified to not download until scrolled into
  view.
- **`preconnect` to `res.cloudinary.com`** so the home video starts sooner.

Deferred (need a build step / the Phase 5 refactor): JS/CSS minification — a
gzip/brotli-enabled static host already covers most of this — and code-splitting
the per-game modules, which is blocked by the single-file `app.js`.
