// Captured from the live Supabase project "sura" (version 3) on 2026-06-22 for
// version control / review. This is the source of record going forward — redeploy
// from here. verify_jwt = true (platform verifies the token before this runs).
//
// What it does: server-side authority for gameplay results. Requires a verified
// email, re-evaluates the guess against the secret solution (never trusts the
// client's win), upserts the submission (unique on user_id+puzzle_id → idempotent),
// computes score server-side, and advances streaks on first completion.
//
// Known gap (tracked): only wordle / connections / spelling_bee are evaluated;
// the other newer games fall through to a no-op (they run client-side / offline).
//
// Round 2 (2026-06-22): now reads `time_seconds`, sanity-clamps it (1s..24h), and
// records it on the FIRST completion only — keeping the leaderboard time honest
// without trusting the client and without letting a player re-post a faster time.
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

// Arabic normalization — must match Postgres normalize_arabic()
function normalizeArabic(s: string): string {
  if (!s) return "";
  let r = s.normalize("NFC");
  r = r.replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, "");
  r = r.replace(/[أإآٱ]/g, "ا"); // alef variants -> ا
  r = r.replace(/ى/g, "ي"); // ى -> ي
  r = r.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return r.replace(/\s+/g, " ").trim();
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
  // Gameplay requires a verified email.
  if (!userData.user.email_confirmed_at) return json({ error: "email_not_verified" }, 403);
  const userId = userData.user.id;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { puzzle_id?: string; guess?: unknown; game_type?: string; time_seconds?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { puzzle_id, guess, game_type, time_seconds } = body;
  if (!puzzle_id || guess === undefined || !game_type) return json({ error: "missing fields" }, 400);

  // Sanity-clamp the client-reported solve time: 1s..24h, integer, else null.
  // The client is not trusted; this just keeps the leaderboard time column honest
  // and rejects absurd values. (Recorded only on the FIRST completion below.)
  const tNum = Number(time_seconds);
  const safeTime = Number.isFinite(tNum) && tNum >= 1 && tNum <= 86400 ? Math.round(tNum) : null;

  const { data: puzzle } = await admin
    .from("daily_puzzles")
    .select("id, game_type, payload, solution")
    .eq("id", puzzle_id)
    .single();
  if (!puzzle) return json({ error: "puzzle not found" }, 404);

  // A7 (audit, August 2026) · The client's `game_type` used to be written
  // verbatim into `submissions.game_type` and used to drive `streaks`, while
  // the EVALUATION used `puzzle.game_type` read from the database. The two were
  // never reconciled — so a player could solve a Wordle and file the win, and
  // the streak, under `spelling_bee`, a game they had never opened.
  //
  // The fix is not a whitelist: it is to stop having two sources of truth. The
  // puzzle row owns its own type, and `gameType` below is the only one used
  // from here on. The client's claim is kept solely to reject a mismatch
  // loudly, because a disagreement means either a stale client or a forgery
  // attempt, and both are worth refusing rather than silently correcting.
  const gameType = puzzle.game_type as string;
  if (game_type !== gameType) return json({ error: "game_type mismatch" }, 409);

  const result = evaluate(gameType, puzzle.payload, puzzle.solution, guess);

  // upsert submission
  const { data: existing } = await admin
    .from("submissions")
    .select("id, guesses, attempts, completed")
    .eq("user_id", userId).eq("puzzle_id", puzzle_id).maybeSingle();

  const guesses = [...((existing?.guesses as unknown[]) ?? []), { guess, ...result.summary }];
  const attempts = (existing?.attempts ?? 0) + 1;
  const completed = result.completed || (existing?.completed ?? false);
  const score = result.completed ? result.score : (existing ? 0 : 0);

  const row: Record<string, unknown> = {
    user_id: userId,
    puzzle_id,
    game_type: gameType,
    guesses,
    attempts,
    completed,
    score,
    submitted_at: completed ? new Date().toISOString() : null,
  };
  // Record solve time only on the first completion. On idempotent re-submits the
  // column is omitted, so upsert preserves it — a player can't re-post a faster time.
  if (result.completed && !(existing?.completed)) row.time_seconds = safeTime;

  await admin.from("submissions").upsert(row, { onConflict: "user_id,puzzle_id" });

  // streaks on first completion
  if (result.completed && !(existing?.completed)) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const { data: streak } = await admin.from("streaks")
      .select("current_streak, max_streak, last_played_date, total_played, total_won")
      .eq("user_id", userId).eq("game_type", gameType).maybeSingle();
    const last = streak?.last_played_date as string | null;
    const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const ydate = yesterday.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const current = (last === ydate || last === today) ? (streak?.current_streak ?? 0) + (last === today ? 0 : 1) : 1;
    await admin.from("streaks").upsert({
      user_id: userId, game_type: gameType,
      current_streak: current,
      max_streak: Math.max(current, streak?.max_streak ?? 0),
      last_played_date: today,
      total_played: (streak?.total_played ?? 0) + 1,
      total_won: (streak?.total_won ?? 0) + 1,
    });
  }

  return json({ result: result.feedback, completed: result.completed, attempts, score });
});

function evaluate(game: string, payload: any, solution: any, guess: any) {
  if (game === "wordle") return evalWordle(solution.word, String(guess));
  if (game === "connections") return evalConnections(solution.groups, guess as string[]);
  if (game === "spelling_bee") return evalBee(payload, solution, String(guess));
  return { feedback: null, completed: false, score: 0, summary: {} };
}

function evalWordle(secret: string, guess: string) {
  const s = normalizeArabic(secret).split("");
  const g = normalizeArabic(guess).split("");
  const len = s.length;
  const feedback: string[] = Array(len).fill("absent");
  const used = Array(len).fill(false);
  for (let i = 0; i < len; i++) if (g[i] === s[i]) { feedback[i] = "correct"; used[i] = true; }
  for (let i = 0; i < len; i++) {
    if (feedback[i] === "correct") continue;
    const idx = s.findIndex((c, j) => !used[j] && c === g[i]);
    if (idx !== -1) { feedback[i] = "present"; used[idx] = true; }
  }
  const completed = feedback.every(f => f === "correct") && g.length === len;
  return { feedback, completed, score: completed ? Math.max(60 - 10 * 0, 10) : 0, summary: { correct: feedback.filter(f=>f==="correct").length } };
}

function evalConnections(groups: any[], picks: string[]) {
  // picks is array of 4 words user chose
  const norm = picks.map(normalizeArabic).sort();
  let matched: any = null;
  for (const g of groups) {
    const w = (g.words as string[]).map(normalizeArabic).sort();
    if (w.length === norm.length && w.every((x, i) => x === norm[i])) { matched = g; break; }
  }
  return {
    feedback: matched ? { matched: true, theme: matched.theme, difficulty: matched.difficulty } : { matched: false },
    completed: false, // completion handled client-side after all 4 groups found; or backend tallies later
    score: matched ? 25 : 0,
    summary: { matched: !!matched },
  };
}

function evalBee(payload: any, solution: any, word: string) {
  const valid = (solution.valid_words as string[]).map(normalizeArabic);
  const center = normalizeArabic(payload.center);
  const w = normalizeArabic(word);
  const ok = w.length >= (payload.min_length ?? 4) && w.includes(center) && valid.includes(w);
  const isPangram = ok && (solution.pangrams as string[]).map(normalizeArabic).includes(w);
  return { feedback: { valid: ok, pangram: isPangram }, completed: false, score: ok ? (isPangram ? w.length + 7 : (w.length === 4 ? 1 : w.length)) : 0, summary: { valid: ok } };
}

