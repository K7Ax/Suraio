// core/checks — the programmatic gate every daily puzzle passes before a human
// (or Groq) ever looks at it.
//
// WHY IT EXISTS, AND WHY IT IS NOT AN LLM: the temptation with a monthly
// generator is to let a model both write and vet the puzzles. Two facts in this
// repo say otherwise. CONSTITUTION §8 forbids AI authoring a level. And we have
// already shipped the bug: a language model asked for Arabic words invents ones
// that look plausible and do not exist (fixed in Round 4 by making «نحلة»
// strict-dictionary). Code proves membership, connectivity and uniqueness;
// a model cannot beat `Set.has` at any of them. So: code generates and gates,
// Groq only judges the things that are genuinely semantic — cross-category
// ambiguity, cultural exclusion, clue quality — and only on rows that already
// passed everything here.
//
// ONE COPY, THREE CONSUMERS. bot.js imports this, tests/checks.test.js imports
// this. It is deliberately NOT duplicated into bot.js: that is exactly how the
// three normalizers drifted, which is why tests/normalize.test.js exists.
//
// normalizeArabic is INJECTED via ctx.norm rather than imported. core/util.js is
// a plain .js ESM file that node cannot load (package.json has no "type":
// "module"), and re-implementing the folding here would recreate the drift this
// file is supposed to prevent. Callers pass their own canonical copy; if those
// ever diverge, tests/normalize.test.js catches it first.

// How long a piece of content SHOULD rest before it is reused as a daily.
//
// THIS IS A TARGET, NOT A GATE — and that is a correction I made after measuring,
// not a softening. I first enforced it as a hard error. Then I ran the real
// rotation over a year and it rejected most of the calendar, for a reason no
// checker can fix: each game now runs ~104 times a year, and a band's bucket
// holds what the bank holds. «نحلة» band 2 has TWO boards, so it returns every
// 7 days no matter how cleverly it is selected. Failing the row would block the
// month over a content shortage while saying nothing about which bank to grow.
//
// So selection does the most that is possible — core/resolve.mjs walks each
// bucket in order, so nothing repeats until every peer has run (measured: wordle
// 97 days, connections 42, amthal/warmer 49, lamha 42, bee 7) — and falling short
// of the target here is reported as a ⚠ carrying the real number. The owner can
// then act on the only thing that would actually help: more content.
export const REUSE_WINDOW_DAYS = {
    wordle: 90, spelling_bee: 90, letterboxed: 90, strands: 90,
    connections: 30, amthal: 60, lamha: 60, warmer: 60
};

// THE NUMBER IS ARITHMETIC, NOT TASTE. A month gives a band up to 13 days (the
// hard tier owns خميس·جمعة·سبت), and a bucket of n against 13 days repeats
// 13 − n times. So a band needs 14 items to carry one clean month with a spare,
// and anything under that WILL repeat — which is what the owner saw.
//
// This was 3, which only caught the degenerate case (1 item = the same board
// every time). At 3 it stayed silent through the twenty-three duplicate «نحلة»
// boards in August 2026, so it read as a healthy month right up until someone
// played it. A warning that only fires when the failure is already total is not
// an early warning.
export const THIN_BUCKET = 14;

// THE BOARD «نحلة» ACTUALLY PLAYS IS INLINE IN bee.js:55 — eight hand-curated
// boards of 7–12 words. `serverMode` is hard-coded false (bee.js:296,344), so
// bank/**/spelling_bee.json never reaches a player; it only feeds puzzle_bank
// through the bot's /seedall. My first threshold of 15 was measured against
// those unused JSON files and would have made «نحلة» permanently unschedulable
// as a daily — a gate is worthless if it rejects the only content that exists.
// So the floor is the live bank's floor, and thinness is a warning instead.
export const BEE_MIN_WORDS = 7;
export const BEE_THIN_WORDS = 12;   // ⚠ below this a level goal has little room

// Letter Boxed par. See gateLetterBoxed.
export const LB_MAX_WORDS = 3;

// Games that can appear as a daily. Anything else fails closed — a daily row
// for a game with no gate must never publish just because nobody wrote a rule.
export const CHECKABLE = Object.keys(REUSE_WINDOW_DAYS);

const need = (ctx) => {
    if (!ctx || typeof ctx.norm !== 'function') {
        throw new Error('checks: ctx.norm (normalizeArabic) is required');
    }
    return ctx.norm;
};
const chars = s => [...String(s || '')];
const uniq = a => new Set(a);

