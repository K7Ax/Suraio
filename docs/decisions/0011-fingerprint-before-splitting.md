# 0011 — Splitting `main.js` requires a behavioural baseline, because tests read it as text

**Status:** accepted · **Date:** 2026-08-17 · **Affects:** `src/ui/`, `src/main.js`, `scripts/qa/fingerprint.js`

## Context

`src/main.js` was 7,241 lines, and **every one of them lived inside a single
`DOMContentLoaded` callback.** Behaviour was organized as nested IIFEs —
`initAuth`, `initLevels`, `initFocusTrap`, and so on — which run in order and
close over the enclosing scope.

The honest measurement of the test suite, taken before touching anything:

| | Files | What they actually do |
|---|---|---|
| Read source as **text** | 27 of 34 | ~280 `assert.match` against file contents |
| **Import and execute** | 11 | `await import("../src/core/*.mjs")`, real logic |
| Execute `src/main.js` | **0** | — |

Zero is not an oversight. A file whose entire content is inside a
`DOMContentLoaded` closure **exports no surface at all** — there is nothing a
test can import. So the largest surface in the project was untested because it
was unsplit, and unsplit because splitting it without tests is a gamble. Each
condition held the other in place.

A regex-over-text test is not worthless, but it is worth much less than it
looks: it asserts that a string still appears in a file. It passes just as
happily when the code around that string has stopped working.

## Decision

**Break the deadlock from the outside: measure behaviour in a real browser
before the split, then again after, and require the two to be identical.**

`scripts/qa/fingerprint.js` drives Chromium against the local server and records
class names, ARIA attributes, focus position, scroll-lock state and console
errors — then diffs against a stored capture, exiting non-zero on any drift.

```bash
npm run fingerprint -- --out .fingerprint/before.json
#   … the split happens here …
npm run fingerprint -- --against .fingerprint/before.json
```

It follows `sweep.js`'s convention of resolving Playwright outside
`devDependencies`, because the test suite's "no install step" guarantee is worth
keeping and browsers do not belong in a static site's dependency tree.

Baselines are **gitignored**. A baseline is only meaningful against the build it
came from; a committed one ages into a false alarm that someone eventually
deletes, taking the habit with it.

### Choosing what to move: free-variable analysis, then reading

Candidates were ranked by what they capture from the enclosing closure, since a
block that captures nothing is a move that cannot change semantics. A regex
analyser produced the ranking — and produced enough false positives to prove it
could not be trusted as evidence:

- `$` appeared as a "capture" in almost every block. It is `${` in template
  literals.
- `span`, `td`, `tr`, `div` appeared as captures. They are HTML tags inside
  template literals.
- `sessionId` appeared as a capture of `initAnalytics`. It is declared inside it,
  by `let deviceId, sessionId;` — a multi-name declaration the pattern missed.
- Brace counting overran on templates containing `${…}`, reporting `initDemo` as
  1,182 lines when it is 203.

So the analyser was used to **rank**, and every block was then **read** before
being moved. Ranking is cheap and approximate; the decision was not.

### The eighteen modules moved so far

**Batch one, zero captures each** — `scrollBlur`, `scrollLock`, `focusTrap`,
`closeBead`, `announcementStrip` (the last needing only the `sb` import).

**Batch two** — `soloModals` and `rules` (zero captures), `analytics` (zero
captures; it went to `src/core/` rather than `src/ui/` because it has no UI of
its own), and two that take their dependency as a **parameter**:
`initSettings(PREFS)` and `initPhaseCopy(LOOM)`.

That last pattern is the one that matters for what remains. `PREFS` and `LOOM`
are live single instances built once in `main.js`. A module that *imported* them
would construct a second instance that never sees the first — settings would keep
opening while nothing was ever saved, a failure with no error and no visible
symptom. Hence the rule: **state is passed, data is imported.** `phaseCopy` shows
both halves — it takes `LOOM` as an argument and imports `PHASES`, a frozen table.

Order is part of the contract, not formatting: `initScrollLock` and
`initFocusTrap` both attach a `MutationObserver` to `body` and call `sync()`
immediately, so swapping them changes which one observes an open modal first.
Every extracted call sits at the exact line position its IIFE occupied.

**Batch three** — `initAccount` (306 lines), the first of the large blocks. Also
zero captures: it needs `sb`, `arNum` and `escapeHtmlShared` as imports, and
reads `meta`, `ranks`, `openAuth`, `openVerifyOtp` and `refreshNav` off
`window.__sura` **at call time rather than at construction time**. That timing
distinction is what made a 306-line move safe — those surfaces may not exist yet
when `initAccount()` runs, and every one of them is read inside a handler that
fires much later.

