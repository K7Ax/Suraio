// core/progression — the pure, DOM-free heart of the level campaign.
//
// WHY THIS FILE EXISTS: src/main.js is a browser IIFE that touches window/document
// at module scope, so none of its logic can be unit-tested. Everything here is
// pure (no window, no document, no localStorage) and therefore testable directly
// from tests/progression.test.js. src/main.js's initLevels() imports from here and
// keeps its existing public API shape — this is an extraction, not a rewrite.
//
// NOTE THE .mjs EXTENSION: package.json has no "type":"module", so a .js file
// using `export` can only be consumed by esbuild, never by node. The .mjs suffix
// lets node import it in tests while esbuild still bundles it normally.

export const LEVELS = 21;              // levels 0..20
export const MAX = LEVELS - 1;

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------
// A data table rather than an if-chain, so band edges live in exactly one place.
// Several games used to hardcode `lv<=2 ? 0 : lv<=8 ? 1 : 2` as a local fallback;
// those are deleted in favour of bandOf() so the edges can never drift.
//
// THE PYRAMID IS DELIBERATELY FLIPPED. The original split was 3 easy / 6 medium /
// 12 hard — 57% of the ladder sat in the hardest band at a ~40% target completion
// rate, so most players hit a wall around L9 and never saw the back half. Flow
// theory says the bulk of content belongs where challenge just exceeds current
// skill, so the mass moves to the middle: 6 easy / 9 medium / 6 hard.
export const BANDS = [
    { key: 'easy',   label: 'سهل',   start: 0,  size: 6, idx: 0 },   // L0–5
    { key: 'medium', label: 'متوسط', start: 6,  size: 9, idx: 1 },   // L6–14
    { key: 'hard',   label: 'صعب',   start: 15, size: 6, idx: 2 }    // L15–20
];

export function clampLevel(n) { return Math.max(0, Math.min(MAX, n | 0)); }

export function bandOf(level) {
    const l = clampLevel(level);
    for (const b of BANDS) if (l < b.start + b.size) return b;
    return BANDS[BANDS.length - 1];
}
export function bandIndex(level) { return bandOf(level).idx; }
export function bandLabel(level) { return bandOf(level).label; }
// 1-based position within the band, for display ("متوسط ٢/٦")
export function levelInBand(level) { return clampLevel(level) - bandOf(level).start + 1; }
// 0-based position within the band, for indexing into a per-band pool
export function levelInBandIndex(level) { return clampLevel(level) - bandOf(level).start; }

// ---------------------------------------------------------------------------
// Deterministic seeding
// ---------------------------------------------------------------------------
// Per-game salt so "level 5" is a different fixed board in every game.
export const SALT = {
    wordle: 101, connections: 211, sudoku: 307, spelling_bee: 409, letterboxed: 521,
    strands: 631, tiles: 743, pips: 859, amthal: 967, missing_word: 1031,
    story_order: 1153, warmer: 1279, lamha: 1409, zayid: 1531
};

// Fixed seed per (game, level) — the same board for everyone, forever.
// Level-seeded, NOT date-seeded: that is what makes the campaign reproducible.
export function levelSeed(game, lv) { return (SALT[game] || 1) * 1000 + clampLevel(lv) * 7919; }

// Deterministic bank index inside the level's band bucket (difficulty 0/1/2).
// Falls back to the whole bank when a bucket is empty.
// KNOWN LIMITATION: this can repeat an item across levels in the same band.
// Games that need guaranteed uniqueness use buildAssign() instead (see warmer.js).
export function pickBankIndex(game, bank, lv, random) {
    if (!bank || !bank.length) return 0;
    const bi = bandIndex(lv);
    const pool = [];
    bank.forEach((b, i) => {
        const d = (b && b.difficulty != null) ? b.difficulty : 1;
        if (d === bi) pool.push(i);
    });
    const list = pool.length ? pool : bank.map((_, i) => i);
    const salt = random ? Math.floor(Math.random() * list.length)
                        : (levelSeed(game, lv) % list.length);
    return list[salt];
}

