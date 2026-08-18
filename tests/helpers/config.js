// Resolves the public Supabase URL + anon key for integration tests.
// Order: env vars → parse from index.html's SURA_CONFIG (the real public values).
// The anon/publishable key is public by design, so reading it from the repo is fine.
const fs = require("node:fs");
const path = require("node:path");

function getSupabaseConfig() {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    try {
      const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
      const u = html.match(/SUPABASE_URL:\s*['"]([^'"]+)['"]/);
      const k = html.match(/SUPABASE_ANON_KEY:\s*['"]([^'"]+)['"]/);
      url = url || (u && u[1]);
      key = key || (k && k[1]);
    } catch { /* index.html not found — handled by caller */ }
  }
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

// Fetch wrapper that distinguishes a real HTTP response from a network/DNS
// failure, so tests can skip gracefully when offline instead of hard-failing.
async function tryFetch(url, opts) {
  try {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { networkError: true };
  }
}

module.exports = { getSupabaseConfig, tryFetch };
