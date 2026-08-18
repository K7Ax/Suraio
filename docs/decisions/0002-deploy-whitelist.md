# 0002 — The deploy list is a whitelist, never an ignore list

**Status:** accepted · **Date:** 2026-06 · **Affects:** `scripts/build/dist.js`

## Context

`wrangler pages deploy .` uploads the working directory to a public CDN. It
**does not read `.gitignore`.**

At the time this was written, the repository root contained `.env` (holding
`SUPABASE_SERVICE_KEY`, `BOT_TOKEN`, `SURA_ADMIN_SECRET`), `bot.js`, the SQL
migration files, `prompts/`, `docs/` — including the security report itself —
and the complete `.git` directory. One command with a `.` in it publishes all of
it, permanently, to an endpoint that is then crawled.

The obvious mitigation is a `.cfignore`-style deny list. That fails in the worst
possible direction: it is correct until someone adds a file nobody remembered to
deny, and then it is silently wrong in the direction of a leaked key.

## Decision

Deployment goes through `scripts/build/dist.js`, which assembles a `dist/` tree
from an **explicit whitelist** and deploys only that:

```bash
npm run dist
npx wrangler pages deploy dist --project-name sura
```

The whitelist names files, not directories, wherever naming files is possible.
`bank/` is a good example: the directory holds `words_ar.json` (2.5 MB, a build
*input* the client never fetches) alongside the small JSON banks the client does
fetch, so the whitelist names the ten shipped files individually.

On top of the list, `dist.js` refuses nine extensions, skips names beginning
with `_`, fails the build on any stray file in the output, and **scans the
finished tree for secret patterns** before handing it over.

## Consequences

A whitelist also fails silently when someone forgets an entry — but it fails as
a *missing asset*, discovered by a broken page in staging, not as a leaked
credential discovered by a stranger. Both designs have a silent failure mode;
the entire decision is about choosing which one.

Two second-order effects, both good:

- **The whitelist is documentation.** It is the only place that answers "what is
  actually on the internet?" without inference.
- **File placement stops being load-bearing.** Because nothing ships unless
  named, the repository can be reorganized freely — a file that is not on the
  list cannot break deployment no matter where it moves. The 2026-06
  reorganization moved ~500 files on exactly this guarantee, and `dist/` came
  out byte-identical.

The secret scan is a belt-and-braces layer, not the primary control. It would
not catch a novel key format. It exists because the cost of being wrong here is
not a broken page.

## Related

[0006](0006-rls-as-authorization.md) — the anon key is deliberately public; this
record is about the keys that are not.
