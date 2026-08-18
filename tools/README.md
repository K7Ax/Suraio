# tools/

Local-only Python utilities. **Nothing here ships**, nothing here runs in CI, and
nothing here is imported by the app, the build, or the tests. They exist because
each solves a problem that `npm` scripts do not.

Run every one of them **from the repository root** — each resolves its paths
relative to the repo root, not to this directory.

| Script | What it does |
|---|---|
| `serve_nocache.py` | **The dev server.** `python tools/serve_nocache.py` → http://localhost:8000. Serves the working tree with caching fully disabled, so an edited `app.js` or `style.css` is visible on reload without a `?v=` bump. Also serves `404.html` for unknown paths, matching Cloudflare Pages. |
| `serve.py` | The same idea, older and simpler: no-cache headers, no 404 handling. Kept because it has no dependency on the 404 page existing. |
| `process_words.py` | Rebuilds `bank/words_ar.json`, the shared Arabic dictionary behind كَلِمة, صندوق الحروف, and نحلة الإملاء. Reads the hermitdave frequency corpus from `archive/data/_ar_full.txt`, filters to 3–6 letter words above a frequency floor, normalizes to match `normalizeArabic()`, then unions in every puzzle answer so game content always validates. Degrades gracefully when the corpus is absent. |
| `remove_bg.py` | Adaptive background removal by boundary-sampled flood fill. `python tools/remove_bg.py <in.png> [out.png]`; edits in place when no output is given. |

## Why `python` and not `node`

`serve_nocache.py` needs zero install — Python ships with the machine, and the
alternative would add a dev-server dependency to `package.json` for something the
standard library already does in 50 lines. `process_words.py` predates the Node
tooling and processes a 2.5M-line corpus that nothing else touches.

The Node counterparts live in `scripts/` and are the ones wired into
`package.json`. If you are looking for the build, the tests, the bank generators,
or the QA sweep, they are there, not here.

## Path resolution

`serve.py` and `process_words.py` compute the repo root as **two** levels up from
`__file__`, because they live one directory deep. That line is load-bearing: with
one level, `serve.py` would serve `tools/` (no `index.html`) and
`process_words.py` would try to write `tools/bank/words_ar.json` and crash. Both
were corrected when these files moved here in the 2026-08 reorganization.
