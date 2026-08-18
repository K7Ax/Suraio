# Tests

Zero-dependency suite on Node's built-in runner (`node:test`, Node ≥ 20). No
`npm install`, no test framework, no mocking library.

```bash
npm test                              # all 35 files, 450 tests
node --test tests/progression.test.js # one file
node --test --test-name-pattern="سلسلة" "tests/**/*.test.js"
```

## What kind of suite this is

Almost every test here reads **source files from disk and asserts on their
contents**. That sounds unusual until you see the shape of the system: Sura's
logic is spread across five layers that share no compiler — browser JS, Deno
Edge Functions, Postgres SQL, HTML, and `bot.js` — and the characteristic bug is
not a wrong function, it is **one copy drifting from another**. A value in a
dropdown the server won't accept. An event the client emits that a `CHECK`
rejects. A game name the dashboard spells differently from the bot.

None of that reproduces locally. All of it reproduces on the first real player.
So the suite's job is to fail when two copies of the same truth diverge, and to
stay quiet when a line is merely reworded.

The consequence worth knowing before you edit: **renaming a CSS class, a DOM id,
or an exported symbol can fail a test in a file that seems unrelated to your
change.** That is the design, not a flaky test.

## The files

`tests` = number of `test()` cases in the file.

### Pure domain logic — the modules under `src/core/`

| File | tests | Guards |
|---|---:|---|
| `progression.test.js` | 39 | The level campaign's pure heart: bands, XP, rank tiers, stars. |
| `resolve.test.js` | 13 | The seam where a scheduled day becomes a playable board, plus the rotation. |
| `daily.test.js` | 16 | «تحدي اليوم» — the daily mode that sits beside the campaign without touching it. |
| `daily_window.test.js` | 7 | The 24-hour Riyadh-midnight rule: each puzzle belongs to its own day, no catch-up. |
| `checks.test.js` | 20 | المُشيك — the gate every daily puzzle passes before publication. |
| `normalize.test.js` | 9 | `normalizeArabic` folding. **The canonical spec** the Deno (`submit-guess`) and Postgres (`normalize_arabic`) copies must match. |
| `tier.test.js` | 12 | Device capability classification — how much is computed per frame on this machine. |
| `loom.test.js` | 17 | The Sadu weave is a pure function of its seed; «نسيج اليوم» must mean one cloth. |
| `dict.test.js` | 5 | The packed dictionary's structural assumptions. |
| `banks.test.js` | 10 | The banks that used to live inside three game files. |
| `level_advance.test.js` | 5 | Winning advances the level; the board stays the board it was. |

### Content banks — the puzzles themselves

| File | tests | Guards |
|---|---:|---|
| `bank.test.js` | 7 | Bank integrity validated through `bot.js`'s own builders, so the test and production agree by construction. |
| `connections_decoys.test.js` | 5 | «تشابك» decoy variety — neither the puzzle nor its decoy vocabulary may repeat. |
| `lexicon.test.js` | 11 | The barriers stopping the AI layer from inventing words. |
| `hints.test.js` | 12 | One law for every hint: it adds information or it is rejected. |
| `wordle_hint.test.js` | 8 | «كَلِمة» hints may not restate what the player already uncovered. |

### Client seams and DOM contracts

| File | tests | Guards |
|---|---:|---|
| `daily_seam.test.js` | 10 | The client's daily-challenge joint — the riskiest property in that feature. |
| `modals.test.js` | 4 | The shell modals: sign-in · account · settings. |
| `modal_templates.test.js` | 5 | Template drift, the sharpest edge of the modal round. |
| `hud_icons.test.js` | 8 | The HUD icons are hand-written SVG paths in `src/ui/levels.js` — no emoji, no `<img>`, one `viewBox`, `currentColor` only. |
| `dashboard.test.js` | 2 | The admin panel names games exactly as the rest of the system does. |
| `privacy.test.js` | 7 | `privacy.html` is a legal document; these pin what it must keep saying. |
| `csp.test.js` | 4 | The generator hashes what the *browser* hashes, not what the file appears to contain. |

### Cinematics

| File | tests | Guards |
|---|---:|---|
| `hero.test.js` | 10 | The layered hero — including that the built layer files exist and stay inside a 360 KB budget. |
| `story.test.js` | 28 | Scroll-driven camera maths; breakages here are visible on screen. |
| `tallal.test.js` | 25 | The 404 page «ضاع الطريق», including its motion ceiling. |
| `pixel.test.js` | 13 | The pixel layer. The round was cancelled; the guarantees still hold. |

### Backend contracts — asserted against source, not a live database

