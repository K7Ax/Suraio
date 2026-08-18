// scripts/bank/gen_bee_bank.js — more «نحلة» boards, without inventing a single word.
//
// WHY THIS EXISTS: BEE_BANK held 8 boards split {0:3, 1:3, 2:2}. August needs
// 13 hard days, so a two-board hard bucket served the same board eleven times —
// 23 of the month's 37 repeats came from نحلة alone. No selector can fix a
// bucket of two; only content can.
//
// WHY IT DOES NOT READ bank/words_ar.json. That file is a 175,627-entry
// MORPHOLOGICAL EXPANSION, not a curated lexicon: «فقطط»، «بنفنن»، «بفمك» are
// all in it. Generating from it is what was tried and rejected in banks.mjs:116,
// and it would fail the same way today. The gate `ctx.dict.has(w)` cannot save
// us either — the junk is IN the dict.
//
// WHAT IT READS INSTEAD: the words already shipped in the curated banks —
// connections categories, strands themes, proverbs, wordle answers, the eight
// hand-made bee boards. Roughly 5,400 words, every one of which a human already
// approved for this product. A word must ALSO be in words_ar.json, so the
// existing gate still passes; curation narrows, the dictionary confirms.
//
//   node scripts/bank/gen_bee_bank.js            -> report only, writes nothing
//   node scripts/bank/gen_bee_bank.js --write    -> rewrites the marked block in banks.mjs
//
// The hand-curated eight are never touched: they live in BEE_CURATED and this
// script only ever replaces what is between the @gen markers.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const BANKS = path.join(ROOT, "src/core/banks.mjs");
const WRITE = process.argv.includes("--write");

// Per band. 31 days with 13 in the hard tier is the worst month; 14 buys a
// clean month plus one spare, and buys it for every month, not just August.
const PER_BAND = 14;

// The board alphabet. ة, ء and the hamza carriers are excluded on purpose: ة
// only ever ends a word, so a board carrying it plays as a six-letter board
// with a decoration, and the hamza forms fold inconsistently across sources.
const ALPHA = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];
const IDX = new Map(ALPHA.map((c, i) => [c, i]));

const norm = s => String(s || "").normalize("NFC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .trim();

// --- 1. the curated lexicon -------------------------------------------------
// A blind walk over every string in bank/ was the first attempt and it produced
// «اامل»، «الادله»، «الليدي» — because it also ate PROSE: proverb texts, lamha
// clues, wordle hints. A sentence tokenised into 4–6 letter runs yields inflected
// fragments and article-prefixed forms that no one ever curated as a word.
// So only fields that are word LISTS are read; prose fields are not read at all.
const WORD_FIELDS = ["words", "solution", "word", "star", "target", "spangram"];

// Three shapes that survive the field filter and still should not reach a board.
const REJECT = [
    /(.)\1\1/u,          // a letter three times running — an expansion artefact
    /^(.)\1/u,           // a doubled FIRST letter: «اامل»، «اانا»
    /^ال/u,              // article-prefixed: «الهدف» when «هدف» is the word
];

// Not every bank under bank/ is curated. These two were themselves generated
// FROM words_ar.json (gen_letterboxed.js, gen_bank.js), so they carry the exact
// artefacts this script exists to avoid — «اباتي»، «ابادوا»، «ابداوا» all trace
// back to them. Reading them would launder the morphological expansion through
// a file that merely looks hand-made. Verified by grep before excluding.
const NOT_CURATED = new Set(["letterboxed.json", "spelling_bee.json"]);

function collect() {
    const out = new Set();
    const eat = s => {
        for (const tok of String(s).split(/[^ء-ي]+/)) {
            const w = norm(tok);
            const n = [...w].length;
            if (n < 4 || n > 6) continue;
            if (![...w].every(c => IDX.has(c))) continue;
            if (REJECT.some(r => r.test(w))) continue;
            out.add(w);
        }
    };
    // Walks the tree but only spends the string values found under a word-list
    // key. `tiers` in warmer.json is an object of three word arrays, so any
    // array or object reached FROM a word field stays inside the word context.
    const walk = (o, inWords) => {
        if (typeof o === "string") { if (inWords) eat(o); return; }
        if (Array.isArray(o)) { o.forEach(x => walk(x, inWords)); return; }
        if (o && typeof o === "object") {
            for (const [k, v] of Object.entries(o)) {
                walk(v, inWords || WORD_FIELDS.includes(k) || k === "tiers" || /^[0-2]$/.test(k) && inWords);
            }
        }
    };
    const files = [];
    (function rec(d) {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) rec(p);
            // words_ar.json is the thing we are deliberately NOT curating from.
            else if (f.name.endsWith(".json") && f.name !== "words_ar.json"
                && !NOT_CURATED.has(f.name)) files.push(p);
        }
    })(path.join(ROOT, "bank"));
    for (const f of files) {
        try { walk(JSON.parse(fs.readFileSync(f, "utf8")), false); } catch { /* not a bank */ }
    }
    // The inline banks too — BEE_BANK's own words, CONNECTIONS_SAUDI, WORD_EXTRA*.
    // Those files hold no prose: every quoted Arabic literal is a bank word or a
    // group theme, and a theme is two curated nouns.
    const src = fs.readFileSync(BANKS, "utf8");
    for (const m of src.matchAll(/'([ء-ي]+)'/g)) eat(m[1]);
    return out;
}

