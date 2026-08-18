// Sura — groq-author Edge Function.
//
// Turns an authoring prompt into content PROPOSALS. It does not decide anything:
// bot.js runs every returned item through core/checks.mjs, and nothing reaches a
// bank file without an explicit human /adopt (Constitution §8).
//
// WHY THE PROMPT IS BUILT BY THE CALLER AND NOT HERE:
//   core/authoring.mjs is a plain ESM module that bot.js, the tests and this
//   function would all need. Deno cannot import from src/ at deploy time, so
//   putting the prompt here would mean a SECOND copy of the per-game rules in a
//   different language — which is exactly how the three Arabic normalizers
//   drifted (see tests/normalize.test.js). One copy, in src/, tested.
//
// WHAT THIS FUNCTION IS FOR, THEN: holding GROQ_API_KEY. The key is a Supabase
// secret and must never sit in the bot's .env on a laptop alongside a Telegram
// token. Everything below is the cost and blast-radius fence around that key.
//
// Secret required: GROQ_API_KEY (Supabase → Edge Functions → Secrets).
// Auth: SURA_ADMIN_SECRET only — there is no user-session path, because no
// signed-in player has any reason to author content.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonFor, preflight, secretEquals } from "../_shared/guard.ts";

// See groq-hint/index.ts: llama-3.3-70b-versatile was deprecated 2026-06-17.
const GROQ_MODEL = "openai/gpt-oss-120b";

// Caps. A valid secret buys authoring, not an open Groq account: even an
// operator mistake (a loop, a pasted 400-item avoid-list) stops here rather than
// at the invoice. The numbers are sized from the real prompts — a 12-item
// batch's user message measures well under 6k characters.
const MAX_SYSTEM = 4_000;
const MAX_USER = 24_000;
const MAX_N = 12;
const MAX_OUT_TOKENS = 3_000;

// Mirrors AUTHORABLE_GAMES in core/authoring.mjs. Duplicated ON PURPOSE and kept
// to a bare list: it is a fence, not logic. The five excluded games are correct
// by construction, and if a caller ever asks for one the answer must be no even
// if the bug is on our own side of the wire.
const AUTHORABLE = new Set(["connections", "wordle", "amthal", "lamha", "warmer"]);

// A SECOND, NARROWER DOOR: vetting, not authoring.
//
// «نحلة» stays out of AUTHORABLE and always will — its boards are correct by
// construction and a model asked for Arabic words invents plausible ones that do
// not exist (the Round-4 bug). But `mode:"vet"` asks a different question: given
// a list of words WE generated, which are ordinary Arabic a player would know?
// That is classification, and the model never contributes a token of content —
// the caller intersects the reply with the words it sent, so a word the model
// invents cannot survive the round trip even if it tries. Vetting is therefore
// safe for the construction-proved games, and authoring still is not.
const VETTABLE = new Set([...AUTHORABLE, "spelling_bee", "letterboxed", "strands"]);

// A12 · wildcard origin replaced by the shared allowlist; adminSecret:true
// keeps `x-sura-admin-secret` permitted, but now only for allowed origins.
const OPTS = { methods: "POST, OPTIONS", adminSecret: true };

// A13 · see groq-review — the old compare short-circuited on length and leaked
// SURA_ADMIN_SECRET's length through response timing.
const secretOk = (req: Request) =>
  secretEquals(Deno.env.get("SURA_ADMIN_SECRET") || "", req.headers.get("x-sura-admin-secret") || "");

Deno.serve(async (req) => {
  const pre = preflight(req, OPTS);
  if (pre) return pre;
  const json = jsonFor(req, OPTS);

  // Fails closed: with SURA_ADMIN_SECRET unset, secretOk is false for everyone
  // and this endpoint simply does not exist. That is the desired default — an
  // unconfigured deploy must not be an open one.
  if (!await secretOk(req)) return json({ error: "not authorized" }, 403);

  const KEY = Deno.env.get("GROQ_API_KEY");
  if (!KEY) return json({ error: "missing_key" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const game = String(body.game ?? "");
  const system = String(body.system ?? "");
  const user = String(body.user ?? "");
  const n = Number(body.n ?? 5);
  const mode = String(body.mode ?? "author");

  if (mode !== "author" && mode !== "vet") return json({ error: "bad_mode", mode }, 400);
  const allowed = mode === "vet" ? VETTABLE : AUTHORABLE;
  if (!allowed.has(game)) return json({ error: "game_not_authorable", game, mode }, 400);
  if (!system || !user) return json({ error: "empty_prompt" }, 400);
  if (system.length > MAX_SYSTEM || user.length > MAX_USER) return json({ error: "prompt_too_long" }, 413);
  if (!Number.isFinite(n) || n < 1 || n > MAX_N) return json({ error: "bad_n" }, 400);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        // Higher than groq-review's 0.3 on purpose: review wants the same
        // verdict every time, authoring wants variety across runs — a bank
        // grown from twenty near-identical proverbs is not a bigger bank.
        // Vetting is the opposite: «is this a real word» must not depend on
        // which run you asked, or the same lexicon vets differently twice.
        temperature: mode === "vet" ? 0 : 0.8,
        // gpt-oss-120b is a REASONING model and its thinking tokens are billed
        // against max_tokens. A 120-word vetting batch spent the whole 3,000 on
        // deliberation and Groq answered 400 «Failed to validate JSON» — the
        // object was truncated before it closed, which reads as a prompt bug and
        // is not one. Classification needs no deliberation, so vetting asks for
        // low effort and a SMALLER ceiling: max_tokens is also what Groq bills
        // against tokens-per-minute, so asking for 8,000 to be safe bought a 413
        // instead. Sixty words answer inside two thousand with room to spare.
        max_tokens: mode === "vet" ? 2_000 : MAX_OUT_TOKENS,
        ...(mode === "vet" ? { reasoning_effort: "low" } : {}),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      // Pass the upstream reason through. It was swallowed before, and a bare
      // «groq_400» is unactionable — the operator cannot tell a bad model name
      // from a bad parameter without it. Truncated, and it carries no secret:
      // the key travels in a header Groq never echoes.
      const why = (await res.text().catch(() => "")).slice(0, 300);
      return json({ error: "groq_" + res.status, upstream: why }, 502);
    }
    const data = await res.json();
    // The raw string is returned UNPARSED. core/authoring.parseProposals is the
    // one place that decides what a model reply means, it is tested against
    // malformed replies, and a second lenient parser here would be a second
    // opinion nobody asked for.
    return json({
      ok: true,
      model: GROQ_MODEL,
      raw: data?.choices?.[0]?.message?.content ?? "",
      usage: data?.usage ?? null,
    });
  } catch {
    return json({ error: "exception" }, 500);
  }
});
