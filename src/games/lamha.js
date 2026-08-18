// games/lamha (لمحة) — progressive-clue guessing. A hidden answer with 3 clues
// that get more revealing; the player TYPES a guess after any clue. Guess early
// on fewer clues for more stars (3⭐ after clue 1 · 2⭐ after clue 2 · 1⭐ after
// clue 3) — a real risk/reward bet. Wrong guesses are free; only revealing a new
// clue lowers the star ceiling. Fully client-side, deterministic, fair (single
// intended answer + accepted variants). Date-seeded daily + 21-level campaign
// with deterministic UNIQUE per-level assignment (mirrors warmer/story_order).
// Reuses the shared HUD (hint/demo/rules), levels, streaks and onWin. esbuild
// bundles this into app.js; main.js calls initLamhaGame().
import { normalizeArabic, arNum, escapeHtmlShared, loadBankJSON } from '../core/util.js';

export function initLamhaGame() {
    const modal = document.getElementById('lamha-modal');
    if (!modal) return;
    const G = window.__sura.games;
    const L = window.__sura.levels;
    L.register('lamha', {
        mode: 'bank',
        diff: () => ({}),
        rules: 'في بالنا كلمة مخفية، ونعطيك عليها 3 تلميحات تتكشّف واحدًا بعد واحد — الأول غامض والأخير شبه كاشف. تكتب تخمينك في أي لحظة. سرّ اللعبة إنك «تراهن»: كل ما خمّنت وأنت عارف بتلميحات أقل، نجومك أكثر — ⭐⭐⭐ لو ضبطتها من التلميح الأول، ⭐⭐ من الثاني، ⭐ من الثالث. التخمين الغلط مجاني وما ينقص نجومك؛ اللي ينقّصها هو كشفك للتلميح التالي. وإذا علّقت في آخر تلميح نكشف لك أول حرف مجانًا 🤝. لمن تضبط الكلمة تُقفل وتفوز.'
    });

    const statusEl = document.getElementById('lamha-status');
    const cluesEl = document.getElementById('lamha-clues');
    const inputEl = document.getElementById('lamha-input');
    const guessBtn = document.getElementById('lamha-guess-btn');
    const revealBtn = document.getElementById('lamha-reveal-btn');
    const msgEl = document.getElementById('lamha-message');
    const actionsEl = document.getElementById('lamha-actions');
    const shareBtn = document.getElementById('lamha-share-btn');
    const closeBtn = document.getElementById('lamha-modal-close');
    const trigger = document.getElementById('lamha-trigger-card');
    const playBtn = document.getElementById('lamha-play-btn');

    const FALLBACK = [{
        id: 'lm_fallback', difficulty: 0, answer: 'المطر',
        accepted: ['المطر', 'مطر', 'الأمطار', 'امطار'],
        clues: ['ينزل من السماء', 'الناس تفرح فيه والأودية تسيل', 'تشمّ ريحته في التراب ويسقي الزرع'],
        explain: '«المطر» — رحمة ينتظرها الناس، وريحته في التراب لها وقع خاص.'
    }];
    let BANK = [], bankLoaded = false;
    async function loadBank() {
        if (bankLoaded) return;
        BANK = await loadBankJSON('bank/saudi/lamha.json', FALLBACK, 'لمحة');
        if (!BANK || !BANK.length) BANK = FALLBACK;
        bankLoaded = true;
    }

    // Lenient Arabic equality: drop tashkeel/tatweel, fold alef/ya/ة/hamza, and
    // strip a leading «ال» so الطموح == طموح.
    function norm(s) {
        return String(s).normalize('NFC')
            .replace(/[ً-ْٰـ]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
            .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
            .replace(/\s+/g, ' ').trim()
            .replace(/^ال/, '');
    }

    function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    function shuffleWith(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

    // ---- inline styles (no style.css change) ----
    const S_INPUT = 'flex:1;min-width:0;padding:.6em .8em;border:1px solid rgba(201,162,39,.5);border-radius:8px;background:rgba(0,0,0,.25);color:inherit;font-size:1.05em;text-align:right;direction:rtl';
    const S_CLUE = 'display:block;width:100%;text-align:right;margin:.28em 0;padding:.6em .8em;border-radius:8px;line-height:1.6;background:rgba(201,162,39,.12);border:1px solid rgba(201,162,39,.4)';
    const S_LOCK = 'display:block;width:100%;text-align:right;margin:.28em 0;padding:.6em .8em;border-radius:8px;line-height:1.6;background:rgba(0,0,0,.14);border:1px dashed rgba(255,255,255,.18);opacity:.5';

    let item = null, answerNorm = '', acceptedNorm = [], clues = [], cluesRevealed = 1,
        gameOver = false, serverId = null, practiceIndex = null, startedAt = 0,
        wrongStreak = 0, floorGiven = false, guessCount = 0;

    const ceilingStars = () => Math.max(1, 4 - cluesRevealed); // 1 clue→3, 2→2, 3→1

    function startWith(p) {
        item = p;
        answerNorm = norm(p.answer);
        acceptedNorm = (p.accepted && p.accepted.length ? p.accepted : [p.answer]).map(norm);
        clues = (p.clues || []).slice(0, 3);
        cluesRevealed = 1; gameOver = false; startedAt = Date.now();
        wrongStreak = 0; floorGiven = false; guessCount = 0;
        // Wrong guesses cost; revealing a clue does not (it already costs rank).
        const bud = L.budgetFor('lamha', L.level('lamha'));
        if (bud) L.mountBudget(modal, 'lamha', bud.n, bud.label);
        L.hideRetry(modal);
        if (inputEl) { inputEl.value = ''; inputEl.disabled = false; }
        if (guessBtn) guessBtn.disabled = false;
        if (revealBtn) revealBtn.classList.remove('hidden');
        if (actionsEl) actionsEl.classList.add('hidden');
        renderClues();
        msg('اقرأ التلميح وخمّن — كل ما خمّنت أبكر نجومك أكثر ⭐');
        if (inputEl) setTimeout(() => inputEl.focus(), 50);
    }

    function renderClues() {
        if (statusEl) {
            const cs = ceilingStars();
            const stars = '⭐'.repeat(cs) + '☆'.repeat(3 - cs);
            statusEl.innerHTML = `<span style="opacity:.85">التلميح ${arNum(cluesRevealed)} من 3</span> <span style="opacity:.55">·</span> <span>النجوم الممكنة: ${stars}</span>`;
        }
        if (!cluesEl) return;
        let html = '';
        for (let i = 0; i < clues.length; i++) {
            if (i < cluesRevealed) html += `<div style="${S_CLUE}"><b style="opacity:.65">${arNum(i + 1)})</b> ${escapeHtmlShared(clues[i])}</div>`;
            else html += `<div style="${S_LOCK}">🔒 تلميح ${arNum(i + 1)} — مخفي</div>`;
        }
        cluesEl.innerHTML = html;
        if (revealBtn) {
            if (cluesRevealed >= clues.length) { revealBtn.disabled = true; revealBtn.textContent = 'لا مزيد من التلميحات'; }
            else { revealBtn.disabled = false; revealBtn.textContent = '💡 اكشف التلميح التالي (−⭐)'; }
        }
    }

    // Reveal the next clue (lowers the star ceiling). Shared by the in-modal button
    // AND the HUD hint, so both do the same thing. Returns the revealed clue text,
    // or a free first-letter floor once the clues run out.
    function revealNext() {
        if (gameOver || !item) return { ok: false, message: 'انتهت اللعبة' };
        if (cluesRevealed < clues.length) {
            cluesRevealed++;
            renderClues();
            const c = clues[cluesRevealed - 1];
            msg(`💡 تلميح ${arNum(cluesRevealed)}: ${c}`);
            return { ok: true, message: c };
        }
        // نفدت اللمحات ⇒ أرضيّة الحرف الأول، مرّةً واحدة. كانت تُعاد كلّما ضُغط
        // الزرّ: الجملة نفسها بثمنٍ جديد. `floorGiven` تحرسها الآن أيضًا.
        if (floorGiven) return { ok: false, message: 'كشفتُ كل اللمحات وأول حرف — ما بقي إلا الجواب' };
        floorGiven = true;
        const fl = (item.answer || ' ').replace(/^ال/, '')[0] || (item.answer || ' ')[0];
        msg(`أول حرف من الكلمة: «${fl}»`);
        return { ok: true, message: `أول حرف من الكلمة: «${fl}»` };
    }

    function submitGuess() {
        if (gameOver) return;
        const raw = (inputEl.value || '').trim();
        if (!raw) return;
        const g = norm(raw);
        if (!g) return;
        guessCount++;
        if (g === answerNorm || acceptedNorm.includes(g)) { inputEl.value = ''; return endGame(); }
        wrongStreak++;
        inputEl.select();
        if (window.__sura.fx) window.__sura.fx.sfx('wrong');
        window.__sura.rush.miss();
        if (L.spendBudget('lamha')) return exhausted();
        if (cluesRevealed < clues.length) msg('مو صحيح — جرّب مرة ثانية، أو اكشف التلميح التالي 💡');
        else msg('مو صحيح — ركّز في التلميحات وحاول مرة ثانية');
        // free floor: genuinely stuck on the last clue → reveal the first letter once
        if (!floorGiven && cluesRevealed >= clues.length && wrongStreak >= 3) {
            floorGiven = true;
            const fl = (item.answer || ' ').replace(/^ال/, '')[0] || (item.answer || ' ')[0];
            setTimeout(() => { if (!gameOver) msg(`نساعدك 🤝 الكلمة تبدأ بحرف «${fl}»`); }, 950);
        }
        inputEl.focus();
    }

    // Out of guesses. Reaching the later clues still shows engagement, so the
    // round ranks on how far it got rather than scoring a flat zero.
    function exhausted() {
        gameOver = true;
        if (inputEl) inputEl.disabled = true;
        if (guessBtn) guessBtn.disabled = true;
        if (revealBtn) revealBtn.classList.add('hidden');
        cluesRevealed = clues.length; renderClues();
        const score01 = Math.min(0.5, 0.15 * guessCount);
        const res = (practiceIndex === null)
            ? L.finish('lamha', { won: false, score01 })
            : { rank: window.__sura.ranks.tierFor(score01).idx };
        window.__sura.meta.onPartial('lamha', { rank: res.rank, kind: 'wrong_out' });
        msg(`الكلمة كانت «${item.answer}»`);
        if (item && item.explain && msgEl) setTimeout(() => msg('💡 ' + item.explain), 1600);
        if (actionsEl) actionsEl.classList.remove('hidden');
        L.showRetry(modal, 'lamha', () => startDaily());
        window.__sura.meta.offerSaver('lamha', () => { L.resetBudget('lamha'); startDaily(); });
    }

    function endGame() {
        gameOver = true;
        // Guessing on fewer clues — and with fewer wrong tries — ranks higher.
        const shown = Math.max(1, cluesRevealed);
        const score01 = Math.max(0, 1 - (shown - 1) * 0.24 - Math.max(0, guessCount - 1) * 0.07);
        if (inputEl) inputEl.disabled = true;
        if (guessBtn) guessBtn.disabled = true;
        if (revealBtn) revealBtn.classList.add('hidden');
        cluesRevealed = clues.length; renderClues();
        const res = (practiceIndex === null)
            ? L.finish('lamha', { won: true, score01 })
            : { rank: window.__sura.ranks.tierFor(score01).idx, tier: window.__sura.ranks.tierFor(score01) };
        const tier = res.tier || window.__sura.ranks.TIERS[res.rank];
        msg(`أحسنت! ${tier.icon} ${tier.name} — الكلمة «${item.answer}» عرفتها بعد ${arNum(shown)} تلميح`);
        if (item && item.explain && msgEl) setTimeout(() => msg('💡 ' + item.explain), 1600);
        if (actionsEl) actionsEl.classList.remove('hidden');
        const secs = Math.round((Date.now() - startedAt) / 1000);
        // spoiler-free share: how few clues it took, not the word
        const trail = ['🟩', '🟨', '🟧'][shown - 1] || '🟩';
        modal.dataset.shareSummary = `لمحة ${tier.icon} ${tier.name}\nعرفتها من التلميح ${arNum(shown)} ${trail}`;
        G.submitResult({ puzzle_id: serverId, game_type: 'lamha', guess: { answer: item.answer, clues: shown, tries: guessCount }, time_seconds: secs },
            () => { window.__sura.meta.promptSignup(); });
        window.__sura.meta.serverStreak('lamha').then(streak => window.__sura.meta.onWin('lamha', { seconds: secs, streak, rank: res.rank, timed: res.timed, rushMax: res.rushMax }));
    }

    let msgTimer = null;
    function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 3600); }

    // ---- deterministic UNIQUE campaign assignment (mirrors warmer/story_order) ----
    const LEVELS_TOTAL = 21;
    let assignMap = null;
    function buildAssign() {
        const buckets = { 0: [], 1: [], 2: [] };
        BANK.forEach((b, i) => { const d = (b && b.difficulty != null) ? b.difficulty : 1; (buckets[d] || (buckets[d] = [])).push(i); });
        const rng = seededRng(((L.levelSeed ? L.levelSeed('lamha', 0) : 1409000) ^ 0x9e3779b9) >>> 0);
        [0, 1, 2].forEach(d => { buckets[d] = shuffleWith(buckets[d] || [], rng); });
        const cur = { 0: 0, 1: 0, 2: 0 };
        const used = new Set();
        const take = (d) => { const a = buckets[d] || []; while (cur[d] < a.length) { const i = a[cur[d]++]; if (!used.has(i)) return i; } return -1; };
        const map = [];
        for (let lv = 0; lv < LEVELS_TOTAL; lv++) {
            const want = L.bandIndex(lv);
            let pick = take(want);
            if (pick < 0) for (const d of [want + 1, want - 1, want + 2, want - 2]) { if (d >= 0 && d <= 2) { pick = take(d); if (pick >= 0) break; } }
            if (pick < 0) { pick = BANK.findIndex((_, i) => !used.has(i)); if (pick < 0) pick = 0; }
            used.add(pick); map[lv] = pick;
        }
        return map;
    }
    function levelItemIndex(lv) {
        if (!assignMap) assignMap = buildAssign();
        const c = Math.max(0, Math.min(LEVELS_TOTAL - 1, lv | 0));
        return assignMap[c];
    }
    function startDaily() {
        const lv = L.level('lamha');
        const idx = (practiceIndex !== null) ? Math.floor(Math.random() * Math.max(1, BANK.length)) : levelItemIndex(lv);
        startWith(BANK[idx] || BANK[0]);
        if (practiceIndex === null) L.startLevel('lamha', lv);
    }

    // HUD hint = reveal the next clue (identical to the in-modal reveal button).
    window.__sura.hints.register('lamha', () => revealNext());
    window.__sura.hints.registerCtx('lamha', () => {
        if (gameOver || !item) return null;
        return {
            difficulty: L.bandOf(L.level('lamha')).key,
            player_state: `كشف ${arNum(cluesRevealed)} تلميح من 3`,
            safe_context: 'التلميحات الظاهرة: ' + clues.slice(0, cluesRevealed).join(' | '),
            solution: item.answer
        };
    });

    async function openGame() {
        practiceIndex = null;
        // Play first, sign up after a win: never blocks on auth.
        await G.resolveSession();
        modal.classList.add('active');
        window.__sura.hints.mountChrome(modal, 'lamha');
        L.mountControls(modal, 'lamha', { onChange: () => { practiceIndex = null; startDaily(); } });
        await loadBank();
        const puzzle = await G.fetchPuzzle('lamha');
        serverId = puzzle && puzzle.id ? puzzle.id : null;
        startDaily();
    }

    const close = () => modal.classList.remove('active');
    if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
    if (playBtn) playBtn.addEventListener('click', openGame);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
    if (guessBtn) guessBtn.addEventListener('click', submitGuess);
    if (revealBtn) revealBtn.addEventListener('click', revealNext);
    if (inputEl) inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitGuess(); } });
    if (shareBtn) shareBtn.addEventListener('click', () => G.share('lamha', modal.dataset.shareSummary || ''));
}
