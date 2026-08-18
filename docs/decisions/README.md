# Decision records

Every entry here is a decision that was **measured**, not preferred. Each one
names the thing that broke, the number that proved it, and what the fix cost.

They are written in English because they are meant to be read by people who
have never seen this codebase. The code comments themselves are bilingual —
Arabic where the reasoning is about Arabic (typography, morphology, RTL), English
where it is about the platform. That split is deliberate: the language of a
comment should match the language of the problem.

Two rules kept this list honest:

1. **A decision with no measurement is not recorded here.** Preferences go in
   code review, not in an ADR.
2. **Failures are recorded with the same weight as successes.** Three of the
   entries below (`0005`, `0008`, `0009`) exist because something shipped broken
   and a real player found it. An ADR log with no scars is marketing.

| | Decision | The measurement behind it |
|---|---|---|
| [0001](0001-committed-bundle.md) | The build artefact is committed, and CI proves it matches source | `git diff --exit-code app.js` |
| [0002](0002-deploy-whitelist.md) | The deploy list is a whitelist, never an ignore list | A `.env` one flag away from a public CDN |
| [0003](0003-content-hash-cache-busting.md) | `?v=` is a content hash the build writes, never a number a human types | Stale bundles served behind a version that hadn't changed |
| [0004](0004-generated-csp.md) | The Content-Security-Policy is generated from the pages it protects | 7 inline-script hashes across 5 pages, recomputed every build |
| [0005](0005-server-authoritative-xp.md) | The server, not the client, decides what a level is worth | A forged POST could top the global leaderboard |
| [0006](0006-rls-as-authorization.md) | RLS is the authorization layer; the anon key is public on purpose | Backend fully offline → 6/6 games still playable |
| [0007](0007-text-overflow-on-flex.md) | `text-overflow` is inert on a flex container | «Khalid» rendered as «halid», reproduced at 1280px |
| [0008](0008-never-animate-opacity-ios.md) | Never animate `opacity` in keyframes on iOS Safari | A blank hero on every back-navigation |
| [0009](0009-percentage-height-flex-column.md) | `height: 100%` resolves against the parent's whole box, not the space left | A keyboard 94px below the fold on a real phone |
| [0010](0010-versioned-migration-flags.md) | A persisted "done" flag needs a version, because fixing the writer is half a fix | One account silently stopped scoring for weeks |
| [0011](0011-fingerprint-before-splitting.md) | Splitting `main.js` needs a behavioural baseline first | 0 of 34 test files execute `main.js` |
