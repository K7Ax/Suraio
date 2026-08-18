// submit-feedback — the ONLY writer of `feedback_reports` and `game_ratings`.
// verify_jwt = false, deliberately: the player most likely to hit a bug is the
// one who never signed in, and a report form that demands an account collects
// nothing. Identity is read when a token is present and simply absent when not.
//
// WHY A FUNCTION AND NOT A CLIENT INSERT. Both tables have RLS on with zero
// policies. A table a browser can write is a table a stranger can fill, and a
// report queue full of junk is a report queue nobody reads. Everything that
// decides *value* here — the rate limit, the image size cap, the rater identity
// behind `game_ratings`'s unique constraint — has to be computed somewhere the
// caller cannot reach.
//
// THE RATE LIMIT IS A REAL ONE, NOT THE ISOLATE COUNTER. `_shared/guard.ts`
// documents its own limiter as measured-ineffective on this platform: requests
// spread across short-lived isolates, so an in-memory counter never sees a burst.
// The reason that was accepted for the read endpoints was latency — a database
// round trip on the site's hottest path to protect a quota is a bad trade. None
// of that applies here. This endpoint is cold, it already writes, and one extra
// SELECT is invisible next to the INSERT it guards. So the ceiling is counted in
// the table itself, where every isolate can see it. The isolate limiter is kept
// in front as a free floor.
//
// THE IMAGE NEVER TOUCHES STORAGE. It is forwarded to Telegram and only the
// returned `file_id` is stored — the owner's explicit choice, and worth stating
// because the column name does not say it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bodyTooLarge, capped, clientIp, jsonFor, preflight, rateLimit, tooMany, verifiedUser,
} from "../_shared/guard.ts";
// The standard decoder, NOT `atob`. tests/security.test.js bans `atob(` outright
// across every function, because the A4 finding was identity read straight out of
// a JWT payload. Decoding an image is a different thing entirely — but a blanket
// ban that needs no case-by-case reading is worth more than the convenience, and
// this returns the Uint8Array we wanted anyway instead of a charCode loop.
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

const OPTS = { methods: "POST, OPTIONS" };

// Caps. The client downscales to ~150KB of JPEG; base64 inflates by 4/3, so
// 260KB of encoded image plus prose fits comfortably under 400KB of body. The
// client enforces the same numbers — this is the copy that matters, because the
// other one runs on the attacker's machine.
const MAX_BODY = 400_000;
const MAX_IMAGE_BYTES = 260_000;
const MAX_FIELD = 2000;
// The only floor left. It was 10 against a form that also demanded 40 characters
// across three boxes; the owner cut the form to one box and the ceremony with it,
// so this is now a junk filter and nothing more — and it drops to 3 when a
// screenshot is attached, because «هذي المشكلة» over a photo of a broken board is
// a complete report and refusing it would be pedantry.
const MIN_TEXT = 8;
const MIN_TEXT_WITH_PHOTO = 3;

// Reports per device per hour, and per IP per hour. Two keys because each one
// alone is trivially defeated: device_id is client-supplied, and an IP is shared
// by everyone behind a carrier NAT. Crossing either is a refusal.
const PER_DEVICE_HOUR = 5;
const PER_IP_HOUR = 20;

const VERDICTS = new Set(["too_hard", "just_right", "too_easy"]);
const LIVE = new Set([
  "wordle", "connections", "spelling_bee", "amthal", "warmer", "lamha",
  "sudoku", "letterboxed", "strands", "tiles", "pips", "missing_word",
  "story_order", "zayid",
]);

