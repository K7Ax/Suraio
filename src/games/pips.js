// games/pips — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initPipsGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle } from '../core/util.js';

export function initPipsGame() {
        const modal = document.getElementById('pips-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        // 21-level board ladder. N (= r*c) MUST stay even for domino tiling;
        // bigger board + larger regions = harder constraints.
        const PIP_DIMS = [
            { r: 3, c: 2, span: 2 }, { r: 4, c: 2, span: 2 }, { r: 4, c: 2, span: 2 },          // سهل: 6,8,8
            { r: 4, c: 3, span: 3 }, { r: 4, c: 3, span: 3 }, { r: 4, c: 4, span: 3 }, { r: 4, c: 4, span: 3 }, { r: 5, c: 4, span: 3 }, { r: 5, c: 4, span: 3 }, // متوسط: 12,12,16,16,20,20
            { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 }, { r: 6, c: 4, span: 4 } // صعب: 24
        ];
        L.register('pips', {
            mode: 'generated',
            diff: lv => PIP_DIMS[Math.min(lv, PIP_DIMS.length - 1)],
            rules: 'ضع أحجار الدومينو (نقاط 0–6) على اللوح بحيث تحقّق كل منطقة شرطها: «=» كل خاناتها متساوية، و«Σ» مجموع خاناتها يساوي الرقم. كلّما تقدّمت المستويات كبر اللوح وزادت قيوده.'
        });
        const boardEl = document.getElementById('pips-board');
        const handEl = document.getElementById('pips-hand');
        const msgEl = document.getElementById('pips-message');
        const timerEl = document.getElementById('pips-timer');
        const actionsEl = document.getElementById('pips-actions');
        const shareBtn = document.getElementById('pips-share-btn');
        const newBtn = document.getElementById('pips-new-btn');
        const closeBtn = document.getElementById('pips-modal-close');
        const trigger = document.getElementById('pips-trigger-card');
        const playBtn = document.getElementById('pips-play-btn');

        let R = 4, C = 3, N = R * C, regionSpan = 3;
        let cells = [], regions = [], hand = [], handOrder = [], solution = [], pending = [],
            gameOver = false, serverId = null, startedAt = 0, timerInt = null, isDaily = true;

        const neighbors = i => {
            const r = (i / C) | 0, c = i % C, out = [];
            if (c + 1 < C) out.push(i + 1); if (c - 1 >= 0) out.push(i - 1);
            if (r + 1 < R) out.push(i + C); if (r - 1 >= 0) out.push(i - C);
            return out;
        };
        const adjacent = (a, b) => neighbors(a).includes(b);

        function tile(rng) {
            const cov = Array(N).fill(false), pairs = [];
            function rec() {
                const i = cov.indexOf(false);
                if (i === -1) return true;
                cov[i] = true;
                const r = (i / C) | 0, c = i % C, nb = [];
                if (c + 1 < C) nb.push(i + 1);
                if (r + 1 < R) nb.push(i + C);
                for (const j of seededShuffle(nb, rng)) {
                    if (!cov[j]) { cov[j] = true; pairs.push([i, j]); if (rec()) return true; pairs.pop(); cov[j] = false; }
                }
                cov[i] = false; return false;
            }
            return rec() ? pairs : null;
        }

        function makeRegions(rng, val) {
            const reg = Array(N).fill(-1); let id = 0;
            for (let s = 0; s < N; s++) {
                if (reg[s] !== -1) continue;
                const size = 2 + Math.floor(rng() * regionSpan);
                const q = [s]; reg[s] = id; let cnt = 1;
                while (q.length && cnt < size) {
                    const cur = q.shift();
                    for (const n of seededShuffle(neighbors(cur).filter(x => reg[x] === -1), rng)) {
                        if (cnt >= size) break; reg[n] = id; q.push(n); cnt++;
                    }
                }
                id++;
            }
            // merge singletons into a neighbouring region
            for (let i = 0; i < N; i++) {
                if (reg.filter(x => x === reg[i]).length === 1) {
                    const nb = neighbors(i).find(n => reg[n] !== reg[i]);
                    if (nb != null) reg[i] = reg[nb];
                }
            }
            // re-pack ids
            const map = {}; let k = 0;
            reg.forEach(x => { if (!(x in map)) map[x] = k++; });
            const packed = reg.map(x => map[x]);
            const regs = [];
            for (let g = 0; g < k; g++) {
                const cs = []; for (let i = 0; i < N; i++) if (packed[i] === g) cs.push(i);
                const vals = cs.map(i => val[i]);
                const allEq = vals.every(v => v === vals[0]);
                regs.push({ id: g, cells: cs, type: allEq && cs.length > 1 ? 'equal' : 'sum', target: vals.reduce((a, b) => a + b, 0) });
            }
            return { reg: packed, regs };
        }

        function generate(seed) {
            const rng = mulberry32(seed);
            let pairs = null;
            for (let t = 0; t < 50 && !pairs; t++) pairs = tile(rng);
            if (!pairs) pairs = []; // shouldn't happen for 4x3
            const val = Array(N).fill(0);
            const sol = [], h = [];
            pairs.forEach((pr, k) => {
                const a = Math.floor(rng() * 7), b = Math.floor(rng() * 7);
                val[pr[0]] = a; val[pr[1]] = b;
                sol.push({ domId: k, cells: [pr[0], pr[1]], vals: [a, b] });
                h.push({ id: k, a, b, placed: false });
            });
            const { reg, regs } = makeRegions(rng, val);
            // hand stays in id order (so hand[id] is valid everywhere); display
            // order is shuffled so the solution isn't given away by position.
            return { reg, regs, hand: h, order: seededShuffle(h.map(x => x.id), rng), sol, val };
        }

        function start(useDaily) {
            const lv = L.level('pips');
            const dims = L.diffFor('pips', lv);
            R = dims.r; C = dims.c; N = R * C; regionSpan = dims.span;
            const seed = useDaily ? L.levelSeed('pips', lv) : Math.floor(suraDailySeed() + (typeof performance !== 'undefined' ? performance.now() : 1));
            isDaily = !!useDaily;
            const g = generate(seed);
            cells = Array.from({ length: N }, (_, i) => ({ region: g.reg[i], placed: null }));
            regions = g.regs; hand = g.hand; handOrder = g.order; solution = g.sol; pending = [];
            gameOver = false; startedAt = Date.now();
            modal.__sol = solution; // exposed for automated tests only
            if (actionsEl) actionsEl.classList.add('hidden');
            if (timerEl) timerEl.textContent = '0:00';
            renderBoard(); renderHand(); msg(''); startTimer();
        }

        // pip-dot face for 0..6
        const DOTS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
        function pipFace(n) {
            return `<span class="pip-face">${Array.from({ length: 9 }, (_, k) => `<i class="${DOTS[n].includes(k) ? 'on' : ''}"></i>`).join('')}</span>`;
        }

        function regionBadge(rg) {
            return rg.type === 'equal' ? '<span class="pip-badge">=</span>' : `<span class="pip-badge">Σ ${G.arNum(rg.target)}</span>`;
        }

        function renderBoard() {
            boardEl.style.gridTemplateColumns = `repeat(${C}, 1fr)`;
            boardEl.innerHTML = '';
            // first cell (top-left-most) of each region carries the badge
            const badgeCell = {};
            regions.forEach(rg => { badgeCell[rg.cells[0]] = rg; });
            for (let i = 0; i < N; i++) {
                const cell = document.createElement('button');
                cell.className = 'pip-cell';
                cell.dataset.i = i;
                const reg = cells[i].region;
                // region borders: thick edge where neighbour differs / board edge
                const r = (i / C) | 0, c = i % C;
                if (c === 0 || cells[i - 1].region !== reg) cell.classList.add('br-r'); // RTL: right side is "start"
                if (c === C - 1 || cells[i + 1].region !== reg) cell.classList.add('br-l');
                if (r === 0 || cells[i - C].region !== reg) cell.classList.add('br-t');
                if (r === R - 1 || cells[i + C].region !== reg) cell.classList.add('br-b');
                if (pending.includes(i)) cell.classList.add('pending');
                if (cells[i].placed) { cell.classList.add('filled'); cell.innerHTML = pipFace(cells[i].placed.value); }
                else if (badgeCell[i]) cell.innerHTML = regionBadge(badgeCell[i]);
                if (badgeCell[i] && cells[i].placed) cell.innerHTML += regionBadge(badgeCell[i]); // keep badge visible
                cell.addEventListener('click', () => clickCell(i));
                boardEl.appendChild(cell);
            }
            // region-satisfied highlight
            regions.forEach(rg => {
                const sat = regionState(rg);
                rg.cells.forEach(ci => { const el = boardEl.children[ci]; if (sat === 'ok') el.classList.add('reg-ok'); else if (sat === 'bad') el.classList.add('reg-bad'); });
            });
        }

        function renderHand() {
            handEl.innerHTML = '';
            handOrder.forEach(id => {
                const d = hand[id];
                const el = document.createElement('button');
                el.className = 'pip-domino' + (d.placed ? ' placed' : '');
                el.dataset.dom = d.id;
                el.innerHTML = `${pipFace(d.a)}<span class="pip-div"></span>${pipFace(d.b)}`;
                el.addEventListener('click', () => clickDomino(d.id));
                handEl.appendChild(el);
            });
        }

        function regionState(rg) {
            const placed = rg.cells.filter(i => cells[i].placed);
            if (placed.length < rg.cells.length) return 'partial';
            const vals = rg.cells.map(i => cells[i].placed.value);
            if (rg.type === 'equal') return vals.every(v => v === vals[0]) ? 'ok' : 'bad';
            return vals.reduce((a, b) => a + b, 0) === rg.target ? 'ok' : 'bad';
        }

        function clickCell(i) {
            if (gameOver) return;
            if (cells[i].placed) { removeDomino(i); return; }
            if (!pending.length) pending = [i];
            else if (pending.length === 1) {
                if (pending[0] === i) pending = [];
                else if (adjacent(pending[0], i)) pending = [pending[0], i];
                else pending = [i];
            } else pending = [i];
            renderBoard();
        }

        function clickDomino(domId) {
            if (gameOver) return;
            const d = hand.find(h => h.id === domId);
            if (!d || d.placed) return;
            if (pending.length !== 2) { msg('اختر خانتين فارغتين متجاورتين أولاً'); return; }
            cells[pending[0]].placed = { domId, value: d.a };
            cells[pending[1]].placed = { domId, value: d.b };
            d.placed = true; d.at = [pending[0], pending[1]];
            pending = [];
            renderBoard(); renderHand(); checkWin();
        }

        function removeDomino(cellIdx) {
            const domId = cells[cellIdx].placed.domId;
            cells.forEach(c => { if (c.placed && c.placed.domId === domId) c.placed = null; });
            const d = hand.find(h => h.id === domId); if (d) { d.placed = false; d.at = null; }
            renderBoard(); renderHand();
        }

        function checkWin() {
            if (cells.some(c => !c.placed)) return;
            if (!regions.every(rg => regionState(rg) === 'ok')) { msg('بعض المناطق غير محقّقة'); return; }
            endGame();
        }

        function endGame() {
            gameOver = true; stopTimer();
            const secs = Math.round((Date.now() - startedAt) / 1000);
            msg('رائع! حللت كل المناطق 🎉'); winWave();
            if (actionsEl) actionsEl.classList.remove('hidden');
            modal.dataset.shareSummary = `نقاط: ${fmt(secs)}`;
            G.submitResult({ puzzle_id: serverId, game_type: 'pips', guess: { solved: true }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            window.__sura.meta.serverStreak('pips').then(streak => window.__sura.meta.onWin('pips', { seconds: secs, streak }));
            if (isDaily) L.won('pips');
        }

        function winWave() {
            boardEl.querySelectorAll('.pip-cell').forEach((c, i) => setTimeout(() => { c.style.boxShadow = 'inset 0 0 14px #ff7e5f'; setTimeout(() => c.style.boxShadow = '', 400); }, i * 60));
        }

        const fmt = s => `${G.arNum(Math.floor(s / 60))}:${G.arNum(String(s % 60).padStart(2, '0'))}`;
        function startTimer() { stopTimer(); timerInt = setInterval(() => { if (timerEl) timerEl.textContent = fmt(Math.round((Date.now() - startedAt) / 1000)); }, 1000); }
        function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

        let msgTimer = null;
        function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2200); }

        // Hint: place one correct domino from the solution on its empty cells.
        window.__sura.hints.register('pips', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const sd = solution.find(s => !hand[s.domId].placed && s.cells.every(ci => !cells[ci].placed));
            if (!sd) return { ok: false, message: 'لا توجد بلاطة لكشفها' };
            cells[sd.cells[0]].placed = { domId: sd.domId, value: sd.vals[0] };
            cells[sd.cells[1]].placed = { domId: sd.domId, value: sd.vals[1] };
            hand[sd.domId].placed = true; hand[sd.domId].at = sd.cells.slice();
            pending = [];
            renderBoard(); renderHand(); checkWin();
            // نسمّي البلاطة بنقطتيها: كل كشفٍ بلاطةٌ أخرى، وجملةٌ واحدة متكرّرة
            // تُقرأ «نفس التلميح» ولو تغيّر اللوح.
            return { ok: true, message: `وضعنا البلاطة (${G.arNum(sd.vals[0])}|${G.arNum(sd.vals[1])}) في مكانها` };
        });

        async function openGame() {
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'pips');
            L.mountControls(modal, 'pips', { onChange: () => { start(true); } });
            const puzzle = await G.fetchPuzzle('pips');
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            start(true);
        }

        const close = () => { modal.classList.remove('active'); stopTimer(); };
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('pips', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => start(false));
}
