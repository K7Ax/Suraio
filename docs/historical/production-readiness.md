# Sura / سُرى — Production Readiness Report

Date: 2026-06-22. Covers the hardening effort (Phases 1–4, 6–9 executed; Phase 5
planned in [`refactor-plan.md`](refactor-plan.md)). The product — design, copy,
Arabic text, game rules, features — is **unchanged**.

---

## 1. What was changed

**Repo hygiene & docs (Phase 1–2)**
- Added `.gitignore`, `.env.example` (placeholders only), `README.md`, and
  `docs/` (architecture, security, database, deployment, incident-runbook,
  ai-agent-rules, git-hygiene, refactor-plan, this report).
- Pulled the cloud-only Edge Functions and a live schema snapshot into
  `supabase/` so the backend is version-controlled and reviewable.

**Database & server hardening (Phase 3–4, applied to prod via MCP)**
- **S1:** dropped the `daily_puzzles` public SELECT policy — the `solution`
  column is no longer readable over REST (was bypassing function-level stripping).
- **A1:** `submit-guess` now reads, sanity-clamps (1s–24h), and records
  `time_seconds` on first completion only (honest leaderboard time, no re-posting).
- **A2:** added RLS-locked `ai_usage` table + `bump_ai_usage()` counter;
  `groq-hint` (40/day) and `groq-review` (200/day) are rate-limited per user.
- **A3:** widened the `game_type` CHECK to all 10 games.
- Advisor cleanups: pinned function `search_path`, wrapped `auth.uid()` in RLS
  policies (perf), added two FK covering indexes, restricted `set_username` to
  authenticated.

**Reliability (Phase 6)**
- `window.__sura.reportError` (structured, secret-free, never throws) + global
  `error`/`unhandledrejection` safety nets; instrumented the backend-facing
  catches while preserving every fallback.

**Performance (Phase 7)**
- Off-screen videos `preload="metadata"`; below-the-fold archive images
  `loading="lazy"`; `preconnect` to the video CDN. Fixed a `.gitignore` mistake
  that had excluded **live** image assets.

**Tests & CI (Phase 8)**
- Zero-dependency Node test runner; `npm test` / `lint` / `build`; unit + content
  + live-security tests (skip offline); GitHub Actions CI.

**Bot safety (Phase 9)**
- `bot.js`: structured audit logging, safe (generic) user-facing errors with full
  detail server-side only, bulk-insert cap, `isAdmin` test.

## 2. What was NOT changed

- No visual design, layout, colors, fonts, animations, spacing, or branding.
- No copy, Arabic text, or game names; no game rules; no removed features.
- No DOM structure or CSS class-name changes (`style.css` untouched).
- `app.js` remains a single self-contained file (Phase 5 refactor is planned, not
  executed — see [`refactor-plan.md`](refactor-plan.md)).

## 3. Remaining risks

| Risk | Severity | Mitigation / status |
|---|---|---|
| `GROQ_API_KEY` may have been exposed in dev | Med | **Owner must rotate** (see §4). |
| Leaked-password protection disabled | Low | **Owner toggle** in Supabase Auth. |
| 6 newer games have no server-side result validation | Low | By design — they're offline/client-only and don't post meaningful leaderboard results. |
| `app.js` monolith | Low (maintainability) | Staged plan in `refactor-plan.md`; needs a build step. |
| Newsletter form is UI-only | Low | Product decision: wire to a validated endpoint or document as decorative. |
| Repo still tracks stale files / real backend untracked | Med (process) | **Owner must run** the git commit per `git-hygiene.md`. |

## 4. Required manual Supabase settings (owner)

1. **Rotate `GROQ_API_KEY`** at the Groq console; set it in Supabase → Edge
   Functions → Secrets. Confirm `groq-hint` / `groq-review` still work.
2. **Enable leaked-password protection**: Supabase → Auth → Password settings
   (HaveIBeenPwned check).
