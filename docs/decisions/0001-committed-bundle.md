# 0001 — The build artefact is committed, and CI proves it matches source

**Status:** accepted · **Date:** 2026-06 · **Affects:** `app.js`, `tallal.js`, `.github/workflows/ci.yml`

## Context

Sura is a static site on Cloudflare Pages. The frontend is vanilla JS with no
framework and no runtime build, but it is not one file: `src/` holds `core/`
(pure, importable modules), `games/`, and `main.js`. Something has to turn that
into what the browser loads.

Two conventional answers, both wrong here:

- **Ship ES modules directly.** ~40 modules means ~40 requests on a cold load,
  and the site's first paint is a cinematic hero — the one moment where request
  waterfalls are most visible.
- **Build in CI and publish from the runner.** This makes the deployed artefact
  a thing no human has ever run. Cloudflare Pages deploys are also triggered
  manually here (`wrangler pages deploy dist`), so a CI-only artefact would mean
  the thing that gets deployed and the thing that gets tested are built by
  different machines at different times.

## Decision

`esbuild` bundles `src/main.js → app.js` and `src/tallal.js → tallal.js`, and
**both bundles are committed to the repository**. CI then asserts they are not
stale:

```yaml
- name: Build (bundle src/ + static preflight)
  run: npm run build
- name: Verify the committed app.js matches src/ (no drift)
  run: git diff --exit-code app.js
```

The rule that follows, and is written at the top of the file itself: **never
hand-edit `app.js`.** Edit `src/`, run `npm run build`.

## Consequences

**What it buys.** The deployed bytes are in version control, so `git log -p
app.js` shows exactly what changed in production. Deploy needs no toolchain —
`npm run dist` copies files, it does not compile. And a contributor who edits
the bundle by mistake is caught by CI on the same push, not by a user.

**What it costs.** Every source change produces a large mechanical diff. That is
a real cost in review, and it is accepted: reviewers read `src/`, and CI reads
the bundle. The alternative — a diff nobody can see at all — is worse.

**The honest limitation.** `git diff --exit-code` only proves the bundle matches
source *on CI's esbuild version*. A contributor on a different `esbuild` minor
could produce a byte-different bundle from identical source. `package.json` pins
the version for this reason; if that pin is ever loosened, this check weakens
with it.

## Related

[0003](0003-content-hash-cache-busting.md) — because the bundle is committed,
its cache-busting token must be derived from its content, not typed.
