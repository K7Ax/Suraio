// Sura — groq-review Edge Function.
// Admin-only content QA: scores a puzzle/level against the Sura constitution
// and returns a structured verdict for the quality pipeline. The client calls
// THIS, never Groq directly (key stays server-side). Gated to the owner email.
//
// Secret required: GROQ_API_KEY (set in Supabase → Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ADMIN = "khalid.alzahem@gmail.com";
const REVIEW_DAILY_CAP = 200; // generous per-day cap for the admin review tool

// See groq-hint/index.ts: llama-3.3-70b-versatile was deprecated 2026-06-17.
const GROQ_MODEL = "openai/gpt-oss-120b";

import { jsonFor, preflight, secretEquals, verifiedUser } from "../_shared/guard.ts";

// A12 · The wildcard origin was worst here: this function advertises
// `x-sura-admin-secret` in Allow-Headers while accepting any origin, which
// invites a cross-origin page to try the admin door. adminSecret:true keeps the
// header allowed, and the allowlist decides who may send it.
const OPTS = { methods: "POST, OPTIONS", adminSecret: true };

const SYS = `أنت حارس جودة سُرى. راجع المرحلة وفق دستور سُرى:
العودة اليومية، العدالة (حلٌّ واحد مقصود بلا غموض)، لا اعتماد على بحث خارجي،
صعوبة مطابقة للهدف (سهل≈85%/متوسط≈70%/صعب≈40% إكمال)، هوية سعودية متاحة لكل عربي،
المتعة ولحظة الاكتشاف، قابلية المشاركة.
ارفض فورًا إن وُجد حل بديل غير مقصود (غموض)، أو حاجة لمعرفة خارجية، أو مرجع ثقافي مُقصٍ.
أعد JSON فقط بهذا الشكل بالضبط:
{"approved":true,"summary":"سطر واحد","scores":{"retention":0,"fun":0,"fairness":0,"aha":0,"cultural_fit":0,"difficulty_fit":0,"shareability":0},"requires_external_knowledge":false,"violations":[],"edits_required":[],"final_decision":"approve"}`;

// A13 · The old compare returned early when the lengths differed, so timing
// separated "wrong length" from "right length, wrong bytes" and handed away the
// secret's length. secretEquals() hashes both sides first, so every comparison
// runs over 32 fixed bytes. It also fails closed when the env var is unset.
const secretOk = (req: Request) =>
  secretEquals(Deno.env.get("SURA_ADMIN_SECRET") || "", req.headers.get("x-sura-admin-secret") || "");

Deno.serve(async (req) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);

  // TWO WAYS IN, both admin. The dashboard sends the owner's JWT. The Telegram
  // bot (bot.js /genmonth) has no user session at all — it runs as a service —
  // so it presents SURA_ADMIN_SECRET instead. The secret is a Supabase Function
  // secret, lives only in the bot's env, and is never sent to a chat or logged.
  // Absent the env var, secretOk is false and this path simply does not exist.
  //
  // A4 · The JWT path used to take `email` out of an UNVERIFIED token payload —
  // one base64 string away from anyone claiming to be the owner, had the
  // platform gate ever been off. verify_jwt is false on this function by
  // necessity (the bot has no session), so nothing stood behind it. The email
  // now comes from auth.getUser(), which is verified server-side.
  const viaSecret = await secretOk(req);
  if (!viaSecret) {
    const caller = await verifiedUser(req);
    if (!caller || caller.email.toLowerCase() !== ADMIN) return json({ error: "not authorized" }, 403);
  }

  // Server-side daily cap (defence-in-depth against runaway Groq spend). It is
  // keyed on the caller's JWT, so it only applies to the dashboard path; the bot
  // is capped instead by REVIEW_CAP on its own side, per run.
  const sbUrl = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!viaSecret && sbUrl && anon) {
    try {
      const uc = createClient(sbUrl, anon, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      const { data: allowed } = await uc.rpc("bump_ai_usage", { p_kind: "review", p_cap: REVIEW_DAILY_CAP });
      if (allowed === false) return json({ error: "rate_limited" }, 429);
    } catch { /* don't block review on the limiter itself */ }
  }

  const KEY = Deno.env.get("GROQ_API_KEY");
  if (!KEY) return json({ error: "missing_key" }, 500);
  try {
    const { game_type, level_number, difficulty_target, puzzle, solution } = await req.json();
    const user = `اللعبة: ${game_type ?? "—"}
رقم المرحلة: ${level_number ?? "—"}
الصعوبة المستهدفة: ${difficulty_target ?? "—"}
اللغز: ${JSON.stringify(puzzle)}
الحل: ${JSON.stringify(solution)}`;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0.3, max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYS }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) return json({ error: "groq_" + res.status }, 502);
    const data = await res.json();
    let out: unknown = {};
    try { out = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}"); } catch { out = {}; }
    return json(out);
  } catch {
    return json({ error: "exception" }, 500);
  }
});
