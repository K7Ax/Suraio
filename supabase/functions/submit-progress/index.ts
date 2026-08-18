// submit-progress — server-authoritative campaign progress + global leaderboard.
//
// WHY THIS EXISTS
// The meta-game (XP, rank, "games cleared") used to live only in device
// localStorage, so there was no cross-player leaderboard of it and a client could
// claim any XP it liked. This function is the ONLY writer of `player_progress` /
// `player_totals` (both are service-role-only under RLS), so the server — never
// the client — decides what a campaign clear is worth.
//
// AUTHORITY MODEL (Path A — "structural authority"):
//   1. Session required (verified email, like submit-guess) — anon play still works
//      locally, it just doesn't populate the global board.
//   2. XP is band-only and computed HERE (easy/medium/hard). The client's rich
//      onWin XP (speed/streak/combo) stays as local juice; it is never trusted for
//      the leaderboard, because those inputs aren't server-verifiable. This kills
//      forged XP magnitude outright.
//   3. Monotonic gate mirrors the client ladder exactly: a NEW clear of level L is
//      allowed iff L <= contiguousFrontier(alreadyCleared)+1. No jumping to L20.
//   4. Idempotent per (user, game, level) — a level credits XP exactly once
//      (the primary key is the idempotency key). Replays only refresh best_time.
//   5. Rate-limited via bump_ai_usage(kind='progress').
//   6. OPTIONAL proof check: if a `level_keys` row exists for (game, level), the
//      submitted `proof` is re-validated against it and rejected on mismatch. With
//      `level_keys` empty this is a no-op, so the framework ships working for all
//      games today and proof-validation switches on per-game as keys are seeded —
//      no code change, no fragile generator port.
//
// player_totals is RECOMPUTED from player_progress on every call (self-healing:
// it can never drift from the source rows).
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

// The 21-level campaign, mirrored from src/core/progression.mjs.
const LEVELS = 21;
const MAX = LEVELS - 1;

// Band edges — must match progression.mjs BANDS (6 easy / 9 medium / 6 hard).
// bandIndex(L): 0 easy (L0–5), 1 medium (L6–14), 2 hard (L15–20).
function bandIndex(lv: number): number {
  if (lv < 6) return 0;
  if (lv < 15) return 1;
  return 2;
}
// Band-only XP. Server-determined, monotonic by difficulty. Tunable in one place.
const BAND_XP = [20, 35, 55];

// Every game with a campaign (SALT keys in progression.mjs). Anything else → 400.
const GAMES = new Set([
  "wordle", "connections", "sudoku", "spelling_bee", "letterboxed", "strands",
  "tiles", "pips", "amthal", "missing_word", "story_order", "warmer", "lamha", "zayid",
]);

// Rank tier from total XP. Thresholds are deliberately gentle and live in one
// place; tune freely (0 مُشارِك → 4 أسطورة).
function rankTierFromXp(xp: number): number {
  if (xp >= 2500) return 4;
  if (xp >= 1000) return 3;
  if (xp >= 400) return 2;
  if (xp >= 100) return 1;
  return 0;
}

// Highest CONTIGUOUS cleared level starting from 0; -1 when L0 isn't cleared.
// Mirrors progression.mjs contiguousFrontier over a Set of cleared levels.
function contiguousFrontier(cleared: Set<number>): number {
  let i = -1;
  while (i < MAX && cleared.has(i + 1)) i++;
  return i;
}

// Arabic normalization — must match Postgres normalize_arabic() / submit-guess.
function normalizeArabic(s: string): string {
  if (!s) return "";
  let r = s.normalize("NFC");
  r = r.replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, "");
  r = r.replace(/[أإآٱ]/g, "ا");
  r = r.replace(/ى/g, "ي");
  r = r.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return r.replace(/\s+/g, " ").trim();
}

