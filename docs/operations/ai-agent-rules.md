# Rules for Contributors & AI Agents

Read this before changing anything. These rules exist because Sura's value is its
**design and feel** — that is frozen — while its backend is being hardened.

## Non-negotiable (the design is frozen)

1. **Do not change the visual design.** No colors, spacing, fonts, animations,
   layout, shadows, or visual identity — unless fixing a clear, demonstrable bug.
2. **Do not change copy, Arabic text, branding, or game names.**
3. **Do not change game rules** or simplify the experience.
4. **Do not remove existing features.** Do not add features that weren't asked for.
5. **Keep DOM structure and CSS class names stable.** The styling depends on them;
   refactors must preserve them unless absolutely necessary.

## How to work

6. **Minimal diffs.** Prefer the smallest change that achieves the goal. Match the
   surrounding code's style, naming, and comment density.
7. **Small phases.** No broad rewrites in one step. Verify the app still works
   after each change before continuing.
8. **Preserve behavior** unless the change is explicitly required for security,
   reliability, maintainability, or production readiness.

## Security & data (the backend *is* fair game to harden)

9. **Never trust the client for results.** Score, win/loss, and time must be
   validated or computed server-side (`submit-guess`).
10. **RLS is the authorization layer.** Every user-owned row stays scoped to its
    owner. Never disable RLS to "fix" a query — tighten the policy.
11. **Secrets never enter the repo or the browser.** The anon key is public; the
    service role key, `GROQ_API_KEY`, and `BOT_TOKEN` are server-only.
12. **Edge Functions: the repo is the source of record.** Redeploy from
    `supabase/functions/`; don't hot-edit in the dashboard (causes drift).
13. **Never re-apply `_current_schema_snapshot.sql`** — it's documentation, not a
    migration. Real schema changes go in new numbered migration files.

## Before you start a change

- Read `docs/security/security.md` and `docs/architecture/database.md` for the current posture and the
  known-gaps backlog (don't silently "fix" a documented gap — coordinate it).
- Verify any file/function/flag a note references still exists before relying on it.
- Run a smoke test after changes: site loads, a game plays, sign-in works, a win
  submits, leaderboard renders.

## Out of scope without explicit approval

Bulk reformatting, dependency upgrades, design tweaks, new games, removing
"unused" code that the design or runtime may depend on, and any destructive DB
operation.
