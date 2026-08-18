# Deployment

Sura has three independently deployed pieces. Keep them separate.

## 1. Static frontend (the SPA)

**Never deploy the repository root.** `npx wrangler pages deploy .` uploads
`.env` — including the Supabase service-role key — to a public CDN. The deploy
artefact is `dist/`, and nothing else.

```bash
npm run dist        # bundle → preflight → csp → build dist/   (prints DIST_OK)
npx wrangler pages deploy dist --project-name sura
```

**What ships is a whitelist, not an exclusion list.** `scripts/build/dist.js`
copies only what it names, so a new file at the root is invisible to deployment
by default — which is the property that makes the rest of the repository safe to
reorganise. The whitelist is:

| Kind | Paths |
|---|---|
| Pages & bundles | `index.html` `app.js` `style.css` `hub.html` `404.html` `tallal.js` `dashboard.html` `dashboard.js` `privacy.html` |
| Content | ten named files under `bank/` |
| Asset directories | `public/brand` `public/navbar` `public/story` `public/vendor` |
| Named extras | `public/tallal/alley-{820,1200,1672,og}.webp` |

On top of that it refuses `.bak .map .psd .ai .sql .md .txt .py .html` by
extension, skips any file whose name starts with `_`, blocks two oversized brand
masters by name, fails on a stray file it did not expect, and scans the result
for secrets. To change what ships, edit that whitelist — do not add files beside
it and hope.

**Everything else stays server-side or local by construction:** `bot.js`,
`supabase/` (functions, SQL, templates), `prompts/`, `scripts/`, `src/`,
`tools/`, `docs/`, `tests/`, `_design-src/`, `archive/`, and `.env`.

**Cache-busting is automatic.** `scripts/build/preflight.js` rewrites the `?v=`
query on the `app.js` / `style.css` tags from a hash of the file contents. Do not
bump it by hand — a hand-edited value will just be overwritten on the next build,
and preflight fails the build if the tags are missing.

## 2. Supabase backend

**Edge Functions** (`supabase/functions/*`): deploy with the Supabase CLI or MCP.
Source of record is this repo — redeploy from here, do not edit in the dashboard.

Required **Edge Function secrets** (Supabase → Edge Functions → Secrets):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by the
platform for service-role functions), and `GROQ_API_KEY`.

`verify_jwt` settings are intentional: `submit-guess`, `groq-hint`, `groq-review`,
`submit-daily` = **true**; `get-todays-puzzle`, `get-leaderboard`, `get-daily-challenge` = **false** (public
reads — an anonymous player gets the same daily challenge as a member).

`groq-author` = **false**, and that is not a public endpoint: it has no
user-session path at all. Its only credential is `SURA_ADMIN_SECRET`, presented
by `bot.js`, which has no JWT because it runs as a service. With that secret
unset the function authorizes nobody — an unconfigured deploy is a closed one.

**Database:** apply migrations via MCP `apply_migration` / SQL Editor. Do **not**
re-apply `_current_schema_snapshot.sql`.

**Auth:** email + password. **Signup does not require an email round-trip** —
confirmation mail was cancelled by owner decision (2026-08-16), so `signUp()`
returns a session and the player is signed straight in. Email is used only for
**password reset and notifications**.

This depends on one dashboard setting: **Authentication → Email → "Confirm email"
must be OFF.** If it is ON, `src/main.js` falls back to the OTP tab and every
signup waits for mail. Resend is still in test mode and delivers only to the
owner's address, so with "Confirm email" ON, **no new user can register.**

## 3. Telegram content bot (`bot.js`)

Runs on the operator's machine/server (Node 18+, uses built-in `fetch`). Reads
`BOT_TOKEN`, `ADMIN_IDS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` from the
environment (see `.env.example`). **Never** deploy it to the static host — it
holds the service role key. See `SETUP_TELEGRAM_BOT.md`.

Safety posture (Phase 9):
- **Write commands require `ADMIN_IDS`.** If unset, all writes are refused and the
  bot warns at startup. Non-admins get only `/start` + `/help`.
- **Audit log:** every admin action and every denied attempt emits a secret-free
  `AUDIT {...}` JSON line to stdout (who, what, outcome). Capture it via your
  process manager (systemd/journald, pm2, Docker logs) for accountability.
- **Safe errors:** the service key is never logged or sent to a chat; DB errors are
  logged in full server-side but shown to admins as a generic message.
- **No destructive commands** — the bot only reads and inserts; `/seedall` is
  idempotent (dedup by signature). Bulk inserts from one message are capped.

## Required environment / secrets — quick reference

| Name | Used by | Set where |
|---|---|---|
| `SUPABASE_URL` | all | client config + env + Supabase |
| `SUPABASE_ANON_KEY` | client, functions | public (in HTML) |
| `SUPABASE_SERVICE_ROLE_KEY` | `bot.js`, service functions | env / Supabase only |
| `GROQ_API_KEY` | `groq-hint`, `groq-review` | Supabase secrets only |
| `BOT_TOKEN`, `ADMIN_IDS` | `bot.js` | env only |
| `ADMIN_EMAIL` | dashboard, DB gate | config (identity) |

## Pre-deploy checklist

- [ ] `git status` shows no `.env`, `.khalid/`, `node_modules/`, or `dist/`
      staged. See `git-hygiene.md`.
- [ ] Deploy `dist/`, never the repo root — `npm run dist` first, and let its
      whitelist decide what ships. Do not hand-curate a file list.
- [ ] `DIST_OK` printed, including its secrets scan over the build output.
- [ ] Cache-busting needs no action: `scripts/build/preflight.js` derives every
      `?v=` from a content hash during `npm run build`. Hand-edits are overwritten.
- [ ] Edge Functions deployed from `supabase/functions/`; secrets set; `GROQ_API_KEY`
      rotated and present.
- [ ] Smoke test: site loads, a game opens and is playable, sign-in works, a win
      submits, leaderboard renders.
- [ ] Bot (if running) started with env vars, not committed secrets.
