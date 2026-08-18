// games/story_order (رتّب السالفة) — arrange the shuffled fragments of a short
// everyday situation/سالفة into their correct logical (cause→effect) order.
// Tap a pool card to append it to the «الترتيب» sequence; tap a placed card to
// pull it back. «تحقّق» validates the whole order; wrong order never reveals the
// answer (just nudges + lets you rearrange). Pure-local, date-seeded daily +
// 21-level campaign with deterministic UNIQUE per-level assignment (no repeats).
// Modeled on games/missing_word.js so it reuses the shared HUD (hint/demo/rules),
// levels, streaks and onWin reward. esbuild bundles this into app.js; main.js
// calls initStoryOrderGame() in init order.
import { normalizeArabic, arNum, escapeHtmlShared, loadBankJSON } from '../core/util.js';

export function initStoryOrderGame() {
    const modal = document.getElementById('storyorder-modal');
    if (!modal) return;
    const G = window.__sura.games;
    const L = window.__sura.levels;
    L.register('story_order', {
        mode: 'bank',
        diff: () => ({}),
        rules: 'تظهر أجزاء سالفةٍ يومية مبعثرة، ومهمتك ترتّبها حسب تسلسلها المنطقي (السبب قبل النتيجة، وما يحصل أولًا قبل ما يجي بعده). اضغط على الجزء ليُضاف إلى «الترتيب» مرقّمًا، واضغط على جزءٍ مرتَّب لتسحبه ويرجع للأسفل. لمّا تكمل الترتيب اضغط «تحقّق»: إذا صحّ يُقفل بالأخضر وتظهر القصة كاملة، وإذا غلط ننبّهك دون كشف الحل لتعيد الترتيب. الصعوبة من عدد الأجزاء وقرب السبب من النتيجة، لا من غرابة الكلمات. رتّبها صح من أول محاولة وبدون تلميح لتنال ⭐⭐⭐.'
    });

    const titleEl = document.getElementById('storyorder-title');
    const orderEl = document.getElementById('storyorder-order');
    const poolEl = document.getElementById('storyorder-pool');
    const msgEl = document.getElementById('storyorder-message');
    const actionsEl = document.getElementById('storyorder-actions');
    const submitBtn = document.getElementById('storyorder-submit-btn');
    const resetBtn = document.getElementById('storyorder-reset-btn');
    const shareBtn = document.getElementById('storyorder-share-btn');
    const newBtn = document.getElementById('storyorder-new-btn');
    const closeBtn = document.getElementById('storyorder-modal-close');
    const trigger = document.getElementById('storyorder-trigger-card');
    const playBtn = document.getElementById('storyorder-play-btn');

    const FALLBACK = [{
        id: 'so_fallback', difficulty: 0, title: 'نسي المفتاح',
        fragments: ['طلع من البيت وسكّر الباب', 'تذكّر إنه نسي المفتاح', 'رجع ياخذه من فوق'],
        answer_order: [0, 1, 2],
        hints: ['ابدأ بأول حركة قبل ما ينتبه لأي شي.', 'الرجوع يجي بعد ما يتذكّر إنه نسي.', 'أول جزء: «طلع من البيت وسكّر الباب».'],
        explanation: 'طلع، تذكّر إنه ناسي المفتاح، فرجع ياخذه.'
    }];
    let BANK = [], bankLoaded = false;
    async function loadBank() {
        if (bankLoaded) return;
        BANK = await loadBankJSON('bank/saudi/story_order.json', FALLBACK, 'ترتيب الحكاية');
        if (!BANK || !BANK.length) BANK = FALLBACK;
        bankLoaded = true;
    }

    function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    function shuffleWith(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

    // ---- inline styles (no style.css change) ----
    const S_SLOT = 'display:block;width:100%;text-align:right;margin:.25em 0;padding:.55em .7em;border:1px solid rgba(201,162,39,.45);border-radius:8px;background:rgba(201,162,39,.1);cursor:pointer;line-height:1.5';
    const S_LOCK = 'display:block;width:100%;text-align:right;margin:.25em 0;padding:.55em .7em;border:1px solid #3aa655;border-radius:8px;background:rgba(58,166,85,.18);color:#d6f5de;line-height:1.5';
    const S_POOL = 'display:block;width:100%;text-align:right;margin:.25em 0;padding:.55em .7em;line-height:1.5';
    const S_NUM = 'display:inline-block;min-width:1.6em;height:1.6em;line-height:1.6em;text-align:center;margin-left:.5em;border-radius:50%;background:#c9a227;color:#1a1a1a;font-weight:700';
    const S_NUMOK = 'display:inline-block;min-width:1.6em;height:1.6em;line-height:1.6em;text-align:center;margin-left:.5em;border-radius:50%;background:#3aa655;color:#fff;font-weight:700';

    let item = null, frags = [], answerOrder = [], display = [],
        order = [], gameOver = false, serverId = null, practiceIndex = null,
        startedAt = 0, mistakes = 0, hintsUsed = 0;

    function startWith(p, lv, random) {
        item = p;
        if (titleEl) titleEl.textContent = p.title || '';
        frags = (p.fragments || []).slice();
        answerOrder = Array.isArray(p.answer_order) && p.answer_order.length === frags.length
            ? p.answer_order.slice() : frags.map((_, i) => i);
        // deterministic display shuffle per level (same level → same scramble),
        // re-shuffled (and re-seeded so it never matches the solved order) for
        // free practice. display holds original fragment indices.
        let idxs = frags.map((_, i) => i);
        if (random) {
            idxs = shuffleWith(idxs, Math.random);
        } else {
            const seed = (L.levelSeed('story_order', lv) ^ (frags.length * 2654435761)) >>> 0;
            idxs = shuffleWith(idxs, seededRng(seed));
        }
        // guard: never present the cards already in the exact answer order
        if (idxs.length > 1 && idxs.every((v, i) => v === answerOrder[i])) idxs.reverse();
        display = idxs;
        order = []; gameOver = false; startedAt = Date.now(); mistakes = 0; hintsUsed = 0;
        if (actionsEl) actionsEl.classList.add('hidden');
        render(); msg('');
    }

    // ---- deterministic UNIQUE campaign assignment (mirrors missing_word) -----
    const LEVELS_TOTAL = 21;
    let assignMap = null;
    function buildAssign() {
        const buckets = { 0: [], 1: [], 2: [] };
        BANK.forEach((b, i) => { const d = (b && b.difficulty != null) ? b.difficulty : 1; (buckets[d] || (buckets[d] = [])).push(i); });
        const rng = seededRng(((L.levelSeed ? L.levelSeed('story_order', 0) : 1153000) ^ 0x9e3779b9) >>> 0);
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
        const lv = L.level('story_order');
        const idx = (practiceIndex !== null)
            ? Math.floor(Math.random() * Math.max(1, BANK.length)) // «سالفة جديدة» — free practice may repeat
            : levelItemIndex(lv);                                  // campaign — guaranteed unique per level
        startWith(BANK[idx] || BANK[0], lv, practiceIndex !== null);
    }

    // ---- rendering ----
    function render() {
        // ordered (chosen) sequence — numbered, tap to remove
        orderEl.innerHTML = '';
        if (!order.length) {
            const ph = document.createElement('div');
            ph.style.cssText = 'opacity:.6;text-align:center;padding:.5em';
            ph.textContent = 'اضغط الأجزاء بالترتيب الصحيح…';
            orderEl.appendChild(ph);
        }
        order.forEach((origIdx, pos) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'conn-btn so-slot';
            b.style.cssText = gameOver ? S_LOCK : S_SLOT;
            b.innerHTML = `<span style="${gameOver ? S_NUMOK : S_NUM}">${escapeHtmlShared(arNum(pos + 1))}</span>${escapeHtmlShared(frags[origIdx])}`;
            if (!gameOver) b.addEventListener('click', () => removeAt(pos));
            orderEl.appendChild(b);
        });
        // pool — remaining cards, tap to append
        poolEl.innerHTML = '';
        display.forEach(origIdx => {
            if (order.includes(origIdx)) return;
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'conn-btn so-card';
            b.style.cssText = S_POOL;
            b.textContent = frags[origIdx];
            b.addEventListener('click', () => place(origIdx));
            poolEl.appendChild(b);
        });
        if (submitBtn) submitBtn.disabled = gameOver || order.length !== frags.length;
        if (resetBtn) resetBtn.disabled = gameOver || order.length === 0;
    }
    function place(origIdx) { if (gameOver || order.includes(origIdx)) return; order.push(origIdx); render(); msg(''); }
    function removeAt(pos) { if (gameOver) return; order.splice(pos, 1); render(); msg(''); }
    function reset() { if (gameOver) return; order = []; render(); msg(''); }

    function shake() { poolEl.style.animation = 'shake 0.4s ease'; setTimeout(() => { poolEl.style.animation = ''; }, 420); }

    function submit() {
        if (gameOver || order.length !== frags.length) return;
        const correct = order.every((v, i) => v === answerOrder[i]);
        if (correct) return endGame();
        mistakes++;
        shake();
        msg('قريب… راجع ترتيب السبب والنتيجة، وش اللي لازم يصير قبل؟');
    }

    function fullStory() { return answerOrder.map((origIdx, i) => `${arNum(i + 1)}. ${frags[origIdx]}`).join('  •  '); }

    function endGame() {
        gameOver = true;
        order = answerOrder.slice(); // snap to the correct order, then lock green
        render();
        const stars = (mistakes === 0 && hintsUsed === 0) ? 3 : (mistakes + hintsUsed <= 1 ? 2 : 1);
        const starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
        msg(`أحسنت! ${starStr} ركّبت السالفة صح`);
        if (window.__sura.meta && window.__sura.meta.toast) {
            window.__sura.meta.toast(`<span class="t-ico">${stars === 3 ? '🌟' : '🏅'}</span> ${starStr} — ${item && item.title ? item.title : 'رتّب السالفة'}`);
        }
        if (item && item.explanation && msgEl) setTimeout(() => msg('💡 ' + item.explanation), 1500);
        if (actionsEl) actionsEl.classList.remove('hidden');
        const secs = Math.round((Date.now() - startedAt) / 1000);
        modal.dataset.shareSummary = `رتّب السالفة ${starStr}: «${item && item.title ? item.title : ''}»`;
        G.submitResult({ puzzle_id: serverId, game_type: 'story_order', guess: { order: answerOrder, title: item && item.title }, time_seconds: secs },
            () => { window.__sura.meta.promptSignup(); });
        window.__sura.meta.serverStreak('story_order').then(streak => window.__sura.meta.onWin('story_order', { seconds: secs, streak, stars }));
        if (practiceIndex === null) L.won('story_order');
    }

    let msgTimer = null;
    function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 3200); }

    // Local hint: first serve the puzzle's OWN graded hints (item.hints[]: L1
    // gentle → L3 near-answer) which point at THIS سالفة's logic; once exhausted,
    // give stronger guidance by snapping the next still-misplaced card into its
    // correct position. AI-free. hintsUsed doubles as the graded index.
    window.__sura.hints.register('story_order', () => {
        if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
        const authored = (item && Array.isArray(item.hints)) ? item.hints : [];
        if (hintsUsed < authored.length) {
            const h = authored[hintsUsed];
            hintsUsed++;
            return { ok: true, message: h };
        }
        // stronger guidance: place the correct fragment for the first wrong slot
        const pos = answerOrder.findIndex((origIdx, i) => order[i] !== origIdx);
        if (pos < 0) return { ok: false, message: 'الترتيب صحيح، اضغط «تحقّق»' };
        const want = answerOrder[pos];
        order = answerOrder.slice(0, pos + 1); // keep the correct prefix + reveal this card
        hintsUsed++;
        render();
        return { ok: true, message: `الجزء رقم ${arNum(pos + 1)} هو: «${frags[want]}»` };
    });
    window.__sura.hints.registerCtx('story_order', () => {
        if (gameOver || !item) return null;
        return {
            difficulty: L.bandOf(L.level('story_order')).key,
            player_state: `رتّب ${arNum(order.length)} من ${arNum(frags.length)} أجزاء`,
            safe_context: `الموقف: «${item.title || ''}». الأجزاء المبعثرة: ${display.map(i => frags[i]).join(' / ')}.`,
            solution: answerOrder.map(i => frags[i]).join(' ثم ')
        };
    });

    async function openGame() {
        practiceIndex = null;
        // Play first, sign up after a win: never blocks on auth.
        await G.resolveSession();
        modal.classList.add('active');
        window.__sura.hints.mountChrome(modal, 'story_order');
        L.mountControls(modal, 'story_order', { onChange: () => { practiceIndex = null; startDaily(); } });
        await loadBank();
        const puzzle = await G.fetchPuzzle('story_order');
        serverId = puzzle && puzzle.id ? puzzle.id : null;
        startDaily();
    }

    const close = () => modal.classList.remove('active');
    if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
    if (playBtn) playBtn.addEventListener('click', openGame);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
    if (submitBtn) submitBtn.addEventListener('click', submit);
    if (resetBtn) resetBtn.addEventListener('click', reset);
    if (shareBtn) shareBtn.addEventListener('click', () => G.share('story_order', modal.dataset.shareSummary || ''));
    if (newBtn) newBtn.addEventListener('click', () => { serverId = null; practiceIndex = Math.floor(Math.random() * Math.max(1, BANK.length)); startDaily(); practiceIndex = null; });
}
