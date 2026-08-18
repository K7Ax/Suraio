// gen_letterboxed.js — mine bank/words_ar.json for valid Arabic "Letter Boxed"
// (صندوق الحروف) puzzles. A puzzle = 12 distinct letters split across 4 sides of
// 3, such that a known three-word solution uses every letter, chains (last letter
// of word N == first letter of word N+1) and never places two consecutive letters
// of a word on the same side.
//
// Difficulty is CALIBRATED, not arbitrary: for each board we count how many real
// dictionary words are playable on it. The more playable words, the easier it is
// to use all 12 letters. We bucket boards into difficulty 0/1/2 (سهل/متوسط/صعب)
// by terciles of that richness score, matching the campaign's ~85/70/40 target.
//
// Usage: node scripts/bank/gen_letterboxed.js [count]  ->  writes bank/letterboxed.json
'use strict';
const fs = require('fs');

const NORM = s => String(s).normalize('NFC')
    .replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')   // alef variants -> ا
    .replace(/ى/g, 'ي')                       // ى -> ي
    .trim();

const want = parseInt(process.argv[2] || '60', 10);

const allWords = JSON.parse(fs.readFileSync('bank/words_ar.json', 'utf8'))
    .map(NORM).filter(w => w.length >= 3);

// distinct-letter signature per word
function letters(w) { return Array.from(new Set(w.split(''))); }

// Restrict to common Arabic letters so the boards are approachable (drop rare
// letters and hamza-carriers that make awkward puzzles).
const ALLOWED_RE = /^[ابتجحدرسشصطعفقكلمنهوي]+$/;

// Solution-word candidates: distinct-letter count 4..6 (so a 3-word chain can
// reach exactly 12 distinct letters).
const cand = allWords.filter(w => {
    if (!ALLOWED_RE.test(w)) return false;
    if (/(.)\1/.test(w)) return false;   // no consecutive dup letter (unplayable: same side twice)
    const n = letters(w).length; return n >= 4 && n <= 6;
});

// Playability candidates: every allowed word length 3..8 — used only to SCORE
// how rich (easy) a finished board is.
const playable = allWords.filter(w => w.length <= 8 && ALLOWED_RE.test(w));

// index words by their first letter for fast chaining
const byFirst = {};
for (const w of cand) (byFirst[w[0]] = byFirst[w[0]] || []).push(w);

// Try to 4-colour the 12 letters into sides of 3 with no edge inside a side.
// edges = consecutive letter pairs across the solution words.
function assignSides(letters12, edges) {
    const adj = {};
    letters12.forEach(l => adj[l] = new Set());
    edges.forEach(([a, b]) => { if (a !== b) { adj[a].add(b); adj[b].add(a); } });
    const sides = [[], [], [], []];
    const order = letters12.slice().sort((a, b) => adj[b].size - adj[a].size); // hardest first
    function place(i) {
        if (i === order.length) return true;
        const L = order[i];
        for (let s = 0; s < 4; s++) {
            if (sides[s].length >= 3) continue;
            if (sides[s].some(x => adj[L].has(x))) continue;
            sides[s].push(L);
            if (place(i + 1)) return true;
            sides[s].pop();
        }
        return false;
    }
    return place(0) ? sides : null;
}

function edgesOf(w) { const e = []; for (let i = 0; i + 1 < w.length; i++) e.push([w[i], w[i + 1]]); return e; }

// Count how many dictionary words are playable on a board (all letters present,
// length >= 3, no two consecutive letters from the same side). Higher = easier.
function richness(sides) {
    const side = {};
    sides.forEach((s, si) => s.forEach(l => { side[l] = si; }));
    const board = new Set(sides.flat());
    let n = 0;
    for (const w of playable) {
        let ok = true;
        for (let i = 0; i < w.length; i++) {
            if (!board.has(w[i])) { ok = false; break; }
            if (i > 0 && side[w[i]] === side[w[i - 1]]) { ok = false; break; }
        }
        if (ok) n++;
    }
    return n;
}

// Collect many valid boards first, then score + bucket. We oversample so the
// difficulty terciles are meaningful.
const harvest = Math.max(want * 2, 120);
const raw = [];
const seen = new Set();
for (let i = 0; i < cand.length && raw.length < harvest; i++) {
    const w1 = cand[i];
    const p2 = byFirst[w1[w1.length - 1]];
    if (!p2) continue;
    const L1 = new Set(w1.split(''));
    let made = false;
    for (let a = 0; a < p2.length && !made; a++) {
        const w2 = p2[a];
        if (w2 === w1) continue;
        const L12 = new Set([...L1, ...w2.split('')]);
        if (L12.size > 11 || L12.size < 8) continue;        // leave room for w3
        const p3 = byFirst[w2[w2.length - 1]];
        if (!p3) continue;
        for (let b = 0; b < p3.length && !made; b++) {
            const w3 = p3[b];
            if (w3 === w2 || w3 === w1) continue;
            const union = new Set([...L12, ...w3.split('')]);
            if (union.size !== 12) continue;
            const key = Array.from(union).sort().join('');
            if (seen.has(key)) continue;
            const sides = assignSides(Array.from(union), [...edgesOf(w1), ...edgesOf(w2), ...edgesOf(w3)]);
            if (!sides) continue;
            seen.add(key);
            raw.push({ sides, solution: [w1, w2, w3] });
            made = true;
        }
    }
}

// Score every harvested board, sort easy→hard, keep an even spread of `want`.
raw.forEach(b => { b.score = richness(b.sides); });
raw.sort((a, b) => b.score - a.score);   // most playable words first = easiest
const picked = [];
if (raw.length <= want) picked.push(...raw);
else for (let k = 0; k < want; k++) picked.push(raw[Math.round(k * (raw.length - 1) / (want - 1))]);

// Bucket the picked boards into difficulty 0/1/2 by tercile (easy third = 0).
const out = picked.map((b, i) => {
    const third = i / picked.length;
    const difficulty = third < 1 / 3 ? 0 : third < 2 / 3 ? 1 : 2;
    return { sides: b.sides, solution: b.solution, cultural_tags: ['ar'], difficulty };
});

fs.writeFileSync('bank/letterboxed.json', JSON.stringify(out, null, 1));
const byDiff = [0, 1, 2].map(d => out.filter(o => o.difficulty === d).length);
console.log('letterboxed puzzles:', out.length, '| difficulty 0/1/2 counts:', byDiff.join('/'));
console.log('easiest score:', picked[0] && picked[0].score, 'hardest score:', picked[picked.length - 1] && picked[picked.length - 1].score);
console.log('sample easy:', JSON.stringify(out[0]));
console.log('sample hard:', JSON.stringify(out[out.length - 1]));