3. Confirm Edge Function secrets exist: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`.
4. (Broad email delivery) verify a Resend sending domain so auth emails reach all
   users, not just the test address.

## 5. Required environment variables

| Name | Zone | Where |
|---|---|---|
| `SUPABASE_URL` | public | client config + env + Supabase |
| `SUPABASE_ANON_KEY` | public | client (in `index.html`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | `bot.js` env + service functions |
| `GROQ_API_KEY` | **server only** | Supabase Edge Function secrets |
| `BOT_TOKEN`, `ADMIN_IDS` | **server only** | `bot.js` env |
| `ADMIN_EMAIL` | identity | dashboard + DB gate |

Template: `.env.example`. Never commit a real `.env`.

## 6. Deployment checklist

- [ ] `.gitignore` present; `git status` shows no `.env`, `.khalid/`, or
      `_ar_full.txt` staged.
- [ ] Publish only the static "ships" set (see `deployment.md`) — no
      `bot.js`/`supabase/`/`migrations/`/`gen_*`/`serve.py`/tests on the CDN.
- [ ] **Live assets included**: `pixel_camel.png`, `media_1/2/3.jpg`, `assets/`,
      `bank/`, `content/`.
- [ ] `?v=NN` bumped on changed `app.js`/`style.css` (currently `app.js?v=89`).
- [ ] Edge Functions deployed from `supabase/functions/`; secrets set; `GROQ_API_KEY`
      rotated.
- [ ] `npm run lint && npm run build && npm test` green.
- [ ] Smoke: site loads, a game plays, sign-in works, a win submits, leaderboard
      renders.

## 7. Security checklist

- [x] Client never trusted for results — `submit-guess` re-validates server-side.
- [x] RLS enabled on all user tables; `submissions` owner-scoped; `puzzle_bank`
      and `daily_puzzles` solutions not client-readable.
- [x] Service role key server-side only; anon key is public by design.
- [x] AI functions `verify_jwt=true` + per-user rate limits.
- [x] Admin analytics + bot writes gated (owner email / `ADMIN_IDS`) with audit log.
- [ ] `GROQ_API_KEY` rotated (owner). [ ] Leaked-password protection on (owner).

## 8. Testing checklist

- [x] `npm test` (23), `npm run lint`, `npm run build` all green.
- [x] Unit: `normalizeArabic` parity spec. Content: bank integrity. Authz:
      `isAdmin` gating.
- [x] Live security: solutions unreadable by anon; `submit-guess` rejects
      unauthenticated; privileged RPCs denied to anon; leaderboard clamp.
- [x] Browser smoke (Playwright): render, open a game, lazy images, 0 console errors.
- [x] CI runs lint+build+test (integration skipped for hermeticity).

## 9. Rollback plan

- **Frontend:** revert the changed static files (or the previous `?v=NN` bundle)
  and redeploy. All client changes are additive/behavior-preserving.
- **Edge Functions:** redeploy the prior version from git history of
  `supabase/functions/` (the repo is the source of record).
- **Database:** Round 2 migrations are in `supabase/migrations/20260622_*`. To
  reverse:
  - S1: `CREATE POLICY daily_puzzles_read_public ON public.daily_puzzles FOR SELECT USING (true);` (only if a regression appears — re-introduces the leak).
  - A2: `DROP FUNCTION bump_ai_usage; DROP TABLE ai_usage;` (removes rate limiting).
  - Game-type CHECK / indexes / policy tweaks are non-destructive and safe to leave.
  - Take a snapshot before any reversal; the harness blocks destructive prod SQL —
    run deliberate changes in the SQL Editor.

## 10. Confidence scores (per category)

| Category | Score | Notes |
|---|---:|---|
| Security | 9/10 | Strong RLS + server validation + rate limits; −1 pending key rotation + leaked-password toggle. |
| Database safety | 9/10 | RLS verified, solutions locked, indexes/constraints in place. |
| Server-side validation | 8/10 | Core games validated; 6 newer games intentionally offline. |
| Reliability | 8/10 | Graceful degradation + structured errors + safety nets. |
| Performance | 8/10 | Already lean; lazy media/video; minify deferred (needs build). |
| Testing | 8/10 | Solid critical-path + live-security tests + CI; client unit coverage limited by the monolith. |
| Deployment readiness | 8/10 | Clear ship-set + checklist; −pending owner git commit. |
| Maintainability | 6/10 | Well-documented, but `app.js` monolith remains (Phase 5 planned). |
| Bot safety | 9/10 | Admin-gated, audited, safe errors, no destructive ops. |
| Architecture | 8/10 | Clean trust model; backend now in version control. |

**Overall: production-ready** once the three owner actions (rotate `GROQ_API_KEY`,
enable leaked-password protection, run the git commit) are done.
