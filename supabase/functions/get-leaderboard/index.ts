// Sura — get-leaderboard Edge Function.
// verify_jwt = false (public read; anyone can view the leaderboard) — recorded
// in supabase/config.toml.
//
// Reads only through two SECURITY DEFINER RPCs. Both are projection-limited and
// neither returns a user id; the underlying tables stay closed under RLS.
//   board=global → get_global_leaderboard (display_name, total_xp, rank_tier, …)
//   otherwise    → get_leaderboard_today  (display_name, time, score)
//
// SECURITY ROUND, August 2026:
//
//  A15 · `error.message` from Postgres was returned verbatim to anonymous
//        callers with HTTP 500. Postgres error text carries schema, column and
//        function names, which is free reconnaissance. Errors are now generic
//        to the caller. They are not swallowed — `console.error` keeps them in
//        the function log, where the owner can read them and an attacker
//        cannot. (This is also the first observability in the function layer;
//        the audit noted that nothing logged anywhere.)
//
//  A15b · `game` was passed straight into `get_leaderboard_today(p_game_type)`
//         unvalidated and possibly null. It is now checked against the same
//         canonical set submit-progress uses.
//
//  A6 · No rate limit. Now limited per IP and per isolate — see the honest
//       caveat in _shared/guard.ts.
//
//  A12 · Wildcard CORS origin replaced by the shared allowlist.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonFor, preflight, rateLimit, tooMany } from "../_shared/guard.ts";

const OPTS = { methods: "GET, OPTIONS" };

// Same 14 the campaign knows (submit-progress GAMES). Kept as a literal rather
// than imported so a change to one is a deliberate change to both.
const GAMES = new Set([
  "wordle", "connections", "sudoku", "spelling_bee", "letterboxed", "strands",
  "tiles", "pips", "amthal", "missing_word", "story_order", "warmer", "lamha", "zayid",
]);

Deno.serve(async (req: Request) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);

  if (!rateLimit(req, { perIp: 60, perIsolate: 3000 })) return tooMany(req, OPTS);

  const url = new URL(req.url);
  const board = url.searchParams.get("board");
  const game = url.searchParams.get("game");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 100);

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  // Unified global XP/rank board across all games.
  if (board === "global") {
    const { data, error } = await client.rpc("get_global_leaderboard", { p_limit: limit });
    if (error) return fail("get_global_leaderboard", error, json);
    return json({ rows: data ?? [] });
  }

  // Per-game daily board.
  if (!game || !GAMES.has(game)) return json({ error: "invalid game" }, 400);

  const { data, error } = await client.rpc("get_leaderboard_today", {
    p_game_type: game,
    p_limit: limit,
  });
  if (error) return fail("get_leaderboard_today", error, json);
  return json({ rows: data ?? [] });
});

// The caller learns that it failed; only the log learns why.
function fail(where: string, error: { message?: string }, json: (b: unknown, s?: number) => Response) {
  console.error(`[get-leaderboard] ${where}: ${error?.message ?? "unknown"}`);
  return json({ error: "unavailable" }, 500);
}
