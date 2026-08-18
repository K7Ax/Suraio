// Sura — the shared edge guard.
//
// WHY THIS FILE EXISTS. The August 2026 audit found the same four defects
// repeated across ten functions: a wildcard CORS origin (A12), identity read
// from an unverified JWT payload (A4), no rate limit on the open endpoints
// (A6), and a length-leaking secret compare (A13). Fixing those ten times by
// hand fixes them ten times; the eleventh function still gets written wrong.
// So each one is solved exactly once, here, and every function imports it.
//
// Nothing in this module is allowed to be optional. A helper that can be
// forgotten is a helper that will be.

import { createClient } from "jsr:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// A12 · CORS — an allowlist, and a `Vary` so caches never cross-serve it.
// ---------------------------------------------------------------------------
// `Access-Control-Allow-Origin: *` is what turns A6 from "an attacker can
// script this" into "any web page can conscript your visitors into scripting
// it". The replacement must not be a hardcoded domain, because the production
// domain is not bought yet and a wrong constant here takes the whole site down
// with a CORS error that looks like a backend outage.
//
// So: reflect the caller's origin only when it matches. Patterns cover local
// development and every Cloudflare Pages preview; SURA_ALLOWED_ORIGINS (comma
// separated) carries the real domain once it exists, with no redeploy of this
// logic.
//
// A request with NO Origin header is not a browser request — server-to-server
// callers like bot.js send none. CORS governs browsers only, so those pass
// through untouched; their gate is the admin secret, not this.
const ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.pages\.dev$/,
  /^https:\/\/sura\.games$/,
  /^https:\/\/www\.sura\.games$/,
];

function originAllowed(origin: string): boolean {
  if (!origin) return false;
  if (ORIGIN_PATTERNS.some((re) => re.test(origin))) return true;
  const extra = (Deno.env.get("SURA_ALLOWED_ORIGINS") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return extra.includes(origin);
}

/** CORS headers for this specific request. Adds the admin-secret header only
 *  where asked, so the two admin functions do not widen the other eight. */
export function cors(req: Request, opts: { methods?: string; adminSecret?: boolean } = {}) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type" +
      (opts.adminSecret ? ", x-sura-admin-secret" : ""),
    "Access-Control-Allow-Methods": opts.methods || "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // Without this a shared cache can hand an allowed origin's response to a
    // disallowed one and defeat the allowlist entirely.
    "Vary": "Origin",
  };
  if (originAllowed(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** JSON response carrying the right CORS headers for this request. */
export function jsonFor(req: Request, opts: Parameters<typeof cors>[1] = {}) {
  const base = cors(req, opts);
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...base, "Content-Type": "application/json" },
    });
}

/** Standard preflight answer. Returns null when this is not a preflight. */
export function preflight(req: Request, opts: Parameters<typeof cors>[1] = {}) {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: cors(req, opts) });
}

// ---------------------------------------------------------------------------
// A4 · Identity — verified, not decoded.
// ---------------------------------------------------------------------------
// The old pattern was `JSON.parse(atob(token.split(".")[1]))`, which READS the
// claims without checking the signature. It was safe only because the platform
// gate `verify_jwt = true` rejected forged tokens first — a setting that lived
// in a dashboard toggle, not in this repository. (`supabase/config.toml` now
// version-controls it, but a defence that depends on one switch is not a
// defence.) `getUser()` asks the auth server, so a forged token fails here
// even if every gate in front of it is off.
export type Caller = { id: string; email: string } | null;

export async function verifiedUser(req: Request): Promise<Caller> {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return null;
  try {
    const uc = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data, error } = await uc.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: String(data.user.email || "") };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A13 · Constant-time compare that does not leak length.
