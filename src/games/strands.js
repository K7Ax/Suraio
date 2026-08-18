// games/strands — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initStrandsGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle, loadBankJSON } from '../core/util.js';

export function initStrandsGame() {
        const modal = document.getElementById('strands-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('strands', {
            mode: 'bank',
            diff: () => ({}),
            rules: 'جِد كل الكلمات المرتبطة بالموضوع على الشبكة بالتنقل بين الحروف المتجاورة (8 اتجاهات). الكلمة الذهبية «سبانجرام» تمر عبر اللوح كله. كلّما تقدّمت المستويات صارت الكلمات أطول وأصعب.'
        });
        const boardEl = document.getElementById('strands-board');
        const themeEl = document.getElementById('strands-theme');
        const progEl = document.getElementById('strands-progress');
        const msgEl = document.getElementById('strands-message');
        const clearBtn = document.getElementById('strands-clear');
        const actionsEl = document.getElementById('strands-actions');
        const shareBtn = document.getElementById('strands-share-btn');
        const newBtn = document.getElementById('strands-new-btn');
        const closeBtn = document.getElementById('strands-modal-close');
        const trigger = document.getElementById('strands-trigger-card');
        const playBtn = document.getElementById('strands-play-btn');

        const PALETTE = ['#264a37', '#b07c2a', '#ab442d', '#472652', '#2e5a7a', '#6a3d6e'];
        const SPAN_COLOR = '#caa43a';
        const FALLBACK = [{
            theme: 'مدن سعودية', spangram: 'السعوديه', words: ['الرياض', 'جده', 'مكه'],
            rows: 4, cols: 4,
            grid: ['السع', 'ضايو', 'ايرد', 'جهكم'],
            placements: { 'السعوديه': [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [2, 2], [2, 1], [2, 0]] }
        }];
        let BANK = [], bankLoaded = false;
        async function loadBank() {
            if (bankLoaded) return;
            BANK = await loadBankJSON('bank/strands.json', FALLBACK, 'خيوط');
            if (!BANK || !BANK.length) BANK = FALLBACK;
            bankLoaded = true;
        }

        let rows = 0, cols = 0, grid = [], placements = {}, themeWords = [], spangram = '',
            found = new Set(), path = [], cellWord = {}, gameOver = false, serverId = null,
            practiceIndex = null, startedAt = 0, firstFound = null;

        function startWith(p) {
            rows = p.rows; cols = p.cols;
            grid = p.grid.map(r => r.split(''));
            placements = p.placements || {};
            spangram = normalizeArabic(p.spangram);
            themeWords = [spangram, ...p.words.map(normalizeArabic)];
            found = new Set(); path = []; cellWord = {}; gameOver = false; startedAt = Date.now(); firstFound = null;
            window.__sura.hints.memo('strands').reset();   // لوحٌ جديد ⇒ لا تلميح مُقدَّم
            if (themeEl) themeEl.textContent = p.theme;
            if (actionsEl) actionsEl.classList.add('hidden');
            renderBoard(); renderProgress(); msg('');
        }
        function startDaily() {
            const lv = L.level('strands');
            const idx = L.pickBankIndex('strands', BANK, lv, practiceIndex !== null);
            startWith(BANK[idx] || BANK[0]);
        }

        const adj = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && !(a[0] === b[0] && a[1] === b[1]);
        const inPath = (r, c) => path.some(p => p[0] === r && p[1] === c);
        const eqPath = (A, B) => A.length === B.length && A.every((p, i) => p[0] === B[i][0] && p[1] === B[i][1]);

        function tap(r, c) {
            if (gameOver) return;
            if (cellWord[`${r},${c}`] !== undefined) return;           // already part of a found word
            const last = path[path.length - 1];
            if (!path.length) path = [[r, c]];
            else if (inPath(r, c)) {
                if (last[0] === r && last[1] === c) { path = []; }       // tap last cell again to reset
                else return;
            } else if (adj(last, [r, c])) path.push([r, c]);
            else path = [[r, c]];
            renderBoard();
            checkMatch();
        }

        function checkMatch() {
            for (const w of themeWords) {
                if (found.has(w)) continue;
                const pl = placements[w];
                if (!pl) continue;
                if (eqPath(path, pl) || eqPath(path, pl.slice().reverse())) { accept(w, pl); return; }
            }
        }

        function accept(word, pl) {
            if (firstFound === null) firstFound = word; // for the "spangram first" mission
            found.add(word);
            const isSpan = word === spangram;
            const color = isSpan ? SPAN_COLOR : PALETTE[(found.size - 1) % PALETTE.length];
            pl.forEach(([r, c]) => { cellWord[`${r},${c}`] = color; });
            path = [];
            renderBoard(); renderProgress();
            msg(isSpan ? 'وجدت الكلمة الممتدة! ✨' : 'أحسنت!');
            if (found.size === themeWords.length) endGame();
        }

        function endGame() {
            gameOver = true;
            msg('رائع! وجدت كل الكلمات 🎉');
            if (actionsEl) actionsEl.classList.remove('hidden');
            celebrate();
            const secs = Math.round((Date.now() - startedAt) / 1000);
            modal.dataset.shareSummary = `خيوط: ${G.arNum(themeWords.length)} كلمات`;
            G.submitResult({ puzzle_id: serverId, game_type: 'strands', guess: { found: [...found] }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            window.__sura.meta.serverStreak('strands').then(streak => window.__sura.meta.onWin('strands', { seconds: secs, streak }));
            if (practiceIndex === null) L.won('strands');
        }

        // اللوح يُبنى عند تغيّر شكله وحده. كانت كلّ نقرةٍ تهدم ٤٨ زرًّا وتنشئ
        // ٤٨ بديلًا و٤٨ مستمعًا، فتعيد تخطيط الشبكة كاملةً لتلوين خليّةٍ واحدة.
        // الآن: مستمعٌ واحدٌ مفوَّض، وأصنافٌ تُحدَّث في مكانها.
        let cells = null, builtFor = '';
        function buildBoard() {
            boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
            boardEl.innerHTML = '';
            const frag = document.createDocumentFragment();
            cells = [];
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const cell = document.createElement('button');
                cell.className = 'strand-cell';
                cell.dataset.r = r; cell.dataset.c = c;
                cells.push(cell);
                frag.appendChild(cell);
            }
            boardEl.appendChild(frag);
            if (!boardEl.dataset.bound) {
                boardEl.dataset.bound = '1';
                boardEl.addEventListener('click', e => {
                    const cell = e.target.closest('.strand-cell');
                    if (!cell || cell.parentNode !== boardEl) return;
                    tap(+cell.dataset.r, +cell.dataset.c);
                });
            }
        }

        function renderBoard() {
            const shape = `${rows}x${cols}`;
            if (!cells || builtFor !== shape) { buildBoard(); builtFor = shape; }
            let i = 0;
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, i++) {
                const cell = cells[i];
                const ch = grid[r][c];
                if (cell.textContent !== ch) cell.textContent = ch;
                const fc = cellWord[`${r},${c}`];
                let cls = 'strand-cell';
                if (fc) cls += ' found';
                if (inPath(r, c)) cls += ' in-path';
                if (cell.className !== cls) cell.className = cls;
                // القراءة من `style.background` تعود مُطبَّعةً (`rgb(...)`) فلا
                // تطابق ما كُتب أبدًا، فيسقط الحارس. العلامة هي ما كُتب فعلًا.
                const bg = fc || '';
                if (cell.dataset.bg !== bg) {
                    cell.dataset.bg = bg;
                    cell.style.background = bg;
                    cell.style.borderColor = bg;
                }
            }
        }
        function renderProgress() { if (progEl) progEl.textContent = `${G.arNum(found.size)}/${G.arNum(themeWords.length)}`; }

        function celebrate() {
            const cells = boardEl.querySelectorAll('.strand-cell.found');
            cells.forEach((c, i) => setTimeout(() => { c.style.boxShadow = '0 0 16px #ff7e5f'; setTimeout(() => c.style.boxShadow = '', 400); }, i * 40));
        }

        let msgTimer = null;
        function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2200); }

        // Hint: highlight the start cell of an unfound themed word.
        window.__sura.hints.register('strands', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const H = window.__sura.hints.memo('strands');
            const rest = themeWords.filter(w => !found.has(w) && placements[w]);
            if (!rest.length) return { ok: false, message: 'وجدت كل الكلمات!' };
            // الاختيار العشوائي كان يعيد الكلمة نفسها ويخصم تلميحًا ثانيًا بلا
            // معلومةٍ جديدة. نقدّم كلمةً لم تُضأ بعد، فإن لم تبقَ فالردّ رفضٌ.
            const virgin = rest.filter(w => !H.has(w));
            if (!virgin.length) return { ok: false, message: 'أضأتُ لك بداية كل كلمةٍ متبقّية' };
            const w = virgin[Math.floor(Math.random() * virgin.length)];
            H.take(w);
            const [r, c] = placements[w][0];
            const idx = r * cols + c;
            const cell = boardEl.children[idx];
            if (cell) { cell.classList.add('hint-cell'); setTimeout(() => cell.classList.remove('hint-cell'), 3000); }
            // نذكر حرف البداية: كلمتان بالطول نفسه كانتا تُنتجان الجملة ذاتها،
            // فتبدو الخانة المضيئة الجديدة تكرارًا للقديمة.
            return { ok: true, message: `ابدأ من الحرف «${w[0]}» المضيء (${G.arNum(w.length)} أحرف)` };
        });
        window.__sura.hints.registerCtx('strands', () => {
            if (gameOver || !themeWords.length) return null;
            const rest = themeWords.filter(w => !found.has(w));
            if (!rest.length) return null;
            return {
                difficulty: L.bandOf(L.level('strands')).key,
                player_state: `وجدت ${found.size} من ${themeWords.length} كلمة`,
                safe_context: `الموضوع: «${(themeEl && themeEl.textContent) || ''}»`,
                solution: `الكلمة الجامعة: ${spangram} | الكلمات: ${rest.join('، ')}`
            };
        });

        async function openGame() {
            practiceIndex = null;
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'strands');
            L.mountControls(modal, 'strands', { onChange: () => { practiceIndex = null; startDaily(); } });
            await loadBank();
            const puzzle = await G.fetchPuzzle('strands');
            // campaign board is level-seeded; serverId (if any) only posts the result
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            startDaily();
        }

        const close = () => modal.classList.remove('active');
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (clearBtn) clearBtn.addEventListener('click', () => { path = []; renderBoard(); });
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('strands', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => { serverId = null; practiceIndex = Math.floor(Math.random() * Math.max(1, BANK.length)); startDaily(); practiceIndex = null; });
}
