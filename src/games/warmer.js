// games/warmer (قرّبها) — semantic hot/cold. A hidden daily target word; the
// player TYPES free guesses (no options, no blanks) and each guess returns how
// close it is in meaning: 🔥🔥 قريب جدًا · 🔥 قريب · 🌡️ دافئ · ❄️ بارد. Guesses
// stack hottest-first (Contexto-style) until the target is hit. Closeness comes
// from hand-curated tiers in the bank (offline, deterministic, fair — no AI/
// embeddings). Date-seeded daily + 21-level campaign with deterministic UNIQUE
// per-level assignment. Reuses the shared HUD (hint/demo/rules), levels, streaks
// and onWin. esbuild bundles this into app.js; main.js calls initWarmerGame().
import { normalizeArabic, arNum, escapeHtmlShared, loadBankJSON } from '../core/util.js';

export function initWarmerGame() {
    const modal = document.getElementById('warmer-modal');
    if (!modal) return;
    const G = window.__sura.games;
    const L = window.__sura.levels;
    L.register('warmer', {
        mode: 'bank',
        diff: () => ({}),
        rules: 'في بالنا كلمة مخفية، وأنت تخمّن بالكتابة (بدون خيارات وبدون فراغات). فوق نعرض لك «الموضوع» وعدد حروف الكلمة عشان نضيّق دائرة البحث. كل تخمين نقول لك قد إيش قرّبت بالمعنى: 🔥🔥 قريب جدًا، 🔥 قريب، 🌡️ دافئ، ❄️ بارد. تخميناتك تترتّب الأحرّ فوق عشان تشوف وين وصلت. وإذا برّدت عدّة مرّات ورا بعض نكشف لك أول حرف مجانًا 🤝. كمّل تخمين لين تضبط الكلمة فتُقفل بالأخضر وتفوز. كل ما خمّنت بأقل عدد محاولات وبدون تلميح، نجومك أكثر ⭐⭐⭐.'
    });

    const themeEl = document.getElementById('warmer-theme');
    const inputEl = document.getElementById('warmer-input');
    const guessBtn = document.getElementById('warmer-guess-btn');
    const guessesEl = document.getElementById('warmer-guesses');
    const msgEl = document.getElementById('warmer-message');
    const actionsEl = document.getElementById('warmer-actions');
    const shareBtn = document.getElementById('warmer-share-btn');
    const newBtn = document.getElementById('warmer-new-btn');
    const closeBtn = document.getElementById('warmer-modal-close');
    const trigger = document.getElementById('warmer-trigger-card');
    const playBtn = document.getElementById('warmer-play-btn');

    const FALLBACK = [{
        id: 'wr_fallback', difficulty: 0, target: 'قهوة', theme: 'ضيافة',
        accepted: ['قهوة', 'قهوه', 'القهوة'],
        tiers: { 2: ['فنجان', 'دلة', 'بن'], 1: ['شاي', 'ضيافة', 'تمر'], 0: ['مشروب', 'صباح'] },
        hints: ['الكلمة من أجواء الضيافة.', 'تُصبّ في فنجان وتجي مع التمر.', 'تبدأ بحرف القاف.'],
        explain: '«القهوة» — رمز الضيافة السعودية.'
    }];
    let BANK = [], bankLoaded = false;
    async function loadBank() {
        if (bankLoaded) return;
        BANK = await loadBankJSON('bank/saudi/warmer.json', FALLBACK, 'قرّبها');
        if (!BANK || !BANK.length) BANK = FALLBACK;
        bankLoaded = true;
    }

    // Lenient Arabic equality: drop tashkeel/tatweel, fold alef/ya/ة/hamza, and
    // strip a leading «ال» so القهوة == قهوة.
    function norm(s) {
        return String(s).normalize('NFC')
            .replace(/[ً-ْٰـ]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
            .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
            .replace(/\s+/g, ' ').trim()
            .replace(/^ال/, '');
    }
    // two words "relate" if equal, or one contains the other (>=3 chars) — catches
    // morphological variants (كريم↔الكرم) without false 2-letter hits.
    function relate(a, b) { if (a === b) return true; return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)); }

    function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    function shuffleWith(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

    // ---- inline styles (no style.css change) ----
    const S_INPUT = 'flex:1;min-width:0;padding:.6em .8em;border:1px solid rgba(201,162,39,.5);border-radius:8px;background:rgba(0,0,0,.25);color:inherit;font-size:1.05em;text-align:right;direction:rtl';
    const S_ROW = 'display:block;width:100%;text-align:right;margin:.22em 0;padding:.5em .7em;border-radius:8px;line-height:1.5';
    const TIER = {
        2: { ic: '🔥🔥', label: 'قريب جدًا', css: 'background:rgba(192,57,43,.22);border:1px solid #c0392b' },
        1: { ic: '🔥', label: 'قريب', css: 'background:rgba(201,120,39,.20);border:1px solid #c97827' },
        0: { ic: '🌡️', label: 'دافئ', css: 'background:rgba(201,162,39,.16);border:1px solid #c9a227' },
        '-1': { ic: '❄️', label: 'بارد', css: 'background:rgba(80,120,160,.14);border:1px solid #4a6b8a' },
        win: { ic: '✅', label: 'الكلمة!', css: 'background:rgba(58,166,85,.22);border:1px solid #3aa655;color:#d6f5de' }
    };

    let item = null, targetNorm = '', acceptedNorm = [], tiers = { 2: [], 1: [], 0: [] },
        guesses = [], seen = new Set(), gameOver = false, serverId = null, practiceIndex = null,
        startedAt = 0, hintsUsed = 0, coldStreak = 0, floorGiven = false;

    function startWith(p) {
        item = p;
        targetNorm = norm(p.target);
        acceptedNorm = (p.accepted && p.accepted.length ? p.accepted : [p.target]).map(norm);
        const t = p.tiers || {};
        tiers = { 2: (t[2] || t['2'] || []).map(norm), 1: (t[1] || t['1'] || []).map(norm), 0: (t[0] || t['0'] || []).map(norm) };
        guesses = []; seen = new Set(); gameOver = false; startedAt = Date.now(); hintsUsed = 0;
        coldStreak = 0; floorGiven = false;
        // Budget counts COLD guesses only — following the warmth signal costs
        // nothing, so the stake punishes flailing, never exploration.
        const bud = L.budgetFor('warmer', L.level('warmer'));
        if (bud) L.mountBudget(modal, 'warmer', bud.n, bud.label);
        L.hideRetry(modal);
        // persistent anchor: theme + letter count narrows the search space fairly
        // (the count is spoiler-free, like Contexto/Wordle).
        const letters = (p.target || '').replace(/\s+/g, '').length;
        const lenLabel = letters === 2 ? 'حرفين' : `${arNum(letters)} حروف`;
        if (themeEl) themeEl.innerHTML = `<span style="opacity:.85">الموضوع:</span> <b>${escapeHtmlShared(p.theme || '—')}</b> <span style="opacity:.55">·</span> <b style="opacity:.9">${lenLabel}</b>`;
        if (inputEl) { inputEl.value = ''; inputEl.disabled = false; }
        if (guessBtn) guessBtn.disabled = false;
        if (actionsEl) actionsEl.classList.add('hidden');
        render(); msg('اكتب أي كلمة تحسّها قريبة وشوف كم تسخن 🔍');
        if (inputEl) setTimeout(() => inputEl.focus(), 50);
    }

    // ---- deterministic UNIQUE campaign assignment (mirrors story_order) ----
    const LEVELS_TOTAL = 21;
    let assignMap = null;
    function buildAssign() {
        const buckets = { 0: [], 1: [], 2: [] };
        BANK.forEach((b, i) => { const d = (b && b.difficulty != null) ? b.difficulty : 1; (buckets[d] || (buckets[d] = [])).push(i); });
        const rng = seededRng(((L.levelSeed ? L.levelSeed('warmer', 0) : 1279000) ^ 0x9e3779b9) >>> 0);
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
        const lv = L.level('warmer');
        const idx = (practiceIndex !== null) ? Math.floor(Math.random() * Math.max(1, BANK.length)) : levelItemIndex(lv);
        startWith(BANK[idx] || BANK[0]);
        if (practiceIndex === null) L.startLevel('warmer', lv);
    }

    // closeness tier for a typed guess: 'win' | 2 | 1 | 0 | -1
    function tierOf(guessNorm) {
        if (guessNorm === targetNorm || acceptedNorm.includes(guessNorm)) return 'win';
        for (const t of [2, 1, 0]) if (tiers[t].some(w => relate(guessNorm, w))) return t;
        return -1;
    }

    function render() {
        guessesEl.innerHTML = '';
        if (!guesses.length) return;
        // hottest first; equal tiers keep most-recent-first
        const order = guesses.map((g, i) => ({ g, i })).sort((a, b) => (b.g.rank - a.g.rank) || (b.i - a.i));
        order.forEach(({ g }) => {
            const t = TIER[g.tier];
            const row = document.createElement('div');
            row.style.cssText = S_ROW + ';' + t.css;
            row.innerHTML = `<span style="float:left;opacity:.9">${t.ic} ${escapeHtmlShared(t.label)}</span>${escapeHtmlShared(g.word)}`;
            guessesEl.appendChild(row);
        });
    }
    const rankOf = (tier) => (tier === 'win' ? 4 : tier + 1); // -1→0,0→1,1→2,2→3,win→4

    function submitGuess() {
        if (gameOver) return;
        const raw = (inputEl.value || '').trim();
        if (!raw) return;
        const g = norm(raw);
        if (!g) return;
        if (seen.has(g)) { msg('خمّنتها قبل — جرّب كلمة ثانية'); inputEl.select(); return; }
        const tier = tierOf(g);
        seen.add(g);
        guesses.push({ word: raw, tier, rank: rankOf(tier) });
        inputEl.value = '';
        render();
        if (tier === 'win') return endGame();
        if (tier === -1) coldStreak++; else coldStreak = 0;
        // The warmth signal, as PITCH — colder is a low note, hotter is a high
        // one, so the player feels the closeness before reading the label.
        const FXL = window.__sura.fx;
        if (FXL) { FXL.sfx('warm', (tier + 1) / 3); FXL.haptic(tier === 2 ? [10, 40, 10] : 8); }
        // "getting warmer" is the correct action here, so that is what builds momentum
        if (tier === -1) { window.__sura.rush.miss(); if (L.spendBudget('warmer')) return exhausted(); }
        else window.__sura.rush.hit();
        const t = TIER[tier];
        if (tier === -1) msg(`${t.ic} بارد — قرّب من «${item.theme || 'الموضوع'}» أكثر`);
        else if (tier === 2) msg(`${t.ic} قريب جدًا! خطوة وتمسكها`);
        else msg(`${t.ic} ${t.label} — كمّل`);
        // free floor: if the player is genuinely lost (several cold in a row),
        // reveal the first letter ONCE — no hint budget spent — so they never
        // dead-end and feel forced to spend a hint. Graded by the word's own
        // difficulty so easy words help sooner and hard ones stay a challenge:
        // easy 3 cold / medium 4 / hard 5.
        const dd = (item && item.difficulty != null) ? item.difficulty : 1;
        const coldFloor = 3 + dd;
        if (!floorGiven && coldStreak >= coldFloor) {
            floorGiven = true;
            const fl = (item.target || ' ').replace(/^ال/, '')[0] || (item.target || ' ')[0];
            setTimeout(() => { if (!gameOver) msg(`نساعدك مجانًا 🤝 الكلمة تبدأ بحرف «${fl}»`); }, 950);
        }
        inputEl.focus();
    }

    // Out of cold guesses. The warmth path already walked still earns a rank.
    function exhausted() {
        gameOver = true;
        if (inputEl) inputEl.disabled = true;
        if (guessBtn) guessBtn.disabled = true;
        const bestTier = guesses.reduce((a, g) => Math.max(a, g.tier), -1);
        const score01 = Math.max(0, ((bestTier + 1) / 3) * 0.5);
        const res = (practiceIndex === null)
            ? L.finish('warmer', { won: false, score01 })
            : { rank: window.__sura.ranks.tierFor(score01).idx };
        window.__sura.meta.onPartial('warmer', { rank: res.rank, kind: 'cold_out' });
        msg(`الكلمة كانت «${item.target}»`);
        if (item && item.explain && msgEl) setTimeout(() => msg('💡 ' + item.explain), 1600);
        if (actionsEl) actionsEl.classList.remove('hidden');
        L.showRetry(modal, 'warmer', () => startDaily());
        window.__sura.meta.offerSaver('warmer', () => { L.resetBudget('warmer'); startDaily(); });
    }

    function endGame() {
        gameOver = true;
        const tries = guesses.length;
        // Fewer guesses and no hints = a better rank. Scales with tries rather
        // than snapping at fixed thresholds, so improvement is always visible.
        const score01 = Math.max(0, 1 - Math.max(0, tries - 3) * 0.09 - hintsUsed * 0.18);
        if (inputEl) inputEl.disabled = true;
        if (guessBtn) guessBtn.disabled = true;
        render();
        const res = (practiceIndex === null)
            ? L.finish('warmer', { won: true, score01 })
            : { rank: window.__sura.ranks.tierFor(score01).idx, tier: window.__sura.ranks.tierFor(score01) };
        const tier = res.tier || window.__sura.ranks.TIERS[res.rank];
        msg(`أحسنت! ${tier.icon} ${tier.name} — الكلمة «${item.target}» بـ${arNum(tries)} تخمين`);
        if (item && item.explain && msgEl) setTimeout(() => msg('💡 ' + item.explain), 1600);
        if (actionsEl) actionsEl.classList.remove('hidden');
        const secs = Math.round((Date.now() - startedAt) / 1000);
        // spoiler-free share: warmth path, not the word
        const trail = guesses.map(g => TIER[g.tier].ic).join('');
        modal.dataset.shareSummary = `قرّبها ${tier.icon} ${tier.name} (${arNum(tries)} تخمين)\n${trail}`;
        G.submitResult({ puzzle_id: serverId, game_type: 'warmer', guess: { answer: item.target, tries }, time_seconds: secs },
            () => { window.__sura.meta.promptSignup(); });
        window.__sura.meta.serverStreak('warmer').then(streak => window.__sura.meta.onWin('warmer', { seconds: secs, streak, rank: res.rank, timed: res.timed, rushMax: res.rushMax }));
    }

    let msgTimer = null;
    function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 3200); }

    // سُلَّم كشفٍ لا يكرّر نفسه. كان السطر الأخير يعيد «أول حرف من الكلمة» إلى
    // الأبد: تلميحٌ واحد يُباع مرارًا ويخصم من النتيجة (0.18 لكل تلميح) بلا أي
    // معلومةٍ جديدة. الآن: تلميحات اللغز المكتوبة أولًا، ثم أول حرفٍ فآخره فما
    // بينهما من اليمين، ثم يتوقّف قبل أن تنكشف الكلمة كاملة.
    // عدد الحروف ليس في السُّلَّم لأنه معروضٌ أصلًا في شريط الموضوع.
    function warmerLadder() {
        const w = (item && item.target ? item.target : '').replace(/\s+/g, '');
        const ch = [...w];
        if (ch.length < 2) return [];
        const steps = [
            `أول حرف من الكلمة: «${ch[0]}»`,
            `وآخر حرف منها: «${ch[ch.length - 1]}»`
        ];
        // نُبقي حرفًا واحدًا مستورًا على الأقل — التلميح يقرّب ولا يحلّ
        for (let i = 1; i < ch.length - 2; i++) steps.push(`الحرف رقم ${arNum(i + 1)} هو «${ch[i]}»`);
        return steps;
    }
    window.__sura.hints.register('warmer', () => {
        if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
        const authored = (item && Array.isArray(item.hints)) ? item.hints : [];
        if (hintsUsed < authored.length) { const h = authored[hintsUsed]; hintsUsed++; return { ok: true, message: h }; }
        const ladder = warmerLadder();
        const i = hintsUsed - authored.length;
        // نفد ما يُكشَف ⇒ رفضٌ صريح. المحرّك لا يخصم على ok:false، فلا يدفع
        // اللاعب نتيجةً مقابل جملةٍ سمعها من قبل.
        if (i >= ladder.length) return { ok: false, message: 'ما بقي ما أكشفه — الباقي عليك' };
        hintsUsed++;
        return { ok: true, message: ladder[i] };
    });
    window.__sura.hints.registerCtx('warmer', () => {
        if (gameOver || !item) return null;
        const warm = guesses.filter(g => g.tier !== -1 && g.tier !== 'win').map(g => g.word);
        return {
            difficulty: L.bandOf(L.level('warmer')).key,
            player_state: `خمّن ${arNum(guesses.length)} كلمة${warm.length ? '، وأقربها: ' + warm.slice(0, 3).join('، ') : ''}`,
            safe_context: `موضوع الكلمة المخفية: «${item.theme || ''}».`,
            solution: item.target
        };
    });

    async function openGame() {
        practiceIndex = null;
        // Play first, sign up after a win: never blocks on auth.
        await G.resolveSession();
        modal.classList.add('active');
        window.__sura.hints.mountChrome(modal, 'warmer');
        L.mountControls(modal, 'warmer', { onChange: () => { practiceIndex = null; startDaily(); } });
        await loadBank();
        const puzzle = await G.fetchPuzzle('warmer');
        serverId = puzzle && puzzle.id ? puzzle.id : null;
        startDaily();
    }

    const close = () => modal.classList.remove('active');
    if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
    if (playBtn) playBtn.addEventListener('click', openGame);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
    if (guessBtn) guessBtn.addEventListener('click', submitGuess);
    if (inputEl) inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitGuess(); } });
    if (shareBtn) shareBtn.addEventListener('click', () => G.share('warmer', modal.dataset.shareSummary || ''));
    if (newBtn) newBtn.addEventListener('click', () => { serverId = null; practiceIndex = Math.floor(Math.random() * Math.max(1, BANK.length)); startDaily(); practiceIndex = null; });
}