**Batch four** — `initFeaturedDaily` (219 lines) and `initDemo` (204). Both read
their collaborators off `window.__sura` and both are order-dependent in a way that
is invisible from the call site, so each call site now says which way:
`initFeaturedDaily` reads `window.__sura.levels` **at construction time**, so a
call placed before the daily engine registers returns early and leaves the card on
the hand-written fallback in `index.html` — silently, with no console error, which
is precisely the lie the module exists to remove. `initDemo` is the mirror case: it
*writes* `window.__sura.demo`, so its position must precede the first game HUD that
reads it.

**Batch five** — the three small remainders in one move: `initLeaderboard` (126
lines) to `ui/`, `initDailyStrip` (41) to `ui/`, and `initDict` (23) to
`core/dictApi.js`. That last name is deliberate and the file says why: `core/dict.mjs`
*loads* the dictionary and owns its structure, while `dictApi.js` mounts the public
`window.__sura.dict` surface the games interrogate. Two files, two jobs, one word in
both names — worth one sentence of explanation rather than a reader's guess.

**Batch six** — `initSuraMeta` (933 lines) to `src/ui/meta.js`: XP, levels, badges,
coins, the daily combo, the countdown, per-user namespaced storage, the anonymous
→ account migration, and the free offline hint engine. It is the widest module in
the interface and the one nearly every other reads, so its call site is annotated
with the only ordering fact that matters: it **registers** `window.__sura.meta`
and `window.__sura.hints`, therefore it precedes all of its readers — exactly
where the IIFE stood. Its probes were written to exercise behaviour rather than
shape: write a key and read it back namespaced (`sura.<uid>.__fpProbe`), award XP
and record the delta (`xpAddedExactly: 10`), spend coins and record the difference
(`coinsSpent: 3`), and assert the combo total equals `LIVE_GAMES.length` rather
than a typed six.

**Batch seven** — `initLevels` (999 lines) to `src/ui/levels.js`: the 21-level
campaign, the daily-challenge seam, `window.__sura.levels` / `.ranks` / `.rush`,
and the HUD's inline icons. It is the second **parameter** case after
`initSettings(PREFS)` and `initPhaseCopy(LOOM)` — the whole residue of a
999-line block was a single free variable, `LOOM`, used twice as `LOOM.weaveRow()`.
`LOOM` is a live instance built once in `main.js`, so importing `createLoom` here
would have woven a second cloth nobody sees. Hence `initLevels(LOOM)`.

That one line is also what the probes were written to catch. A `finishRound` probe
drives a real win through `finish()` — the single seam every round ends through —
and records `LOOM.wins` on both sides of it (0 → 1). If `LOOM` had arrived wrong,
that is the one probe that would have said so, and it records the thrown message
as a *value* rather than letting it leak into the error log without a location.

Result: `main.js` 7,241 → 3,993 lines (−3,248, a 45% reduction), eighteen modules
extracted, with `FINGERPRINT_OK` against baselines captured from each pre-move
build, and `SWEEP_OK` over 126 playthroughs each time.

## Consequences

**What this does not claim.** The fingerprint is not coverage. It probes what
these particular modules do, in one browser, at one viewport. It would not catch
a regression in a path it does not visit. Its value is narrow and real: it turns
"the refactor looks fine" into a comparison that fails loudly.

**A trap this tool sets for its own user.** After batch two, comparing against
the batch-one baseline returned `FINGERPRINT_OK` — while containing **no probe
for any of the five modules just moved**. An unchanged fingerprint that never
looked at the changed thing is not evidence, and it is worse than no evidence,
because it reads like proof. The fix is procedural and non-negotiable: extend the
probes first, re-capture the baseline **from the pre-change build**, then apply
the change and compare. That is what was done — the pre-split capture showed
`zoomMatchesStore: true`, which is precisely the assertion a duplicated `PREFS`
would have broken.

**A second trap, one level deeper: a baseline is not evidence until it has been
read.** The comparison only reports *differences*, so a probe that is wrong in the
same way before and after passes in perfect silence. Batch four wrote eleven new
probes and two of them were born broken:

- `serialShape` tested the card's serial against `/^[٠-٩]{2} \. [٠-٩]{2}$/` and
  captured `false`. The digits are not Arabic-Indic — `arNum` is `n => String(n)`,
  a decision taken elsewhere in this codebase. The probe was failing on correct
  behaviour, and would have gone on failing identically after the move.
