// Content-integrity tests for the puzzle banks, validated through the bot's own
// builders (the same code that loads them into Supabase). No network.
// Mirrors the historical _test_bank.js but as assertion-based node:test cases.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test";
const { buildConnections, buildBee, buildWordle, normalizeArabic, sigOf } = require("../bot.js");

const root = path.join(__dirname, "..");
const readBank = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const exists = (rel) => fs.existsSync(path.join(root, rel));

test("connections bank: each puzzle builds to 16 words with no duplicates", (t) => {
  if (!exists("bank/connections.json")) return t.skip("bank/connections.json missing");
  const conns = readBank("bank/connections.json");
  assert.ok(conns.length > 0, "bank is non-empty");
  const sigs = new Set();
  conns.forEach((it, i) => {
    const row = buildConnections(it);
    assert.equal(row.payload.words.length, 16, `connections[${i}] must have 16 words`);
    const s = sigOf("connections", row);
    assert.ok(!sigs.has(s), `connections[${i}] is a duplicate puzzle`);
    sigs.add(s);
  });
});

test("spelling_bee bank: every word uses only board letters and includes the center", (t) => {
  if (!exists("bank/spelling_bee.json")) return t.skip("bank/spelling_bee.json missing");
  const bees = readBank("bank/spelling_bee.json");
  assert.ok(bees.length > 0, "bank is non-empty");
  bees.forEach((it, i) => {
    const row = buildBee(it);
    const center = normalizeArabic(it.center);
    const set = new Set(it.letters.map(normalizeArabic));
    for (const w of it.words) {
      const n = normalizeArabic(w);
      assert.ok(n.length >= 4, `bee[${i}] word "${w}" too short`);
      assert.ok(n.includes(center), `bee[${i}] word "${w}" missing center letter`);
      assert.ok([...n].every((c) => set.has(c)), `bee[${i}] word "${w}" uses letters off the board`);
    }
    assert.ok(row.solution.valid_words.length >= 4, `bee[${i}] has too few valid words`);
  });
});

