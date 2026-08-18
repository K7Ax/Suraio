// core/resolve — turns a daily ENTRY (game, band, seed, mods) into the concrete
// board, and into the ~120-byte recipe that ships to the client.
//
// WHY THIS EXISTS AS A SEPARATE MODULE: the bot must gate the board a player
// will actually be handed, and the client must rebuild that same board offline.
// If each side derived it its own way they would agree today and drift silently
// later — the failure mode is invisible, because both halves keep working. So
// there is exactly one derivation, here, and both sides import it.
//
// WHY THE DAILY CANNOT REUSE THE CAMPAIGN'S PICKERS: they key on the LEVEL, not
// the date. `pickLevelWord` (main.js:2481) indexes by `levelInBandIndex(lv)`, and
// a daily's representative level is always BANDS[band].start — index 0 — so every
// easy day would serve the same word forever. `pickBankIndex` has the same shape
// of problem: it is `levelSeed(game, lv) % pool.length`, and lv is fixed.
//
// The daily's variety comes from the DATE, so selection keys on `entry.turn` —
// the appearance counter from daily.mjs, which walks each band's bucket in order.
// It is deliberately NOT a hash of the seed; see the rotation note in daily.mjs
// for the measurement that ruled that out.

import { WORDLE_POOLS, BEE_BANK, CONNECTIONS_POOL, assembleConnections } from './banks.mjs';
import { BANDS, clampLevel, curves } from './progression.mjs';
import { dailyDecoys, appearanceIndex, bucketOf, pickDailyIndex } from './daily.mjs';

// Re-exported, not redefined: they moved to daily.mjs when the client needed the
// rotation too (main.js must pick the same bank index offline, and importing
// this module would drag every bundled bank into a second copy). Callers that
// already say `from './resolve.mjs'` keep working, and there is still one copy.
export { bucketOf, pickDailyIndex };

// Games that can be scheduled as a daily — the six live ones. Kept as a list
// here (rather than reaching into main.js, which is a browser IIFE) and asserted
// equal to main.js's LIVE_GAMES in tests/resolve.test.js, so hiding or revealing
// a game can never leave the two halves disagreeing.
export const DAILY_GAMES = ['wordle', 'connections', 'spelling_bee', 'amthal', 'warmer', 'lamha'];

// The three banks the browser fetches at runtime rather than bundling. node reads
// the same files off disk; the client passes what it fetched. Keyed by game so a
// caller cannot mix them up positionally.
export const FETCHED_BANKS = {
    amthal: 'bank/saudi/amthal.json',
    warmer: 'bank/saudi/warmer.json',
    lamha:  'bank/saudi/lamha.json'
};

// The level that stands in for a whole band, so every existing per-level curve
// keeps working untouched in daily mode.
export function repLevel(band) {
    return BANDS[Math.max(0, Math.min(BANDS.length - 1, band | 0))].start;
}


function bankOf(game, ctx) {
    const b = (ctx.banks || {})[game];
    if (!Array.isArray(b) || !b.length) throw new Error(`resolve: بنك «${game}» غير مُحمَّل`);
    return b;
}

// ---------------------------------------------------------------------------
// resolveDaily(entry, ctx) -> { game, band, puzzle, recipe, want, groupPool? }
// ---------------------------------------------------------------------------
//   entry : one element of dailyPlan().entries — { game, band, seed, mods }
//   ctx   : { norm, banks: { amthal, warmer, lamha } }
//
//   puzzle : the concrete board, in the shape core/checks.mjs gates.
//   recipe : what the server row stores and the client receives. It is an INDEX
//            and a seed, never the content — the content is already in the
//            player's bundle, and a payload would leak the answer.
//   want   : extra expectations for the checker (wordle's required length).
//
// Fails closed: an unschedulable game throws rather than returning something the
// checker would have to guess at.
export function resolveDaily(entry, ctx = {}) {
    const norm = ctx.norm;
    if (typeof norm !== 'function') throw new Error('resolve: ctx.norm مطلوبة');
    const game = entry && entry.game;
    const band = Math.max(0, Math.min(2, (entry && entry.band) | 0));
    const seed = (entry && entry.seed) | 0;
    const turn = (entry && entry.turn) | 0;   // rotation counter, see daily.mjs
    const mods = (entry && entry.mods) || null;
    const lv = repLevel(band);

    switch (game) {
        case 'wordle': {
            // Difficulty is the word's LENGTH — 4/5/6, one step per band — so the
            // pool is chosen by band and the day only picks within it.
            const len = curves.wordle.wordLen(lv);
            const pool = WORDLE_POOLS[len];
            if (!pool || !pool.length) throw new Error(`resolve: لا تجمّع لطول ${len}`);
            const index = (((turn % pool.length) + pool.length) % pool.length);
            const p = pool[index];
            return {
                game, band, want: { len }, bucketSize: pool.length,
                puzzle: { word: p.word, hint: p.hint },
                recipe: { seed, band, len, index }
            };
        }
        case 'connections': {
            // Friday adds decoys on top of the band's own count. The tiles stay a
            // multiple of 4 because decoyBonus is 4 (daily.mjs) — the 4-column
            // grid is a layout constraint, not a cosmetic preference.
            const decoys = dailyDecoys(curves.connections.decoys(lv), mods);
            const board = assembleConnections(seed, decoys, norm);
            return {
                game, band, want: {}, bucketSize: CONNECTIONS_POOL.length,
                groupPool: CONNECTIONS_POOL,       // the ambiguity gate needs it
                puzzle: { groups: board.groups, decoys: board.decoys },
                recipe: { seed, band, decoys }
            };
        }
        case 'spelling_bee': {
            const index = pickDailyIndex(BEE_BANK, band, turn);
            const b = BEE_BANK[index];
            return {
                game, band, want: {}, bucketSize: bucketOf(BEE_BANK, band).length,
                // The hive is centre + six outer; checks.mjs gates all seven.
                puzzle: { center: b.center, letters: [b.center, ...b.outer], words: b.words },
                recipe: { seed, band, index }
            };
        }
        case 'amthal':
        case 'warmer':
        case 'lamha': {
            const bank = bankOf(game, ctx);
            const index = pickDailyIndex(bank, band, turn);
            return {
                game, band, want: {}, bucketSize: bucketOf(bank, band).length,
                bank,                               // gateBankItem checks membership
                puzzle: bank[index],
                recipe: { seed, band, index }
            };
        }
        default:
            throw new Error(`resolve: «${game}» ليست لعبةً قابلة للجدولة`);
    }
}

// Convenience: everything core/checks.mjs wants, assembled from one resolution.
// Keeping this here means the bot never hand-builds a ctx and can never forget
// to pass groupPool (without which the connections ambiguity gate silently
// passes everything).
export function checkCtxFor(res, extra = {}) {
    return {
        norm: extra.norm,
        band: res.band,
        want: res.want,
        bucketSize: res.bucketSize,
        bank: res.bank,
        groupPool: res.groupPool,
        dict: extra.dict,
        recentSigs: extra.recentSigs
    };
}

export { clampLevel };
