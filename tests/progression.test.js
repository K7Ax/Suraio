// Unit tests for src/core/progression.mjs — the pure heart of the level campaign.
//
// This module exists so the campaign's maths can be tested without a DOM. It is
// loaded via dynamic import() because it is ESM (.mjs) while this suite, like the
// rest of tests/, is CommonJS.
const test = require("node:test");
const assert = require("node:assert/strict");

let P;
test.before(async () => { P = await import("../src/core/progression.mjs"); });

// ---------------------------------------------------------------------------
test("bands: sizes sum to LEVELS and starts are contiguous", () => {
  const total = P.BANDS.reduce((n, b) => n + b.size, 0);
  assert.equal(total, P.LEVELS, "band sizes must cover every level exactly once");
  assert.equal(P.MAX, P.LEVELS - 1);
  let expected = 0;
  for (const b of P.BANDS) {
    assert.equal(b.start, expected, `band ${b.key} must start where the previous ended`);
    expected += b.size;
  }
});

test("bands: every level 0..MAX maps to exactly one band", () => {
  for (let lv = 0; lv <= P.MAX; lv++) {
    const b = P.bandOf(lv);
    assert.ok(b, `level ${lv} has a band`);
    assert.ok(lv >= b.start && lv < b.start + b.size, `level ${lv} sits inside band ${b.key}`);
  }
});

test("bandIndex is monotonic non-decreasing across the ladder", () => {
  let prev = -1;
  for (let lv = 0; lv <= P.MAX; lv++) {
    const idx = P.bandIndex(lv);
    assert.ok(idx >= prev, `band index must never go backwards (level ${lv})`);
    prev = idx;
  }
});

test("clampLevel pins out-of-range input", () => {
  assert.equal(P.clampLevel(-5), 0);
  assert.equal(P.clampLevel(0), 0);
  assert.equal(P.clampLevel(P.MAX), P.MAX);
  assert.equal(P.clampLevel(999), P.MAX);
});

test("levelInBand is 1-based, levelInBandIndex is 0-based, both stay in range", () => {
  for (let lv = 0; lv <= P.MAX; lv++) {
    const b = P.bandOf(lv);
    const one = P.levelInBand(lv), zero = P.levelInBandIndex(lv);
    assert.equal(one, zero + 1, `the two must differ by exactly 1 (level ${lv})`);
    assert.ok(zero >= 0 && zero < b.size, `0-based index inside band size (level ${lv})`);
  }
});

test("bands: the pyramid is flipped — the hard band is no longer the longest", () => {
  const [easy, medium, hard] = P.BANDS;
  assert.deepEqual([easy.size, medium.size, hard.size], [6, 9, 6],
    "6 easy / 9 medium / 6 hard — the bulk of the ladder sits in the flow channel");
  assert.ok(medium.size > hard.size,
    "the original 3/6/12 put 57% of the ladder in the hardest band; that must not come back");
  // Exact edges, since every curve is tuned to them.
  assert.equal(P.bandOf(5).key, "easy");
  assert.equal(P.bandOf(6).key, "medium");
  assert.equal(P.bandOf(14).key, "medium");
  assert.equal(P.bandOf(15).key, "hard");
});

// ---------------------------------------------------------------------------
// Curves. The contract for every game is the same: difficulty must never go
// DOWN as the level rises. A curve that dips means a later level is easier than
// an earlier one, which reads as the ladder being broken.
// ---------------------------------------------------------------------------
function assertMonotonic(label, fn, { decreasing = false } = {}) {
  let prev = fn(0);
  for (let lv = 1; lv <= P.MAX; lv++) {
    const cur = fn(lv);
    if (decreasing) assert.ok(cur <= prev, `${label} must not rise at level ${lv} (${prev} → ${cur})`);
    else assert.ok(cur >= prev, `${label} must not fall at level ${lv} (${prev} → ${cur})`);
    prev = cur;
  }
}