test("missing_word bank: large, well-formed, fair, and non-repeating across the campaign", (t) => {
  if (!exists("bank/saudi/missing_word.json")) return t.skip("bank/saudi/missing_word.json missing");
  const items = readBank("bank/saudi/missing_word.json");

  // (3,4) size + per-difficulty minimums
  assert.ok(items.length >= 45, `bank must have >= 45 items, has ${items.length}`);
  const byDiff = { 0: 0, 1: 0, 2: 0 };

  const ids = new Set();
  const prompts = new Set();
  let proverbType = 0;
  // Presentation-Forms ranges catch reversed / broken (visually-shaped) Arabic.
  const presForms = /[ﭐ-﷿ﹰ-﻿]/;
  const checkAr = (s, where) => assert.ok(!presForms.test(String(s)), `missing_word ${where} contains reversed/broken Arabic`);

  items.forEach((it, i) => {
    const id = it.id || `#${i}`;
    // (1,2) unique ids and prompts
    assert.ok(it.id, `missing_word[${i}] missing id`);
    assert.ok(!ids.has(it.id), `missing_word duplicate id ${it.id}`);
    ids.add(it.id);
    assert.ok(!prompts.has(it.prompt), `missing_word[${id}] duplicate prompt`);
    prompts.add(it.prompt);

    const blanks = (String(it.prompt || "").match(/___/g) || []).length;
    assert.ok(blanks >= 1, `missing_word[${id}] prompt has no blank`);
    assert.ok([0, 1, 2].includes(it.difficulty), `missing_word[${id}] difficulty must be 0/1/2`);
    byDiff[it.difficulty]++;
    if (it.type === "proverb") proverbType++;

    // (12) Arabic not reversed/broken anywhere
    checkAr(it.prompt, `[${id}] prompt`);
    (it.options || []).forEach((o) => checkAr(o, `[${id}] option`));
    (it.hints || []).forEach((h) => checkAr(h, `[${id}] hint`));
    if (it.explain) checkAr(it.explain, `[${id}] explain`);

    // (5) blank count vs difficulty intent
    if (it.difficulty === 0) assert.equal(blanks, 1, `missing_word[${id}] easy must be 1 blank`);

    // (8) options non-empty, no dups, sane size
    assert.ok(Array.isArray(it.options) && it.options.length >= 4 && it.options.length <= 8, `missing_word[${id}] needs 4..8 options`);
    const opts = it.options.map(normalizeArabic);
    assert.equal(new Set(opts).size, opts.length, `missing_word[${id}] has duplicate options`);
    assert.equal(Array.isArray(it.hints) ? it.hints.length : 0, 3, `missing_word[${id}] needs exactly 3 hints`);
    // hints are surfaced to the player (graded L1->L3) — must be non-empty + distinct
    const hs = (it.hints || []).map((h) => String(h).trim());
    hs.forEach((h, k) => assert.ok(h.length > 0, `missing_word[${id}] hint[${k}] is empty`));
    assert.equal(new Set(hs).size, hs.length, `missing_word[${id}] has duplicate hints`);
    // no option may equal the answer text other than the answer itself (single-blank)
    if (!Array.isArray(it.answers)) {
      const dupAns = opts.filter((o) => o === normalizeArabic(it.answer)).length;
      assert.equal(dupAns, 1, `missing_word[${id}] answer appears ${dupAns}x in options`);
    }

    if (Array.isArray(it.answers)) {
      // (6,7) multi-blank: one answer per blank, each in the pool, accepted covers it
      assert.equal(it.answers.length, blanks, `missing_word[${id}] answers.length != #blanks`);
      assert.ok(it.options.length >= blanks + 1, `missing_word[${id}] pool too small for blanks`);
      it.answers.forEach((ans, b) => {
        const n = normalizeArabic(ans);
        assert.ok(opts.includes(n), `missing_word[${id}] answer[${b}] not in options`);
        const acc = (it.accepted && it.accepted[b] && it.accepted[b].length ? it.accepted[b] : [ans]).map(normalizeArabic);
        assert.ok(acc.includes(n), `missing_word[${id}] accepted[${b}] omits its answer`);
      });
    } else {
      assert.equal(blanks, 1, `missing_word[${id}] single-blank item has ${blanks} blanks`);
      assert.ok(it.answer, `missing_word[${id}] missing answer`);
      const ans = normalizeArabic(it.answer);
      assert.ok(opts.includes(ans), `missing_word[${id}] answer not among options`);
      const accepted = (it.accepted && it.accepted.length ? it.accepted : [it.answer]).map(normalizeArabic);
      assert.ok(accepted.includes(ans), `missing_word[${id}] accepted[] omits the answer`);
    }
  });

  // (4) each difficulty has >= 15 items
  assert.ok(byDiff[0] >= 15, `expected >= 15 easy, got ${byDiff[0]}`);
  assert.ok(byDiff[1] >= 15, `expected >= 15 medium, got ${byDiff[1]}`);
  assert.ok(byDiff[2] >= 15, `expected >= 15 hard, got ${byDiff[2]}`);

  // (9) classic proverbs (type === 'proverb') are a minority: <= 25%
  assert.ok(proverbType <= Math.floor(items.length * 0.25), `proverb-type items ${proverbType} exceed 25% of ${items.length}`);

  // (10,11) campaign of 21 levels produces NO repeated ids. Mirrors the module's
  // greedy band-based unique assignment (band map: 0-2 easy, 3-8 medium, 9-20 hard).
  const buckets = { 0: [], 1: [], 2: [] };
  items.forEach((it, idx) => buckets[it.difficulty].push(idx));
  const cur = { 0: 0, 1: 0, 2: 0 };
  const used = new Set();
  const take = (d) => { const a = buckets[d]; while (cur[d] < a.length) { const k = a[cur[d]++]; if (!used.has(k)) return k; } return -1; };
  const seen = new Set();
  for (let lv = 0; lv < 21; lv++) {
    const band = lv <= 2 ? 0 : lv <= 8 ? 1 : 2;
    let pick = take(band);
    if (pick < 0) for (const d of [band + 1, band - 1, band + 2, band - 2]) { if (d >= 0 && d <= 2) { pick = take(d); if (pick >= 0) break; } }
    assert.ok(pick >= 0, `campaign level ${lv}: bank ran out of unique items`);
    used.add(pick);
    const pid = items[pick].id;
    assert.ok(!seen.has(pid), `campaign level ${lv} repeats id ${pid}`);
    seen.add(pid);
  }
  assert.equal(seen.size, 21, "campaign must fill 21 unique levels");
});