// ---------------------------------------------------------------------------
// Signatures — the identity used for "has this run recently?"
// ---------------------------------------------------------------------------
// Deliberately content-based, not id-based: the same board reached through a
// different bank index is still the same board to the player.
export function signature(gameType, p, norm) {
    const n = norm;
    switch (gameType) {
        case 'wordle':       return 'w|' + n(p.word);
        case 'connections':  return 'c|' + (p.groups || []).map(g => n(g.theme)).sort().join(',');
        case 'spelling_bee': return 'b|' + n(p.center) + '|' + (p.letters || []).map(n).sort().join('');
        case 'letterboxed':  return 'lb|' + (p.sides || []).flat().map(n).sort().join('');
        case 'strands':      return 'st|' + n(p.theme);
        case 'amthal':       return 'am|' + n(p.proverb);
        case 'lamha':        return 'lm|' + n(p.answer);
        case 'warmer':       return 'wr|' + n(p.target);
        default:             return '?|' + JSON.stringify(p || {});
    }
}

// ---------------------------------------------------------------------------
// Per-game gates
// ---------------------------------------------------------------------------
// Each returns an array of error strings. Empty array = gate passed.
// Errors are Arabic because they surface verbatim in the Telegram /schedule
// table, which the owner reads.

function gateWordle(p, ctx, want) {
    const n = need(ctx), e = [];
    const w = n(p.word);
    if (!w) return ['لا كلمة'];
    if (ctx.dict && !ctx.dict.has(w)) e.push(`«${p.word}» ليست في المعجم`);
    if (want.len && chars(w).length !== want.len) {
        e.push(`الطول ${chars(w).length} والمطلوب ${want.len} لهذا النطاق`);
    }
    // Three of the same letter in a 4–6 letter word leaves almost nothing to
    // deduce; the grid stops being informative.
    const tally = {};
    for (const c of chars(w)) tally[c] = (tally[c] || 0) + 1;
    const worst = Math.max(0, ...Object.values(tally));
    if (worst > 2) e.push(`الحرف «${Object.keys(tally).find(k => tally[k] === worst)}» يتكرّر ${worst} مرّات`);

    const hint = String(p.hint || '').trim();
    if (!hint) e.push('لا تلميح');
    if (hint.length > 60) e.push(`التلميح ${hint.length} حرفًا (الحدّ ٦٠)`);
    // A hint that contains the answer — or any 3-letter run of it — is not a
    // hint. This is the «مافادني بشي» failure in authoring form.
    const nh = n(hint);
    if (nh && nh.includes(w)) e.push('التلميح يحوي الكلمة نفسها');
    else for (let i = 0; i + 3 <= chars(w).length; i++) {
        const run = chars(w).slice(i, i + 3).join('');
        if (nh.includes(run)) { e.push(`التلميح يحوي مقطعًا من الكلمة: «${run}»`); break; }
    }
    return e;
}

function gateConnections(p, ctx) {
    const n = need(ctx), e = [];
    const groups = p.groups || [];
    if (groups.length !== 4) return [`${groups.length} مجموعات والمطلوب ٤`];
    const all = [];
    groups.forEach((g, i) => {
        if (!g.theme) e.push(`المجموعة ${i + 1}: بلا عنوان`);
        if (!Array.isArray(g.words) || g.words.length !== 4) e.push(`المجموعة ${i + 1}: ${(g.words || []).length} كلمات والمطلوب ٤`);
        else all.push(...g.words.map(n));
    });
    if (all.length === 16 && uniq(all).size !== 16) e.push('كلمةٌ مكرّرة بين مجموعتين — حلٌّ بديل');

    // THE ambiguity gate, and the reason connections needs one at all. A decoy
    // is only a decoy if it belongs to NO group on this board. Worse: if it is
    // a member of some OTHER bank group that shares a word with a chosen group,
    // the player can build a defensible second grouping — the Constitution's
    // hard violation #1 (an unintended alternative solution).
    const chosen = new Set(all);
    const decoys = (p.decoys || []).map(n);
    for (const d of decoys) {
        if (chosen.has(d)) { e.push(`المموّه «${d}» عضوٌ في مجموعةٍ على اللوح`); continue; }
        for (const g of (ctx.groupPool || [])) {
            const gw = (g.words || []).map(n);
            if (!gw.includes(d)) continue;
            if (gw.some(w => chosen.has(w))) {
                e.push(`المموّه «${d}» يشترك مع مجموعة «${g.theme}» في كلمةٍ على اللوح — التباس`);
                break;
            }
        }
    }
    if (uniq(decoys).size !== decoys.length) e.push('مموّهٌ مكرّر');
    return e;
}