// ---------------------------------------------------------------------------
// Per-game difficulty curves
// ---------------------------------------------------------------------------
// These live here, not in each game module, so the whole ladder can be asserted
// monotonic in one test run. Each game reads its own curve at register() time.
//
// Connections uses an explicit per-level table rather than one value per band:
// with 9-level bands, a single per-band constant would hold difficulty flat for
// 9 levels in a row, which reads as a plateau. All values are multiples of 4 so
// the 4-column grid stays clean (16 → 28 tiles).
const CONNECTIONS_DECOYS = [
    0, 0, 0, 0, 4, 4,             // easy   L0–5   → 16, 20 tiles
    4, 4, 4, 8, 8, 8, 8, 8, 8,    // medium L6–14  → 20, 24 tiles
    8, 8, 12, 12, 12, 12          // hard   L15–20 → 24, 28 tiles
];

export const curves = {
    wordle: {
        // 4 → 5 → 6 letters, one step per band.
        wordLen: lv => [4, 5, 6][bandIndex(lv)]
    },
    connections: {
        // Kinder than the old floor of 3: difficulty now comes from the board.
        lives: lv => [6, 5, 4][bandIndex(lv)],
        decoys: lv => CONNECTIONS_DECOYS[clampLevel(lv)]
    },
    spelling_bee: {
        // A FRACTION of the board, not an absolute count. The old `3 + 0.8*lv`
        // was capped by the board's own word count (7–12), so from ~L11 up every
        // level silently collapsed into the same task: "find them all".
        needFrac: lv => 0.30 + 0.55 * (clampLevel(lv) / 20),
        pangram: lv => bandIndex(lv) === 2 && levelInBand(lv) >= 3
    },
    amthal: {
        // Help fades across the whole medium band. The old decay (-0.06/level)
        // hit zero at ~L9 — under 6/9/6 that is only the 2nd medium level, so the
        // scaffolding vanished mid-ladder. -0.037 reaches zero exactly at L15.
        scaffold: lv => ({
            leadLetters: [2, 1, 0][bandIndex(lv)],
            revealFrac: Math.max(0, 0.55 - clampLevel(lv) * 0.037),
            showLen: clampLevel(lv) < 18
        })
    }
};

// ---------------------------------------------------------------------------
// Guess budgets
// ---------------------------------------------------------------------------
// Four games could not be lost at all, which meant no tension and no reason to
// think before acting. Budgets give a round stakes — but the limits are
// deliberately generous, and running out is a FINISH (a rank + partial XP),
// never a "you lost". Only the wrong kind of action costs anything:
// warmer charges for cold guesses only, so following the signal is free.
export const BUDGETS = {
    spelling_bee: { n: lv => [12, 10, 8][bandIndex(lv)], label: 'كلمات مرفوضة', kind: 'rejected' },
    amthal: { n: lv => [8, 6, 5][bandIndex(lv)], label: 'محاولات', kind: 'failed_check' },
    warmer: { n: lv => [12, 10, 8][bandIndex(lv)], label: 'تخمينات باردة', kind: 'cold' },
    lamha: { n: lv => [10, 8, 6][bandIndex(lv)], label: 'محاولات', kind: 'wrong' }
};
export function budgetFor(game, lv) {
    const b = BUDGETS[game];
    return b ? { n: b.n(clampLevel(lv)), label: b.label, kind: b.kind } : null;
}

// ---------------------------------------------------------------------------
// Progress mask
// ---------------------------------------------------------------------------
// Progress is a 21-bit mask rather than a single "highest cleared" number,
// because once the ladder is unlocked a player can clear L12 before L3 — a
// scalar frontier would silently discard that. 21 bits is well inside the
// 31-bit range where JS bitwise ops are exact.
export function maskSet(mask, lv) { return ((mask | 0) | (1 << clampLevel(lv))) >>> 0; }
export function maskHas(mask, lv) { return (((mask | 0) >>> clampLevel(lv)) & 1) === 1; }
export function maskCount(mask) {
    let n = 0;
    for (let i = 0; i <= MAX; i++) if (maskHas(mask, i)) n++;
    return n;
}
// Highest CONTIGUOUS cleared level starting from 0; -1 when L0 is not cleared.
// This preserves the exact contract of the old scalar cleared(), so every
// existing reader (daily strip, dashboard, share text) keeps working unchanged.
export function contiguousFrontier(mask) {
    let i = -1;
    while (i < MAX && maskHas(mask, i + 1)) i++;
    return i;
}

