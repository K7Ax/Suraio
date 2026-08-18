// get-daily-challenge — serves «تحدي اليوم»: the ONE live day, and nothing else.
// verify_jwt = false (an anonymous player gets the same challenge as a member).
//
// THE RULE THIS FUNCTION EXISTS TO ENFORCE, in the owner's words:
//   «كل لغز حسب صعوبة يومه يجلس يوم فقط ٢٤ ساعة ثم ينتهي وينزل الجديد،
//    والموعد ١٢:٠٠ منتصف الليل».
// So there is deliberately NO date parameter and NO catch-up window. Yesterday
// is over; tomorrow is unpublished content. A `date` may be sent for diagnosis
// only, and anything other than today is refused — 410 for a window that has
// closed, 400 for one that has not opened. Refusing the future is a security
// property, not a nicety: the whole month sits in `daily_challenge` as drafts
// weeks ahead, and a leaked recipe is a leaked board.
//
// WHAT IT DOES NOT DO: it does not decide the board. `src/core/daily.mjs` is a
// pure function of the date, so the client derives the identical plan offline
// and this function is an OVERRIDE plus a provenance record. That is why an
// empty result is `{entries: []}` with 200 and never a 503 — "no published row"
// means "play the derived board", not "the site is down".
//
// Nothing here ever reads `payload` or `solution`. The response carries the
// ~120-byte recipe only; the answer never leaves the database.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, preflight, rateLimit, tooMany } from "../_shared/guard.ts";

// A12 · the wildcard origin is gone; A6 · this endpoint had no rate limit at
// all (40 rapid requests measured 40 × 200). Both now come from the shared
// guard so the next open endpoint inherits them instead of forgetting them.
const OPTS = { methods: "GET, POST, OPTIONS" };

// Riyadh is UTC+3 and has never observed DST, so the offset is a constant and
// "midnight" is one instant worldwide. Same clock as suraDailySeed() on the
// client and `(now() at time zone 'Asia/Riyadh')::date` in SQL.
const OFFSET_MS = 3 * 3600000;
const DAY_MS = 86400000;

function riyadhDate(nowMs: number): string {
  return new Date(nowMs + OFFSET_MS).toISOString().slice(0, 10);   // YYYY-MM-DD
}
// The instant this day's window closes: the next 00:00 Asia/Riyadh.
function windowEnd(nowMs: number): number {
  return Math.floor((nowMs + OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - OFFSET_MS;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;

  // Built per request, not at module scope: the allowed origin is now a
  // function of THIS caller's Origin header, and a module-level mutable would
  // race between concurrent requests in the same isolate.
  //
  // `no-store`, not a max-age: the response carries `seconds_left`, and a
  // cached copy would keep counting down from a stale start and let a player
  // hold yesterday's board past midnight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors(req, OPTS),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });

  if (!rateLimit(req, { perIp: 60, perIsolate: 3000 })) return tooMany(req, OPTS);

  const now = Date.now();
  const today = riyadhDate(now);
  const ends = windowEnd(now);

  const asked = new URL(req.url).searchParams.get("date");
  if (asked && asked !== today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)) return json({ error: "bad date" }, 400);
    // 410 vs 400 is the honest distinction: one existed and is finished, the
    // other has never been published and never will be to this caller.
    return asked < today
      ? json({ error: "expired", message: "انتهى تحدي ذلك اليوم — تحدي اليوم متاح الآن", today }, 410)
      : json({ error: "not yet", message: "لم ينزل بعد — الموعد ١٢:٠٠ منتصف الليل", today }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // `status = published` is the gate the four-step bot pipeline exists to feed.
  // Drafts and approved rows are invisible here even on the correct date — the
  // Constitution's human approval must mean something.
  const { data, error } = await supabase
    .from("daily_challenge")
    .select("game_type, tier, band, is_featured, mode, recipe")
    .eq("puzzle_date", today)
    .eq("status", "published");

  // A read failure is not worth breaking the day over: the client can derive
  // the same plan from the date alone. Report it, serve empty, stay up.
  const entries = (error ? [] : (data || [])).map((r) => ({
    game: r.game_type,
    tier: r.tier,
    band: r.band,
    featured: r.is_featured,
    mode: r.mode,
    recipe: r.recipe || {},
  }));

  return json({
    date: today,
    entries,
    // The client counts down from SERVER time, so a wrong device clock cannot
    // hand a player an extra hour or steal one.
    server_now: new Date(now).toISOString(),
    expires_at: new Date(ends).toISOString(),
    seconds_left: Math.max(0, Math.round((ends - now) / 1000)),
    degraded: !!error,
  });
});
