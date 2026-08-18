// gen_bank.js — build the huge Saudi-culture bank from seed data.
//   - Connections: combine 4 disjoint Saudi categories per puzzle.
//   - Wordle: Saudi words + hints (passthrough).
//   - Spelling Bee: mined from the 31k dictionary (real, solvable boards).
// Writes bank/saudi/{connections,wordle,spelling_bee}.json (authoring format
// consumed by bot.js seedAll + gen_seed_sql.js). Letter Boxed + Strands have
// their own generators (gen_letterboxed.js, gen_strands.js).
//
// Usage: node scripts/bank/gen_bank.js
'use strict';
const fs = require('fs');

const NORM = s => String(s).normalize('NFC')
    .replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').trim();
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
let seed = 1234567;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- Connections ----------
function genConnections(want) {
    const cats = read('bank/saudi/categories.json');
    const out = [], seen = new Set();
    for (let attempt = 0; attempt < 4000 && out.length < want; attempt++) {
        const pick = shuffle(cats).slice(0, 4);
        const words = pick.flatMap(c => c.words.map(NORM));
        if (new Set(words).size !== 16) continue;                 // need 16 unique
        const key = pick.map(c => c.theme).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const diffs = shuffle([1, 2, 3, 4]);
        out.push({
            groups: pick.map((c, i) => ({ theme: c.theme, difficulty: diffs[i], words: c.words })),
            cultural_tags: ['saudi', 'connections'],
            featured: out.length < 6
        });
    }
    fs.writeFileSync('bank/saudi/connections.json', JSON.stringify(out, null, 1));
    return out.length;
}

// ---------- Wordle ----------
function genWordle() {
    const words = read('bank/saudi/words.json');
    const out = words.map((w, i) => ({ word: w.word, hint: w.hint || '', cultural_tags: ['saudi', 'wordle'], featured: i < 8 }));
    fs.writeFileSync('bank/saudi/wordle.json', JSON.stringify(out, null, 1));
    return out.length;
}

// ---------- Spelling Bee (mined from the dictionary) ----------
function genBee(want) {
    const dict = read('bank/words_ar.json').map(NORM).filter(w => w.length >= 4 && w.length <= 6);
    const meta = dict.map(w => ({ w, set: new Set(w.split('')) }));
    // candidate 7-distinct-letter "pangram" seeds, biased to common letters
    // No dict word has 7 distinct letters (max length is 6), so build a 7-letter
    // set from a 6-distinct word + one extra common letter.
    const COMMON = 'املنيورتبسدكعفقه'.split('');
    const cands = [];
    for (const m of meta) {
        if (m.set.size !== 6) continue;
        for (const extra of COMMON) {
            if (m.set.has(extra)) continue;
            const key = [...m.set, extra].sort().join('');
            cands.push(key);
        }
        if (cands.length > 4000) break;
    }
    const out = [], seenSets = new Set();
    for (const key of cands) {
        if (out.length >= want) break;
        if (seenSets.has(key)) continue;
        const letters = key.split('');
        const set = new Set(letters);
        const valid = meta.filter(m => m.w.length >= 4 && [...m.set].every(c => set.has(c)));
        if (valid.length < 18) continue;
        // center = letter that appears in the most valid words
        let center = letters[0], best = -1;
        for (const L of letters) { const c = valid.filter(m => m.set.has(L)).length; if (c > best) { best = c; center = L; } }
        const words = valid.filter(m => m.set.has(center)).map(m => m.w);
        if (words.length < 15) continue;
        seenSets.add(key);
        out.push({
            center, letters: [center, ...letters.filter(l => l !== center)],
            words: [...new Set(words)],
            cultural_tags: ['ar', 'spelling_bee'], featured: out.length < 6
        });
    }
    fs.writeFileSync('bank/saudi/spelling_bee.json', JSON.stringify(out, null, 1));
    return out.length;
}

const c = genConnections(48);
const w = genWordle();
const b = genBee(24);
console.log(`connections: ${c}  wordle: ${w}  spelling_bee: ${b}`);