test("wordle: word length rises 4 → 5 → 6 exactly at the band edges", () => {
  assertMonotonic("wordle word length", P.curves.wordle.wordLen);
  assert.equal(P.curves.wordle.wordLen(0), 4);
  assert.equal(P.curves.wordle.wordLen(5), 4, "last easy level is still 4 letters");
  assert.equal(P.curves.wordle.wordLen(6), 5, "medium starts at 5");
  assert.equal(P.curves.wordle.wordLen(14), 5, "last medium level is still 5");
  assert.equal(P.curves.wordle.wordLen(15), 6, "hard starts at 6");
  assert.equal(P.curves.wordle.wordLen(P.MAX), 6);
});

test("wordle: each band has enough distinct pool slots for its levels", () => {
  // levelInBandIndex is what indexes into the per-length word pool. If two
  // levels in a band shared an index the same word would repeat.
  for (const b of P.BANDS) {
    const seen = new Set();
    for (let lv = b.start; lv < b.start + b.size; lv++) seen.add(P.levelInBandIndex(lv));
    assert.equal(seen.size, b.size, `band ${b.key} needs ${b.size} distinct pool indices`);
  }
});

test("connections: lives fall, decoys rise, and the grid stays 4-column", () => {
  assertMonotonic("connections lives", P.curves.connections.lives, { decreasing: true });
  assertMonotonic("connections decoys", P.curves.connections.decoys);
  assert.equal(P.curves.connections.lives(0), 6);
  assert.equal(P.curves.connections.lives(P.MAX), 4, "kinder than the old floor of 3");
  assert.equal(P.curves.connections.decoys(0), 0, "the first level is the classic 16-tile board");
  for (let lv = 0; lv <= P.MAX; lv++) {
    const d = P.curves.connections.decoys(lv);
    assert.equal(d % 4, 0, `decoys must stay a multiple of 4 (level ${lv})`);
    const tiles = 16 + d;
    assert.ok(tiles >= 16 && tiles <= 28, `board stays between 16 and 28 tiles (level ${lv})`);
  }
});

test("spelling_bee: the goal is a fraction that actually moves every level", () => {
  assertMonotonic("bee needFrac", P.curves.spelling_bee.needFrac);
  assert.ok(Math.abs(P.curves.spelling_bee.needFrac(0) - 0.30) < 1e-9, "L0 asks for 30% of the board");
  assert.ok(Math.abs(P.curves.spelling_bee.needFrac(P.MAX) - 0.85) < 1e-9, "L20 asks for 85%");
  // The regression this replaced: an absolute count that the board size clamped,
  // making every level from ~11 up identical. Check the fraction is strictly
  // increasing so no two levels can collapse into the same goal.
  for (let lv = 1; lv <= P.MAX; lv++) {
    assert.ok(P.curves.spelling_bee.needFrac(lv) > P.curves.spelling_bee.needFrac(lv - 1),
      `bee goal must strictly rise at level ${lv}`);
  }
});

test("spelling_bee: the pangram demand is confined to the top of the hard band", () => {
  for (let lv = 0; lv <= P.MAX; lv++) {
    const want = P.curves.spelling_bee.pangram(lv);
    if (lv < 17) assert.equal(want, false, `no pangram demanded at level ${lv}`);
    else assert.equal(want, true, `pangram demanded at level ${lv}`);
  }
});

test("amthal: scaffolding fades and is gone exactly at the hard band", () => {
  const s = P.curves.amthal.scaffold;
  assertMonotonic("amthal revealFrac", lv => s(lv).revealFrac, { decreasing: true });
  assertMonotonic("amthal leadLetters", lv => s(lv).leadLetters, { decreasing: true });
  assert.ok(s(0).revealFrac > 0.5, "easy levels pre-fill about half the words");
  assert.equal(s(15).revealFrac, 0, "help reaches zero exactly at the first hard level, not mid-ladder");
  assert.equal(s(P.MAX).revealFrac, 0);
  assert.equal(s(0).leadLetters, 2);
  assert.equal(s(P.MAX).leadLetters, 0);
  assert.equal(s(17).showLen, true, "length dots survive into the hard band");
  assert.equal(s(18).showLen, false, "the very top is pure recall");
});

