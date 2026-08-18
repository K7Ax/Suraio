// games/zayid (زايد) — a Saudi naming-bid BLUFF duel. A category appears
// («كم مدينة سعودية تقدر تذكر؟»); the two sides raise a claimed count until one
// folds (يستسلم), then the LAST (highest) bidder must actually name that many —
// deliver it and win, fall short and lose. ONE round decides the level.
//
// THE OPPONENT — a GHOST, not a bot. You face a recorded attempt by a REAL past
// player (their nerve = how high they bid, their depth = how many they really
// named, and the actual names they gave). A bundled bank of seed players ships
// so the game has a believable human opponent offline; once
// supabase/sql/zayid_ghosts.sql is applied, real players' attempts are recorded &
// served, so the ghost becomes a genuine replay. Because the ghost is a FIXED
// human record — never an adaptive AI — it can never out-name you, and if they
// bluffed (claimed more than they delivered) you WIN by folding to call them.
// The only place the AI's knowledge is used is as an impartial JUDGE of YOUR
// typed answers (list-first, groq-judge fallback for open categories). A «ضد
// صديق» pass-and-play mode swaps the ghost for a second human on the same phone.
//
// Fully client-side. esbuild bundles this into app.js; main.js calls initZayidGame().
import { arNum, escapeHtmlShared, loadBankJSON } from '../core/util.js';