// OPTIONAL per-game proof validator. Only runs when a level_keys row exists.
// `solution` is whatever gen_level_keys later stores; keep the shapes small and
// forgiving. Returns true when no key demands validation for this game shape.
function validateProof(gameType: string, solution: any, proof: any): boolean {
  if (!solution || typeof solution !== "object") return true;
  // Word/proverb games: the answer is a normalized string.
  if (typeof solution.answer === "string") {
    const want = normalizeArabic(solution.answer);
    const got = normalizeArabic(String(proof?.answer ?? proof ?? ""));
    return want.length > 0 && want === got;
  }
  // Connections: proof.groups must partition into the same normalized word sets.
  if (Array.isArray(solution.groups)) {
    const key = (arr: string[]) => arr.map(normalizeArabic).sort().join("|");
    const want = new Set((solution.groups as string[][]).map(key));
    const got = Array.isArray(proof?.groups) ? (proof.groups as string[][]).map(key) : [];
    return got.length === want.size && got.every((g) => want.has(g));
  }
  // Unknown key shape: don't reject a legitimate clear on our account.
  return true;
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
  if (!userData.user.email_confirmed_at) return json({ error: "email_not_verified" }, 403);
  const userId = userData.user.id;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { game_type?: string; level?: unknown; proof?: unknown; time_seconds?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const gameType = String(body.game_type ?? "");
  const level = Number(body.level);
  if (!GAMES.has(gameType)) return json({ error: "bad game_type" }, 400);
  if (!Number.isInteger(level) || level < 0 || level > MAX) return json({ error: "bad level" }, 400);

  const tNum = Number(body.time_seconds);
  const safeTime = Number.isFinite(tNum) && tNum >= 1 && tNum <= 86400 ? Math.round(tNum) : null;

  // Current progress for this (user, game).
  const { data: rows, error: readErr } = await admin
    .from("player_progress")
    .select("level, best_time")
    .eq("user_id", userId).eq("game_type", gameType);
  if (readErr) return json({ error: "read failed" }, 500);

  const cleared = new Set<number>((rows ?? []).map((r: any) => r.level as number));
  const already = cleared.has(level);

  // Idempotent replay of an already-cleared level: refresh best_time only, no XP.
  if (already) {
    if (safeTime != null) {
      const prev = (rows ?? []).find((r: any) => r.level === level)?.best_time ?? null;
      if (prev == null || safeTime < prev) {
        await admin.from("player_progress")
          .update({ best_time: safeTime })
          .eq("user_id", userId).eq("game_type", gameType).eq("level", level);
      }
    }
    const totals = await recomputeTotals(admin, userId);
    return json({ credited: false, already: true, totals });
  }

  // Monotonic gate — mirror the client ladder: a new clear must be at or below the
  // next contiguous frontier. Blocks jumping straight to the high-XP hard levels.
  const frontier = contiguousFrontier(cleared) + 1;
  if (level > frontier) return json({ error: "level_locked", frontier }, 403);

  // ── A8 (audit, August 2026) — READ THIS BEFORE TRUSTING THE BOARD ──────────
  //
  // The proof check below runs ONLY when a `level_keys` row exists, and that
  // table is empty by design. So in production the proof has never been
  // examined once: XP is credited on the client's word that it cleared a level.
  //
  // WHAT THIS ROUND DID AND DID NOT DO. It did not close A8, and no rate limit
  // can. Without a server-side solution to check against, a client that asserts
  // completions in ladder order is *indistinguishable* from one that plays
  // them — that is an information problem, not a throttling problem. Closing it
  // properly means populating `level_keys`, which means deriving each of the
  // 294 level boards server-side, which means porting the level generators to
  // Deno. That is its own piece of work and is recorded as such.
  //
  // What the three gates below DO buy is time and visibility. Before them, a
  // script could climb all 294 levels and top the global leaderboard inside a
  // single day. After them the same script needs roughly five days of sustained
  // requests, and it leaves an obvious signature — a perfect 60-per-day, six-
  // per-minute cadence — instead of hiding inside one afternoon's traffic.
  // Slowing an attack until it becomes visible is a real gain. It is not a fix,
  // and this comment exists so nobody later mistakes it for one.

  // Gate 1 · pace. Six new clears a minute is far past human play (each level
  // is a whole puzzle) and far under any legitimate burst.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count: recent } = await admin
    .from("player_progress")
    .select("level", { count: "exact", head: true })
    .eq("user_id", userId).gte("cleared_at", since);
  if ((recent ?? 0) >= 6) return json({ error: "too_fast" }, 429);

  // Gate 2 · daily ceiling, tightened 400 → 60. It moved down here on purpose:
  // it used to run before the idempotent-replay branch above, so re-opening a
  // finished level burned quota. Counting only NEW credits is what makes a cap
  // this tight safe for a real player — and it removes a write per replay,
  // which is also the cheapest thing in this file.
  try {
    const { data: allowed } = await userClient.rpc("bump_ai_usage", { p_kind: "progress", p_cap: 60 });
    if (allowed === false) return json({ error: "rate_limited" }, 429);
  } catch { /* never block progress on the limiter itself */ }

  // Gate 3 · the proof, for the day `level_keys` is populated. Unchanged.
  const { data: key } = await admin
    .from("level_keys")
    .select("solution")
    .eq("game_type", gameType).eq("level", level).maybeSingle();
  if (key && !validateProof(gameType, key.solution, body.proof)) {
    return json({ error: "proof_rejected" }, 422);
  }

  const xp = BAND_XP[bandIndex(level)];

  // Credit exactly once. If a race double-fires, onConflict do-nothing keeps it
  // idempotent (the second insert is ignored, not double-counted).
  const { error: insErr } = await admin.from("player_progress").insert({
    user_id: userId, game_type: gameType, level,
    xp_awarded: xp, best_time: safeTime, best_score: 0,
  });
  if (insErr && !/duplicate key/i.test(insErr.message ?? "")) {
    return json({ error: "write failed" }, 500);
  }

  const totals = await recomputeTotals(admin, userId);
  return json({ credited: !insErr, xp, band: bandIndex(level), totals });
});

// Recompute player_totals from the authoritative player_progress rows. Self-healing
// — the aggregate can never drift because it is always derived, never incremented.
async function recomputeTotals(admin: any, userId: string) {
  const { data: all } = await admin
    .from("player_progress")
    .select("game_type, xp_awarded")
    .eq("user_id", userId);
  const rows = (all ?? []) as { game_type: string; xp_awarded: number }[];
  const totalXp = rows.reduce((s, r) => s + (r.xp_awarded | 0), 0);
  const gamesCleared = new Set(rows.map((r) => r.game_type)).size;
  const rankTier = rankTierFromXp(totalXp);
  await admin.from("player_totals").upsert({
    user_id: userId,
    total_xp: totalXp,
    rank_tier: rankTier,
    games_cleared: gamesCleared,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  return { total_xp: totalXp, rank_tier: rankTier, games_cleared: gamesCleared };
}

