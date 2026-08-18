// Sura — groq-hint Edge Function.
// A graded, constitution-bound hint via Groq. The client calls THIS, never
// Groq directly (key stays server-side). If anything fails it returns
// { ok:false } so the client keeps its local deterministic hint — the game
// never depends on AI (Constitution principle 8). Only signed-in players get
// AI hints (protects the Groq quota); anonymous players fall back to local.
//
// Secret required: GROQ_API_KEY (set in Supabase → Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const HINT_DAILY_CAP = 40; // per signed-in user per KSA day; over → local fallback

// Groq deprecated llama-3.3-70b-versatile on 2026-06-17 and names gpt-oss-120b
// as its replacement. The old id was still hard-coded in all three groq-*
// functions, so every AI hint failed and `deliverHint` fell through to the
// local provider — silently, because that fallback is by design. A dead model
// looks exactly like a healthy fallback from the outside; hence the constant,
// so the next migration is one edit per file and not a grep.
const GROQ_MODEL = "openai/gpt-oss-120b";

import { bodyTooLarge, capped, jsonFor, preflight, verifiedUser } from "../_shared/guard.ts";

const OPTS = { methods: "POST, OPTIONS" };

// A5 · INPUT CAPS. Every field below is caller-controlled and was previously
// interpolated into the prompt raw — no length cap, no type check. Two things
// followed: unbounded token spend (one request could carry megabytes), and
// prompt injection against a model that is holding the puzzle solution.
//
// The caps are generous enough that no real hint request touches them, and
// small enough that the worst-case prompt is bounded and cheap. `capped()`
// JSON-encodes non-strings first, so an object cannot smuggle length past a
// `typeof` check.
const MAX_BODY_BYTES = 16 * 1024;
const CAP = { game: 40, level: 12, difficulty: 24, player_state: 600, safe_context: 1200, solution: 600 };

const SYS = `أنت مساعد تلميحات في منصة سُرى للألعاب الذهنية العربية.
قد يُعطى لك حلّ اللغز سرًّا لتوجيه اللاعب — وممنوع منعًا باتًا كشفه أو ذكر أي كلمة/حرف/جزء منه مباشرة. وجّه طريقة التفكير فقط.
القواعد (لا تُكسر):
- التزم بمستوى التلميح: 1=إشارة عامة لطريقة التفكير، 2=تضييق المجال، 3=خاصية واحدة مميِّزة دون ذكر الحل، 4=شرح المنطق (بعد الحل فقط).
- كلما ارتفع المستوى اقتربتَ أكثر، لكن لا تكشف الحل أبدًا.
- ≤ 20 كلمة، بالعربية الفصحى المبسطة، نبرة مشجّعة لا تُشعِر اللاعب بالغباء.
- اعتمد فقط على السياق المعطى، لا معرفة خارجية.
أعد JSON فقط بمفتاحين بالضبط: {"hint":"...", "reveal_risk":"low|medium|high"}. لا تضف مفاتيح أخرى.`;