- `clonedIdsSuffixed` captured `true` by calling `.every()` on an empty array:
  today's featured board happens to contain no SVG `id` at all. A check that
  cannot fail is not a check. It now records the count alongside it and returns
  `null` rather than `true` when there is nothing to inspect, so an empty result
  reads as empty.

Neither would have been caught by running the tool; both were caught by opening the
JSON and reading every value. The rule that follows: **after capturing a baseline,
read it, and treat any `false`, `0`, `[]` or unconditional `true` as a claim about
the probe until proven a claim about the code.**

Batch five put the rule to work three more times. `rejectsImpossible` was written as
`D.has('ززززززز')` and captured `false` — correct behaviour under a field name that
asserted the opposite, which is a trap for whoever reads the diff next year, so the
negation moved into the probe. `readyBeforeLoad` captured `true` because by the time
the probe runs the page has long since loaded the dictionary; the value was real and
the *name* was the lie, so the name changed rather than the measurement. And the
leaderboard's `neverBlank: true` was replaced by the raw `rows` and `emptyRows`
counts — which immediately showed `rows: 1, emptyRows: 1`, i.e. the board is
rendering its «لا فرسان بعد» line and no real rows at all. `neverBlank` was true and
would have stayed true through a total loss of data. Same lesson as `bodyTop` above:
**record the value, not the verdict.**

**A moving test count, and the wrong explanation for it.** Across this work
`npm test` reported 439, then 440, then 441. Two things were established, in
this order:

- A controlled A/B on the first batch — `git stash push src/main.js`, run,
  restore, run — produced **440 both ways with an identical sorted list of test
  names**. The refactor itself added and removed nothing. This part held up.
- The remaining drift was then attributed to failing tests suppressing their
  siblings. **That was wrong.** It was an inference from a coincidence (the 440
  reading happened to be taken while two tests were failing), not a measurement.

The actual cause was found by checking file timestamps at the end of the session:
`tests/promo.test.js` had been edited *during* the session by something outside
this work, going from 38 to 40 `test()` calls. 439 + 2 = 441. The suite total
moved because the suite changed.

Two lessons, and the second is the one worth keeping. First: when a number moves,
check whether the inputs moved before theorising about the machinery — `git
status` and an `ls -l` would have answered it immediately. Second: a plausible
mechanism that explains the observation is not the same as the cause, and writing
one into a permanent record is how a guess becomes an accepted fact. This
paragraph replaces such a guess.

The check has since paid for itself. During batch four the total moved again, 441
→ 442, and the same two commands answered it in seconds: `tests/promo.test.js` had
been touched again, and `git show HEAD:tests/promo.test.js | grep -c '^test('`
against the working copy read 38 → 41. 439 + 3 = 442. No theory required.

**Moving code broke text-matching tests three times, and each break was
informative.** Analytics leaving `main.js` failed `cost.test.js`, which matched
`queue.push(` in that file and a `flush()` body closing at *eight* spaces of
indentation — an assertion pinned to a file path and a nesting depth. Both were
repointed at the new module.

The third break was the valuable one. Moving the account panel failed the
**security** guard `A10`, which asserts the client obtains its rank from the
`get_my_rank` SECURITY DEFINER RPC and never by counting `player_totals`
directly. It failed on its *positive* half: the RPC call had moved out of
`main.js`, which was the only file it read.

That exposed a real hole. A guard scoped to one file was never checking the
others — a violation written in any other client module would have passed
silently, which is the failure mode the guard exists to prevent. It now walks the
whole of `src/` (asserting it finds >20 files, so a broken walk fails loudly
rather than passing vacuously). The strengthened version was verified by
**injecting the violation and confirming it fails**, then removing it. A guard
that has not been seen to fail is not known to be a guard.

Generalized: when a structural move breaks a text-matching test, the question is
not "how do I make it green" but "was its scope ever right".

**A fourth break, and the pattern in all four.** Moving the featured-daily card
failed `daily.test.js`, which matched the IIFE with
`/function initFeaturedDaily\(\)[\s\S]*?\n    \}\)\(\);/` — a pattern that encodes
the closing brace's *indentation*, and therefore the block's nesting depth. Moving
the walkthrough failed `feedback.test.js` the same way. Both were repointed at
their new files, where the file itself is the block and no brace-matching is
needed.

Repointing alone would have left a hole, though, and it is the same hole `A10` had:
a module that exists but is never imported keeps every assertion about its contents
green while the site runs without it. Both tests now also assert the import line and
the call site in `main.js`. A test that reads a file proves the file says something;
only the wiring proves the program does it.

