// core/rng — the seeded random pair, split out of core/util.js unchanged.
//
// WHY THE SPLIT: util.js is a .js file using ESM syntax. package.json has no
// "type":"module", so node treats .js as CommonJS and CANNOT import it —
// esbuild can, node cannot. That was fine while only the browser needed these.
// It stopped being fine when the Telegram bot had to generate the SAME board
// the site will show: the bot runs in node, and every deterministic board in
// Sura is `mulberry32(seed)` fed through `seededShuffle`.
//
// The alternative was a second copy of eight lines inside bot.js. This repo
// already carries the scar of that decision — tests/normalize.test.js exists
// because normalizeArabic was copied three ways and drifted. One copy, .mjs so
// both runtimes can load it; util.js re-exports so no existing import changes.

export function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

export function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
