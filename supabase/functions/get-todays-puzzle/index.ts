// Sura — get-todays-puzzle Edge Function.
// verify_jwt = false (anonymous players can fetch today's puzzle) — recorded in
// supabase/config.toml, not only in a dashboard toggle.
//
// What it does: returns (and lazily materializes from puzzle_bank) the daily
// puzzle row for a game. The client uses the returned `id` to file results
// against `submissions`/`streaks`; nothing else is read from the response.
//
// SECURITY ROUND, August 2026 — three findings closed here:
//
//  A3 · It used to ship the daily Wordle answer to any anonymous caller, on an
//       explicit honor-system rationale. A ranked, timed leaderboard now exists,
//       and an honor system is not compatible with one. The client had already
//       stopped reading it (`fetchDailyWordle` was dead code), so this removal
//       costs nothing and closes the leak. Solutions are now stripped for every
//       game with no exceptions — see `expose()` below.
//
//  A2 · The lazy materialization is a service-role WRITE reached on a fully
//       anonymous request. Its blast radius was always bounded (one bank row per
//       game per day, which is the design), but it had a real concurrency bug:
//       two simultaneous first-visitors both missed the cache, both inserted,
//       the loser got `ins.data === null`, and the next line dereferenced it
//       into a 500. The write is now an idempotent upsert followed by a re-read,
//       so a lost race resolves to the winner's row instead of an error — and
//       `puzzle_bank.used_on` is stamped only by the caller that actually won.
//
//  A6 · No rate limit at all: 40 rapid requests measured 40 × 200. Now limited
//       per IP and per isolate. Read the honest caveat in _shared/guard.ts —
//       this caps cost, it does not authenticate anyone.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonFor, preflight, rateLimit, tooMany } from "../_shared/guard.ts";

const OPTS = { methods: "GET, POST, OPTIONS" };

// The four game types this endpoint has ever served. The other nine games run
// fully client-side and never had a row here.
const ALLOWED = ["wordle", "connections", "crossword", "spelling_bee"];

Deno.serve(async (req: Request) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);

  if (!rateLimit(req, { perIp: 60, perIsolate: 3000 })) return tooMany(req, OPTS);

  const url = new URL(req.url);
  const game = url.searchParams.get("game");
  if (!game || !ALLOWED.includes(game)) return json({ error: "invalid game" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ksaDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const COLS = "id, game_type, puzzle_date, payload";

  const read = async () =>
    (await supabase.from("daily_puzzles").select(COLS)
      .eq("game_type", game).eq("puzzle_date", ksaDate).maybeSingle()).data;

  let daily = await read();

  if (!daily) {
    const { data: pick } = await supabase
      .from("puzzle_bank")
      .select("id, payload, solution")
      .eq("game_type", game)
      .eq("reviewed", true)
      .or(`used_on.is.null,used_on.lt.${ksaDate}`)
      .order("used_on", { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();

    if (!pick) return json({ error: "no puzzles in bank" }, 503);

    // ignoreDuplicates makes the racing caller a no-op instead of an error.
    const ins = await supabase
      .from("daily_puzzles")
      .upsert({
        game_type: game,
        puzzle_date: ksaDate,
        payload: pick.payload,
        solution: pick.solution,
        source_bank_id: pick.id,
      }, { onConflict: "game_type,puzzle_date", ignoreDuplicates: true })
      .select(COLS)
      .maybeSingle();

    if (ins.data) {
      daily = ins.data;
      // Only the winner consumes the bank row. Stamping it from a loser would
      // burn a second puzzle for a day that already has one.
      await supabase.from("puzzle_bank").update({ used_on: ksaDate }).eq("id", pick.id);
    } else {
      daily = await read(); // someone else won the race — take their row
    }

    if (!daily) return json({ error: "unavailable" }, 503);
  }

  return json({ puzzle: expose(daily) });
});

// The whole response surface, in one place. `solution` is never selected from
// the database above, so it cannot be leaked by a future edit here either —
// the column is absent from COLS, not merely omitted from the output.
function expose(row: Record<string, unknown>) {
  return {
    id: row.id,
    game_type: row.game_type,
    puzzle_date: row.puzzle_date,
    payload: row.payload,
  };
}
