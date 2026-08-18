// scripts/bank/audit_banks.js — every bank, every item, every defect class.
//
// WHY THIS EXISTS AND review_month.js DOES NOT COVER IT: that script walks a
// MONTH, so it only ever sees the items the rotation happens to land on, and it
// judges each board alone. Two whole classes of defect are invisible to it:
//
//   · defects BETWEEN items — the same proverb stored twice under two ids, two
//     lamha entries whose answers normalise to the same word. Each item passes
//     every gate on its own; together they are a repeat the player will notice
//     and no per-board checker can ever see.
//   · defects in items the month never sampled. A 36-item bank sampled 31 times
//     leaves several entries that have never been checked at all.
//
// It also checks the thing that makes a clue-based game work or not: whether the
// clue gives the answer away. That is not a structural property, so checks.mjs
// cannot express it as a gate — but a substring test catches the blatant cases,
// and the blatant cases are the ones that ship.
//
//   node scripts/bank/audit_banks.js          -> report, exit 1 if any ✗
//   node scripts/bank/audit_banks.js --warn   -> also exit 1 on ⚠
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const STRICT = process.argv.includes("--warn");

const norm = s => String(s || "").normalize("NFC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

// The article is not part of the word for leak purposes: a clue saying «الأمطار»
// for the answer «المطر» gives it away just as completely.
const stem = w => norm(w).replace(/^ال/, "");

const errs = [], warns = [];
const bad = (where, msg) => errs.push(`✗ ${where}: ${msg}`);
const warn = (where, msg) => warns.push(`⚠ ${where}: ${msg}`);

// A band bucket under this repeats inside a single month — the arithmetic is in
// checks.mjs (THIN_BUCKET): a hard band owns up to 13 days.
const PER_BAND = 14;

function bands(items, key = "difficulty") {
    const t = { 0: 0, 1: 0, 2: 0 };
    for (const it of items) t[it[key]] = (t[it[key]] || 0) + 1;
    return t;
}

function checkBands(name, items) {
    const t = bands(items);
    const line = [0, 1, 2].map(b => `${b}:${t[b] || 0}`).join(" ");
    const short = [0, 1, 2].filter(b => (t[b] || 0) < PER_BAND);
    if (short.length) {
        const gap = short.map(b => `نطاق ${b} ناقص ${PER_BAND - (t[b] || 0)}`).join("، ");
        warn(name, `${line} — ${gap} (يتكرّر داخل الشهر)`);
    }
    return t;
}

// Duplicates BETWEEN items: the defect no per-board gate can see.
function checkDupes(name, items, keyOf) {
    const seen = new Map();
    for (const [i, it] of items.entries()) {
        const k = keyOf(it);
        if (!k) continue;
        if (seen.has(k)) bad(name, `مكرّر: «${k}» في ${seen.get(k)} و${it.id ?? i}`);
        else seen.set(k, it.id ?? i);
    }
}

function checkIds(name, items) {
    const seen = new Set();
    for (const [i, it] of items.entries()) {
        if (it.id == null) { warn(name, `العنصر ${i} بلا id`); continue; }
        if (seen.has(it.id)) bad(name, `id مكرّر: ${it.id}`);
        seen.add(it.id);
    }
}

// accepted[] is what the player is allowed to type. If the canonical answer is
// not in it, the correct answer is rejected — the «نحلة» bug in another game.
function checkAccepted(name, items, answerKey) {
    for (const it of items) {
        const a = it[answerKey];
        if (!a) { bad(name, `${it.id}: بلا ${answerKey}`); continue; }
        const acc = (it.accepted || []).map(norm);
        if (!acc.includes(norm(a)))
            bad(name, `${it.id}: «${a}» ليست في accepted — الجواب الصحيح يُرفَض`);
    }
}

// The leak test. A clue that contains the answer is not a clue.
function checkLeak(name, items, answerKey, textsOf) {
    for (const it of items) {
        const s = stem(it[answerKey]);
        if (s.length < 3) continue;              // too short to test meaningfully
        for (const [label, text] of textsOf(it)) {
            if (!text) continue;
            // Word-level, not substring: «برق» inside «البرقية» is not a leak,
            // but a whole word matching the answer's stem is.
            const words = norm(text).split(/[^ء-ي]+/).filter(Boolean).map(w => w.replace(/^ال/, ""));
            if (words.includes(s)) bad(name, `${it.id}: ${label} يكشف الجواب «${it[answerKey]}»`);
        }
    }
}

const load = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

function main() {
    // --- لمحة -------------------------------------------------------------
    const lamha = load("bank/saudi/lamha.json");
    checkIds("لمحة", lamha);
    checkBands("لمحة", lamha);
    checkDupes("لمحة", lamha, it => norm(it.answer));
    checkAccepted("لمحة", lamha, "answer");
    checkLeak("لمحة", lamha, "answer", it =>
        (it.clues || []).map((c, i) => [`التلميح ${i + 1}`, c]));
    for (const it of lamha)
        if ((it.clues || []).length !== 3) bad("لمحة", `${it.id}: ${(it.clues || []).length} تلميحات والمطلوب ٣ بالضبط`);

    // --- قرّبها -----------------------------------------------------------
    const warmer = load("bank/saudi/warmer.json");
    checkIds("قرّبها", warmer);
    checkBands("قرّبها", warmer);
    checkDupes("قرّبها", warmer, it => norm(it.target));
    checkAccepted("قرّبها", warmer, "target");
    checkLeak("قرّبها", warmer, "target", it => [
        ...(it.hints || []).map((h, i) => [`تلميح ${i + 1}`, h]),
        ...Object.entries(it.tiers || {}).flatMap(([t, ws]) =>
            ws.map((w, i) => [`طبقة ${t}/${i + 1}`, w])),
    ]);
    for (const it of warmer) {
        // The tiers are the whole game: they must get warmer, and a tier that
        // repeats a word from a colder tier wastes the player's guess.
        const all = Object.values(it.tiers || {}).flat().map(norm);
        if (new Set(all).size !== all.length) bad("قرّبها", `${it.id}: كلمة مكرّرة بين الطبقات`);
        // The answer may not sit in its own ladder — the ladder IS the clue.
        // Mirrors the gate in checks.mjs; kept here too because this script is
        // what reads bank files a scheduled month never happens to sample.
        const acc = new Set([norm(it.target), ...(it.accepted || []).map(norm)]);
        for (const w of all) if (acc.has(w)) bad("قرّبها", `${it.id}: الجواب «${w}» في طبقاته — يُعطى مجّانًا`);
        for (const t of ["0", "1", "2"])
            if (!(it.tiers || {})[t]?.length) bad("قرّبها", `${it.id}: طبقة ${t} فارغة`);
    }

    // --- أمثال ------------------------------------------------------------
    const amthal = load("bank/saudi/amthal.json");
    checkBands("أمثال", amthal);
    checkDupes("أمثال", amthal, it => norm(it.proverb));
    checkLeak("أمثال", amthal, "proverb", it => [["المعنى", it.meaning]]);
    for (const it of amthal) {
        const n = norm(it.proverb).split(" ").filter(Boolean).length;
        // The game reorders/types the proverb's words. One or two words is not a
        // puzzle; past about eight it is a memory test, not a language one.
        if (n < 3) bad("أمثال", `«${it.proverb}»: ${n} كلمة — أقصر من أن يكون لغزًا`);
        if (n > 8) warn("أمثال", `«${it.proverb}»: ${n} كلمة — طويل`);
        if (!it.meaning) bad("أمثال", `«${it.proverb}»: بلا معنى، واللعبة تعرضه`);
    }

    // An EMPTY string passes «has three clues» and shows the player a blank line.
    // The model emitted exactly that once, and a `< 3` check let it through: a
    // lower bound is not a shape check, and «الوردة» shipped with a fourth clue
    // that was the empty string.
    for (const [name, items, fields] of [
        ["لمحة", lamha, it => [...(it.clues || []), ...(it.accepted || [])]],
        ["قرّبها", warmer, it => [...(it.hints || []), ...(it.accepted || []), ...Object.values(it.tiers || {}).flat()]],
        ["أمثال", amthal, it => [it.proverb, it.meaning]],
    ]) for (const it of items)
        if (fields(it).some(s => !String(s ?? "").trim()))
            bad(name, `${it.id ?? it.proverb}: حقلٌ نصّيٌّ فارغ`);

    // --- نحلة -------------------------------------------------------------
    // The inline bank, read through the built module so what is audited is what
    // ships. Its own generator already guards structure; what is checked here is
    // what only a cross-item view can see.
    return import("../src/core/banks.mjs").then(B => {
        const bee = B.BEE_BANK;
        checkBands("نحلة", bee);
        checkDupes("نحلة", bee, b => [b.center, ...[...b.outer].sort()].join(""));
        for (const b of bee) {
            const set = new Set([b.center, ...b.outer]);
            if (set.size !== 7) bad("نحلة", `${b.center}|${b.outer.join("")}: ليست ٧ حروف مميّزة`);
            for (const w of b.words) {
                if (!w.includes(b.center)) bad("نحلة", `${b.center}: «${w}» بلا الحرف الأوسط`);
                if (![...w].every(c => set.has(c))) bad("نحلة", `${b.center}: «${w}» فيه حرفٌ خارج اللوح`);
            }
            if (new Set(b.words).size !== b.words.length) bad("نحلة", `${b.center}: كلمة مكرّرة داخل اللوح`);
        }
        // The bands must not overlap, or «صعب» does not mean harder than «متوسط».
        const sz = d => bee.filter(b => b.difficulty === d).map(b => b.words.length);
        for (const [a, c] of [[0, 1], [1, 2]])
            if (Math.min(...sz(a)) <= Math.max(...sz(c)))
                bad("نحلة", `النطاقان ${a} و${c} متداخلان بعدد الكلمات`);

        // --- كَلِمة و تشابك ---------------------------------------------------
        checkDupes("كَلِمة", B.WORDLE_PRACTICE.concat(B.WORD_EXTRA5, B.WORD_EXTRA6), p => norm(p.word));
        checkLeak("كَلِمة", B.WORDLE_PRACTICE.concat(B.WORD_EXTRA5, B.WORD_EXTRA6).map(
            (p, i) => ({ ...p, id: p.word, i })), "word", it => [["التلميح", it.hint]]);
        checkDupes("تشابك", B.CONNECTIONS_POOL, g => norm(g.theme));
        // A word in two groups makes a board with two right answers.
        const owner = new Map();
        for (const g of B.CONNECTIONS_POOL)
            for (const w of g.words) {
                const k = norm(w);
                if (owner.has(k) && owner.get(k) !== g.theme)
                    warn("تشابك", `«${w}» في «${owner.get(k)}» و«${g.theme}» — التباس انتماء`);
                owner.set(k, g.theme);
            }

        report();
    });
}

function report() {
    for (const e of errs) console.log(e);
    for (const w of warns) console.log(w);
    const verdict = `AUDIT — أعطاب ${errs.length || "—"} · تحذيرات ${warns.length || "—"}`;
    console.log("\n" + verdict);
    if (errs.length || (STRICT && warns.length)) process.exit(1);
    console.log("AUDIT_OK");
}

main().catch(e => { console.error(e); process.exit(1); });