test("story_order bank: well-formed, fair, ordered, and non-repeating across the campaign", (t) => {
  if (!exists("bank/saudi/story_order.json")) return t.skip("bank/saudi/story_order.json missing");
  const items = readBank("bank/saudi/story_order.json");

  // (2) size + (3) per-difficulty minimums
  assert.ok(items.length >= 21, `bank must have >= 21 items, has ${items.length}`);
  const byDiff = { 0: 0, 1: 0, 2: 0 };
  const FRAGS_FOR = { 0: 3, 1: 4, 2: 5 }; // (4,5,6) easy=3, medium=4, hard=5

  const ids = new Set();
  const titles = new Set();
  const fragSigs = new Set();
  const presForms = /[ﭐ-﷿ﹰ-﻿]/; // (15) reversed / broken (presentation-forms) Arabic
  const checkAr = (s, where) => assert.ok(!presForms.test(String(s)), `story_order ${where} contains reversed/broken Arabic`);

  items.forEach((it, i) => {
    const id = it.id || `#${i}`;
    // (7) unique ids, (8) unique titles
    assert.ok(it.id, `story_order[${i}] missing id`);
    assert.ok(!ids.has(it.id), `story_order duplicate id ${it.id}`);
    ids.add(it.id);
    assert.ok(it.title, `story_order[${id}] missing title`);
    assert.ok(!titles.has(it.title), `story_order[${id}] duplicate title`);
    titles.add(it.title);

    assert.ok([0, 1, 2].includes(it.difficulty), `story_order[${id}] difficulty must be 0/1/2`);
    byDiff[it.difficulty]++;

    const frags = it.fragments;
    assert.ok(Array.isArray(frags) && frags.length >= 3, `story_order[${id}] needs >= 3 fragments`);
    // (4,5,6) fragment count matches difficulty intent
    assert.equal(frags.length, FRAGS_FOR[it.difficulty], `story_order[${id}] diff ${it.difficulty} must have ${FRAGS_FOR[it.difficulty]} fragments`);

    // (13) no ambiguous duplicate fragments within a puzzle (an exact dup = two
    // cards that could swap without changing meaning)
    const fnorm = frags.map(normalizeArabic);
    assert.equal(new Set(fnorm).size, fnorm.length, `story_order[${id}] has duplicate fragments`);

    // (9) no duplicate fragment SETS across puzzles
    const sig = fnorm.slice().sort().join("|");
    assert.ok(!fragSigs.has(sig), `story_order[${id}] duplicates another puzzle's fragment set`);
    fragSigs.add(sig);

    // (12) answer_order is a valid permutation of all fragment indices
    const ao = it.answer_order;
    assert.ok(Array.isArray(ao) && ao.length === frags.length, `story_order[${id}] answer_order length mismatch`);
    assert.deepEqual([...ao].sort((a, b) => a - b), frags.map((_, k) => k), `story_order[${id}] answer_order is not a valid permutation`);

    // (10) exactly 3 hints, non-empty + distinct (surfaced graded L1->L3)
    assert.equal(Array.isArray(it.hints) ? it.hints.length : 0, 3, `story_order[${id}] needs exactly 3 hints`);
    const hs = it.hints.map((h) => String(h).trim());
    hs.forEach((h, k) => assert.ok(h.length > 0, `story_order[${id}] hint[${k}] is empty`));
    assert.equal(new Set(hs).size, hs.length, `story_order[${id}] has duplicate hints`);

    // (11) explanation exists
    assert.ok(it.explanation && String(it.explanation).trim().length > 0, `story_order[${id}] missing explanation`);

    // (15) Arabic not reversed/broken anywhere
    checkAr(it.title, `[${id}] title`);
    frags.forEach((f) => checkAr(f, `[${id}] fragment`));
    hs.forEach((h) => checkAr(h, `[${id}] hint`));
    checkAr(it.explanation, `[${id}] explanation`);
  });

  // (3) each difficulty has >= 7 items
  assert.ok(byDiff[0] >= 7, `expected >= 7 easy, got ${byDiff[0]}`);
  assert.ok(byDiff[1] >= 7, `expected >= 7 medium, got ${byDiff[1]}`);
  assert.ok(byDiff[2] >= 7, `expected >= 7 hard, got ${byDiff[2]}`);

  // (14) campaign of 21 levels produces NO repeated ids. Mirrors the module's
  // greedy band-based unique assignment (bands: 0-2 easy, 3-8 medium, 9-20 hard).
  const buckets = { 0: [], 1: [], 2: [] };
  items.forEach((it, idx) => buckets[it.difficulty].push(idx));
  const cur = { 0: 0, 1: 0, 2: 0 };
  const used = new Set();
  const take = (d) => { const a = buckets[d]; while (cur[d] < a.length) { const k = a[cur[d]++]; if (!used.has(k)) return k; } return -1; };
  const seen = new Set();
  for (let lv = 0; lv < 21; lv++) {
    const band = lv <= 2 ? 0 : lv <= 8 ? 1 : 2;
    let pick = take(band);
    if (pick < 0) for (const d of [band + 1, band - 1, band + 2, band - 2]) { if (d >= 0 && d <= 2) { pick = take(d); if (pick >= 0) break; } }
    assert.ok(pick >= 0, `campaign level ${lv}: bank ran out of unique items`);
    used.add(pick);
    const pid = items[pick].id;
    assert.ok(!seen.has(pid), `campaign level ${lv} repeats id ${pid}`);
    seen.add(pid);
  }
  assert.equal(seen.size, 21, "campaign must fill 21 unique levels");
});