**A fifth break, and the fix that was not a repointing.** Batch six moved
`initSuraMeta` — 933 lines, the retention and hint platform — into `src/ui/meta.js`,
and **eight tests in five files** went red at once. Not because a defect returned:
the fingerprint was `FINGERPRINT_OK` before a single test was touched. They went
red because each of the five had written its own regex for *where `LIVE_GAMES`
lives*, and eight copies of that fact drifted together.

Repointing eight call sites would have rebuilt the same trap one module later. The
answer was `tests/helpers/live.js`: one reader, named once, that throws if it finds
nothing — because a list that silently comes back empty makes every test that
consumes it pass on nothing, which is worse than failing. `LIVE_GAMES.length < 6`
and an empty `TITLES` are both hard errors there. `scripts/qa/loadtest.js` had the
same read and was the only *non-test* casualty; it already exited 1 on a failed
match, which is why the move surfaced there as an error rather than as a wave of
400s.

Generalized, and this is the fourth variation on one theme: **a fact worth
asserting is worth having one place to read it from.** `A10` needed the whole of
`src/`; `daily.test.js` needed the wiring as well as the contents; these eight
needed a single reader. Every time, the move did not create the weakness — it
revealed one that had been there since the assertion was written.

**The sixth break said the same thing louder, so the fix got bigger.** Batch seven
took sixteen tests across three files down, all of them reading `src/main.js` for
symbols that had moved. `tests/helpers/live.js` answered *which games are live*;
what was missing was an answer to *where does a UI module live at all*. That is
now `tests/helpers/ui.js`: a logical-name → path table (`main`, `meta`, `levels`),
a `read()` that throws when a file is absent or implausibly short, and an
`assertWired()` that checks `main.js` both imports **and calls** the module.

Two deliberate restraints in it. It does not concatenate `src/` into one blob — an
`assert.match` over the whole tree passes wherever the pattern happens to live,
which is precisely the `A10` hole rebuilt on purpose; **scope is part of the
claim**. And when a variable stopped holding `main.js`, it was renamed rather than
left as a comfortable lie: `daily_seam.test.js` now says `levels`, because a
variable called `main` that holds something else is how the next reader gets it
wrong.

**The read-the-baseline rule paid for itself three more times in batch seven,**
and one of the three was not a probe defect at all. `budgetFor` returned `null`
twenty-one times because the probe asked `wordle`, the one live game with no guess
budget — correct behaviour, zero information; it now measures `spelling_bee` and
`lamha` and records wordle's `null` explicitly as the absence it is.
`playableIsMax` captured `false` because it compared `playable()` against `LEVELS`
(21, a count) when the function returns `MAX` (20, an index) — the verdict was
wrong about correct code, so it became `playableValue: 20`. And the band ladder
came back `6/9/6` while the comment above the block claimed `3 · 6 · 12`: the
measurement was right and the **comment** was stale, left over from the Round-5
design before the difficulty redesign moved the mass to the middle. The comment was
corrected as part of the move and the arithmetic was not touched.

**Batch eight caught the drift the fingerprint exists for.** Extracting
`initFeedback` produced `FINGERPRINT_DRIFT (25)` and a page error:
`escapeHtmlShared is not defined`. The residue script had said the block was
clean, and it was right about residue — but it excludes `main.js`'s own imports,
which is correct when analysing `main.js` and wrong for a file that will no longer
be inside it. Two imports (`supabaseClient.js`, `util.js`) had to travel with the
code. **No test in the suite would have caught this**, because every one of them
reads source text; only a browser executing the bundle notices a name that is not
in scope. The lesson is a second inventory per extraction: residue answers *what
does this block still need from its siblings*, imports answer *what does it need
from outside the file*, and an extraction needs both.

`initFeedback` also left behind a single function, `weaveIn` — its entire residue.
It became `src/ui/weave.js` rather than being duplicated or dragged along, because
it is behaviour and not state, and it now has three readers instead of one.

**Batch nine, `initAuth`, was the last one and the one that mattered most.** 830
lines: the single email gate that routes sign-in against register, the three-step
wizard, OTP, recovery, Google, the username claim. The move itself was clean —
zero residue, three imports, `FINGERPRINT_OK` first try — and the interesting
finding was not in the code but in its absence of cover. Nothing in `tests/`
asserted anything about it. No file mentioned `openAuth`, `isStrongPassword`,
`checkEmailAvailable`, or the recovery guard. The most dangerous block in the
project had a green suite around it that was green because it was not looking.

