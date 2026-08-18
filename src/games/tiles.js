// games/tiles — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initTilesGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle } from '../core/util.js';

export function initTilesGame() {
        const modal = document.getElementById('tiles-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        // 21-level grid ladder: more tiles to remember each level (3 → 18 pairs).
        const TILE_DIMS = [
            { cols: 3, rows: 2 }, { cols: 4, rows: 2 }, { cols: 4, rows: 3 },          // سهل: 3,4,6 أزواج
            { cols: 4, rows: 4 }, { cols: 5, rows: 4 }, { cols: 6, rows: 4 }, { cols: 6, rows: 4 }, { cols: 7, rows: 4 }, { cols: 8, rows: 4 }, // متوسط: 8,10,12,12,14,16
            { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 }, { cols: 6, rows: 6 } // صعب: 18
        ];
        L.register('tiles', {
            mode: 'generated',
            diff: lv => TILE_DIMS[Math.min(lv, TILE_DIMS.length - 1)],
            rules: 'اقلب البلاطات وطابِق كل بلاطتين تحملان النقش نفسه حتى تُفرغ اللوحة. المطابقات المتتالية تبني سلسلة. كلّما تقدّمت المستويات زادت البلاطات وصعب الحفظ.'
        });
        const boardEl = document.getElementById('tiles-board');
        const msgEl = document.getElementById('tiles-message');
        const comboEl = document.getElementById('tiles-combo');
        const timerEl = document.getElementById('tiles-timer');
        const actionsEl = document.getElementById('tiles-actions');
        const shareBtn = document.getElementById('tiles-share-btn');
        const newBtn = document.getElementById('tiles-new-btn');
        const closeBtn = document.getElementById('tiles-modal-close');
        const trigger = document.getElementById('tiles-trigger-card');
        const playBtn = document.getElementById('tiles-play-btn');

        // 18 visually distinct zellige faces (geometric glyph + accent colour) —
        // enough for the hardest 6×6 board (18 pairs).
        const FACES = [
            { g: '✦', c: '#ff7e5f' }, { g: '❂', c: '#feb47b' }, { g: '✺', c: '#4db6a4' }, { g: '◆', c: '#7e9cff' },
            { g: '❋', c: '#e879b9' }, { g: '⬡', c: '#c9a227' }, { g: '✸', c: '#6dd36d' }, { g: '❄', c: '#9b8cff' },
            { g: '✶', c: '#ff9f43' }, { g: '⬢', c: '#4dc0e8' }, { g: '◈', c: '#ef6c6c' }, { g: '❉', c: '#b07cc6' },
            { g: '✷', c: '#f2c14e' }, { g: '✹', c: '#39b3a6' }, { g: '✵', c: '#ff6fae' }, { g: '⬣', c: '#5c7cfa' },
            { g: '❅', c: '#7bc96f' }, { g: '◉', c: '#d98c5f' }
        ];
        let COLS = 6, ROWS = 4, PAIRS = (COLS * ROWS) / 2;

        let tiles = [], sel = [], matched = 0, combo = 0, bestCombo = 0, busy = false,
            gameOver = false, serverId = null, startedAt = 0, timerInt = null, isDaily = true;

        function generate(seed) {
            const rng = mulberry32(seed);
            const faces = seededShuffle([...Array(FACES.length).keys()], rng).slice(0, PAIRS);
            const deck = seededShuffle(faces.concat(faces), rng);
            return deck.map((f, i) => ({ id: i, face: f, matched: false }));
        }

        function start(useDaily) {
            const lv = L.level('tiles');
            const dims = L.diffFor('tiles', lv);
            COLS = dims.cols; ROWS = dims.rows; PAIRS = (COLS * ROWS) / 2;
            const seed = useDaily ? L.levelSeed('tiles', lv) : Math.floor(suraDailySeed() + (typeof performance !== 'undefined' ? performance.now() : 1));
            isDaily = !!useDaily;
            tiles = generate(seed);
            sel = []; matched = 0; combo = 0; bestCombo = 0; busy = false; gameOver = false; startedAt = Date.now();
            window.__sura.hints.memo('tiles').reset();   // لوحٌ جديد ⇒ لا تلميح مُقدَّم
            if (actionsEl) actionsEl.classList.add('hidden');
            if (timerEl) timerEl.textContent = '0:00';
            renderCombo(); render(); msg(''); startTimer();
        }

        function render() {
            boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
            boardEl.innerHTML = '';
            tiles.forEach(t => {
                const el = document.createElement('button');
                el.className = 'zellige-tile';
                el.dataset.face = t.face;
                el.dataset.id = t.id;
                if (t.matched) el.classList.add('matched');
                if (sel.includes(t.id)) el.classList.add('sel');
                el.style.setProperty('--tile-accent', FACES[t.face].c);
                el.innerHTML = `<span class="zt-glyph">${FACES[t.face].g}</span>`;
                el.addEventListener('click', () => pick(t.id));
                boardEl.appendChild(el);
            });
        }

        function pick(id) {
            if (busy || gameOver) return;
            const t = tiles[id];
            if (!t || t.matched || sel.includes(id)) return;
            sel.push(id); render();
            if (sel.length === 2) {
                const [a, b] = sel;
                if (tiles[a].face === tiles[b].face) {
                    tiles[a].matched = tiles[b].matched = true;
                    matched += 2; combo++; bestCombo = Math.max(bestCombo, combo);
                    sel = []; renderCombo(); render();
                    msg(combo >= 3 ? `تطابق! سلسلة ×${G.arNum(combo)} 🔥` : 'تطابق!');
                    if (matched >= tiles.length) endGame();
                } else {
                    busy = true; combo = 0; renderCombo();
                    const wa = boardEl.querySelector(`[data-id="${a}"]`), wb = boardEl.querySelector(`[data-id="${b}"]`);
                    [wa, wb].forEach(x => x && x.classList.add('wrong'));
                    setTimeout(() => { sel = []; busy = false; render(); }, 650);
                }
            }
        }

        function endGame() {
            gameOver = true; stopTimer();
            const secs = Math.round((Date.now() - startedAt) / 1000);
            msg('رائع! أكملت اللوحة 🎉'); winWave();
            if (actionsEl) actionsEl.classList.remove('hidden');
            modal.dataset.shareSummary = `زليج: ${fmt(secs)} · أطول سلسلة ×${G.arNum(bestCombo)}`;
            G.submitResult({ puzzle_id: serverId, game_type: 'tiles', guess: { best_combo: bestCombo }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            window.__sura.meta.serverStreak('tiles').then(streak => window.__sura.meta.onWin('tiles', { seconds: secs, streak }));
            if (isDaily) L.won('tiles');
        }

        function winWave() {
            boardEl.querySelectorAll('.zellige-tile').forEach((c, i) => setTimeout(() => { c.style.boxShadow = '0 0 16px #ff7e5f'; setTimeout(() => c.style.boxShadow = '', 400); }, i * 35));
        }
        function renderCombo() { if (comboEl) comboEl.innerHTML = `سلسلة: <b>×${G.arNum(combo)}</b>`; }

        const fmt = s => `${G.arNum(Math.floor(s / 60))}:${G.arNum(String(s % 60).padStart(2, '0'))}`;
        function startTimer() { stopTimer(); timerInt = setInterval(() => { if (timerEl) timerEl.textContent = fmt(Math.round((Date.now() - startedAt) / 1000)); }, 1000); }
        function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

        let msgTimer = null;
        function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2000); }

        // Hint: pulse one currently-matchable pair.
        window.__sura.hints.register('tiles', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const byFace = {};
            tiles.forEach(t => { if (!t.matched) (byFace[t.face] = byFace[t.face] || []).push(t.id); });
            // `find` تقف على أول وجهٍ دائمًا، فكانت تومض البلاطتين نفسيهما مرارًا
            // إن لم يطابقهما اللاعب. وجهٌ لم يُلمَّح بعد، وإلّا فرفضٌ بلا خصم.
            const H = window.__sura.hints.memo('tiles');
            const entry = Object.entries(byFace).find(([f, ids]) => ids.length >= 2 && !H.has(f));
            const pair = entry && entry[1];
            if (!pair) return { ok: false, message: 'أومضتُ لك كل تطابقٍ متاح' };
            H.take(entry[0]);
            pair.slice(0, 2).forEach(id => { const el = boardEl.querySelector(`[data-id="${id}"]`); if (el) { el.classList.add('hint-cell'); setTimeout(() => el.classList.remove('hint-cell'), 2500); } });
            // نذكر النقش نفسه: كل تلميحٍ زوجٌ مختلف، والجملة الواحدة تُخفي ذلك.
            return { ok: true, message: `بلاطتا النقش ${FACES[entry[0]].g} تومضان لك` };
        });

        async function openGame() {
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'tiles');
            L.mountControls(modal, 'tiles', { onChange: () => { start(true); } });
            const puzzle = await G.fetchPuzzle('tiles');
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            start(true);
        }

        const close = () => { modal.classList.remove('active'); stopTimer(); };
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('tiles', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => start(false));
}
