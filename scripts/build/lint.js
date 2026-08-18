// Zero-dependency syntax lint: runs `node --check` on every first-party JS file.
// Catches parse errors before they ship. Not a style linter (no eslint dependency).
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

// First-party JS we ship or run, that lives at the root rather than in a walked
// directory. The `gen_*.js` bank generators used to be listed here too; they now
// live in `scripts/bank/` and are picked up by the `scripts/` walk below. The
// glob was removed rather than left to match nothing, because a filter that
// silently covers zero files is worse than no filter — it reads like coverage.
const topLevel = ["app.js", "dashboard.js", "bot.js"];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    // `.mjs` too: `node --check` parses those as ESM, which is exactly what
    // promo/ and src/ are. Without them a syntax error in an act module only
    // surfaces when something renders — which for the film is 16 minutes in.
    else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

// Walked roots. `promo` is optional because the public export
// (`scripts/build/publish.js`) does not ship it, and a lint that throws ENOENT
// on a tree it was never given is a broken gate, not a finding. Absent roots are
// PRINTED, never skipped silently: a directory that vanishes from the private
// repo has to look different from one that was deliberately left out.
const ROOTS = [
  ["tests", true],
  ["scripts", true],
  ["src", true],
  // A walk, not a list. The list version named three files and silently missed
  // `world.mjs` the day it was added — which is the whole failure mode a lint is
  // supposed to prevent. `.work/` is derived and gitignored, so it is skipped
  // explicitly rather than by not being mentioned.
  ["promo", false],
];

const missing = [];
const walked = [];
for (const [name, required] of ROOTS) {
  const dir = path.join(root, name);
  if (!fs.existsSync(dir)) {
    if (required) {
      console.error(`LINT_FAIL  جذرٌ إلزاميٌّ مفقود: ${name}/`);
      process.exit(1);
    }
    missing.push(name);
    continue;
  }
  walked.push(...walk(dir).filter(
    (p) => !p.includes(`promo${path.sep}.work${path.sep}`)));
}

const files = [
  ...topLevel.map((f) => path.join(root, f)).filter((p) => fs.existsSync(p)),
  ...walked,
];

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    failed++;
    console.error(`LINT FAIL  ${path.relative(root, f)}`);
    console.error((e.stderr || e.message).toString().trim());
  }
}

const note = missing.length ? `  ·  جذورٌ غيرُ موجودةٍ هنا: ${missing.join(", ")}` : "";
console.log((failed === 0
  ? `LINT_OK (${files.length} files)`
  : `LINT_FAIL (${failed}/${files.length} files)`) + note);
process.exit(failed === 0 ? 0 : 1);