Deno.serve(async (req: Request) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Free floor (see header). Never the control.
  if (!rateLimit(req, { perIp: 20, perIsolate: 200 })) return tooMany(req, OPTS);
  if (bodyTooLarge(req, MAX_BODY)) return json({ error: "too_large" }, 413);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Present when signed in, null otherwise — and verified either way, never
  // decoded from the token's payload (A4).
  const caller = await verifiedUser(req);

  const deviceId = capped(body.device_id, 64) || "unknown";
  const ip = clientIp(req);
  const kind = String(body.kind ?? "report");

  if (kind === "rating") return await handleRating();
  // A suggestion is a report with a different face: same table, same rate limit,
  // same triage queue and GitHub button. A separate table would have bought a
  // second migration, a second dashboard section and a second inbox — for rows
  // that differ by one word. `context.kind` is what tells them apart.
  const isIdea = kind === "idea";
  if (!isIdea && kind !== "report") return json({ error: "bad kind" }, 400);

  // ---- the real rate limit ------------------------------------------------
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [byDevice, byIp] = await Promise.all([
    admin.from("feedback_reports").select("id", { count: "exact", head: true })
      .eq("device_id", deviceId).gte("created_at", since),
    admin.from("feedback_reports").select("id", { count: "exact", head: true })
      .eq("context->>ip", ip).gte("created_at", since),
  ]);
  if ((byDevice.count ?? 0) >= PER_DEVICE_HOUR || (byIp.count ?? 0) >= PER_IP_HOUR) {
    return json({ error: "rate_limited", message: "وصلت الحدّ الأقصى للبلاغات هذه الساعة" }, 429);
  }

  const expected = capped(body.expected, MAX_FIELD).trim();
  const happened = capped(body.happened, MAX_FIELD).trim();
  const hasPhoto = typeof body.image === "string" && body.image.length > 0;
  if (happened.length < (hasPhoto && !isIdea ? MIN_TEXT_WITH_PHOTO : MIN_TEXT)) {
    return json({
      error: "too_short",
      message: isIdea ? "اكتب فكرتك في سطرٍ واحد على الأقل" : "اكتب المشكلة في سطرٍ واحد على الأقل",
    }, 400);
  }

  const gameRaw = capped(body.game_type, 32);
  const game = LIVE.has(gameRaw) ? gameRaw : null;
  // `Number(null)` is 0, and 0 is a valid level — so a report that sent no level
  // at all was landing as «المستوى ٠». Caught by reading a real row rather than
  // trusting the 200. The absent case is now excluded before the range check.
  const lvl = body.level_number == null ? NaN : Number(body.level_number);
  const level = Number.isInteger(lvl) && lvl >= 0 && lvl <= 999 ? lvl : null;

  // The auto-attached slice. Rebuilt here from capped fields rather than stored
  // as the client sent it: `context` is jsonb, and an unbounded object is an
  // unbounded row.
  const ctxIn = (body.context && typeof body.context === "object")
    ? body.context as Record<string, unknown> : {};
  const context: Record<string, string> = { ip };
  for (const k of ["device", "browser", "ua", "viewport", "url", "lang", "theme", "build"]) {
    const v = capped(ctxIn[k], 200);
    if (v) context[k] = v;
  }
  // What tells a suggestion from a bug, everywhere downstream: the bot badge,
  // the dashboard filter, the GitHub label. One word, no second table.
  if (isIdea) context.kind = "idea";

  // THE STAR RIDES WITH THE SUGGESTION (owner: «خل الاقتراح مع التقييم»). It is
  // the idea's temperature, not its content: «add X» from someone who rates the
  // site 2 and from someone who rates it 5 are the same words asking for very
  // different things, and only the star tells them apart.
  //
  // It lives in `context` rather than a new column because it is optional, one
  // digit, and not worth a migration the owner has to paste by hand.
  //
  // AND IT DELIBERATELY DOES NOT GO TO `game_ratings`. That table's entire
  // subject is perceived DIFFICULTY — three verdicts, `verdict` NOT NULL — and
  // it exists to be compared against the real completion rate from
  // `game_events`, which is the comparison the Constitution is built on. An
  // «is Sura good» star is a different axis entirely; pouring it in there would
  // poison the one dataset that measurement depends on.
  const starsRaw = Number(body.stars);
  const stars = Number.isInteger(starsRaw) && starsRaw >= 1 && starsRaw <= 5 ? starsRaw : null;
  if (isIdea && stars != null) context.stars = String(stars);

  // `doing` is NOT NULL in the table, and the form no longer asks for it — that
  // question was exactly the ceremony the owner cut. So it is written here from
  // what we collected silently, which is the half a reporter gets wrong anyway.
  // The column keeps its meaning («in what situation did this happen») without
  // costing anyone a keystroke, and no migration was needed to get there.
  const doing = [
    isIdea ? "اقتراح" : "بلاغ",
    game ? `${game}${level != null ? ` · مستوى ${level}` : ""}` : "الموقع عامّةً",
    context.device || null,
    context.browser || null,
  ].filter(Boolean).join(" · ");

  // ---- the image ----------------------------------------------------------
  let photoBytes: Uint8Array | null = null;
  let photoMime = "image/jpeg";
  const img = typeof body.image === "string" ? body.image : "";
  if (img) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(img);
    if (!m) return json({ error: "bad_image" }, 400);
    // Length is checked BEFORE decoding, not after: 4 base64 chars are 3 bytes,
    // so the size is known without allocating anything. Decoding first to measure
    // is how a size cap becomes the allocation it was meant to prevent.
    if (Math.floor(m[2].length * 3 / 4) > MAX_IMAGE_BYTES) {
      return json({ error: "image_too_large" }, 413);
    }
    try {
      photoBytes = decodeBase64(m[2]);
    } catch {
      return json({ error: "bad_image" }, 400);
    }
    if (photoBytes.length > MAX_IMAGE_BYTES) return json({ error: "image_too_large" }, 413);
    // النوع يُستنبَط من البايتات لا من التسمية. كان `photoMime = m[1]` — أي
    // ما كتبه المُرسِل عن نفسه — فأيّ ٢٦٠ كيلو من أيّ شيء تمرّ ما دامت
    // ترويستها تقول `image/jpeg`، وتُحوَّل كما هي إلى تلغرام. الحدّ كان يعني
    // «٢٦٠ كيلو» ولا يعني «صورة». هذا يجعله يعني الاثنين.
    const sniffed = sniffImage(photoBytes);
    if (!sniffed) return json({ error: "bad_image" }, 400);
    photoMime = sniffed;
  }

  // Telegram first, so the stored row can carry the file_id. A failure here is
  // never fatal: the report is the row, the alert is a courtesy. Losing a bug
  // report because a bot token expired would be the worst possible trade.
  let fileId: string | null = null;
  // `notified` used to be `!!fileId`, which was simply wrong: it only ever went
  // true when a *photo* was sent, so a text-only report that reached Telegram
  // perfectly still reported false — and the owner reasonably read that as «no
  // alert arrived». The two facts are now separate: whether the alert went out,
  // and whether it carried an image.
  let notified = false;
  try {
    const tg = await notifyTelegram({ isIdea, doing, expected, happened, game, level, context, photoBytes, photoMime });
    fileId = tg.fileId;
    notified = tg.sent;
  } catch { /* the row still gets written */ }

  const { data, error } = await admin.from("feedback_reports").insert({
    user_id: caller?.id ?? null,
    device_id: deviceId,
    session_id: capped(body.session_id, 64) || null,
    game_type: game,
    level_number: level,
    doing, expected: expected || null, happened,
    photo_file_id: fileId,
    context,
  }).select("id").maybeSingle();

  if (error) return json({ error: "write_failed" }, 500);
  return json({ ok: true, id: data?.id ?? null, notified });

  // -------------------------------------------------------------------------
  async function handleRating() {
    const g = capped(body.game_type, 32);
    if (!LIVE.has(g)) return json({ error: "bad game" }, 400);
    const verdict = capped(body.verdict, 24);
    if (!VERDICTS.has(verdict)) return json({ error: "bad verdict" }, 400);

    const starsRaw = Number(body.stars);
    const stars = Number.isInteger(starsRaw) && starsRaw >= 1 && starsRaw <= 5 ? starsRaw : null;
    const lv = Number(body.level_number);
    const lvOk = Number.isInteger(lv) && lv >= 0 && lv <= 999 ? lv : null;

    // The identity behind the unique constraint is decided HERE. If the client
    // sent it, one player could be a hundred voters by rerolling a string.
    const rater = caller?.id ?? `dev:${deviceId}`;

    const { error: e } = await admin.from("game_ratings").upsert({
      rater,
      user_id: caller?.id ?? null,
      device_id: deviceId,
      game_type: g,
      level_number: lvOk,
      verdict,
      stars,
      note: capped(body.note, 500).trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "rater,game_type" });

    if (e) return json({ error: "write_failed" }, 500);
    return json({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// أرقامُ الصور السحريّة. ثلاثةٌ لا غير — وهي نفسها الثلاثة التي يقبلها التعبير
// النمطيّ أعلاه، فالبايتات والتسمية يُقاسان بمسطرةٍ واحدة. و`image/svg+xml`
// ليست منها بالتصميم: هي التنسيق الوحيد الذي يحمل نصًّا برمجيًّا.
// ---------------------------------------------------------------------------
function sniffImage(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return "image/png";
  // WebP: "RIFF" ???? "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  return null;
}

// ---------------------------------------------------------------------------
// Telegram. Optional by design: unset secrets mean no alert and no error.
// ---------------------------------------------------------------------------
async function notifyTelegram(r: {
  isIdea: boolean;
  doing: string; expected: string; happened: string;
  game: string | null; level: number | null;
  context: Record<string, string>;
  photoBytes: Uint8Array | null; photoMime: string;
}): Promise<{ sent: boolean; fileId: string | null }> {
  const token = Deno.env.get("SURA_BOT_TOKEN");
  const chat = Deno.env.get("SURA_ADMIN_CHAT");
  // Unset secrets are not an error — the report is the row, this is a courtesy.
  // But the caller is told the truth about it rather than a cheerful `true`.
  if (!token || !chat) return { sent: false, fileId: null };
  const api = `https://api.telegram.org/bot${token}`;

  // The star is its own line rather than a suffix on the subject: it is the one
  // part of the message worth scanning a queue for, and «—» is never printed for
  // it. An absent rating is an absent line, not an empty one (docs/architecture/identity.md).
  const st = Number(r.context.stars);
  const head = [
    r.isIdea ? "💡 اقتراح جديد" : "🐞 بلاغ جديد",
    `${r.isIdea ? "عن" : "اللعبة"}: ${r.game || (r.isIdea ? "الموقع عامّةً" : "—")}${r.level != null ? ` · المستوى ${r.level}` : ""}`,
    st >= 1 && st <= 5 ? `التقييم: ${"★".repeat(st)}${"☆".repeat(5 - st)}` : "",
    `الجهاز: ${r.context.device || "—"} · ${r.context.browser || "—"}`,
  ].filter(Boolean).join("\n");

  let fileId: string | null = null;

  if (r.photoBytes) {
    // A caption is capped at 1024 characters, so it carries the headline and the
    // first line of the complaint; the full text follows as its own message.
    const fd = new FormData();
    fd.append("chat_id", chat);
    fd.append("caption", `${head}\n\n${r.happened}`.slice(0, 1000));
    fd.append(
      "photo",
      new Blob([r.photoBytes as BlobPart], { type: r.photoMime }),
      r.photoMime === "image/png" ? "report.png" : "report.jpg",
    );
    const res = await fetch(`${api}/sendPhoto`, { method: "POST", body: fd });
    const out = await res.json().catch(() => null);
    const sizes = out?.result?.photo;
    if (Array.isArray(sizes) && sizes.length) fileId = String(sizes[sizes.length - 1].file_id);
  }

  const full = [
    r.photoBytes ? (r.isIdea ? "💡 تفاصيل الاقتراح" : "🐞 تفاصيل البلاغ") : head,
    "",
    r.happened,
    "",
    `— ${r.doing}`,
    r.context.url ? `🔗 ${r.context.url}` : "",
  ].filter(Boolean).join("\n").slice(0, 3900);

  const res = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: full }),
  });

  return { sent: res.ok, fileId };
}
