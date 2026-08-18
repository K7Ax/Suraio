# 0004 — The Content-Security-Policy is generated from the pages it protects

**Status:** accepted · **Date:** 2026-06 · **Affects:** `scripts/build/csp.js`, `_headers`

## Context

`index.html` carries six inline `<script>` blocks — config bootstrap, theme
selection before first paint, and similar work that genuinely cannot wait for
`app.js`. Across the five deployed pages there are seven.

A CSP containing `script-src 'unsafe-inline'` gives up the main thing a CSP buys:
preventing an injected script from executing. The correct alternative is a
SHA-256 hash per inline block.

But **hand-written hashes are a trap with a uniquely nasty failure mode**. Edit
one line inside an inline script and its hash no longer matches, so the browser
refuses to run it — and the site breaks *in production only*, because `_headers`
is a Cloudflare Pages file that the local dev server never applies. Development
stays green while production is broken.

## Decision

`scripts/build/csp.js` generates `_headers` from the HTML files themselves on
every build. Drift becomes impossible rather than merely detectable. The file
carries a "generated — do not hand-edit" banner, and `npm run build` prints
`CSP_OK (7 inline-script hashes over 5 pages)`.

Two things had to be gotten right, and the first attempt got both wrong:

**Hashing must use a stateful scan, not a regex.** The obvious
`/<script[^>]*>([\s\S]*?)<\/script>/g` sees things the browser does not.
`index.html` contains an HTML comment that mentions the word `<script>`, so the
regex hashed a phantom 14,648-character block and dropped the real script that
followed it. Measured result: five CSP violations, then one. The scanner now
walks the document once and skips over comments, hashing only what the parser
actually reaches.

**Line endings must be normalized.** The file is stored CRLF. An HTML parser
normalizes to LF before assembling the script's text, so the browser hashes LF.
Hashing the bytes as they sit on disk yields a value that matches nothing.

## Consequences

Inline scripts can be edited freely; the policy follows. External origins are
derived from a scan of the source, not from memory — `res.cloudinary.com`,
`fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.jsdelivr.net`, `*.supabase.co`.

**A deliberate, documented compromise:** inline *styles* remain
`'unsafe-inline'`. Hashes do not cover `style="…"` attributes, of which there
are 39, and `'unsafe-hashes'` opens a wider door than it closes. An injected
style is a far smaller risk than an injected script. This is a trade-off that
was reasoned about and written down — not an oversight, and it should be
revisited if the attribute count ever drops to zero.

**Known noise:** Cloudflare injects its own `beacon.min.js`, which this policy
blocks. It appears as a console error on production and is not fixed, because
loosening the policy for an analytics beacon is a bad trade. It is documented
here so the next person does not spend an afternoon on it.