function gateBee(p, ctx, warn) {
    const n = need(ctx), e = [];
    const letters = (p.letters || []).map(n);
    const center = n(p.center);
    if (letters.length !== 7) e.push(`${letters.length} حروف والمطلوب ٧`);
    if (uniq(letters).size !== letters.length) e.push('حرفٌ مكرّر');
    if (!center || !letters.includes(center)) e.push('الحرف الأوسط ليس ضمن السبعة');

    const set = new Set(letters);
    const words = (p.words || []).map(n).filter(Boolean);
    const bad = [];
    for (const w of words) {
        if (chars(w).length < 4) bad.push(`${w}: أقصر من ٤`);
        else if (!w.includes(center)) bad.push(`${w}: بلا الحرف الأوسط`);
        else if (!chars(w).every(c => set.has(c))) bad.push(`${w}: حرفٌ غير متاح`);
        else if (ctx.dict && !ctx.dict.has(w)) bad.push(`${w}: ليست في المعجم`);
    }
    if (bad.length) e.push(`كلماتٌ مرفوضة (${bad.length}): ` + bad.slice(0, 4).join('، '));
    const good = words.length - bad.length;
    if (good < BEE_MIN_WORDS) e.push(`${good} كلمات صالحة والحدّ الأدنى ${BEE_MIN_WORDS}`);
    else if (good < BEE_THIN_WORDS) warn.push(`لوحٌ نحيل: ${good} كلمات فقط (bee.js:51)`);
    // NO PANGRAM GATE, deliberately. bank/words_ar.json holds no word longer
    // than 6 letters, so a word using all 7 board letters cannot exist on this
    // dictionary — measured: 0 of 32 shipped boards, max 6 distinct letters.
    // bee.js:46-49 already documents this and ANDs the hard-band pangram goal
    // with `boardHasPangram` so it self-disables. Gating on it here would make
    // every hard-band daily unschedulable for a requirement the game itself
    // waives. It is reported as a fact, never as a failure.
    return e;
}

function gateLetterBoxed(p, ctx) {
    const n = need(ctx), e = [];
    const sides = p.sides || [];
    if (sides.length !== 4 || sides.some(s => !Array.isArray(s) || s.length !== 3)) {
        return ['البنية ليست ٤ جهات × ٣ حروف'];
    }
    const flat = sides.flat().map(n);
    if (uniq(flat).size !== 12) e.push('الحروف الاثنا عشر ليست فريدة');

    const sideOf = {};
    sides.forEach((s, i) => s.map(n).forEach(c => { sideOf[c] = i; }));

    const sol = (p.solution || []).map(n).filter(Boolean);
    if (!sol.length) return e.concat('لا حلّ مرفق');
    // Par is THREE, not two. gen_letterboxed_saudi.js tries a 2-word solution
    // first "for a cleaner identity" and falls back to 3 (:85-104) — and all 78
    // shipped boards land on 3. A two-word cap rejected every one of them.
    if (sol.length > LB_MAX_WORDS) e.push(`الحلّ ${sol.length} كلمات والحدّ ${LB_MAX_WORDS}`);
    for (const w of sol) {
        const cs = chars(w);
        for (const c of cs) if (sideOf[c] === undefined) { e.push(`«${w}»: الحرف «${c}» ليس على اللوح`); break; }
        // The whole game: consecutive letters must come from DIFFERENT sides.
        for (let i = 0; i + 1 < cs.length; i++) {
            if (sideOf[cs[i]] !== undefined && sideOf[cs[i]] === sideOf[cs[i + 1]]) {
                e.push(`«${w}»: «${cs[i]}${cs[i + 1]}» من ضلعٍ واحد`); break;
            }
        }
        if (ctx.dict && !ctx.dict.has(w)) e.push(`«${w}» ليست في المعجم`);
    }
    // Chain rule: each word starts with the previous word's last letter.
    for (let i = 1; i < sol.length; i++) {
        const prev = chars(sol[i - 1]), cur = chars(sol[i]);
        if (prev[prev.length - 1] !== cur[0]) e.push(`«${sol[i]}» لا تبدأ بآخر حرفٍ من «${sol[i - 1]}»`);
    }
    const used = new Set(sol.flatMap(chars));
    const missing = flat.filter(c => !used.has(c));
    if (missing.length) e.push(`الحلّ لا يستعمل: ${missing.join('، ')}`);
    return e;
}