So the batch added `tests/auth.test.js` — five guards over meaning, not shape: that
the client's `USERNAME_RE` is **character-for-character** the pattern
`set_username` enforces in `supabase/sql/db-security-definer.sql` (read from both
files and compared, never restated); that `MIN_PW` is one constant and every
account-creating path calls `isStrongPassword` rather than re-checking a length;
that the new-password panel opens only on `type=recovery`, which is the regression
that actually shipped once and pushed Google returnees into "set a new password";
and that no password value reaches `console` or the analytics channel. Each of the
four was then **mutated in the source and observed to go red**, with the file
restored and its md5 checked — a guard that has never failed is a guard whose
failure mode is unknown.

One thing was deliberately left unasserted: the sign-in path checks the password
length against a literal `8` instead of `MIN_PW`. That looks like a wart and is
not one. Accounts created before the minimum was raised are still valid, and
binding sign-in to the constant would lock those players out the day it moves. The
divergence is recorded in the test file rather than "fixed".

**The read-the-baseline rule held for a fourth consecutive batch, and the third
lie in `auth` was the subtlest yet.** Two were the usual kind: the class is
`sura-modal-open`, not `modal-open`, so `false` at open and `true` at close were
two errors that cancelled in the diff; and `focusInsideModalAtOpen` asserted a
promise the code never made, since `initFocusTrap` acts on `Tab`, not on display.
The third survived both corrections — the lock is applied by a `MutationObserver`,
whose callback cannot run in the same task that changed the class, and the probe
read `body` inside the very `evaluate` that opened the modal. It measured the
state *before* the observer existed and reported a working lock as broken. The
general form: **when the code under test is asynchronous, a synchronous probe
measures the previous state and never says so.**

## Batch ten — «كَلِمة», the last game left inline

The Wordle engine was the largest single thing still in `main.js`: 535 lines that
predated every shared module and therefore duplicated pieces of them. It had no
executable guard at all — `tests/wordle_hint.test.js` reads its **source text**,
which is the same blindness the fingerprint exists to fix.

So the probe came first, and it is the richest one in the harness: the board's
shape and cell ids, the hardcoded keyboard layout, the full twenty-one-level word
**length ladder** (`4×6 · 5×9 · 6×6` — the only proof that `curves.wordle.wordLen`
actually reaches `levels.register`), then all four exits from `handleEnter` — a
short row, a word the dictionary rejects, a backspace, and a real winning round
played to the confetti. The secret word itself is never recorded, only its length;
the inputs are derived from it. Change the bank tomorrow and every value holds.

Two things worth keeping from this batch:

**Type the win through `keydown`, not the on-screen keys.** The first version
clicked `.kbd-key[data-key="…"]`, which fails on a perfectly correct word: the
Arabic keyboard has `ا` but not `أ`/`إ`/`آ`, and `normalizeArabic` folds them only
at comparison time. A probe that works for most bank words and silently fails for
some is worse than none.

**A slice boundary that no longer exists does not fail — it widens.**
`tests/wordle_hint.test.js` cut its `provider` region at
`async function fetchDailyWordle()`, a function deleted several rounds earlier.
`indexOf` returned `-1`, `slice` accepted it, and the "provider" every assertion
ran against was quietly the whole rest of the file. The slices now go through a
`between()` helper that asserts both ends exist. Same family as the vacuous
absence-guard in batch nine: **a check that can no longer see its subject reports
success.** `tests/security.test.js`'s A3 guard had the identical problem the moment
the code moved, and now reads both files.

Verification: `LINT_OK (159 files)`, `450 tests / 0 fail`, `PREFLIGHT_OK` +
`CSP_OK`, `DIST_OK (80 files)`, `SWEEP_OK (126 runs)`, and the fingerprint clean
apart from two live-leaderboard rows — which were **proved environmental** by
rebuilding the pre-move source and getting the identical two diffs.

**Where this ended.** `src/main.js` is 1,823 lines, down from 7,241 — 75% of the
file gone into twenty-two modules under `src/ui/`, `src/core/` and `src/games/`,
every batch verified against a baseline captured from the build that preceded it.
No IIFEs remain in it; what is left is the video engine, routing, the cards and
story scenes, `mountGame`, and the wiring that calls everything else in a fixed
order. Zero behavioural drift across all ten batches, and the two breaks that did
occur (`FINGERPRINT_DRIFT (25)`, and `loadtest.js` exiting 1) were both caught by
tools built for exactly that, before a single line reached production.