// ---------------------------------------------------------------------------
test("levelSeed is deterministic, and distinct per game and per level", () => {
  assert.equal(P.levelSeed("wordle", 3), P.levelSeed("wordle", 3), "same input, same seed");
  assert.notEqual(P.levelSeed("wordle", 3), P.levelSeed("wordle", 4), "levels differ");
  assert.notEqual(P.levelSeed("wordle", 3), P.levelSeed("connections", 3), "games differ");
  const seen = new Set();
  for (const g of Object.keys(P.SALT)) for (let lv = 0; lv <= P.MAX; lv++) seen.add(P.levelSeed(g, lv));
  assert.equal(seen.size, Object.keys(P.SALT).length * P.LEVELS, "no seed collisions across the whole matrix");
});

test("pickBankIndex stays in range and prefers the level's difficulty bucket", () => {
  const bank = [];
  for (let i = 0; i < 30; i++) bank.push({ difficulty: i % 3 });
  for (let lv = 0; lv <= P.MAX; lv++) {
    const idx = P.pickBankIndex("warmer", bank, lv);
    assert.ok(idx >= 0 && idx < bank.length, `index in range (level ${lv})`);
    assert.equal(bank[idx].difficulty, P.bandIndex(lv), `picks from the matching bucket (level ${lv})`);
  }
});

test("pickBankIndex falls back to the whole bank when a bucket is empty", () => {
  const bank = [{ difficulty: 0 }, { difficulty: 0 }];   // nothing at difficulty 1 or 2
  const idx = P.pickBankIndex("warmer", bank, P.MAX);
  assert.ok(idx >= 0 && idx < bank.length, "still returns a usable index");
});

test("pickBankIndex tolerates an empty bank", () => {
  assert.equal(P.pickBankIndex("warmer", [], 0), 0);
  assert.equal(P.pickBankIndex("warmer", null, 0), 0);
});

// ---------------------------------------------------------------------------
test("mask: set/has round-trip for every level", () => {
  let m = 0;
  for (let lv = 0; lv <= P.MAX; lv++) {
    assert.equal(P.maskHas(m, lv), false, `level ${lv} starts unset`);
    m = P.maskSet(m, lv);
    assert.equal(P.maskHas(m, lv), true, `level ${lv} reads back as set`);
  }
  assert.equal(P.maskCount(m), P.LEVELS, "all levels set");
});

test("mask: setting is idempotent and does not disturb neighbours", () => {
  let m = P.maskSet(0, 5);
  m = P.maskSet(m, 5);
  assert.equal(P.maskCount(m), 1);
  assert.equal(P.maskHas(m, 4), false);
  assert.equal(P.maskHas(m, 6), false);
});

test("contiguousFrontier: the out-of-order case the old scalar progress lost", () => {
  // Clearing L5 first must NOT be read as "levels 0..5 are done".
  const only5 = P.maskSet(0, 5);
  assert.equal(P.maskHas(only5, 5), true, "L5 is recorded");
  assert.equal(P.contiguousFrontier(only5), -1, "but the contiguous frontier is still -1");

  let m = 0;
  for (let i = 0; i <= 4; i++) m = P.maskSet(m, i);
  assert.equal(P.contiguousFrontier(m), 4);
  m = P.maskSet(m, 5);
  assert.equal(P.contiguousFrontier(m), 5, "filling the gap advances the frontier past it");
});

test("contiguousFrontier: empty is -1, full is MAX", () => {
  assert.equal(P.contiguousFrontier(0), -1);
  let all = 0;
  for (let i = 0; i <= P.MAX; i++) all = P.maskSet(all, i);
  assert.equal(P.contiguousFrontier(all), P.MAX);
});