function gateStrands(p, ctx, warn) {
    const n = need(ctx), e = [];
    const rows = p.rows | 0, cols = p.cols | 0;
    const grid = p.grid || [];
    if (!rows || !cols || grid.length !== rows) return ['أبعاد الشبكة غير متّسقة'];
    if (grid.some(r => chars(r).length !== cols)) return ['صفٌّ بطولٍ مخالف'];

    const spangram = n(p.spangram);
    const words = [spangram, ...(p.words || []).map(n)];
    // Bank files key placements by the raw word; the game looks them up by the
    // NORMALIZED one (strands.js:52). Fold the map once so a board whose keys
    // carry a hamza or an ى can never look like a missing placement here while
    // working (or failing) differently in the browser.
    const placements = {};
    for (const [k, v] of Object.entries(p.placements || {})) placements[n(k)] = v;
    const seen = new Map();   // "r,c" -> word

    for (const w of words) {
        const path = placements[w];
        if (!Array.isArray(path) || !path.length) { e.push(`«${w}»: بلا موضع`); continue; }
        if (path.length !== chars(w).length) e.push(`«${w}»: طول المسار ${path.length} وطول الكلمة ${chars(w).length}`);
        for (let i = 0; i < path.length; i++) {
            const [r, c] = path[i];
            if (r < 0 || r >= rows || c < 0 || c >= cols) { e.push(`«${w}»: خانةٌ خارج الشبكة`); break; }
            const key = `${r},${c}`;
            if (seen.has(key)) e.push(`«${w}» تتقاطع مع «${seen.get(key)}» عند (${r},${c})`);
            seen.set(key, w);
            // 8-neighbour contiguity — the rule the player is actually obeying
            if (i > 0) {
                const [pr, pc] = path[i - 1];
                if (Math.abs(pr - r) > 1 || Math.abs(pc - c) > 1 || (pr === r && pc === c)) {
                    e.push(`«${w}»: قفزةٌ غير مجاورة عند الحرف ${i + 1}`);
                }
            }
            // the grid must actually spell the word along that path
            const ch = chars(grid[r])[c];
            if (n(ch) !== chars(w)[i]) e.push(`«${w}»: الشبكة تحمل «${ch}» حيث يجب «${chars(w)[i]}»`);
        }
    }
    // COVERAGE AND SPANNING ARE WARNINGS, NOT ERRORS — and that is a correction,
    // not a compromise. I first wrote them as hard gates from the NYT Strands
    // rules and they rejected all 30 shipped boards. Sura's generator explicitly
    // does something else: gen_strands.js:3 fills "remaining cells with common
    // Arabic letters", and its randomized DFS never asks the spangram to touch
    // opposite edges. Gating on rules the game does not implement is not a
    // quality bar, it is a broken checker. They stay visible because both would
    // genuinely improve the game — but they are the owner's call, in gen_strands,
    // not something the daily pipeline gets to block on.
    if (seen.size !== rows * cols) {
        warn.push(`التغطية ${seen.size} من ${rows * cols} خانة — الباقي حروف حشو`);
    }
    const sp = placements[spangram] || [];
    if (sp.length) {
        const rs = sp.map(x => x[0]), cs = sp.map(x => x[1]);
        const spansV = Math.min(...rs) === 0 && Math.max(...rs) === rows - 1;
        const spansH = Math.min(...cs) === 0 && Math.max(...cs) === cols - 1;
        if (!spansV && !spansH) warn.push('الكلمة الجامعة لا تصل بين ضلعين متقابلين');
    }
    return e;
}

