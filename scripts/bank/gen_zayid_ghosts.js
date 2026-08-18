// gen_zayid_ghosts.js — builds bank/saudi/zayid_ghosts.json, a pool of
// recorded "past player" attempts per زايد category. Each ghost is a FIXED
// human-like record { name, claimed, delivered, items[] } drawn from the
// category's own real answers: `delivered` = how many they actually named
// (their true depth), `items` = the real names they gave, `claimed` = how high
// they bid (≥ delivered = they bluffed and can be CALLED; = delivered = honest).
//
// These seed the game so «زايد» has a believable human opponent from day one and
// fully offline. Once the owner applies supabase/sql/zayid_ghosts.sql, real
// players' attempts are recorded server-side and mixed into this pool — the
// ghost becomes a genuine past-player replay. Deterministic (seeded) so the bank
// is stable across regenerations.
const fs = require('fs');
const path = require('path');

// مسارات من جذر المستودع لا من مجلّد الملفّ — كان `__dirname` هو الجذر
// حين كان هذا المولّد في الأعلى.
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'bank', 'saudi', 'zayid.json');
const OUT = path.join(ROOT, 'bank', 'saudi', 'zayid_ghosts.json');

// a spread of Saudi first names / nicknames to identify each ghost
const NAMES = ['فهد', 'نورة', 'سلطان', 'ريم', 'عبدالله', 'الجوهرة', 'خالد', 'مها', 'تركي',
    'لمى', 'ناصر', 'هند', 'بندر', 'شهد', 'ماجد', 'العنود', 'فيصل', 'دانة', 'سعود', 'وضحى',
    'راكان', 'جواهر', 'مشعل', 'أروى', 'زياد', 'غادة', 'وليد', 'بشائر', 'يزيد', 'رغد'];

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function sample(arr, k, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, k);
}

const bank = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const out = {};
let total = 0;

for (const entry of bank) {
    const cat = entry.category;
    const answers = entry.answers || [];
    const hc = entry.human_curve || { typical: 8, strong: 14, max: 20 };
    const rng = mulberry32(hashStr('ghost:' + cat));
    const N = 9;                       // ghosts per category
    const usedNames = new Set();
    const ghosts = [];
    for (let g = 0; g < N; g++) {
        // true depth (delivered): most players cluster around `typical`, a few reach `strong`
        const skill = 0.5 + rng() * 0.7;                       // 0.5 .. 1.2 of typical
        let delivered = Math.round((hc.typical || 8) * skill);
        delivered = clamp(delivered, 2, Math.min(hc.strong || answers.length, answers.length));
        // nerve: sometimes bluff above what they can deliver (callable), sometimes honest
        const roll = rng();
        let claimed;
        if (roll < 0.42) claimed = delivered + 1 + Math.floor(rng() * 3);   // bluffed → beatable by calling
        else if (roll < 0.72) claimed = delivered;                          // honest
        else claimed = Math.max(2, delivered - Math.floor(rng() * 2));      // shy under-claimer
        claimed = clamp(claimed, 2, Math.min(hc.max || answers.length, answers.length + 4));
        // the actual names they gave (fixed record)
        const items = sample(answers, delivered, rng);
        // pick a stable name
        let name = NAMES[Math.floor(rng() * NAMES.length)];
        let guard = 0;
        while (usedNames.has(name) && guard++ < NAMES.length) name = NAMES[(NAMES.indexOf(name) + 1) % NAMES.length];
        usedNames.add(name);
        ghosts.push({ name, claimed, delivered, items });
    }
    out[cat] = ghosts;
    total += ghosts.length;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`wrote ${Object.keys(out).length} categories, ${total} ghosts → ${path.relative(__dirname, OUT)}`);
