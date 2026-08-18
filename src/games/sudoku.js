// games/sudoku — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initSudokuGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle } from '../core/util.js';

export function initSudokuGame() {
        const modal = document.getElementById('sudoku-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('sudoku', {
            mode: 'generated',
            // givens drop from 50 → 24 as you climb (fewer clues = harder)
            diff: lv => ({ clues: Math.max(24, Math.min(50, Math.round(50 - 1.3 * lv))) }),
            rules: 'املأ الشبكة 9×9 بحيث يحوي كل صف وكل عمود وكل مربّع 3×3 الأرقام 1 إلى 9 دون تكرار. كلّما تقدّمت المستويات بدأت بخانات أقل.'
        });
        const boardEl = document.getElementById('sudoku-board');
        const padEl = document.getElementById('sudoku-pad');
        const msgEl = document.getElementById('sudoku-message');
        const actionsEl = document.getElementById('sudoku-actions');
        const timerEl = document.getElementById('sudoku-timer');
        const notesBtn = document.getElementById('sudoku-notes');
        const eraseBtn = document.getElementById('sudoku-erase');
        const closeBtn = document.getElementById('sudoku-modal-close');
        const trigger = document.getElementById('sudoku-trigger-card');
        const playBtn = document.getElementById('sudoku-play-btn');
        const shareBtn = document.getElementById('sudoku-share-btn');
        const newBtn = document.getElementById('sudoku-new-btn');

        let givens = [], grid = [], solution = [], notes = [], sel = -1,
            notesMode = false, gameOver = false, startedAt = 0, serverId = null, timerInt = null, isDaily = true;

        function boxOk(g, i, v) {
            const r = (i / 9) | 0, c = i % 9;
            for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false; }
            const br = ((r / 3) | 0) * 3, bc = ((c / 3) | 0) * 3;
            for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (g[(br + dr) * 9 + bc + dc] === v) return false;
            return true;
        }
        function fillGrid(g, rng) {
            const i = g.indexOf(0);
            if (i === -1) return true;
            const nums = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
            for (const v of nums) { if (boxOk(g, i, v)) { g[i] = v; if (fillGrid(g, rng)) return true; g[i] = 0; } }
            return false;
        }
        function countSol(g, limit) {
            const i = g.indexOf(0);
            if (i === -1) return 1;
            let n = 0;
            for (let v = 1; v <= 9; v++) { if (boxOk(g, i, v)) { g[i] = v; n += countSol(g, limit); g[i] = 0; if (n >= limit) break; } }
            return n;
        }
        function generate(seed, clues) {
            const rng = mulberry32(seed);
            const full = new Array(81).fill(0); fillGrid(full, rng);
            const puz = full.slice();
            const order = seededShuffle([...Array(81).keys()], rng);
            let count = 81;
            for (const idx of order) {
                if (count <= clues) break;
                const bak = puz[idx];
                puz[idx] = 0;
                if (countSol(puz.slice(), 2) !== 1) puz[idx] = bak; else count--;
            }
            return { givens: puz, solution: full };
        }

        const valAt = i => givens[i] !== 0 ? givens[i] : grid[i];

        // التعارضات دفعةً واحدة بعدّادات الصفّ والعمود والمربّع.
        //
        // كان `conflictAt(i)` يمسح ٢٧ خانة لكلّ خانة، فالشبكة الممتلئة ٨١×٢٧ =
        // ٢١٨٧ نداء `valAt` في كلّ إعادة رسم — وكانت إعادة الرسم تقع على مجرّد
        // **اختيار** خليّة. هذا المرور مرّتان على ٨١ خانة: تُعدّ الأرقام، ثم
        // تُعلَّم كلّ خانةٍ رقمُها مكرّرٌ في أحد الثلاثة. O(٨١) بدل O(٨١·٢٧)،
        // والنتيجة متطابقة.
        const rowCnt = new Uint8Array(90), colCnt = new Uint8Array(90), boxCnt = new Uint8Array(90);
        const conflicts = new Uint8Array(81);
        function computeConflicts() {
            rowCnt.fill(0); colCnt.fill(0); boxCnt.fill(0); conflicts.fill(0);
            for (let i = 0; i < 81; i++) {
                const v = valAt(i);
                if (v === 0) continue;
                const r = (i / 9) | 0, c = i % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
                rowCnt[r * 10 + v]++; colCnt[c * 10 + v]++; boxCnt[b * 10 + v]++;
            }
            for (let i = 0; i < 81; i++) {
                const v = valAt(i);
                if (v === 0) continue;
                const r = (i / 9) | 0, c = i % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
                if (rowCnt[r * 10 + v] > 1 || colCnt[c * 10 + v] > 1 || boxCnt[b * 10 + v] > 1) conflicts[i] = 1;
            }
        }

        // الشبكة تُبنى مرّةً واحدة. كانت `render()` تهدم ٨١ عنصرًا وتنشئ ٨١
        // بديلًا و٨١ مستمعًا على **كلّ نقرة**، فمجرّد اختيار خليّة كان يعيد
        // تخطيط الشبكة كلّها. الآن: عناصرُ ثابتة، مستمعٌ واحدٌ مفوَّض، والرسم
        // تحديثُ نصٍّ وأصنافٍ في مكانها.
        let cells = null;
        function buildBoard() {
            boardEl.innerHTML = '';
            const frag = document.createDocumentFragment();
            cells = new Array(81);
            for (let i = 0; i < 81; i++) {
                const c = document.createElement('div');
                const col = i % 9, row = (i / 9) | 0;
                c.className = 'sudoku-cell'
                    + (col % 3 === 0 && col !== 0 ? ' bl' : '')
                    + (row % 3 === 0 && row !== 0 ? ' bt' : '');
                cells[i] = c;
                frag.appendChild(c);
            }
            boardEl.appendChild(frag);
            // مستمعٌ واحدٌ للشبكة كلّها. `cells.indexOf` على ٨١ عنصرًا مرّةً
            // لكلّ نقرةٍ بشريّة لا يُقاس، ويُغني عن ٨١ إغلاقًا.
            boardEl.addEventListener('click', e => {
                const cell = e.target.closest('.sudoku-cell');
                if (!cell || cell.parentNode !== boardEl) return;
                const i = cells.indexOf(cell);
                if (i >= 0) { sel = i; render(); }
            });
        }

        const NOTE_SLOTS = Array.from({ length: 9 }, (_, n) => n + 1);
        function render() {
            if (!cells) buildBoard();
            computeConflicts();
            const selVal = sel >= 0 ? valAt(sel) : 0;
            for (let i = 0; i < 81; i++) {
                const c = cells[i];
                const col = i % 9, row = (i / 9) | 0;
                let cls = 'sudoku-cell'
                    + (col % 3 === 0 && col !== 0 ? ' bl' : '')
                    + (row % 3 === 0 && row !== 0 ? ' bt' : '');
                let text = '', notesHtml = null;
                if (givens[i] !== 0) { cls += ' given'; text = G.arNum(givens[i]); }
                else if (grid[i] !== 0) {
                    text = G.arNum(grid[i]);
                    if (conflicts[i]) cls += ' conflict';
                } else if (notes[i] && notes[i].size) {
                    cls += ' has-notes';
                    notesHtml = `<div class="s-notes">${NOTE_SLOTS.map(n => `<span>${notes[i].has(n) ? G.arNum(n) : ''}</span>`).join('')}</div>`;
                }
                if (i === sel) cls += ' selected';
                else if (sel >= 0 && selVal !== 0 && valAt(i) === selVal) cls += ' same';

                if (c.className !== cls) c.className = cls;
                if (notesHtml !== null) { if (c.innerHTML !== notesHtml) c.innerHTML = notesHtml; }
                else if (c.textContent !== text) c.textContent = text;
            }
        }

        function renderPad() {
            padEl.innerHTML = '';
            for (let n = 1; n <= 9; n++) {
                const b = document.createElement('button');
                b.className = 'sudoku-key';
                b.textContent = G.arNum(n);
                b.addEventListener('click', () => place(n));
                padEl.appendChild(b);
            }
        }

        function place(n) {
            if (gameOver || sel < 0 || givens[sel] !== 0) return;
            if (notesMode) {
                if (!notes[sel]) notes[sel] = new Set();
                if (notes[sel].has(n)) notes[sel].delete(n); else notes[sel].add(n);
            } else {
                grid[sel] = n;
                if (notes[sel]) notes[sel].clear();
            }
            render(); checkWin();
        }
        function erase() {
            if (gameOver || sel < 0 || givens[sel] !== 0) return;
            grid[sel] = 0; if (notes[sel]) notes[sel].clear(); render();
        }
        function checkWin() {
            for (let i = 0; i < 81; i++) if (valAt(i) !== solution[i]) return;
            endGame();
        }

        function endGame() {
            gameOver = true; stopTimer(); winWave();
            msg('أحسنت! أكملت الشبكة 🎉');
            actionsEl.classList.remove('hidden');
            const secs = Math.round((Date.now() - startedAt) / 1000);
            modal.dataset.shareSummary = `سودوكو: ${fmt(secs)}`;
            G.submitResult(
                { puzzle_id: serverId, game_type: 'sudoku', guess: { grid: grid.slice() }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); }
            );
            window.__sura.meta.serverStreak('sudoku').then(streak => window.__sura.meta.onWin('sudoku', { seconds: secs, streak }));
            if (isDaily) L.won('sudoku');
        }

        function winWave() {
            for (let r = 0; r < 9; r++) setTimeout(() => {
                for (let c = 0; c < 9; c++) {
                    const cell = boardEl.children[r * 9 + c];
                    if (!cell) continue;
                    cell.style.boxShadow = 'inset 0 0 14px #ff7e5f';
                    setTimeout(() => { cell.style.boxShadow = ''; }, 420);
                }
            }, r * 90);
        }

        const fmt = s => `${G.arNum(Math.floor(s / 60))}:${G.arNum(String(s % 60).padStart(2, '0'))}`;
        function startTimer() {
            stopTimer();
            timerInt = setInterval(() => {
                if (timerEl) timerEl.textContent = fmt(Math.round((Date.now() - startedAt) / 1000));
            }, 1000);
        }
        function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

        let msgTimer = null;
        function msg(t) {
            if (!msgEl) return;
            msgEl.textContent = t;
            msgEl.classList.toggle('visible', !!t);
            clearTimeout(msgTimer);
            if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2500);
        }

        function start(useDaily) {
            const lv = L.level('sudoku');
            const seed = useDaily ? L.levelSeed('sudoku', lv) : Math.floor(suraDailySeed() + (typeof performance !== 'undefined' ? performance.now() : 1));
            const { clues } = L.diffFor('sudoku', lv);
            isDaily = !!useDaily;
            const res = generate(seed, clues);
            givens = res.givens; solution = res.solution; grid = givens.slice();
            notes = Array(81).fill(null); sel = -1; gameOver = false; notesMode = false;
            if (notesBtn) notesBtn.classList.remove('active');
            startedAt = Date.now();
            actionsEl.classList.add('hidden'); msg('');
            if (timerEl) timerEl.textContent = '0:00';
            renderPad(); render(); startTimer();
        }

        window.__sura.hints.register('sudoku', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const empties = [];
            for (let i = 0; i < 81; i++) if (givens[i] === 0 && grid[i] !== solution[i]) empties.push(i);
            if (!empties.length) return { ok: false, message: 'لا توجد خانة لكشفها' };
            const i = empties[Math.floor(Math.random() * empties.length)];
            grid[i] = solution[i]; if (notes[i]) notes[i].clear();
            sel = i; render(); checkWin();
            // تسمية الخانة ضرورية: كل كشفٍ خانةٌ مختلفة، لكن جملةً واحدة تتكرّر
            // تقرأ عند اللاعب «نفس التلميح مرّة ثانية» ولو تغيّر اللوح فعلًا.
            return {
                ok: true,
                message: `كشفنا الخانة (صفّ ${G.arNum(Math.floor(i / 9) + 1)} · عمود ${G.arNum(i % 9 + 1)}) = ${G.arNum(solution[i])}`
            };
        });

        async function openGame() {
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'sudoku');
            L.mountControls(modal, 'sudoku', { onChange: () => { start(true); } });
            const puzzle = await G.fetchPuzzle('sudoku');
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            start(true);
        }

        const close = () => { modal.classList.remove('active'); stopTimer(); };
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (eraseBtn) eraseBtn.addEventListener('click', erase);
        if (notesBtn) notesBtn.addEventListener('click', () => { notesMode = !notesMode; notesBtn.classList.toggle('active', notesMode); });
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('sudoku', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => start(false));

        document.addEventListener('keydown', e => {
            if (!modal.classList.contains('active') || gameOver) return;
            if (e.key >= '1' && e.key <= '9') { place(parseInt(e.key, 10)); return; }
            if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { erase(); return; }
            if (sel < 0) return;
            const r = (sel / 9) | 0, c = sel % 9;
            if (e.key === 'ArrowLeft') { sel = r * 9 + Math.min(8, c + 1); render(); }       // RTL: left = next
            else if (e.key === 'ArrowRight') { sel = r * 9 + Math.max(0, c - 1); render(); }
            else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 9); render(); }
            else if (e.key === 'ArrowDown') { sel = Math.min(80, sel + 9); render(); }
        });
}