const mask = w => [...w].reduce((m, c) => m | (1 << IDX.get(c)), 0);
const bits = m => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };

function main() {
    const dict = new Set(
        JSON.parse(fs.readFileSync(path.join(ROOT, "bank/words_ar.json"), "utf8")).map(norm));

    // TWO SOURCES, BOTH TRUSTED, FOR DIFFERENT REASONS.
    //   · the curated banks — a human already shipped these words in this product
    //   · bank/lexicon_ar.json — vetted one word at a time by scripts/bank/vet_lexicon.js
    // The curated set alone is 405 words and yields exactly ONE usable board, which
    // is why the vetted lexicon exists. Both are still intersected with
    // words_ar.json, because that is the set core/checks.mjs gates against: a word
    // outside it fails the board at publish time no matter how good it is.
    const vettedPath = path.join(ROOT, "bank/lexicon_ar.json");
    const vetted = fs.existsSync(vettedPath)
        ? JSON.parse(fs.readFileSync(vettedPath, "utf8")).map(norm) : [];
    const pool = new Set([...collect(), ...vetted]);
    const words = [...pool].filter(w => dict.has(w));
    const wm = words.map(w => ({ w, m: mask(w), d: bits(mask(w)) }));
    console.log(`المعجم: ${words.length} كلمة — مُحرَّرٌ من البنوك + ${vetted.length} مُنقّاة`
        + (vetted.length ? "" : " ⚠ شغّل scripts/bank/vet_lexicon.js أوّلًا"));

    // --- 2. candidate 7-letter sets ----------------------------------------
    // No word here has 7 distinct letters (nothing longer than 6), so a set is
    // built as «a rich word's letters + one more». Enumerating all C(28,7) =
    // 1.18M sets would score mostly empty boards; seeding from real words means
    // every candidate already has at least one word on it.
    const cand = new Map();
    for (const { m, d } of wm) {
        if (d < 5) continue;                       // 5- or 6-letter cores only
        for (let i = 0; i < ALPHA.length; i++) {
            const bit = 1 << i;
            if (m & bit) continue;
            const s = m | bit;
            if (bits(s) === 7) cand.set(s, (cand.get(s) || 0) + 1);
        }
    }
    console.log(`مجموعات مرشَّحة: ${cand.size}`);

    // --- 3. score each set, per centre --------------------------------------
    // THE MONOTONY GATE. The vetted lexicon is 31% words ending in ـين, and a
    // quarter of it is present-tense verbs carrying a person suffix (تحبين،
    // تجلبين، تبردين). Every one of those is ordinary Arabic — the classifier
    // answered correctly — but they CLUSTER: any set holding ت ي ن fills with the
    // conjugation of one verb and scores 23 words while being one puzzle written
    // out twenty-three times. Word count is the difficulty signal here, so a
    // monotonous board is not merely dull, it is mis-banded.
    //
    // The judgement is made per board, not per word, because the word is fine and
    // only the company it keeps is not: تحبين belongs on a board that is not made
    // of its own siblings. Skeleton = first letter + last two, which is what the
    // eye actually groups.
    const skeleton = w => { const c = [...w]; return c[0] + "·" + c.slice(-2).join(""); };
    const SKEW = 0.30;
    function skew(ws) {
        const fam = new Map();
        for (const w of ws) { const k = skeleton(w); fam.set(k, (fam.get(k) || 0) + 1); }
        return Math.max(...fam.values()) / ws.length;
    }
    const monotonous = ws => skew(ws) > SKEW;

    const boards = [];
    let skipped = 0;
    for (const set of cand.keys()) {
        const on = wm.filter(x => (x.m & ~set) === 0);
        if (on.length < 12) continue;              // cheap reject before the centre loop
        for (let i = 0; i < ALPHA.length; i++) {
            const bit = 1 << i;
            if (!(set & bit)) continue;
            const ws = on.filter(x => x.m & bit).map(x => x.w);
            if (ws.length < 12) continue;
            if (monotonous(ws)) { skipped++; continue; }
            boards.push({ set, centre: ALPHA[i], words: ws.sort() });
        }
    }
    boards.sort((a, b) => b.words.length - a.words.length);
    console.log(`ألواح صالحة (≥١٢ كلمة، كلٌّ يحوي الحرف الأوسط): ${boards.length}`
        + ` · أُسقط للرتابة الصرفيّة: ${skipped}`);

    // --- 4. pick a diverse set ---------------------------------------------
    // Two boards that share six of seven letters are the same puzzle wearing a
    // different hat — the player recognises the shape long before the words. So
    // a pick must differ from every earlier pick by at least three letters, and
    // no centre may carry more than four boards.
    // THE EIGHT COME FIRST, AND THEY COME COMPLETED.
    //
    // A human chose their seven letters and that choice is not the script's to
    // overrule — so they are seeded into `picked` before anything else and the
    // diversity rule then protects them rather than competing with them. But
    // their stored answer lists (7–12 words) are not what the letters actually
    // admit (22–50), and «نحلة» is strict exact-dict: every missing word is a
    // correct guess rejected. So the list is recomputed from the same pool as
    // every other board, which is also what puts all forty-two on one scale.
    const HELD = readCurated();
    const picked = HELD.map(b => {
        const set = mask([b.center, ...b.outer].join(""));
        const ws = wm.filter(x => (x.m & ~set) === 0 && (x.m & (1 << IDX.get(b.center)))).map(x => x.w);
        // Curated boards skip the ≥12 and monotony gates on purpose: those gates
        // choose among candidates, and these are not candidates.
        return { set, centre: b.center, words: [...new Set([...ws, ...b.words.map(norm)])].sort(), held: true };
    });
    const taken = picked.map(b => ({ set: b.set, centre: b.centre }));
    const perCentre = {};
    for (const t of taken) perCentre[t.centre] = (perCentre[t.centre] || 0) + 1;

    for (const b of boards) {
        if (picked.length >= PER_BAND * 3) break;
        if ((perCentre[b.centre] || 0) >= 4) continue;
        if (taken.some(t => bits(t.set & b.set) > 4)) continue;
        picked.push(b);
        taken.push({ set: b.set, centre: b.centre });
        perCentre[b.centre] = (perCentre[b.centre] || 0) + 1;
    }
    console.log(`اختِيرَ ${picked.length} لوحًا (منها ${HELD.length} بحروفٍ يدويّة)`);
    // The promise made in banks.mjs, checked rather than asserted in prose.
    if (picked.filter(b => b.held).length !== HELD.length)
        throw new Error("سقط لوحٌ يدويّ من الاختيار — الحروف التي اختارها إنسان لا تُحذف");
    if (picked.length < PER_BAND * 3)
        throw new Error(`المعجم لا يكفي: ${picked.length} من ${PER_BAND * 3}. شغّل scripts/bank/vet_lexicon.js --run`);

    // --- 5. bands ------------------------------------------------------------
    // Richness IS the difficulty, and in this direction: «a sparse board means
    // each remaining word is harder to dig out, while a rich board hands the
    // player plenty of early wins» (banks.mjs:107). So richest → band 0.
    //
    // ONE SCALE FOR ALL FORTY-TWO. The curated eight were graded against each
    // other, which made their «easy» (11–12 words) sparser than a generated
    // «hard» (20–27) — a band that means one thing here and another there is not
    // a band. Sorting the whole set by richness and cutting it in three is the
    // only grading that lets a player feel the difference between levels.
    picked.sort((a, b) => b.words.length - a.words.length);

    const out = [];
    let i = 0;
    for (const band of [0, 1, 2]) {               // picked is now richest-first
        for (let k = 0; k < PER_BAND && i < picked.length; k++, i++) {
            const b = picked[i];
            out.push({
                center: b.centre,
                outer: ALPHA.filter(c => (b.set & (1 << IDX.get(c))) && c !== b.centre),
                difficulty: band,
                // The accepted-answer set is the whole list — «نحلة» is strict
                // exact-dict since Round 4, so a word left out is a word the
                // player types correctly and is told is wrong.
                words: b.words,
            });
        }
    }
    const tally = { 0: 0, 1: 0, 2: 0 };
    for (const b of out) tally[b.difficulty]++;
    const sizes = b => `${Math.min(...b.map(x => x.words.length))}–${Math.max(...b.map(x => x.words.length))}`;
    console.log(`النطاقات: ${JSON.stringify(tally)} · المجموع ${out.length}`);
    for (const band of [0, 1, 2]) {
        const g = out.filter(b => b.difficulty === band);
        // Report the worst family share too, not just the gate's verdict: SKEW is
        // a threshold picked by hand, and a band that sits right under it is a
        // band about to produce a monotonous board the moment the lexicon shifts.
        if (g.length) console.log(`  نطاق ${band}: ${g.length} لوحًا · كلمات ${sizes(g)}`
            + ` · أعلى تكتّل صرفيّ ${Math.round(100 * Math.max(...g.map(x => skew(x.words))))}٪`);
    }

    if (!WRITE) {
        console.log("\nعيّنة:");
        for (const b of [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]]) {
            if (!b) continue;
            console.log(`  [${b.difficulty}] ${b.center} | ${b.outer.join(" ")} — ${b.words.length}: ${b.words.slice(0, 10).join("، ")}…`);
        }
        console.log("\nلم يُكتب شيء. أضف --write.");
        return;
    }
    writeBlock(out);
    console.log(`BEE_GEN_OK — كُتب ${out.length} لوحًا في src/core/banks.mjs`);
}