export function initZayidGame() {
    const modal = document.getElementById('zayid-modal');
    if (!modal) return;
    const G = window.__sura.games;
    const L = window.__sura.levels;
    L.register('zayid', {
        mode: 'bank',
        diff: () => ({}),
        rules: 'يطلع لك موضوع، مثلاً «كم مدينة سعودية تقدر تذكر؟»، وتلعب ضد خصم: «شبح» = محاولة لاعب حقيقي سابق (مو روبوت — رقمه ثابت ومسجّل)، أو صديقك على نفس الجوال. كل واحد «يزايد» على الثاني بعدد الأشياء اللي يقدر يذكرها: «أذكر ٨» ← «أنا ١٠» ← «١٢»… لين واحد يستسلم. وقتها آخر واحد زايد لازم يذكر فعليًا هذا العدد كامل قبل ما يخلص الوقت — يذكرهم يفوز، يعجز يخسر. سرّ اللعبة إنها «بلَف»: تزايد على قد ما تقدر تثبت، وتستسلم إذا حسّيت خصمك يكذب — بس إذا استسلمت وقدر يثبت، تخسر! لأن الشبح لاعب حقيقي مسجّل، ما يقدر يعرف أكثر مما ذكره فعلاً، وإذا بلَف (زايد فوق اللي ذكره) تكشفه وتكسب. الذكاء الاصطناعي هنا دوره الوحيد إنه حَكَم عادل يتأكد إن أسماءك صحيحة. جولة وحدة تحسم المستوى.'
    });

    const modeEl = document.getElementById('zayid-mode');
    const catEl = document.getElementById('zayid-category');
    const scoreEl = document.getElementById('zayid-score');
    const bidEl = document.getElementById('zayid-bid');
    const rivalEl = document.getElementById('zayid-rival');
    const proveEl = document.getElementById('zayid-prove');
    const msgEl = document.getElementById('zayid-message');
    const actionsEl = document.getElementById('zayid-actions');
    const shareBtn = document.getElementById('zayid-share-btn');
    const closeBtn = document.getElementById('zayid-modal-close');
    const trigger = document.getElementById('zayid-trigger-card');
    const playBtn = document.getElementById('zayid-play-btn');

    const FALLBACK = [{
        id: 'z_fallback', difficulty: 0, category: 'مدن سعودية', open: true,
        prompt: 'كم مدينة سعودية تقدر تذكر؟',
        answers: ['الرياض', 'جدة', 'مكة', 'المدينة', 'الدمام', 'الطائف', 'تبوك', 'بريدة', 'خميس مشيط', 'حائل', 'نجران', 'جازان', 'ينبع', 'الخبر', 'القطيف', 'عرعر', 'سكاكا', 'الباحة', 'أبها', 'الأحساء'],
        accepted: { 'مكة': ['مكة المكرمة'], 'المدينة': ['المدينة المنورة', 'طيبة'] },
        human_curve: { typical: 8, strong: 14, max: 20 }
    }];
    // client aliases used when RECORDING the player's own attempt into the pool
    const ALIASES = ['لاعب', 'زائر', 'منافس', 'ضيف', 'بطل', 'خصم'];
    let BANK = [], GHOSTS = {}, bankLoaded = false;
    async function loadBank() {
        if (bankLoaded) return;
        BANK = await loadBankJSON('bank/saudi/zayid.json', FALLBACK, 'زايد');
        if (!BANK || !BANK.length) BANK = FALLBACK;
        try { const r2 = await fetch('bank/saudi/zayid_ghosts.json'); if (r2.ok) GHOSTS = await r2.json(); } catch (e) { }
        bankLoaded = true;
    }

    // Lenient Arabic equality: drop tashkeel/tatweel, fold alef/ya/ة/hamza, and
    // strip a leading «ال» so الرياض == رياض.
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
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const pick = a => a[Math.floor(Math.random() * a.length)];

    // ---- match state (single round decides the level) ----
    let item = null, canonMap = null, answerCanons = null, serverId = null, practiceIndex = null;
    let mode = 'ghost';              // 'ghost' | 'friend'
    let matchStartedAt = 0, matchOver = false, pWon = null;
    let serverGhosts = null;         // optional live pool for the current category
    let ghost = null;                // the recorded opponent: { name, claimed, delivered, items[] }
    // per-round
    let standingBid = 0, lastBidder = null, turn = null, opener = null, phase = 'idle';
    let aiK = 0, aiC = 0, aiPool = null, proveSecs = 50, rng = Math.random;
    let named = null, namedList = null, proveTarget = 0, proveWho = null, timer = null, timeLeft = 0;

    function indexAnswers(p) {
        canonMap = new Map();
        answerCanons = [];
        (p.answers || []).forEach(a => {
            const c = String(a).trim();
            answerCanons.push(c);
            canonMap.set(norm(c), c);
            const variants = (p.accepted && p.accepted[c]) || [];
            variants.forEach(v => canonMap.set(norm(v), c));
        });
    }

    // ---- deterministic UNIQUE campaign assignment (mirrors warmer/lamha) ----
    const LEVELS_TOTAL = 21;
    let assignMap = null;
    function buildAssign() {
        const buckets = { 0: [], 1: [], 2: [] };
        BANK.forEach((b, i) => { const d = (b && b.difficulty != null) ? b.difficulty : 1; (buckets[d] || (buckets[d] = [])).push(i); });
        const r = seededRng(((L.levelSeed ? L.levelSeed('zayid', 0) : 1531000) ^ 0x9e3779b9) >>> 0);
        [0, 1, 2].forEach(d => { buckets[d] = shuffleWith(buckets[d] || [], r); });
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
        return assignMap[clamp(lv | 0, 0, LEVELS_TOTAL - 1)];
    }

    // ---- ghost pool: real recorded attempts (server first, then bundled seeds) ----
    function ghostPool(cat) {
        const server = (serverGhosts && serverGhosts.length) ? serverGhosts : [];
        const bundled = (GHOSTS && GHOSTS[cat]) || [];
        return server.concat(bundled).filter(g => g && Array.isArray(g.items) && g.items.length);
    }
    // pick a ghost seeded by level so a level replays with the same opponent
    // (deterministic & fair) when the pool is the bundled seed set.
    function pickGhost(cat, lv) {
        const pool = ghostPool(cat);
        if (!pool.length) return null;
        const r = seededRng((L.levelSeed('zayid', lv) ^ 0x51ed270b) >>> 0);
        const g = pool[Math.floor(r() * pool.length)];
        // normalise the recorded items to the category's canonical display where possible
        const items = g.items.map(x => canonMap.get(norm(x)) || String(x)).filter(Boolean);
        const delivered = Math.min(g.delivered | 0 || items.length, items.length);
        const claimed = clamp(g.claimed | 0 || delivered, 2, Math.max(2, answerCanons.length));
        return { name: g.name || pick(ALIASES), claimed, delivered, items: items.slice(0, delivered) };
    }
    // a synthetic ghost if the pool is somehow empty (never leaves the player opponent-less)
    function fallbackGhost(lv) {
        const band = L.bandIndex(lv);
        const hc = item.human_curve || { typical: 8, strong: 14, max: 20 };
        const r = seededRng((L.levelSeed('zayid', lv) ^ 0x2f9a1) >>> 0);
        const delivered = clamp(Math.round((hc.typical || 8) * [0.7, 0.9, 1.05][band]), 2, answerCanons.length);
        const claimed = clamp(delivered + (r() < 0.4 ? 1 + Math.floor(r() * 2) : 0), 2, answerCanons.length);
        const items = shuffleWith(answerCanons, r).slice(0, delivered);
        return { name: pick(ALIASES), claimed, delivered, items };
    }

    // ---- start the level (one round) ----
    function startMatch() {
        const lv = L.level('zayid');
        const idx = (practiceIndex !== null) ? Math.floor(Math.random() * Math.max(1, BANK.length)) : levelItemIndex(lv);
        item = BANK[idx] || BANK[0];
        indexAnswers(item);
        matchStartedAt = Date.now();
        matchOver = false; pWon = null;
        if (practiceIndex === null) L.startLevel('zayid', lv);
        L.hideRetry(modal);
        if (actionsEl) actionsEl.classList.add('hidden');
        renderMode();
        renderCategory();
        newRound();
    }

    // ---- the single round ----
    function newRound() {
        const lv = L.level('zayid');
        const band = L.bandIndex(lv);
        rng = seededRng((L.levelSeed('zayid', lv) ^ 0x777) >>> 0);
        // the opponent is a recorded human: their claim is the bid ceiling C, their
        // real depth is K, and their actual names are the reveal pool.
        ghost = (mode === 'ghost') ? (pickGhost(item.category, lv) || fallbackGhost(lv)) : null;
        if (ghost) { aiC = clamp(ghost.claimed, 2, answerCanons.length); aiK = clamp(ghost.delivered, 1, aiC); aiPool = ghost.items.slice(); }
        proveSecs = [60, 48, 38][band];                       // generous typing time
        standingBid = 0; lastBidder = null;
        // who opens — seeded so a level is reproducible; both sides sometimes open
        opener = (rng() < 0.5) ? 'p' : 'o';
        turn = opener;
        phase = 'bidding';
        clearTimer();
        if (proveEl) { proveEl.classList.add('hidden'); proveEl.innerHTML = ''; }
        renderScore();
        say('');
        if (turn === 'o' && mode === 'ghost') { renderBid(); setTimeout(aiMove, 500 + Math.floor(Math.random() * 400)); }
        else if (turn === 'o' && mode === 'friend') { renderScore(); passTo('اللاعب ٢', () => { turn = 'o'; friendBidTurn(); }); }
        else { const who = mode === 'friend' ? 'اللاعب ١' : 'أنت'; msg(`دورك تفتح المزايدة يا «${who}»`); renderBid(); }
    }

    // ---- rendering ----
    function renderMode() {
        if (!modeEl) return;
        modeEl.innerHTML =
            `<button type="button" class="zayid-modebtn${mode === 'ghost' ? ' on' : ''}" data-mode="ghost">👤 ضد لاعب</button>` +
            `<button type="button" class="zayid-modebtn${mode === 'friend' ? ' on' : ''}" data-mode="friend">👥 ضد صديق</button>`;
        modeEl.querySelectorAll('.zayid-modebtn').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.mode === mode) return;
            mode = b.dataset.mode;
            startMatch();
        }));
    }
    function renderCategory() {
        if (!catEl) return;
        catEl.innerHTML = `<span style="opacity:.85">الموضوع:</span> <b>${escapeHtmlShared(item.category || '—')}</b><div style="margin-top:.35em;font-size:.95em;opacity:.92">${escapeHtmlShared(item.prompt || '')}</div>`;
    }
    function oName() { return mode === 'friend' ? 'اللاعب ٢' : (ghost ? ghost.name : 'الخصم'); }
    function pName() { return mode === 'friend' ? 'اللاعب ١' : 'أنت'; }
    function renderScore() {
        if (!scoreEl) return;
        const tag = mode === 'friend' ? 'جولة تحسم' : 'خصمك: لاعب سابق';
        scoreEl.innerHTML =
            `<span class="zayid-side"><b>${escapeHtmlShared(pName())}</b></span>` +
            `<span class="zayid-vs">${tag}</span>` +
            `<span class="zayid-side"><b>${escapeHtmlShared(oName())}</b> ${mode === 'ghost' ? '👤' : ''}</span>`;
    }

    function renderBid() {
        if (!bidEl) return;
        const bidTxt = standingBid > 0
            ? `<div class="zayid-bidnum">المزايدة الحالية: <b>${arNum(standingBid)}</b></div>`
            : `<div class="zayid-bidnum">افتح المزايدة — كم تقدر تذكر؟</div>`;
        if (phase !== 'bidding' || turn === 'o') {
            bidEl.innerHTML = bidTxt + `<div class="zayid-turn">${turn === 'o' ? (mode === 'friend' ? 'دور اللاعب ٢…' : `«${escapeHtmlShared(oName())}» يفكّر…`) : ''}</div>`;
            return;
        }
        const opts = standingBid > 0
            ? [standingBid + 1, standingBid + 2, standingBid + 3, standingBid + 5]
            : [3, 4, 5, 6];
        const maxAllowed = Math.max(answerCanons.length, standingBid + 8);
        const btns = opts.filter(n => n <= maxAllowed).map(n =>
            `<button type="button" class="zayid-bidbtn" data-bid="${n}">أذكر ${arNum(n)}</button>`).join('');
        const foldBtn = standingBid > 0
            ? `<button type="button" class="zayid-fold" id="zayid-fold">أستسلم 🏳️</button>` : '';
        bidEl.innerHTML = bidTxt + `<div class="zayid-bidbtns">${btns}</div>${foldBtn}`;
        bidEl.querySelectorAll('.zayid-bidbtn').forEach(b => b.addEventListener('click', () => humanBid(+b.dataset.bid)));
        const f = document.getElementById('zayid-fold');
        if (f) f.addEventListener('click', humanFold);
    }

    function say(t, kind) {
        if (!rivalEl) return;
        if (mode === 'friend' || !t) { rivalEl.innerHTML = ''; rivalEl.classList.remove('show'); return; }
        rivalEl.innerHTML = `<span class="zayid-avatar">👤</span><span class="zayid-say${kind ? ' ' + kind : ''}"><b>${escapeHtmlShared(oName())}:</b> ${escapeHtmlShared(t)}</span>`;
        rivalEl.classList.add('show');
    }

    // ---- bidding actions ----
    function humanBid(n) {
        if (phase !== 'bidding' || turn !== 'p') return;
        if (n <= standingBid) return;
        standingBid = n; lastBidder = 'p'; turn = 'o';
        if (window.__sura.fx) window.__sura.fx.sfx('tick');
        renderBid();
        if (mode === 'friend') { renderScore(); passTo('اللاعب ٢', () => { turn = 'o'; friendBidTurn(); }); }
        else { setTimeout(aiMove, 650 + Math.floor(Math.random() * 500)); }
    }
    function humanFold() {
        if (phase !== 'bidding' || turn !== 'p' || standingBid === 0) return;
        if (window.__sura.fx) window.__sura.fx.sfx('wrong');
        startProve(lastBidder, standingBid);
    }

    // The GHOST replays a fixed human: it bids up toward its recorded claim C and
    // folds once the live player passes it. It can only ever prove what that human
    // really named (aiPool, length K) — so a bluff (C > K) is CALLABLE.
    function aiMove() {
        if (phase !== 'bidding' || turn !== 'o' || mode !== 'ghost') return;
        if (standingBid === 0) {
            const frac = 0.4 + Math.random() * 0.35;
            const open = clamp(Math.round(aiC * frac) + (Math.random() < 0.5 ? 1 : 0), 2, aiC);
            standingBid = open; lastBidder = 'o'; turn = 'p';
            say(pick(['أبدأ أنا… ' + arNum(open) + ' سهلة.', 'خلها ' + arNum(open) + ' للبداية.', 'أول وحدة عليّ: ' + arNum(open) + '.']));
            renderBid();
            return;
        }
        // fold once the player's bid reaches or passes the recorded human's claim
        let fold = false;
        if (standingBid >= aiC) fold = true;
        else if (standingBid >= aiC - 1 && Math.random() < 0.5) fold = true;   // nerve wavers near the ceiling
        if (fold) {
            say(pick(['أشك فيك… ذكّرهم إن كنت صادق! 🤨', 'ما أصدّق توصلها — أثبت كلامك.', 'أستسلم، بس ورّني ' + arNum(standingBid) + '!']), 'call');
            if (window.__sura.fx) window.__sura.fx.sfx('tick');
            startProve('p', standingBid);
            return;
        }
        const r = Math.random();
        const inc = r < 0.55 ? 1 : (r < 0.85 ? 2 : 3);
        const raiseTo = clamp(standingBid + inc, standingBid + 1, aiC);
        standingBid = raiseTo; lastBidder = 'o'; turn = 'p';
        const bluffing = raiseTo > aiK;
        say(pick(bluffing ? ['أنا أقدر ' + arNum(raiseTo) + '… 😏', 'زايدتك: ' + arNum(raiseTo) + '.', 'أرفعها ' + arNum(raiseTo) + '، تجرؤ؟'] : ['عندي أكثر — ' + arNum(raiseTo) + '.', arNum(raiseTo) + ' وأنا مرتاح.']));
        renderBid();
    }

    // ---- friend mode: the other human's bid turn ----
    function friendBidTurn() {
        renderScore();
        if (!bidEl) return;
        const bidTxt = `<div class="zayid-bidnum">المزايدة الحالية: <b>${arNum(standingBid)}</b></div>`;
        const opts = [standingBid + 1, standingBid + 2, standingBid + 3, standingBid + 5];
        const btns = opts.map(n => `<button type="button" class="zayid-bidbtn" data-bid="${n}">أذكر ${arNum(n)}</button>`).join('');
        bidEl.innerHTML = `<div class="zayid-turn">دور اللاعب ٢</div>` + bidTxt +
            `<div class="zayid-bidbtns">${btns}</div><button type="button" class="zayid-fold" id="zayid-fold2">أستسلم 🏳️</button>`;
        bidEl.querySelectorAll('.zayid-bidbtn').forEach(b => b.addEventListener('click', () => {
            const n = +b.dataset.bid; if (n <= standingBid) return;
            standingBid = n; lastBidder = 'o'; turn = 'p';
            passTo('اللاعب ١', () => { renderBid(); msg('دورك يا اللاعب ١'); });
        }));
        const f = document.getElementById('zayid-fold2');
        if (f) f.addEventListener('click', () => { if (standingBid === 0) return; startProve(lastBidder, standingBid); });
    }

    function passTo(who, then) {
        phase = 'pass';
        if (bidEl) bidEl.innerHTML = `<div class="zayid-pass"><div>مرّر الجوال إلى<br><b>«${escapeHtmlShared(who)}»</b></div><button type="button" class="btn-primary" id="zayid-pass-ok">جاهز ✋</button></div>`;
        say('');
        const ok = document.getElementById('zayid-pass-ok');
        if (ok) ok.addEventListener('click', () => { phase = 'bidding'; then(); });
    }

    // ---- prove phase ----
    function startProve(who, target) {
        phase = 'prove'; proveWho = who; proveTarget = target; named = new Set(); namedList = [];
        window.__sura.hints.memo('zayid').reset();   // إثباتٌ جديد ⇒ لا اسمَ مُقترحًا بعد
        renderBid();
        if (bidEl) bidEl.innerHTML = '';
        if (who === 'o' && mode === 'ghost') return aiReveal(target);   // the ghost proves
        const label = mode === 'friend' ? (who === 'p' ? 'اللاعب ١' : 'اللاعب ٢') : 'أنت';
        const run = () => humanProveUI(label, target);
        if (mode === 'friend') passTo(label, run); else run();
    }

    function humanProveUI(label, target) {
        say('');
        if (!proveEl) return;
        proveEl.classList.remove('hidden');
        proveEl.innerHTML =
            `<div class="zayid-prove-head"><span>أثبت كلامك يا «${escapeHtmlShared(label)}» — اذكر <b id="zayid-pc">0</b> / ${arNum(target)}</span><span class="zayid-timer" id="zayid-timer">⏱ ${arNum(proveSecs)}</span></div>` +
            `<div class="zayid-prove-row"><input id="zayid-prove-input" type="text" inputmode="text" autocomplete="off" placeholder="اكتب اسمًا واضغط أضف…" /><button class="btn-primary" id="zayid-prove-submit">أضف</button></div>` +
            `<div class="zayid-chips" id="zayid-chips"></div>` +
            `<button type="button" class="zayid-fold" id="zayid-give">خلّصت / أستسلم</button>`;
        const inp = document.getElementById('zayid-prove-input');
        const sub = document.getElementById('zayid-prove-submit');
        const give = document.getElementById('zayid-give');
        const onAdd = () => proveAdd(inp);
        if (sub) sub.addEventListener('click', onAdd);
        if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } });
        if (give) give.addEventListener('click', () => finishProve(false));
        msg(`اذكر ${arNum(target)} من «${item.category}» قبل ما يخلص الوقت ⏱`);
        setTimeout(() => inp && inp.focus(), 60);
        startTimer();
    }

    async function proveAdd(inp) {
        if (phase !== 'prove' || !inp) return;
        const raw = (inp.value || '').trim();
        if (!raw) return;
        inp.value = '';
        const key = norm(raw);
        if (!key) return;
        if (named.has(key) || [...named].some(k => canonMap.get(k) && canonMap.get(k) === canonMap.get(key) && canonMap.get(key))) {
            addChip(raw, 'dup', 'مكرر'); return;
        }
        let canon = canonMap.get(key) || null;
        if (!canon && item.open && window.__sura.aiJudge) {
            addChip(raw, 'pending', '…');
            const res = await window.__sura.aiJudge(item.category, raw);
            removePending();
            if (res && res.valid) canon = (res.canonical && String(res.canonical).trim()) || raw;
        }
        if (!canon) { addChip(raw, 'bad', '✗'); if (window.__sura.fx) window.__sura.fx.sfx('wrong'); return; }
        const canonKey = norm(canon);
        if (named.has(canonKey)) { addChip(raw, 'dup', 'مكرر'); return; }
        named.add(canonKey); namedList.push(canon);
        addChip(canon, 'ok', '✓');
        if (window.__sura.fx) { window.__sura.fx.sfx('warm', 0.9); window.__sura.fx.haptic(8); }
        const pc = document.getElementById('zayid-pc'); if (pc) pc.textContent = arNum(named.size);
        if (named.size >= proveTarget) finishProve(true);
    }
    let pendingChip = null;
    function addChip(text, cls, tag) {
        const c = document.getElementById('zayid-chips'); if (!c) return;
        const el = document.createElement('span');
        el.className = 'zayid-chip ' + cls;
        el.innerHTML = `${escapeHtmlShared(text)}${tag ? ` <i>${tag}</i>` : ''}`;
        c.appendChild(el);
        if (cls === 'pending') pendingChip = el;
    }
    function removePending() { if (pendingChip && pendingChip.parentNode) pendingChip.parentNode.removeChild(pendingChip); pendingChip = null; }

    function finishProve(delivered) {
        if (phase !== 'prove') return;
        clearTimer();
        const success = delivered || named.size >= proveTarget;
        const playerWon = (proveWho === 'p') ? success : !success;
        // record the player's own attempt into the pool (best-effort, signed-in)
        if (proveWho === 'p' && mode === 'ghost' && namedList && namedList.length >= 2) {
            window.__sura.zayidGhosts && window.__sura.zayidGhosts.record({
                category: item.category, name: pick(ALIASES),
                claimed: proveTarget, delivered: namedList.length, items: namedList.slice(0, 40)
            });
        }
        resolveRound(playerWon, proveWho === 'p'
            ? (success ? `ثبّتها! ذكرت ${arNum(named.size)}/${arNum(proveTarget)} ✅` : `ما وصلت — ذكرت ${arNum(named.size)} من ${arNum(proveTarget)} فقط`)
            : (success ? `${mode === 'friend' ? 'اللاعب ٢' : 'الخصم'} أثبت ${arNum(proveTarget)}` : `${mode === 'friend' ? 'اللاعب ٢' : 'الخصم'} عجز`));
    }

    // The ghost proves its bid from its recorded list (length K). If the human
    // bluffed above K it falls short and the player wins for calling. Recall runs
    // at a HUMAN pace — it "thinks", names slowly, and pauses to search — so it
    // never looks like a database dumping a list.
    function aiReveal(target) {
        say('');
        if (proveEl) { proveEl.classList.remove('hidden'); proveEl.innerHTML = `<div class="zayid-prove-head"><span>«${escapeHtmlShared(oName())}» يثبت كلامه — <b id="zayid-pc">0</b> / ${arNum(target)}</span></div><div class="zayid-chips" id="zayid-chips"></div>`; }
        const pool = (aiPool && aiPool.length ? aiPool : answerCanons).slice(0, aiK);
        const canDeliver = Math.min(target, pool.length);
        let i = 0;
        msg(`«${oName()}» يذكر... شوف يوصل ${arNum(target)} ولا يبلَف!`);
        const think = document.createElement('span');
        think.className = 'zayid-chip pending'; think.innerHTML = '<i>يفكّر…</i>';
        const chipsBox = document.getElementById('zayid-chips'); if (chipsBox) chipsBox.appendChild(think);
        const step = () => {
            if (think.parentNode) think.parentNode.removeChild(think);
            if (i < canDeliver) {
                addChip(pool[i], 'ok', '✓');
                const pc = document.getElementById('zayid-pc'); if (pc) pc.textContent = arNum(i + 1);
                if (window.__sura.fx) window.__sura.fx.sfx('tick');
                i++;
                let d = 1000 + Math.floor(Math.random() * 800);
                if (Math.random() < 0.2) { d += 800 + Math.floor(Math.random() * 900); if (chipsBox) chipsBox.appendChild(think); }
                timer = setTimeout(step, d);
                return;
            }
            const delivered = canDeliver >= target;
            if (!delivered) addChip('…عجز', 'bad', '✗');
            const playerWon = !delivered;
            resolveRound(playerWon, delivered ? `«${oName()}» ذكر ${arNum(target)} كاملة 😤` : `«${oName()}» بلَف! وقف عند ${arNum(canDeliver)} 🎉 كشفته`);
        };
        timer = setTimeout(step, 900 + Math.floor(Math.random() * 700));
    }

    // ---- timer ----
    function startTimer() {
        timeLeft = proveSecs;
        clearTimer();
        timer = setInterval(() => {
            timeLeft--;
            const t = document.getElementById('zayid-timer');
            if (t) { t.textContent = '⏱ ' + arNum(Math.max(0, timeLeft)); if (timeLeft <= 5) t.classList.add('low'); }
            if (timeLeft <= 0) { clearTimer(); finishProve(false); }
        }, 1000);
    }
    function clearTimer() { if (timer) { clearInterval(timer); clearTimeout(timer); timer = null; } }

    // ---- one round decides the level → straight to the result ----
    function resolveRound(playerWon, detail) {
        phase = 'roundend';
        clearTimer();
        pWon = playerWon;
        const banner = `<div class="zayid-banner ${playerWon ? 'win' : 'lose'}">${playerWon ? '🏆 فزت!' : '💤 خسرت'}</div>`;
        if (proveEl) proveEl.insertAdjacentHTML('afterbegin', banner);
        msg(detail || '');
        if (window.__sura.fx) window.__sura.fx.sfx(playerWon ? 'win' : 'wrong');
        setTimeout(endMatch, 1400);
    }

    function endMatch() {
        matchOver = true; phase = 'done';
        const won = !!pWon;
        const score01 = clamp((won ? 0.7 : 0.3) + 0.06 * (item.difficulty || 0), 0, 1);
        const res = (practiceIndex === null)
            ? L.finish('zayid', { won, score01 })
            : { rank: window.__sura.ranks.tierFor(score01).idx, tier: window.__sura.ranks.tierFor(score01) };
        const tier = res.tier || window.__sura.ranks.TIERS[res.rank];
        // oName() is a GHOST name straight out of the zayid_ghosts table, whose
        // read policy is `using (true)` and whose `name` column carries no CHECK.
        // Every other HTML sink in this file escapes it; this one must too, or a
        // row inserted by any signed-in account executes in the next player's origin.
        const head = won ? '🏆 كسبت المستوى!' : `خسرت — ${escapeHtmlShared(oName())} كسب`;
        if (proveEl) { proveEl.classList.remove('hidden'); proveEl.innerHTML = `<div class="zayid-banner ${won ? 'win' : 'lose'}">${head}</div><div class="zayid-final">${tier.icon} ${tier.name}</div>`; }
        if (bidEl) bidEl.innerHTML = '';
        say('');
        msg(won ? `أحسنت! ${tier.icon} ${tier.name}` : `حظ أوفر — التصنيف ${tier.icon} ${tier.name}`);
        if (actionsEl) actionsEl.classList.remove('hidden');
        const secs = Math.round((Date.now() - matchStartedAt) / 1000);
        modal.dataset.shareSummary = `زايد 🃏 «${item.category}»\n${won ? '🏆 كسبت' : 'خسرت'} · ${tier.icon} ${tier.name}`;
        if (mode === 'ghost') {
            G.submitResult({ puzzle_id: serverId, game_type: 'zayid', guess: { category: item.category, won: won ? 1 : 0, opponent: oName() }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            if (won) window.__sura.meta.serverStreak('zayid').then(streak => window.__sura.meta.onWin('zayid', { seconds: secs, streak, rank: res.rank, timed: res.timed, rushMax: res.rushMax }));
            else window.__sura.meta.onPartial('zayid', { rank: res.rank, kind: 'match_lost' });
        }
        L.showRetry(modal, 'zayid', () => startMatch());
    }

    let msgTimer = null;
    function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 4200); }

    // HUD hint: during the player's prove phase, reveal one still-unnamed answer.
    window.__sura.hints.register('zayid', () => {
        if (phase !== 'prove' || proveWho !== 'p') return { ok: false, message: 'التلميح يفيدك وقت تثبت كلامك فقط' };
        // عشوائيٌّ بلا ذاكرة كان يقترح الاسم نفسه مرّتين، والوقت في «إثبات
        // الكلام» محدود — فتلميحٌ مكرّر يكلّف ثوانٍ لا تُعوَّض.
        const H = window.__sura.hints.memo('zayid');
        const remaining = answerCanons.filter(a => !named.has(norm(a)) && !H.has(norm(a)));
        if (!remaining.length) return { ok: false, message: 'ما بقي عندي اسمٌ جديد أدلّك عليه' };
        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        H.take(norm(pick));
        return { ok: true, message: `جرّب: «${pick}»` };
    });

    async function openGame() {
        practiceIndex = null;
        await G.resolveSession();
        modal.classList.add('active');
        window.__sura.hints.mountChrome(modal, 'zayid');
        L.mountControls(modal, 'zayid', { onChange: () => { practiceIndex = null; serverGhosts = null; startMatch(); } });
        await loadBank();
        const puzzle = await G.fetchPuzzle('zayid');
        serverId = puzzle && puzzle.id ? puzzle.id : null;
        startMatch();
        // enrich the pool with REAL past players for this category (best-effort)
        if (window.__sura.zayidGhosts) {
            const cat = item && item.category;
            window.__sura.zayidGhosts.fetch(cat).then(rows => { if (rows && rows.length && item && item.category === cat) serverGhosts = rows; });
        }
    }

    const close = () => { clearTimer(); modal.classList.remove('active'); };
    if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
    if (playBtn) playBtn.addEventListener('click', openGame);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !matchOver && phase !== 'idle', close); });
    if (shareBtn) shareBtn.addEventListener('click', () => G.share('zayid', modal.dataset.shareSummary || ''));
}