test("warmer bank: well-formed closeness tiers, fair, and non-repeating across the campaign", (t) => {
  if (!exists("bank/saudi/warmer.json")) return t.skip("bank/saudi/warmer.json missing");
  const items = readBank("bank/saudi/warmer.json");

  assert.ok(items.length >= 21, `bank must have >= 21 items, has ${items.length}`);
  const byDiff = { 0: 0, 1: 0, 2: 0 };
  const ids = new Set();
  const targets = new Set();
  const presForms = /[ﭐ-﷿ﹰ-﻿]/;
  const checkAr = (s, where) => assert.ok(!presForms.test(String(s)), `warmer ${where} contains reversed/broken Arabic`);

  items.forEach((it, i) => {
    const id = it.id || `#${i}`;
    assert.ok(it.id, `warmer[${i}] missing id`);
    assert.ok(!ids.has(it.id), `warmer duplicate id ${it.id}`);
    ids.add(it.id);
    assert.ok(it.target, `warmer[${id}] missing target`);
    const tnorm = normalizeArabic(it.target);
    assert.ok(!targets.has(tnorm), `warmer[${id}] duplicate target`);
    targets.add(tnorm);

    assert.ok([0, 1, 2].includes(it.difficulty), `warmer[${id}] difficulty must be 0/1/2`);
    byDiff[it.difficulty]++;

    // accepted includes the target (normalized)
    const accepted = (it.accepted && it.accepted.length ? it.accepted : [it.target]).map(normalizeArabic);
    assert.ok(accepted.includes(tnorm), `warmer[${id}] accepted[] omits the target`);

    // tiers 2/1/0 all present + non-empty; the target may NOT sit in any tier;
    // and no word repeats across tiers (a word can't be two warmths at once).
    const t = it.tiers || {};
    const all = [];
    [2, 1, 0].forEach((k) => {
      const arr = (t[k] || t[String(k)] || []).map(normalizeArabic);
      assert.ok(arr.length >= 1, `warmer[${id}] tier ${k} is empty`);
      assert.equal(new Set(arr).size, arr.length, `warmer[${id}] tier ${k} has duplicate words`);
      arr.forEach((w) => {
        assert.ok(w !== tnorm, `warmer[${id}] target appears inside tier ${k}`);
        assert.ok(!accepted.includes(w), `warmer[${id}] an accepted variant sits in tier ${k}`);
      });
      all.push(...arr);
    });
    assert.equal(new Set(all).size, all.length, `warmer[${id}] a word appears in more than one tier`);

    // 3 graded hints (surfaced to the player), non-empty + distinct
    assert.equal(Array.isArray(it.hints) ? it.hints.length : 0, 3, `warmer[${id}] needs exactly 3 hints`);
    const hs = it.hints.map((h) => String(h).trim());
    hs.forEach((h, k) => assert.ok(h.length > 0, `warmer[${id}] hint[${k}] is empty`));
    assert.equal(new Set(hs).size, hs.length, `warmer[${id}] has duplicate hints`);
    assert.ok(it.explain && String(it.explain).trim().length > 0, `warmer[${id}] missing explain`);
    assert.ok(it.theme && String(it.theme).trim().length > 0, `warmer[${id}] missing theme`);

    checkAr(it.target, `[${id}] target`);
    checkAr(it.theme, `[${id}] theme`);
    all.forEach((w) => checkAr(w, `[${id}] tier word`));
    hs.forEach((h) => checkAr(h, `[${id}] hint`));
    checkAr(it.explain, `[${id}] explain`);
  });

  // one item per level of each band (6/9/6) or buildAssign spills across bands.
  assert.ok(byDiff[0] >= 6, `expected >= 6 easy, got ${byDiff[0]}`);
  assert.ok(byDiff[1] >= 9, `expected >= 9 medium, got ${byDiff[1]}`);
  assert.ok(byDiff[2] >= 6, `expected >= 6 hard, got ${byDiff[2]}`);

  // campaign of 21 levels produces NO repeated ids (greedy band assignment).
  const buckets = { 0: [], 1: [], 2: [] };
  items.forEach((it, idx) => buckets[it.difficulty].push(idx));
  const cur = { 0: 0, 1: 0, 2: 0 };
  const used = new Set();
  const take = (d) => { const a = buckets[d]; while (cur[d] < a.length) { const k = a[cur[d]++]; if (!used.has(k)) return k; } return -1; };
  const seen = new Set();
  for (let lv = 0; lv < 21; lv++) {
    const band = lv <= 2 ? 0 : lv <= 8 ? 1 : 2;
    let pick = take(band);
    if (pick < 0) for (const d of [band + 1, band - 1, band + 2, band - 2]) { if (d >= 0 && d <= 2) { pick = take(d); if (pick >= 0) break; } }
    assert.ok(pick >= 0, `campaign level ${lv}: bank ran out of unique items`);
    used.add(pick);
    const pid = items[pick].id;
    assert.ok(!seen.has(pid), `campaign level ${lv} repeats id ${pid}`);
    seen.add(pid);
  }
  assert.equal(seen.size, 21, "campaign must fill 21 unique levels");
});

