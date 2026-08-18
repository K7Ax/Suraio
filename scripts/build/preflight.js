// "build" for a no-build static site = a deploy preflight. Verifies the invariants
// that must hold before publishing the static frontend. Fails loudly if violated.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const has = (rel) => fs.existsSync(path.join(root, rel));

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// 1. Required static files exist.
for (const f of ["index.html", "app.js", "style.css", "dashboard.html", "dashboard.js"]) {
  ok(has(f), `missing required file: ${f}`);
}

// 2. Cache-busting: derive ?v= from the asset's own content and REWRITE it.
//    This used to only assert the marker existed, which meant every edit shipped
//    under whichever number was typed by hand last — so returning visitors kept
//    running a cached bundle. Deriving from a content hash makes it automatic and
//    idempotent: a rebuild with no source change leaves index.html untouched.
function contentTag(rel) {
  return crypto.createHash("sha1").update(fs.readFileSync(path.join(root, rel))).digest("hex")
    .replace(/\D/g, "").slice(0, 8) || "0";
}
if (has("index.html") && has("app.js") && has("style.css")) {
  const before = read("index.html");
  const after = before
    .replace(/app\.js\?v=[\w]+/g, `app.js?v=${contentTag("app.js")}`)
    .replace(/style\.css\?v=[\w]+/g, `style.css?v=${contentTag("style.css")}`);
  if (after !== before) {
    fs.writeFileSync(path.join(root, "index.html"), after);
    console.log("cache-bust: index.html updated to match app.js / style.css");
  }
}

// 2b. The 404 page carries its own tiny bundle (`tallal.js`), on purpose: the
//     page that explains a thing does not exist must not depend on the 431 KB
//     bundle whose failure may be what sent you there. It is versioned by the
//     same content hash, for the same reason — an error page served from a stale
//     cache is the one page nobody thinks to hard-refresh.
if (has("404.html") && has("tallal.js")) {
  const before = read("404.html");
  const after = before.replace(/tallal\.js\?v=[\w]+/g, `tallal.js?v=${contentTag("tallal.js")}`);
  if (after !== before) {
    fs.writeFileSync(path.join(root, "404.html"), after);
    console.log("cache-bust: 404.html updated to match tallal.js");
  }
  ok(/tallal\.js\?v=\w+/.test(after), "404.html: tallal.js is missing a ?v= cache-bust");
  // The backdrop is derived from `_design-src/tallal/alley.png` by `scripts/assets/tallal_bg.js`. If
  // that never ran against this checkout the deploy ships an error page that is
  // a flat navy rectangle — which reads as a second failure, not as a design.
  ok(/alley-1200\.webp/.test(after), "404.html: the alley backdrop is missing");
  ok(has("public/tallal/alley-1200.webp"), "run `node scripts/assets/tallal_bg.js`");
}

if (has("index.html")) {
  const html = read("index.html");

  ok(/app\.js\?v=\w+/.test(html), "index.html: app.js is missing a ?v= cache-bust");
  ok(/style\.css\?v=\w+/.test(html), "index.html: style.css is missing a ?v= cache-bust");

  // 3. No server-only secret accidentally inlined. The publishable/anon key is
  //    fine; a service_role key or a raw JWT is not.
  ok(!/service_role/i.test(html), "index.html: contains the string 'service_role'");
  ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(html),
     "index.html: contains a JWT-shaped token (possible leaked key)");
}

// 4. A real .env must never be part of the deployable tree.
//
// «Present on disk» is the wrong test and it started failing honestly: the
// Telegram bot needs a local .env to run at all, so the file is now expected to
// exist on the operator's machine. What must never happen is that git can see
// it. So the check is whether it is IGNORED, not whether it is there — a real
// leak (an un-ignored .env, or one already tracked) still fails, and the false
// alarm that would train everyone to skim past PREFLIGHT_FAIL is gone.
if (has(".env")) {
  const ignored = (() => {
    try {
      execFileSync("git", ["check-ignore", "-q", ".env"], { cwd: root, stdio: "ignore" });
      return true;
    } catch { return false; }
  })();
  const tracked = (() => {
    try {
      return execFileSync("git", ["ls-files", "--error-unmatch", ".env"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
        .toString().trim().length > 0;
    } catch { return false; }
  })();
  ok(ignored, ".env exists and is NOT git-ignored — add it to .gitignore before committing");
  ok(!tracked, ".env is TRACKED by git — it must be removed from the index (git rm --cached .env)");
}

// 5. The source map must never reach the deploy tree. It is ~889 KB — nearly 3x the
//    bundle it maps — and publishing it hands out the unminified `src/` to anyone
//    who asks. `npm run bundle` no longer emits it; `bundle:dev` still does, so this
//    catches a dev build that was left in place before a deploy.
ok(!has("app.js.map"), "app.js.map present — run `npm run build` (not bundle:dev) before deploying");

if (problems.length) {
  console.error("PREFLIGHT_FAIL");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("PREFLIGHT_OK");