| File | tests | Guards |
|---|---:|---|
| `security.test.js` | 16 | The August 2026 security round: reads `supabase/functions/` and `config.toml` and asserts the fixes are still present. |
| `auth.test.js` | 5 | Sign-in and registration. Added when splitting `initAuth` out revealed that the block owning every account had **no** guard at all. Asserts the client's username pattern is character-for-character the one `set_username` enforces, that one constant sets the password minimum, that the new-password panel opens only on `type=recovery`, and that no password reaches `console` or analytics. Each of the four was mutated and observed to fail. |
| `feedback.test.js` | 20 | «أبلغ وقيّم» across all five layers at once — SQL, Deno, browser JS, HTML, bot. |
| `streak.test.js` | 9 | «السلسلة» — the one number a player loses by not showing up. |
| `authoring.test.js` | 23 | The AI proposal layer: BM25 retrieval, the avoid-list, and the rule that Groq proposes but never authors at play time. |
| `cost.test.js` | 4 | Cost ceilings on the paid paths. |

### Operator bot

| File | tests | Guards |
|---|---:|---|
| `bot-admin.test.js` | 2 | Only configured `ADMIN_IDS` may run write commands. |
| `bot_daily.test.js` | 29 | The guards around `/genmonth` and its siblings. |

### Launch film

| File | tests | Guards |
|---|---:|---|
| `promo.test.js` | 29 | The 20-second launch film: act structure, motion rules from `docs/architecture/identity.md`, and a probe of the rendered master. |

## External dependencies

The suite is hermetic with two exceptions, both isolated to one file each:

| File | Needs | If absent |
|---|---|---|
| `promo.test.js` | `ffprobe` on PATH, and a rendered master in `promo/.work/` | The master check is skipped when nothing is rendered (`skip: !master`). It does **not** skip when a master exists but is *corrupt* — an aborted render leaves a file with no `moov` atom and the test fails. Delete the partial file or re-render: `npm run promo:test`. |
| `cost.test.js` | mentions `fetch(keepalive)` in an assertion | Reads source; does not open a socket. |

**No test in this suite performs network I/O.** That is a change from how it is
often described — `security.test.js` used to query live Supabase with the public
anon key and now inspects the function source on disk instead, which is both
faster and honest about what it proves.

## The two helpers that keep the suite from breaking on every move

Most of this suite reads source files by path. `src/main.js` used to be 7,241
lines and is being split into `src/ui/*`, so every move used to take a batch of
tests down at once — not because anything broke, but because dozens of copies of
"where does this symbol live" drifted together. Twice, measured: **eight** tests
when `initSuraMeta` moved, **sixteen** when `initLevels` did.

**`tests/helpers/live.js` — which games are live.** The only reader of
`LIVE_GAMES` and `TITLES`. Exports those two plus `ROOT`, `META_REL` and `META`
(the module's source text, for tests asserting on the hint engine), and **throws**
if a list comes back short — an empty `LIVE_GAMES` would make every test that
consumes it pass on nothing, which is worse than failing.

**`tests/helpers/ui.js` — where a UI module lives.** A logical-name → path table
(`main`, `meta`, `levels`, `auth`), a `read(name)` that throws when the file is missing or
implausibly short, and `assertWired(assert, initName, rel)` which checks that
`main.js` both **imports and calls** the module — because a module that exists but
is never wired keeps every assertion about its contents green while the site runs
without it.

Two things it deliberately does not do. It does not concatenate `src/` into one
blob: an `assert.match` over the whole tree passes wherever the pattern happens to
live, which destroys the test's ability to notice a symbol that moved somewhere
wrong. **Scope is part of the claim.** And it does not let a variable keep a name
that has stopped being true — when `daily_seam.test.js` stopped holding `main.js`,
the variable was renamed to `levels`.

Import these rather than writing a new path or regex. The next move should be one
line in a table, not sixteen edits.

It worked: the last two moves — `initFeedback` and `initAuth`, some 1,600 lines
between them — took **zero** tests down. But the second one exposed the other half
of the problem. Nothing broke on `initAuth` because nothing was watching it: the
suite had no assertion anywhere about sign-in, registration, recovery or OAuth.
A helper stops a move from producing false failures; it cannot conjure coverage
that was never written. Hence `auth.test.js`, and hence the habit of asking, when
a batch comes back suspiciously quiet, whether the silence is health or blindness.

Two artefacts survive from the network era and are currently inert:

- **`tests/helpers/config.js`** — resolves `SUPABASE_URL` / `SUPABASE_ANON_KEY`
  from the environment, falling back to parsing `window.SURA_CONFIG` out of
  `index.html`. **Nothing imports it.**
- **`SURA_SKIP_INTEGRATION`** — set in `.github/workflows/ci.yml`, **read by
  nothing.** CI is hermetic, but not because of this variable.

Neither was removed during the 2026-08 reorganization: they are the scaffolding
for integration tests against a live backend, which is a real gap worth filling
rather than a leftover worth deleting. Whoever fills it should start here.

## CI

`.github/workflows/ci.yml` runs, in order: `npm ci` → `npm run lint` →
`npm run build` → **`git diff --exit-code app.js`** → `npm test`.

That fourth step is the one to understand. `app.js` is a **committed build
artefact**, and the step asserts that rebuilding from `src/` reproduces the
committed bundle byte for byte. Editing `app.js` by hand — or committing a `src/`
change without rebuilding — fails CI. Always `npm run build`; never hand-edit the
bundle.