// ---------------------------------------------------------------------------
test("tiers: ascending thresholds, first is reachable by simply finishing", () => {
  assert.equal(P.TIERS[0].min, 0, "tier 0 must be free — the 'always end with something' guarantee");
  for (let i = 1; i < P.TIERS.length; i++) {
    assert.ok(P.TIERS[i].min > P.TIERS[i - 1].min, "thresholds strictly ascend");
    assert.equal(P.TIERS[i].idx, i, "idx matches position");
  }
});

test("tierFor: exact boundaries land on the higher tier", () => {
  for (const t of P.TIERS) {
    assert.equal(P.tierFor(t.min).idx, t.idx, `score ${t.min} is tier ${t.idx}`);
    if (t.idx > 0) {
      assert.equal(P.tierFor(t.min - 0.001).idx, t.idx - 1, `just below ${t.min} is the tier beneath`);
    }
  }
});

test("tierFor: clamps and never throws on junk", () => {
  assert.equal(P.tierFor(0).idx, 0);
  assert.equal(P.tierFor(1).idx, P.TIERS.length - 1);
  assert.equal(P.tierFor(-99).idx, 0);
  assert.equal(P.tierFor(99).idx, P.TIERS.length - 1);
  assert.equal(P.tierFor(NaN).idx, 0);
  assert.equal(P.tierFor(undefined).idx, 0);
});

test("tierFromStars bridges the legacy 1..3 star reports", () => {
  assert.equal(P.tierFromStars(1), 0);
  assert.equal(P.tierFromStars(2), 2);
  assert.equal(P.tierFromStars(3), 4);
  assert.equal(P.tierFromStars(0), 0, "out of range clamps low");
  assert.equal(P.tierFromStars(9), 4, "out of range clamps high");
});

// ---------------------------------------------------------------------------
test("migrateProgressV2 seeds the mask and back-fills ranks from a scalar cleared", () => {
  const out = P.migrateProgressV2({ cleared: 4, v: 0 });
  assert.equal(out.v, 2);
  for (let i = 0; i <= 4; i++) {
    assert.equal(P.maskHas(out.mask, i), true, `level ${i} carried over as cleared`);
    assert.equal(out.rank[i], 2, `level ${i} got a retroactive «مُتقِن»`);
  }
  assert.equal(P.maskHas(out.mask, 5), false, "nothing beyond cleared is invented");
});

test("migrateProgressV2 is idempotent", () => {
  const first = P.migrateProgressV2({ cleared: 3, v: 0 });
  assert.ok(first, "first run migrates");
  assert.equal(P.migrateProgressV2({ cleared: 3, v: 2 }), null, "second run is a no-op");
});

test("migrateProgressV2 handles a fresh player and preserves existing ranks", () => {
  const fresh = P.migrateProgressV2({ cleared: -1, v: 0 });
  assert.equal(fresh.mask, 0);
  assert.deepEqual(fresh.rank, {});

  const kept = P.migrateProgressV2({ cleared: 2, v: 0, rank: { 0: 4 } });
  assert.equal(kept.rank[0], 4, "an existing 👑 is never downgraded to the retroactive default");
  assert.equal(kept.rank[1], 2);
});

// ---------------------------------------------------------------------------
test("mergeProgress: absent side yields the other side", () => {
  assert.equal(P.mergeProgress("xp", 100, undefined), 100);
  assert.equal(P.mergeProgress("xp", undefined, 250), 250);
  assert.equal(P.mergeProgress("xp", null, 250), 250);
});

test("mergeProgress: counters keep the larger value", () => {
  assert.equal(P.mergeProgress("xp", 100, 250), 250);
  assert.equal(P.mergeProgress("coins", 900, 10), 900);
  assert.equal(P.mergeProgress("wins", 3, 7), 7);
});

