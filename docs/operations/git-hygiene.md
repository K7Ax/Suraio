# Git hygiene — the first real commit

> **You run the commit, not the agent.** This document is a recommendation.
> Review it, then stage and commit yourself.

## The situation

Git tracks **13 files**. All of them are legacy: the flat prototype this project
started as. Everything built since — `src/`, `tests/`, `scripts/`, `docs/`,
`supabase/`, `bank/`, `bot.js`, the dashboard — has never been committed.

Ten of those 13 tracked files no longer exist at the paths git remembers,
because the 2026-08 reorganization moved them. `git status` reports them as
deletions. They are **not lost** — each one moved somewhere deliberate:

| Tracked path (deleted) | Now lives at |
|---|---|
| `_test_auth.py` | `archive/legacy-harnesses/_test_auth.py` |
| `_test_final.png` | `archive/screenshots/_test_final.png` |
| `media_1.jpg` · `media_2.jpg` · `media_3.jpg` | `archive/screenshots/` |
| `second.html` · `third.html` | `archive/experiments/` |
| `remove_bg.py` | `tools/remove_bg.py` |
| `inspect_image.py` | `archive/legacy-harnesses/inspect_image.py` |
| `pixel_camel.png` | `_design-src/pixel_camel.png` |

The other three — `app.js`, `index.html`, `style.css` — are still at the root
and show as modified. That is correct: the tracked copies are months old.

> An earlier version of this file warned that `media_*.jpg` and `pixel_camel.png`
> were **live UI assets referenced by `index.html`**. That is no longer true and
> was verified before archiving: `grep` across `index.html`, `style.css`,
> `hub.html`, `404.html`, `privacy.html`, `dashboard.*` and `src/` returns zero
> hits for any of them, and none appears in `dist/`. The shipped camel cursors
> are `public/brand/camel-cursor*.png`.

## A. Record the moves

The seven archived/moved files are gitignored at their destinations, so the
commit simply records their removal from the tracked tree:

```bash
git rm --cached _test_auth.py _test_final.png inspect_image.py remove_bg.py \
                media_1.jpg media_2.jpg media_3.jpg pixel_camel.png \
                second.html third.html
```

The files stay on disk. Only the index entry goes.

## B. Stage the actual project

**Never `git add .`** — it would pull in `node_modules/`, `dist/`, `.env`, and
120 MB of design masters. Stage explicitly:

```bash
# repo config and CI
git add .gitignore .gitattributes .env.example .github/

# the deployed pages and their bundles
git add index.html app.js style.css 404.html tallal.js \
        hub.html privacy.html dashboard.html dashboard.js _headers

# frontend source, content, deployed assets
git add src/ bank/ public/

# backend source of record
git add supabase/ bot.js

# build, test, tooling
git add package.json package-lock.json deno.lock skills-lock.json \
        scripts/ tests/ tools/

# documentation, prompt library, launch film
git add README.md docs/ prompts/ promo/

# the archive RECORD only — the bytes stay ignored
git add archive/

# still-undecided prototype, see section C
git add pixel.html
```

That is **403 files, ~18.9 MB**. `public/` is the bulk of it (123 files,
11.7 MB) and is legitimately deployed content.

## C. One thing to decide

**`pixel.html`** — the pixel-art round was cancelled, but `tests/pixel.test.js`
is green and is 13 of the 443 tests, and it reads `pixel.html` from disk.
Archiving the page orphans a passing test. Staged above as the low-risk default;
if you would rather retire the round, archive the page *and* the test together
in one commit rather than leaving a test asserting on a file that moved.

## D. Verify before committing

```bash
git status --short                # review every line
git diff --cached --name-only     # exactly what you are about to commit
git diff --cached --stat | tail -1

# the three that must never appear:
git check-ignore -v .env node_modules dist _design-src
git diff --cached --name-only | grep -E '^\.env$|node_modules|^dist/' && echo "STOP"
```

Confirm `.env.example` holds placeholders only and that no real key is staged.
`scripts/build/dist.js` scans build output for secret patterns, but that guard
covers the deploy artefact, **not** the commit — this step is the only thing
standing between `.env` and a public repository.

## What stays out of git, and why

| Path | Reason |
|---|---|
| `.env` | Real credentials, including the Supabase service role key. |
| `node_modules/` · `dist/` | Reproducible from `package-lock.json` and `npm run dist`. |
| `_design-src/` | ~120 MB of full-resolution masters; the derived WebP under `public/` is what ships. |
| `archive/` **bytes** | Non-production material. `archive/README.md` and each `archive/*/MANIFEST.md` **are** tracked — the record is versioned, the bytes are not. |
| `supabase/sql/seed.sql` | Regenerable, and it is the plaintext answer key to every seeded puzzle. |
| `.bench/` · `.hero_work/` · `promo/.work/` | Generated benchmark and render output. |
| `review_*.html` | Throwaway review pages. |

The `archive/` rules are written as four lines rather than a plain `archive/`
because **git will not re-include a file whose parent directory is excluded**.
With `archive/` ignored outright the `!archive/README.md` negation is dead and
the record silently disappears. Excluding `archive/*` instead lets git descend.

## After the first commit

The tracked `app.js` will finally match `src/`. From then on
`.github/workflows/ci.yml` enforces it: it rebuilds and runs
`git diff --exit-code app.js`, so a `src/` change committed without
`npm run build` fails CI.