// ---------------------------------------------------------------------------
// The previous version returned early when the lengths differed — so response
// timing separated "wrong length" from "right length, wrong bytes", handing an
// attacker SURA_ADMIN_SECRET's length for free. Hashing both sides first makes
// every comparison run over 32 fixed bytes regardless of input length.
export async function secretEquals(want: string, got: string): Promise<boolean> {
  if (!want) return false; // unset secret must never authorize anyone
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(want)),
    crypto.subtle.digest("SHA-256", enc.encode(got)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// A6 · Rate limiting for the endpoints that have no user to key on.
// ---------------------------------------------------------------------------
// ⚠️ MEASURED AND FOUND INEFFECTIVE ON THIS PLATFORM. READ BEFORE RELYING ON IT.
//
// This was written to close A6 and it does not. Against production, after
// deploying: **80 concurrent requests → 80 × 200, and 80 SEQUENTIAL requests →
// 80 × 200** as well, with the per-IP ceiling set to 60. It never fired once.
//
// The reason is the platform, not the arithmetic. Supabase Edge Functions
// spread requests across many short-lived isolates, so `buckets` and
// `globalBucket` are effectively fresh per request. A counter in isolate memory
// cannot see a burst that no single isolate observes. The comment that used to
// sit here called this "a cost control, not an authorization control" and
// described three layers — it was wrong in the same way an untested assertion
// is usually wrong: plausible, and never run.
//
// WHY IT IS STILL HERE. It costs nothing, and it does bound the one case it can
// see: a hammer that happens to land on a warm isolate. It is kept as a floor,
// never as the control.
//
// WHAT ACTUALLY CLOSES A6 is a limiter in front of the origin — a Cloudflare
// rate-limiting rule on /functions/v1/*. That is free, it sees every request,
// and it is a required owner action before launch (docs/security-fixes-2026-08).
//
// The alternative considered and not taken: a database-backed counter. It would
// work, and it would add a write and a round trip to EVERY anonymous read —
// doubling the latency of the three endpoints on the site's hottest path, to
// protect a quota, on a project whose stated first priority is speed. That is a
// bad trade when a free edge limiter does the same job better. If Cloudflare is
// ever not an option, this is the fallback to build.
type Bucket = { n: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let globalBucket: Bucket = { n: 0, resetAt: 0 };

// Unbounded Maps are themselves a denial-of-service vector: one request per
// forged IP would grow this forever. Sweeping expired entries whenever the map
// gets large keeps it bounded without a timer.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  // Still large after sweeping means the attack is live; drop everything rather
  // than grow. Callers get a fresh window, which the global bucket still caps.
  if (buckets.size >= 5000) buckets.clear();
}

/** The caller's address, preferring the headers the EDGE sets over the one the
 *  CALLER sends. `x-forwarded-for` is a list the client can prepend to — A17
 *  established that, and F2 showed the feedback rate limit resting on it — so
 *  it is now the last resort, not the first. `cf-connecting-ip` and `x-real-ip`
 *  are written by the proxy in front of the function and overwritten if the
 *  client sends them, which is exactly the property a rate-limit key needs.
 *
 *  This does not make the key unforgeable — a platform that sets neither falls
 *  back to the old behaviour — so the Cloudflare rule on `/functions/v1/*`
 *  remains the real ceiling. It removes the free bypass, nothing more. */
export function clientIp(req: Request): string {
  const cf = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const real = (req.headers.get("x-real-ip") || "").trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for") || "";
  return (xff.split(",")[0] || "").trim() || "unknown";
}

/** True when the request is allowed. `perIp` and `perIsolate` are counts per
 *  `windowMs`. Returns false only when a ceiling is actually crossed. */
export function rateLimit(
  req: Request,
  opts: { perIp?: number; perIsolate?: number; windowMs?: number } = {},
): boolean {
  const windowMs = opts.windowMs ?? 60_000;
  const perIp = opts.perIp ?? 60;
  const perIsolate = opts.perIsolate ?? 3000;
  const now = Date.now();

  if (globalBucket.resetAt <= now) globalBucket = { n: 0, resetAt: now + windowMs };
  globalBucket.n++;
  if (globalBucket.n > perIsolate) return false;

  sweep(now);
  const key = clientIp(req);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) { b = { n: 0, resetAt: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= perIp;
}

/** 429 with Retry-After — a real status code, so monitoring can see it (A14). */
export function tooMany(req: Request, opts: Parameters<typeof cors>[1] = {}) {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: { ...cors(req, opts), "Content-Type": "application/json", "Retry-After": "60" },
  });
}

// ---------------------------------------------------------------------------
// A5 · Input caps.
// ---------------------------------------------------------------------------
// groq-hint interpolated caller-controlled strings straight into a prompt with
// no length cap, so one request could carry megabytes of tokens — and the model
// holding the puzzle solution was reading attacker-authored instructions.
// `groq-author` already enforced caps; this makes that knowledge shared.

/** Coerce to a string and hard-cap it. Non-strings are JSON-encoded first so an
 *  object payload cannot smuggle length past a `typeof` check. */
export function capped(v: unknown, max: number): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) : s;
}

/** Reject an oversized body before parsing it. Content-Length is advisory, so
 *  this is a cheap first gate, not the only one. */
export function bodyTooLarge(req: Request, maxBytes: number): boolean {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  return Number.isFinite(len) && len > maxBytes;
}