// amthal / lamha / warmer are SELECTED from curated banks, not authored fresh.
// So the gate is about selection integrity, not content: the item must exist,
// sit in the right difficulty bucket, and its accepted-answer list must
// actually contain its own answer after folding (a real class of typo that
// makes a level unwinnable).
function gateBankItem(gameType, p, ctx, band) {
    const n = need(ctx), e = [];
    const answerKey = { amthal: 'proverb', lamha: 'answer', warmer: 'target' }[gameType];
    const answer = n(p[answerKey]);
    if (!answer) return [`لا ${answerKey}`];

    if (Array.isArray(ctx.bank)) {
        const hit = ctx.bank.some(it => n(it[answerKey]) === answer);
        if (!hit) e.push(`«${p[answerKey]}» ليست في البنك المُجمَّع — لن يجدها العميل`);
    }
    if (p.difficulty != null && band != null && (p.difficulty | 0) !== (band | 0)) {
        e.push(`صعوبة العنصر ${p.difficulty} ونطاق اليوم ${band}`);
    }
    if (Array.isArray(p.accepted) && p.accepted.length && !p.accepted.map(n).includes(answer)) {
        e.push('قائمة الأجوبة المقبولة لا تحوي الجواب نفسه — المستوى غير قابل للفوز');
    }
    if (gameType === 'lamha' && (p.clues || []).length < 2) e.push('أقلّ من لمحتين');
    if (gameType === 'warmer' && !p.tiers) e.push('لا سُلَّم حرارة');
    // THE ANSWER MAY NOT APPEAR IN ITS OWN HEAT LADDER. The tiers are the clue —
    // the player is shown «أدفأ / أبرد» words to triangulate from — so putting
    // the target itself among them hands over the answer for free.
    //
    // All 44 curated items honour this and none of them had to be told; it was
    // never written down, so nothing enforced it. A Groq proposal (2026-08-08)
    // put «نجم» in tier 2 of the item whose target was «نجم», passed every gate,
    // and would have shipped. An invariant that lives only in the head of
    // whoever wrote the bank is not an invariant.
    if (gameType === 'warmer' && p.tiers) {
        const acc = new Set([answer, ...(p.accepted || []).map(n)]);
        for (const [t, ws] of Object.entries(p.tiers)) {
            for (const w of (ws || [])) {
                if (acc.has(n(w))) e.push(`الجواب «${w}» نفسه في الطبقة ${t} — يُعطى مجّانًا`);
            }
        }
    }
    if (gameType === 'amthal' && !String(p.meaning || '').trim()) e.push('لا معنى للمثل — وهو التوجيه الوحيد');
    return e;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------
// check(gameType, puzzle, ctx) -> { ok, gates, errors, signature }
//
//   puzzle : the CONCRETE resolved board (recipe already expanded), in the same
//            shape the bank files use.
//   ctx    : { norm, dict?:Set, bank?:[], groupPool?:[], recentSigs?:Set,
//              band?:0|1|2, want?:{len} }
//
// Fails closed: an unknown game type is an error, never a silent pass.
export function check(gameType, puzzle, ctx = {}) {
    const norm = need(ctx);
    const p = puzzle || {};
    const band = ctx.band;
    const warnings = [];      // لا تمنع النشر، لكنها تظهر بـ⚠ في /schedule
    let errors;

    switch (gameType) {
        case 'wordle':       errors = gateWordle(p, ctx, ctx.want || {}); break;
        case 'connections':  errors = gateConnections(p, ctx); break;
        case 'spelling_bee': errors = gateBee(p, ctx, warnings); break;
        case 'letterboxed':  errors = gateLetterBoxed(p, ctx); break;
        case 'strands':      errors = gateStrands(p, ctx, warnings); break;
        case 'amthal':
        case 'lamha':
        case 'warmer':       errors = gateBankItem(gameType, p, ctx, band); break;
        default:
            return {
                ok: false, gates: {}, signature: null, warnings: [],
                errors: [`لا بوّابة فحصٍ للعبة «${gameType}» — لا تُنشَر بلا فحص`]
            };
    }

    const sig = signature(gameType, p, norm);
    // ⚠ not ✗ — see the note on REUSE_WINDOW_DAYS. The gap is a property of bank
    // size, and the rotation already extracts the maximum from what exists.
    if (ctx.recentSigs && ctx.recentSigs.has(sig)) {
        warnings.push(`تكرار: استُعمل خلال آخر ${REUSE_WINDOW_DAYS[gameType]} يومًا — البنك أصغر من أن يبلغ الهدف`);
    }
    if (ctx.bucketSize != null && ctx.bucketSize < THIN_BUCKET) {
        warnings.push(`نطاق ${band} في «${gameType}» فيه ${ctx.bucketSize} عنصر فقط — يتكرّر سريعًا`);
    }
    return {
        ok: errors.length === 0,
        gates: { [gameType]: errors.length === 0 },
        errors,
        warnings,
        signature: sig
    };
}
