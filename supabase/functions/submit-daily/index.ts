// submit-daily — the ONLY writer of `daily_streaks`. verify_jwt = true.
//
// WHAT IT IS FOR: «تحدي اليوم» lasts 24 hours and then it is gone. A streak is
// what makes that window mean something — it is the only thing a player loses by
// not showing up, and it is therefore the one number worth defending.
//
// AUTHORITY MODEL — what is server-owned and what is not, stated plainly:
//   1. THE DATE IS OURS. `last_day` comes from the server clock in Asia/Riyadh,
//      never from the request. A client-supplied date is the cheapest possible
//      forgery: set the device clock forward and collect a streak a day.
//   2. THE SCHEDULE IS OURS, when it exists. If today has published rows in
//      `daily_challenge`, the claimed game must be one of them. If the owner has
//      not published yet, we fall back to "any live game" — degraded on purpose,
//      because a streak that silently dies while the content pipeline is behind
//      punishes the player for the operator's timing.
//   3. THE SOLVE IS NOT OURS, and we say so rather than pretending. The daily is
//      checked in the browser exactly like the campaign, so this endpoint trusts
//      the claim "I finished today" at the same level `submit-progress` trusts
//      "I cleared level N". What it does NOT trust is how MUCH that is worth: no
//      XP, no rank, no leaderboard position is granted here.
//   4. IDEMPOTENT BY CONSTRUCTION. `last_day === today` returns the row unchanged.
//      Friday's six games are one day, and a double-tap costs nothing.
//
// The streak rule itself is defined once in `src/core/streak.mjs` and mirrored
// below line for line — the same arrangement `normalize_arabic` already has, and
// tests/streak.test.js reads both files to keep them from drifting.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonFor, preflight } from "../_shared/guard.ts";

// A12 (audit, August 2026) · `Access-Control-Allow-Origin: *` is replaced by the
// shared allowlist in _shared/guard.ts. The practical risk here was lower than
// on the open endpoints — this function needs a bearer token that a foreign
// origin cannot read out of our localStorage, so there are no ambient
// credentials for a cross-origin page to ride. It is changed anyway: an
// exception that is safe "for a reason" is an exception the next reader has to
// re-derive, and the reason stops being true the day anything moves to cookies.
const OPTS = { methods: "POST, OPTIONS" };

// The six live games. Mirrors LIVE_GAMES in src/main.js — a hidden game must not
// be claimable, or un-hiding one later becomes a silent behaviour change.
const LIVE = new Set(["wordle", "connections", "spelling_bee", "amthal", "warmer", "lamha"]);

// Riyadh is UTC+3 with no DST, so the calendar day is a pure offset — the same
// boundary suraDailySeed() uses in the browser and get-daily-challenge uses here.
function riyadhToday(nowMs: number): string {
  return new Date(nowMs + 3 * 3600000).toISOString().slice(0, 10);
}
// Whole days between two YYYY-MM-DD strings. Computed on a day counter, never on
// the digits: a YYYYMMDD subtraction jumps ~70 at a month boundary and would
// break every streak that crossed the 1st.
function dayGap(from: string, to: string): number {
  const d = (s: string) => Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
  return d(to) - d(from);
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  // Per request, because the allowed origin now depends on THIS caller.
  const json = jsonFor(req, OPTS);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  let body: { game?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const game = String(body.game ?? "");
  if (!LIVE.has(game)) return json({ error: "bad game" }, 400);

  const today = riyadhToday(Date.now());

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Structural check (2): claim a game that is actually on today's board.
  const { data: sched } = await admin
    .from("daily_challenge")
    .select("game_type")
    .eq("puzzle_date", today)
    .eq("status", "published");
  if (sched && sched.length && !sched.some((r) => r.game_type === game)) {
    return json({ error: "not_scheduled", message: "هذه اللعبة ليست في تحدي اليوم" }, 400);
  }

  const { data: row } = await admin
    .from("daily_streaks")
    .select("current_streak, max_streak, last_day, total_days")
    .eq("user_id", userId)
    .maybeSingle();

  const last = (row?.last_day as string | null) || null;
  const cur = row?.current_streak ?? 0;
  const max = row?.max_streak ?? 0;

  // ---- the rule (mirror of src/core/streak.mjs advanceStreak) --------------
  if (last === today) {
    return json({ ok: true, already: true, current: cur, max, last_day: last });
  }
  const continued = !!last && dayGap(last, today) === 1;
  const current = continued ? cur + 1 : 1;   // reset to 1, not 0 — they DID play today
  // -------------------------------------------------------------------------

  const { error } = await admin.from("daily_streaks").upsert({
    user_id: userId,
    current_streak: current,
    max_streak: Math.max(current, max),
    last_day: today,
    total_days: (row?.total_days ?? 0) + 1,
    updated_at: new Date().toISOString(),
  });
  if (error) return json({ error: "write_failed" }, 500);

  return json({
    ok: true, already: false, current, max: Math.max(current, max),
    last_day: today, extended: continued, reset: !continued && cur > 0,
  });
});

