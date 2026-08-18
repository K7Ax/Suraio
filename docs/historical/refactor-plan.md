# Phase 5 — `app.js` Modularization Plan (staged, not yet executed)

## Status

**Planned, deliberately NOT executed in this pass.** Splitting the 5,140-line
`app.js` is the highest-risk change in the hardening effort, the design/behavior is
frozen, and the project's rules forbid large risky changes in one step. This
document is the safe path; execution needs the explicit go-ahead below.

## The problem

`app.js` is one `DOMContentLoaded` closure containing ~20 IIFEs: backend client,
analytics, error reporting, prefs, auth, account/settings, the dictionary, levels/
meta/daily, hints, demo, rules, video, and **9 game implementations**. It's hard to
navigate, test in isolation, and review.

## Why a naïve no-build split is the WRONG move

The games reference helpers that live as **closure locals** at the top of the IIFE
(measured directly):

| helper | uses in the games region |
|---|---|
| `normalizeArabic` | 16 |
| `seededShuffle` | 15 |
| `mulberry32` | 9 |
| `suraDailySeed` | 6 |
| `escapeHtml` / `escapeHtmlShared` | 5 |

Cutting the games into separate `<script>` files would break all of these unless
every reference is rewired to a shared namespace. And even done perfectly, multiple
`<script>` files on a **no-build static site** is a net negative:

- **More HTTP requests** and **load-order fragility** (handlers must run in a
  precise sequence relative to `window.__sura` being populated).
- **New failure points:** today `app.js` is self-contained; if one split file fails
  to load, the app breaks. That's a *reliability regression* — the opposite of the
  hardening goal.

The maintainability win of "modules" only materializes when a **bundler recombines
them into one optimized file**. Therefore the safe refactor requires a build step.

## Recommended approach — introduce a tiny build step (needs approval)

Adopt **esbuild** (one dev dependency, ~10 MB, fast) purely as a bundler:

- Source moves to `src/` ES modules; `esbuild src/main.js --bundle --minify
  --outfile=app.js` emits the **same single `app.js`** that ships today.
- **Deployment is unchanged**: still one `app.js`, same `?v=NN` cache-bust, same
  static host. No new runtime requests, no new failure points. (Bonus: minification
  — the deferred Phase 7 item — comes for free.)
- `package.json`: `"build": "esbuild …"` (replacing the current preflight, or
  running both); `npm run build` becomes the deploy step.

This is the only way to get real module boundaries **without** the reliability and
request-count regressions above. It is a **deployment-model change**, so it is
gated on your approval before any code moves.

## Module boundaries (the target structure)

```
src/
  core/
    supabaseClient.js   // sb, SURA config
    util.js             // normalizeArabic, arNum, escapeHtml, suraDailySeed, mulberry32, seededShuffle
    errors.js           // reportError + global safety nets (Phase 6)
  analytics.js          // __sura.track
  auth/                 // initAuth, initAccount, initSettings
  prefs.js              // initPrefs
  video.js              // video pool, activateVideoLayer, loader
  levels.js             // levels, meta, dailyGoal, daily strip
  hints.js              // __sura.hints, __sura.aiHint
  dict.js               // loadDict + morphology
  ui/
    keyboard.js         // renderArabicKeyboard
    leaderboard.js      // hydrateLeaderboard / render
    demo.js, rules.js
  games/
    wordle.js connections.js sudoku.js bee.js letterboxed.js
    strands.js amthal.js tiles.js pips.js
  main.js               // imports + boot order (preserves today's sequence)
```

The shared helpers become `core/util.js` exports; every current call site imports
them — semantics identical.

## Sequencing (lowest-risk first; each step is its own commit)

1. Stand up esbuild; move the **current** `app.js` verbatim into `src/main.js` and
   confirm the bundle is byte-equivalent in behavior (smoke + full game pass).
2. Extract `core/util.js`, `core/supabaseClient.js`, `core/errors.js` — pure, no DOM.
3. Extract leaf features with clean `window.__sura` seams: `analytics`, `dict`,
   `prefs`, `hints`, `demo`, `rules`.
4. Extract `video`, `levels`, `ui/*`.
5. Extract `auth/*`.
6. Extract the **9 games one at a time**, re-running the full per-game manual pass
   after each (open, play to a win, hints, levels, demo, share).

## Verification gate (every step — do not proceed if any fails)

- `npm run lint && npm run build && npm test` green.
- Playwright smoke: page renders, **0 console errors**, a game opens.
- **Manual pass for the touched game(s):** start → win, hint, level change, demo,
  rules, share — visually identical, same DOM/classes.
- `git diff` shows no change to `style.css`, no DOM/class/Arabic-text changes.

## Decision needed

Reply to approve **introducing the esbuild build step**; then I'll execute the
sequence above, one verified commit at a time. Until then `app.js` stays the single
self-contained file it is today.