test("lamha bank: well-formed 3-clue progressive puzzles, fair, and non-repeating across the campaign", (t) => {
  if (!exists("bank/saudi/lamha.json")) return t.skip("bank/saudi/lamha.json missing");
  const items = readBank("bank/saudi/lamha.json");

  assert.ok(items.length >= 21, `bank must have >= 21 items, has ${items.length}`);
  const byDiff = { 0: 0, 1: 0, 2: 0 };
  const ids = new Set();
  const answers = new Set();
  const presForms = /[ﭐ-﷿ﹰ-﻿]/;
  const checkAr = (s, where) => assert.ok(!presForms.test(String(s)), `lamha ${where} contains reversed/broken Arabic`);

  items.forEach((it, i) => {
    const id = it.id || `#${i}`;
    assert.ok(it.id, `lamha[${i}] missing id`);
    assert.ok(!ids.has(it.id), `lamha duplicate id ${it.id}`);
    ids.add(it.id);
    assert.ok(it.answer, `lamha[${id}] missing answer`);
    const anorm = normalizeArabic(it.answer);
    assert.ok(!answers.has(anorm), `lamha[${id}] duplicate answer`);
    answers.add(anorm);

    assert.ok([0, 1, 2].includes(it.difficulty), `lamha[${id}] difficulty must be 0/1/2`);
    byDiff[it.difficulty]++;

    // accepted[] includes the answer (normalized)
    const accepted = (it.accepted && it.accepted.length ? it.accepted : [it.answer]).map(normalizeArabic);
    assert.ok(accepted.includes(anorm), `lamha[${id}] accepted[] omits the answer`);

    // exactly 3 clues, non-empty + distinct; the answer must NOT appear verbatim in a clue.
    assert.ok(Array.isArray(it.clues) && it.clues.length === 3, `lamha[${id}] needs exactly 3 clues`);
    const cs = it.clues.map((c) => String(c).trim());
    cs.forEach((c, k) => {
      assert.ok(c.length > 0, `lamha[${id}] clue[${k}] is empty`);
      assert.ok(!normalizeArabic(c).includes(anorm), `lamha[${id}] clue[${k}] leaks the answer`);
    });
    assert.equal(new Set(cs).size, cs.length, `lamha[${id}] has duplicate clues`);

    assert.ok(it.explain && String(it.explain).trim().length > 0, `lamha[${id}] missing explain`);

    checkAr(it.answer, `[${id}] answer`);
    cs.forEach((c, k) => checkAr(c, `[${id}] clue[${k}]`));
    checkAr(it.explain, `[${id}] explain`);
  });

  // one item per level of each band (6/9/6) or buildAssign spills across bands.
  assert.ok(byDiff[0] >= 6, `expected >= 6 easy, got ${byDiff[0]}`);
  assert.ok(byDiff[1] >= 9, `expected >= 9 medium, got ${byDiff[1]}`);
  assert.ok(byDiff[2] >= 6, `expected >= 6 hard, got ${byDiff[2]}`);

  // campaign of 21 levels produces NO repeated ids (greedy band assignment).
  const buckets = { 0: [], 1: [], 2: [] };
  items.forEach((it, idx) => buckets[it.difficulty].push(idx));
  const cur = { 0: 0, 1: 0, 2: 0 };
  const used = new Set();
  const take = (d) => { const a = buckets[d]; while (cur[d] < a.length) { const k = a[cur[d]++]; if (!used.has(k)) return k; } return -1; };
  const seen = new Set();
  for (let lv = 0; lv < 21; lv++) {
    const band = lv <= 2 ? 0 : lv <= 8 ? 1 : 2;
    let pick = take(band);
    if (pick < 0) for (const d of [band + 1, band - 1, band + 2, band - 2]) { if (d >= 0 && d <= 2) { pick = take(d); if (pick >= 0) break; } }
    assert.ok(pick >= 0, `campaign level ${lv}: bank ran out of unique items`);
    used.add(pick);
    const pid = items[pick].id;
    assert.ok(!seen.has(pid), `campaign level ${lv} repeats id ${pid}`);
    seen.add(pid);
  }
  assert.equal(seen.size, 21, "campaign must fill 21 unique levels");
});

test("wordle bank: board length matches the word and is at least 4", (t) => {
  if (!exists("bank/wordle.json")) return t.skip("bank/wordle.json missing");
  const words = readBank("bank/wordle.json");
  assert.ok(words.length > 0, "bank is non-empty");
  words.forEach((it, i) => {
    const row = buildWordle(it);
    assert.equal(row.payload.length, [...it.word].length, `wordle[${i}] length mismatch`);
    assert.ok(row.payload.length >= 4, `wordle[${i}] word too short for the board`);
  });
});
