// Generates seed.sql from bank/*.json (incl. the Saudi bank) using the bot's
// validated builders. Each INSERT is guarded so re-running is safe. No network.
//
// NOTE: the new game types (letterboxed, strands) require the puzzle_bank
// game_type CHECK to allow them. That widening is already applied to production
// by supabase/migrations/20260622_01_allow_new_game_types.sql. Do NOT reach for
// supabase/sql/allow_new_game_types.sql — it is a superseded draft that would
// narrow the CHECK; its own header explains why.
//
// Output goes to supabase/sql/seed.sql, which is gitignored: it is regenerable
// from bank/*.json and it is the answer key to every seeded puzzle.
const fs = require("fs");
const path = require("path");
const { buildConnections, buildBee, buildWordle, buildLetterBoxed, buildStrands, normalizeArabic } = require("../../bot.js");

// كلُّ المسارات هنا تُحسَب من جذر المستودع لا من مجلّد الملفّ، فيعمل الأمر من
// أيّ مكان. وكان `__dirname` هو الجذر حين كان هذا الملفّ في الأعلى.
const ROOT = path.join(__dirname, "..", "..");
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const tryRead = f => { try { return read(f); } catch (e) { return []; } };
const q = s => String(s).replace(/'/g, "''");
const jb = obj => `'${q(JSON.stringify(obj))}'::jsonb`;
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }

const out = [];
out.push("-- Sura puzzle bank seed — generated from bank/*.json. Safe to re-run (guarded inserts).");
out.push("-- Requires the widened game_type CHECK from supabase/migrations/20260622_01_allow_new_game_types.sql (already applied to prod).");
out.push("-- Paste into Supabase → SQL Editor → Run.");
out.push("BEGIN;");

function emit(game, row, sigTag, tags, extraGuard) {
  const allTags = Array.from(new Set([sigTag, ...(tags || [])]));
  const guards = [`'${q(sigTag)}' = ANY(cultural_tags)`];
  if (extraGuard) guards.push(extraGuard);
  out.push(
    `INSERT INTO public.puzzle_bank (game_type, payload, solution, difficulty, source, reviewed, cultural_tags)\n` +
    `SELECT '${game}', ${jb(row.payload)}, ${jb(row.solution)}, ${row.difficulty}, 'curated', true, ARRAY[${allTags.map(t => `'${q(t)}'`).join(",")}]::text[]\n` +
    `WHERE NOT EXISTS (SELECT 1 FROM public.puzzle_bank WHERE ${guards.join(" OR ")});`
  );
}

const n = {};
function section(game, label, files, build, sigFn, extraGuardFn) {
  out.push(`\n-- ${label}`);
  n[game] = 0;
  for (const file of files) for (const it of tryRead(file)) {
    let row; try { row = build(it); } catch (e) { continue; }
    emit(game, row, sigFn(row), it.cultural_tags, extraGuardFn ? extraGuardFn(row) : null);
    n[game]++;
  }
}

section("connections", "Connections (تشابك)", ["bank/connections.json", "bank/saudi/connections.json"], buildConnections,
  row => "seed:c:" + djb2(row.payload.words.map(normalizeArabic).sort().join(",")));

section("spelling_bee", "Spelling Bee (نحلة الإملاء)", ["bank/spelling_bee.json", "bank/saudi/spelling_bee.json"], buildBee,
  row => "seed:b:" + normalizeArabic(row.payload.center) + ":" + row.payload.letters.map(normalizeArabic).sort().join(""));

section("wordle", "Wordle (كَلِمة)", ["bank/wordle.json", "bank/saudi/wordle.json"], buildWordle,
  row => "seed:w:" + normalizeArabic(row.solution.word),
  row => `(game_type='wordle' AND solution->>'word' = '${q(row.solution.word)}')`);

section("letterboxed", "Letter Boxed (صندوق الحروف)", ["bank/letterboxed.json"], buildLetterBoxed,
  row => "seed:lb:" + djb2(row.payload.sides.flat().map(normalizeArabic).sort().join("")));

section("strands", "Strands (خيوط)", ["bank/strands.json"], buildStrands,
  row => "seed:st:" + djb2(normalizeArabic(row.payload.theme) + ":" + row.payload.grid.join("")));

out.push("\nCOMMIT;");
out.push(`-- Totals: ${Object.entries(n).map(([k, v]) => `${k}=${v}`).join(", ")}`);

fs.writeFileSync(path.join(ROOT, "supabase", "sql", "seed.sql"), out.join("\n") + "\n", "utf8");
console.log("seed.sql written:", Object.entries(n).map(([k, v]) => `${k}=${v}`).join(", "));
