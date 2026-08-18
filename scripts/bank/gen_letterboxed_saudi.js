// gen_letterboxed_saudi.js — Saudi-identity "Letter Boxed" (صندوق الحروف) bank.
// Same hard constraints as gen_letterboxed.js (12 distinct letters on 4 sides of 3;
// a chained solution that uses every letter and never puts two consecutive letters
// of a word on one side) — but every board is SEEDED FROM A SAUDI STAR WORD
// (city, food, heritage…). The board's par solution therefore STARS a Saudi word,
// and we carry `theme` + `star` so the app can show a Saudi label and reveal the
// cultural solution on win. Generic boards top up any thin difficulty bucket.
//
// Usage: node scripts/bank/gen_letterboxed_saudi.js  ->  overwrites bank/letterboxed.json
'use strict';
const fs = require('fs');

const NORM = s => String(s).normalize('NFC')
    .replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim();

const ALLOWED_RE = /^[ابتجحدرسشصطعفقكلمنهوي]+$/;
const letters = w => Array.from(new Set(w.split('')));

const allWords = JSON.parse(fs.readFileSync('bank/words_ar.json', 'utf8')).map(NORM).filter(w => w.length >= 3);
const dict = new Set(allWords);

// chain candidates: distinct 4..6, allowed, no consecutive-dup letter
const cand = allWords.filter(w => ALLOWED_RE.test(w) && !/(.)\1/.test(w) && letters(w).length >= 4 && letters(w).length <= 6);
const byFirst = {};
for (const w of cand) (byFirst[w[0]] = byFirst[w[0]] || []).push(w);

// playability scoring corpus
const playable = allWords.filter(w => w.length <= 8 && ALLOWED_RE.test(w));

function assignSides(letters12, edges) {
    const adj = {}; letters12.forEach(l => adj[l] = new Set());
    edges.forEach(([a, b]) => { if (a !== b) { adj[a].add(b); adj[b].add(a); } });
    const sides = [[], [], [], []];
    const order = letters12.slice().sort((a, b) => adj[b].size - adj[a].size);
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
const edgesOf = w => { const e = []; for (let i = 0; i + 1 < w.length; i++) e.push([w[i], w[i + 1]]); return e; };
function richness(sides) {
    const side = {}; sides.forEach((s, si) => s.forEach(l => { side[l] = si; }));
    const board = new Set(sides.flat()); let n = 0;
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

// ---- Saudi star pool: words from the cultural banks that are real dict words ----
const cats = JSON.parse(fs.readFileSync('bank/saudi/categories.json', 'utf8'));
const themeWords = JSON.parse(fs.readFileSync('bank/saudi/strands_themes.json', 'utf8'));
const starMap = new Map(); // normalized star word -> theme label
const addStar = (w, theme) => {
    const n = NORM(w);
    if (!ALLOWED_RE.test(n) || /(.)\1/.test(n)) return;
    if (letters(n).length < 4 || letters(n).length > 6) return;
    if (!dict.has(n)) return;                 // must be a genuinely playable word
    if (!starMap.has(n)) starMap.set(n, theme);
};
cats.forEach(g => (g.words || []).forEach(w => addStar(w, g.theme)));
themeWords.forEach(g => { addStar(g.spangram, g.theme); (g.words || []).forEach(w => addStar(w, g.theme)); });

// Build a chain that STARTS at the Saudi star word and reaches exactly 12 letters.
function buildFromStar(star) {
    const L1 = new Set(star.split(''));
    const p2 = byFirst[star[star.length - 1]] || [];
    // try 2-word solutions (star + w2) hitting exactly 12 first (cleaner identity)
    for (const w2 of p2) {
        if (w2 === star) continue;
        const u = new Set([...L1, ...w2.split('')]);
        if (u.size !== 12) continue;
        const sides = assignSides([...u], [...edgesOf(star), ...edgesOf(w2)]);
        if (sides) return { sides, solution: [star, w2] };
    }
    // else 3-word: star + w2 (<=11 letters) + w3 -> 12
    for (const w2 of p2) {
        if (w2 === star) continue;
        const L12 = new Set([...L1, ...w2.split('')]);
        if (L12.size > 11 || L12.size < 8) continue;
        const p3 = byFirst[w2[w2.length - 1]] || [];
        for (const w3 of p3) {
            if (w3 === w2 || w3 === star) continue;
            const u = new Set([...L12, ...w3.split('')]);
            if (u.size !== 12) continue;
            const sides = assignSides([...u], [...edgesOf(star), ...edgesOf(w2), ...edgesOf(w3)]);
            if (sides) return { sides, solution: [star, w2, w3] };
        }
    }
    return null;
}

const saudi = [];
const seenKey = new Set();
for (const [star, theme] of starMap) {
    const r = buildFromStar(star);
    if (!r) continue;
    const key = [...new Set(r.sides.flat())].sort().join('');
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    r.theme = theme; r.star = star; r.cultural_tags = ['saudi'];
    saudi.push(r);
}

// Generic top-up so every difficulty bucket has variety (mirrors gen_letterboxed).
const generic = [];
for (let i = 0; i < cand.length && generic.length < 40; i++) {
    const w1 = cand[i]; const p2 = byFirst[w1[w1.length - 1]]; if (!p2) continue;
    const L1 = new Set(w1.split(''));
    for (let a = 0; a < p2.length; a++) {
        const w2 = p2[a]; if (w2 === w1) continue;
        const L12 = new Set([...L1, ...w2.split('')]);
        if (L12.size > 11 || L12.size < 8) continue;
        const p3 = byFirst[w2[w2.length - 1]]; if (!p3) continue;
        let made = false;
        for (let b = 0; b < p3.length; b++) {
            const w3 = p3[b]; if (w3 === w2 || w3 === w1) continue;
            const u = new Set([...L12, ...w3.split('')]); if (u.size !== 12) continue;
            const key = [...u].sort().join(''); if (seenKey.has(key)) continue;
            const sides = assignSides([...u], [...edgesOf(w1), ...edgesOf(w2), ...edgesOf(w3)]);
            if (!sides) continue;
            seenKey.add(key); generic.push({ sides, solution: [w1, w2, w3], cultural_tags: ['ar'] });
            made = true; break;
        }
        if (made) break;
    }
}

// Saudi-MAJORITY bank: all Saudi boards + a quarter as many generic. Score, sort
// easy->hard, tercile-bucket into difficulty 0/1/2.
const bank = [...saudi, ...generic.slice(0, Math.ceil(saudi.length / 3))];
bank.forEach(b => { b.score = richness(b.sides); });
bank.sort((a, b) => b.score - a.score);     // most playable = easiest first
const out = bank.map((b, i) => {
    const third = i / bank.length;
    const difficulty = third < 1 / 3 ? 0 : third < 2 / 3 ? 1 : 2;
    const o = { sides: b.sides, solution: b.solution, cultural_tags: b.cultural_tags, difficulty };
    if (b.theme) o.theme = b.theme;
    if (b.star) o.star = b.star;
    return o;
});

fs.writeFileSync('bank/letterboxed.json', JSON.stringify(out, null, 1));
const saudiCount = out.filter(o => o.cultural_tags.includes('saudi')).length;
const byDiff = [0, 1, 2].map(d => out.filter(o => o.difficulty === d).length);
console.log('letterboxed boards:', out.length, '| saudi:', saudiCount, '| generic:', out.length - saudiCount);
console.log('difficulty 0/1/2:', byDiff.join('/'));
console.log('sample easy:', JSON.stringify(out[0]));
console.log('sample hard:', JSON.stringify(out[out.length - 1]));
