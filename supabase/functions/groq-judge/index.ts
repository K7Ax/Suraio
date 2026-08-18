// Sura — groq-judge Edge Function.
// A strict, conservative validator for the «زايد» naming-bid game. Given a
// category (e.g. "أماكن سعودية") and a typed answer, it decides whether the
// answer is a REAL, valid member of that Saudi category — so a real-but-unlisted
// village the player types is still accepted, instead of being wrongly rejected
// by a static list. The client calls THIS, never Groq directly (key stays
// server-side). On ANY failure it returns { ok:false } and the client falls back
// to list-only judging — the game never depends on AI (Constitution principle 8).
// Only signed-in players (protects the Groq quota); anonymous → list-only.
//
// Secret required: GROQ_API_KEY (set in Supabase → Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const JUDGE_DAILY_CAP = 120; // per signed-in user per KSA day; over → local fallback

// See groq-hint/index.ts: llama-3.3-70b-versatile was deprecated 2026-06-17.
// Here the dead model meant every typed answer fell back to list-only judging —
// i.e. the exact wrong-rejection this function exists to prevent.
const GROQ_MODEL = "openai/gpt-oss-120b";

import { bodyTooLarge, jsonFor, preflight, verifiedUser } from "../_shared/guard.ts";

const OPTS = { methods: "POST, OPTIONS" };
const MAX_BODY_BYTES = 4 * 1024; // category + answer are capped at 80 chars each

const SYS = `أنت حَكَمٌ صارم في لعبة سُرى العربية. يُعطى لك «الفئة» و«الإجابة»، وعليك أن تقرّر هل الإجابة عضوٌ حقيقيّ وصحيح من تلك الفئة.
القواعد (لا تُكسر):
- اقبل فقط إذا كنت واثقًا أن الإجابة حقيقية وتنتمي فعلًا للفئة (مثال: قرية أو محافظة سعودية حقيقية لفئة «أماكن سعودية»).
- ارفض المخترع أو الخيالي أو الأجنبي عن الفئة أو الخطأ الإملائي الشديد الذي لا يُعرف.
- تسامح مع اختلافات بسيطة في الإملاء (ألف/همزة/تاء مربوطة) إن كان الاسم معروفًا.
- لا تعتمد على تخمين؛ عند الشك ارفض.
أعد JSON فقط بمفتاحين بالضبط: {"valid": true|false, "canonical": "الاسم الصحيح المعتمد"}. لا تضف أي مفتاح آخر ولا أي شرح.`;

Deno.serve(async (req) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);

  // A4 · verified, not decoded — see the long note in groq-hint/index.ts.
  // A14 · 401 instead of 200, so auth failures are visible to monitoring. The
  // client's `aiJudge` returns null on `error` and falls back to list-only
  // judging, which is the same path a timeout already takes.
  const user = await verifiedUser(req);
  if (!user) return json({ ok: false, error: "auth" }, 401);

  if (bodyTooLarge(req, MAX_BODY_BYTES)) return json({ ok: false, error: "too_large" }, 413);

  // Per-user daily rate limit (server-side, can't be spoofed). Over cap → list-only.
  const sbUrl = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (sbUrl && anon) {
    try {
      const uc = createClient(sbUrl, anon, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      const { data: allowed } = await uc.rpc("bump_ai_usage", { p_kind: "judge", p_cap: JUDGE_DAILY_CAP });
      if (allowed === false) return json({ ok: false, error: "rate_limited" });
    } catch { /* never block on the limiter itself; fall through */ }
  }

  const KEY = Deno.env.get("GROQ_API_KEY");
  if (!KEY) return json({ ok: false, error: "missing_key" });
  try {
    const { category, answer } = await req.json();
    const cat = String(category ?? "").slice(0, 80);
    const ans = String(answer ?? "").slice(0, 80).trim();
    if (!cat || !ans) return json({ ok: false, error: "empty" });
    const prompt = `الفئة: ${cat}\nالإجابة: ${ans}`;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0, max_tokens: 60,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return json({ ok: false, error: "groq_" + res.status });
    const data = await res.json();
    let out: Record<string, unknown> = {};
    try { out = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "{}")); } catch { out = {}; }
    const valid = out.valid === true;
    const canonical = String(out.canonical ?? ans).trim() || ans;
    return json({ ok: true, valid, canonical });
  } catch {
    return json({ ok: false, error: "exception" });
  }
});