// The eight hand-made boards, read from the file rather than duplicated here —
// a second copy is a second thing to keep in step, and it would drift.
function readCurated() {
    const src = fs.readFileSync(BANKS, "utf8");
    const m = src.match(/export const BEE_CURATED = \[([\s\S]*?)\n\];/)
        || src.match(/export const BEE_BANK = \[([\s\S]*?)\n\];/);
    if (!m) throw new Error("لم أجد BEE_CURATED ولا BEE_BANK في banks.mjs");
    // eslint-disable-next-line no-new-func
    return new Function(`return [${m[1]}]`)();
}

function writeBlock(boards) {
    const src = fs.readFileSync(BANKS, "utf8");
    const START = "/* @gen:bee:start */", END = "/* @gen:bee:end */";
    const a = src.indexOf(START), b = src.indexOf(END);
    if (a < 0 || b < 0) throw new Error(`لم أجد العلامتين ${START} … ${END} في banks.mjs`);
    const body = "\n" + boards.map(x =>
        `    { center: '${x.center}', outer: [${x.outer.map(c => `'${c}'`).join(", ")}], difficulty: ${x.difficulty},\n`
        + `      words: [${x.words.map(w => `'${w}'`).join(", ")}] },`).join("\n") + "\n    ";
    fs.writeFileSync(BANKS, src.slice(0, a + START.length) + body + src.slice(b), "utf8");
}

main();