test("mergeProgress: bestSeconds keeps the faster non-zero time", () => {
  assert.equal(P.mergeProgress("bestSeconds", 45, 90), 45);
  assert.equal(P.mergeProgress("bestSeconds", 0, 90), 90, "0 means unset, not instant");
  assert.equal(P.mergeProgress("bestSeconds", 45, 0), 45);
});

test("mergeProgress: badges union without duplicates", () => {
  const out = P.mergeProgress("badges", ["fast", "first_win"], ["first_win", "falcon"]);
  assert.equal(out.length, 3);
  ["fast", "first_win", "falcon"].forEach(b => assert.ok(out.includes(b), `${b} survives the merge`));
});

test("mergeProgress: level masks OR together so no clear is lost", () => {
  const anon = P.maskSet(P.maskSet(0, 0), 1);
  const uid = P.maskSet(0, 7);
  const out = P.mergeProgress("lvl.wordle.mask", anon, uid);
  [0, 1, 7].forEach(lv => assert.equal(P.maskHas(out, lv), true, `level ${lv} survives`));
  assert.equal(P.maskHas(out, 2), false);
});

test("mergeProgress: ranks take the best tier per level", () => {
  const out = P.mergeProgress("lvl.amthal.rank", { 0: 4, 1: 1 }, { 0: 2, 2: 3 });
  assert.equal(out[0], 4, "anon's 👑 beats the account's 🥈");
  assert.equal(out[1], 1, "levels only anon has are carried over");
  assert.equal(out[2], 3, "levels only the account has are kept");
});

test("mergeProgress: scalar level keys keep the further-along value", () => {
  assert.equal(P.mergeProgress("lvl.bee.cleared", 8, 3), 8);
  assert.equal(P.mergeProgress("lvl.bee.level", 2, 11), 11);
  assert.equal(P.mergeProgress("lvl.bee.v", 2, 0), 2);
});

test("mergeProgress: unknown keys defer to the account", () => {
  assert.equal(P.mergeProgress("somethingNew", "anon", "account"), "account");
});

// ---------------------------------------------------------------------------
// Guess budgets
// ---------------------------------------------------------------------------
// Budgets are the one change that can make the game HARDER, so the invariants
// that keep them fair are asserted rather than trusted.

test("budgetFor: only the four newly-losable games have budgets", () => {
  const withBudget = ["spelling_bee", "amthal", "warmer", "lamha"];
  withBudget.forEach((g) => assert.ok(P.budgetFor(g, 0), `${g} must have a budget`));
  // wordle and connections already had their own loss condition
  ["wordle", "connections"].forEach((g) =>
    assert.equal(P.budgetFor(g, 0), null, `${g} must NOT get a second budget`));
});

test("budgets shrink across bands but never below a workable floor", () => {
  Object.keys(P.BUDGETS).forEach((g) => {
    const easy = P.budgetFor(g, 0).n;
    const med = P.budgetFor(g, 10).n;
    const hard = P.budgetFor(g, 20).n;
    assert.ok(easy > med && med > hard, `${g}: ${easy}/${med}/${hard} must decrease`);
    assert.ok(hard >= 5, `${g} hard budget ${hard} is too tight to be fair`);
  });
});

test("budgets are constant WITHIN a band (no mid-band cliff)", () => {
  Object.keys(P.BUDGETS).forEach((g) => {
    P.BANDS.forEach((b) => {
      const first = P.budgetFor(g, b.start).n;
      for (let lv = b.start; lv < b.start + b.size; lv++) {
        assert.equal(P.budgetFor(g, lv).n, first, `${g} L${lv} differs inside ${b.key}`);
      }
    });
  });
});

test("budgetFor clamps out-of-range levels instead of throwing", () => {
  assert.equal(P.budgetFor("amthal", -5).n, P.budgetFor("amthal", 0).n);
  assert.equal(P.budgetFor("amthal", 99).n, P.budgetFor("amthal", 20).n);
});