Deno.serve(async (req) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);

  // A4 · Identity is now VERIFIED, not decoded. The old line read the JWT
  // payload with atob() and trusted `role`, which is safe only while the
  // platform's verify_jwt gate stands in front — a gate that lived in a
  // dashboard toggle, outside this repository. verifiedUser() asks the auth
  // server, so a forged token fails here regardless of what is in front.
  //
  // A14 · 401, not 200. Returning 200 {"ok":false} made every status-code
  // monitor and rate limiter blind to auth failures — an attacker probing this
  // endpoint produced a wall of 200s. The client is unaffected: it calls
  // through `sb.functions.invoke`, which surfaces a non-2xx as `error`, and
  // `aiHint` already returns null on `error` and falls back to the local hint.
  const user = await verifiedUser(req);
  if (!user) return json({ ok: false, error: "auth" }, 401);

  if (bodyTooLarge(req, MAX_BODY_BYTES)) return json({ ok: false, error: "too_large" }, 413);

  // Per-user daily rate limit (server-side, can't be spoofed by the client). Over
  // the cap → {ok:false}, which the client already treats as "use the local hint".
  const sbUrl = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (sbUrl && anon) {
    try {
      const uc = createClient(sbUrl, anon, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      const { data: allowed } = await uc.rpc("bump_ai_usage", { p_kind: "hint", p_cap: HINT_DAILY_CAP });
      if (allowed === false) return json({ ok: false, error: "rate_limited" });
    } catch { /* never block a hint on the limiter itself; fall through */ }
  }

  const KEY = Deno.env.get("GROQ_API_KEY");
  if (!KEY) return json({ ok: false, error: "missing_key" });
  try {
    const body = await req.json();
    // A5 · every interpolated value is capped, and hint_level is coerced to one
    // of the four the system prompt actually defines rather than passed through.
    const g = capped(body?.game, CAP.game) || "—";
    const lv = capped(body?.level, CAP.level) || "—";
    const diff = capped(body?.difficulty, CAP.difficulty) || "—";
    const ctx = capped(body?.safe_context, CAP.safe_context) || "—";
    const state = capped(body?.player_state, CAP.player_state) || "—";
    const hl = Math.min(Math.max(parseInt(String(body?.hint_level ?? 1), 10) || 1, 1), 4);
    const sol = capped(body?.solution, CAP.solution);
    const prompt = `اللعبة: ${g}
المستوى: ${lv}
الصعوبة: ${diff}
ما يراه اللاعب الآن: ${ctx}
تقدّم اللاعب: ${state}
مستوى التلميح المطلوب: ${hl}
${sol ? "الحل (سرّي — للتوجيه فقط، ممنوع كشفه): " + sol : ""}`;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0.5, max_tokens: 180,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return json({ ok: false, error: "groq_" + res.status });
    const data = await res.json();
    let out: Record<string, string> = {};
    try { out = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}"); } catch { out = {}; }
    const hint = String(out.hint ?? "").trim();
    if (!hint) return json({ ok: false, error: "empty" });

    // A5, second half · `reveal_risk` was computed and returned but NEVER
    // enforced — the only thing stopping the model from echoing the answer was
    // one sentence of the system prompt. A prompt is a request, not a control.
    //
    // Two deterministic gates now sit after the model, where they cannot be
    // argued with: the model's own "high" self-assessment is refused outright,
    // and any hint that literally contains the solution is refused whatever the
    // model claims about it. Both fall back to the local deterministic hint,
    // which is the same path a timeout takes — the player still gets help.
    if (String(out.reveal_risk || "").toLowerCase() === "high") {
      return json({ ok: false, error: "reveal_risk" });
    }
    if (sol && leaksSolution(hint, sol)) {
      console.error("[groq-hint] refused: model echoed the solution");
      return json({ ok: false, error: "reveal_risk" });
    }
    return json({ ok: true, hint, reveal_risk: out.reveal_risk || "low" });
  } catch {
    return json({ ok: false, error: "exception" });
  }
});

// Does the hint contain the answer? Compared on a normalized form, because
// «الرِّياض» and «الرياض» are the same leak and a raw `includes` misses one of
// them. Same folding rules as normalizeArabic in src/core/util.js: strip
// tashkeel and tatweel, unify the alef family, ya/alef-maqsura, and ta-marbuta.
//
// Tokens shorter than 3 characters are ignored: Arabic function words appear in
// almost any sentence, and refusing on them would kill every legitimate hint.
// This is a backstop for the obvious failure, not a proof of non-disclosure —
// the real guarantee is that a solution is only sent at all when the caller
// already holds it.
function foldArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function leaksSolution(hint: string, solution: string): boolean {
  const h = foldArabic(hint);
  const tokens = foldArabic(solution)
    .split(/[^ء-يA-Za-z0-9]+/)
    .filter((t) => t.length >= 3);
  return tokens.some((t) => h.includes(t));
}
