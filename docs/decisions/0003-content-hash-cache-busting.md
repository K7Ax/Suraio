# 0003 — `?v=` is a content hash the build writes, never a number a human types

**Status:** accepted · **Date:** 2026-06 · **Affects:** `scripts/build/preflight.js`, `index.html`, `404.html`

## Context

The site serves `app.js` and `style.css` with long-lived immutable cache
headers, so the query token in `app.js?v=…` is the only thing that tells a
returning visitor to fetch a new bundle.

Originally that token was a hand-incremented integer, and preflight only
*asserted the marker existed*. The failure mode was exactly what you would
predict and worse than it sounds: an edit shipped under whichever number was
typed last, so returning visitors — the engaged ones, the ones with the site in
their cache — kept running old code while new visitors ran new code. Bug reports
from that window were unreproducible by definition.

## Decision

`scripts/build/preflight.js` derives the token from the asset's own bytes and
**rewrites the HTML**:

```js
function contentTag(rel) {
  return crypto.createHash("sha1").update(fs.readFileSync(path.join(root, rel)))
    .digest("hex").replace(/\D/g, "").slice(0, 8) || "0";
}
```

Two properties make it safe to run on every build:

- **Automatic** — a source change changes the bundle changes the token. There is
  no step for a human to forget.
- **Idempotent** — a rebuild with no source change produces the same token and
  leaves `index.html` untouched, so the build does not generate spurious diffs.

`404.html` gets the same treatment for `tallal.js`, and deliberately so: an
error page served from a stale cache is the one page nobody thinks to
hard-refresh.

## Consequences

Cache-busting stopped being a discipline and became a property of the build.
`README.md` says plainly: *do not set it by hand.*

**Why sha1 and not sha256.** This is a cache key, not a security boundary.
Collision resistance against an adversary is irrelevant; the requirement is that
different content produces a different token, which any digest satisfies.
Truncating to 8 digits keeps URLs readable.

**The honest limitation.** Digits are stripped from the hex before truncating,
so the token is drawn from a smaller alphabet than the hash suggests. The
collision probability is still far below the rate at which anyone would notice,
but it is not `2^-64` and should not be described as if it were.

## Related

[0001](0001-committed-bundle.md) — the bundle is committed, so its hash is
computed from a file that is already in the tree.