// ---------------------------------------------------------------------------
// Rank tiers
// ---------------------------------------------------------------------------
// Tier 0 is reachable by simply FINISHING a level. That is the deliberate
// "you always end with something" guarantee that lets us add guess budgets
// without the ladder ever becoming a wall.
export const TIERS = [
    { idx: 0, key: 'participant', name: 'مُشارِك', icon: '🎖️', min: 0.00, stars: 1 },
    { idx: 1, key: 'diligent',    name: 'مُجتهد',  icon: '🥉', min: 0.30, stars: 1 },
    { idx: 2, key: 'skilled',     name: 'مُتقِن',  icon: '🥈', min: 0.55, stars: 2 },
    { idx: 3, key: 'expert',      name: 'بارع',    icon: '🥇', min: 0.78, stars: 2 },
    { idx: 4, key: 'legend',      name: 'أسطورة',  icon: '👑', min: 0.93, stars: 3 }
];

export function tierFor(score01) {
    const s = Math.max(0, Math.min(1, Number(score01) || 0));
    let t = TIERS[0];
    for (const x of TIERS) if (s >= x.min) t = x;
    return t;
}

// Legacy bridge: games used to report 1..3 stars. Map onto the 5-tier ladder.
export function tierFromStars(stars) {
    const s = Math.max(1, Math.min(3, stars | 0));
    return [0, 0, 2, 4][s];
}

// ---------------------------------------------------------------------------
// Migration (schema v2)
// ---------------------------------------------------------------------------
// Existing players hold a scalar `lvl.<game>.cleared` from the locked-ladder era.
// v2 seeds the bitmask from it and back-fills a retroactive «مُتقِن» rank so the
// level picker reads as a trophy shelf rather than a blank grid.
//
// `cleared` is never lowered and nothing is taken away: level indices stay 0..20
// and the ladder is unlocked anyway. Returns null when already migrated.
export function migrateProgressV2(old) {
    const cur = (old && old.v) | 0;
    if (cur >= 2) return null;
    const cleared = (old && old.cleared != null) ? (old.cleared | 0) : -1;
    let mask = (old && old.mask) | 0;
    const rank = Object.assign({}, (old && old.rank) || {});
    for (let i = 0; i <= Math.min(MAX, cleared); i++) {
        mask = maskSet(mask, i);
        if (rank[i] == null) rank[i] = 2;   // retroactive «مُتقِن»
    }
    return { mask, rank, v: 2 };
}

// ---------------------------------------------------------------------------
// Anonymous → account merge
// ---------------------------------------------------------------------------
// Once play no longer requires an account, a visitor accrues real progress under
// the `sura.anon.*` namespace. On sign-in it must fold into the account's
// namespace WITHOUT clobbering progress the account already had (same person,
// second device). Pure so every rule is unit-testable.
const MERGE_MAX   = ['xp', 'coins', 'wins', 'comboAllDays', 'maxStreak'];
const MERGE_MIN   = ['bestSeconds'];        // 0/absent means "unset", not "best"
const MERGE_UNION = ['badges'];

export function mergeProgress(suffix, anonVal, uidVal) {
    const hasAnon = anonVal !== undefined && anonVal !== null;
    const hasUid  = uidVal  !== undefined && uidVal  !== null;
    if (!hasAnon) return uidVal;
    if (!hasUid)  return anonVal;

    if (MERGE_MAX.includes(suffix)) return Math.max(Number(anonVal) || 0, Number(uidVal) || 0);

    if (MERGE_MIN.includes(suffix)) {
        const a = Number(anonVal) || 0, u = Number(uidVal) || 0;
        if (!a) return u;
        if (!u) return a;
        return Math.min(a, u);
    }

    if (MERGE_UNION.includes(suffix)) {
        const a = Array.isArray(anonVal) ? anonVal : [];
        const u = Array.isArray(uidVal) ? uidVal : [];
        return Array.from(new Set(u.concat(a)));
    }

    // lvl.<game>.mask — bitwise OR: every level either side cleared stays cleared
    if (/^lvl\.[a-z_]+\.mask$/.test(suffix)) return (((anonVal | 0) | (uidVal | 0)) >>> 0);

    // lvl.<game>.rank — per-level best tier
    if (/^lvl\.[a-z_]+\.rank$/.test(suffix)) {
        const out = Object.assign({}, uidVal || {});
        Object.keys(anonVal || {}).forEach(k => {
            const a = anonVal[k] | 0;
            if (out[k] == null || a > (out[k] | 0)) out[k] = a;
        });
        return out;
    }

    // lvl.<game>.{cleared,level,v} — keep the further-along value
    if (/^lvl\.[a-z_]+\.(cleared|level|v)$/.test(suffix)) {
        return Math.max(Number(anonVal) || 0, Number(uidVal) || 0);
    }

    // Anything unrecognised: the account's own value wins.
    return uidVal;
}
