// games/letterboxed — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initLetterBoxedGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle, loadBankJSON } from '../core/util.js';

export function initLetterBoxedGame() {
        const modal = document.getElementById('letterboxed-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('letterboxed', {
            mode: 'bank',
            diff: () => ({}),
            rules: 'كوّن كلمات بالتنقل بين الحروف على أضلاع المربّع، على ألا يكون حرفان متتاليان من الضلع نفسه، وكل كلمة جديدة تبدأ بآخر حرف من سابقتها. استخدم كل الحروف الـ12 لتفوز. كل لوحة بطابع سعودي تدور حول كلمة من المدن أو الأكلات أو التراث تُكشف عند الفوز. كلّما تقدّمت المستويات صارت اللوحات أصعب.'
        });
        const boxEl = document.getElementById('lb-box');
        const wordEl = document.getElementById('lb-word');
        const chainEl = document.getElementById('lb-chain');
        const msgEl = document.getElementById('lb-message');
        const usedEl = document.getElementById('lb-used');
        const themeEl = document.getElementById('lb-theme');
        const enterBtn = document.getElementById('lb-enter');
        const delBtn = document.getElementById('lb-delete');
        const restartBtn = document.getElementById('lb-restart');
        const actionsEl = document.getElementById('lb-actions');
        const shareBtn = document.getElementById('lb-share-btn');
        const newBtn = document.getElementById('lb-new-btn');
        const closeBtn = document.getElementById('lb-modal-close');
        const trigger = document.getElementById('letterboxed-trigger-card');
        const playBtn = document.getElementById('letterboxed-play-btn');

        const SIDE_POS = ['top', 'right', 'bottom', 'left'];
        const FALLBACK = [{ sides: [['ا', 'ت', 'و'], ['ن', 'م', 'د'], ['ك', 'ج', 'ل'], ['س', 'ع', 'ه']] }];
        let BANK = [], bankLoaded = false;
        async function loadBank() {
            if (bankLoaded) return;
            BANK = await loadBankJSON('bank/letterboxed.json', FALLBACK, 'صندوق الحروف');
            if (!BANK || !BANK.length) BANK = FALLBACK;
            bankLoaded = true;
        }

        let sides = [], letterSide = {}, allLetters = [], curWord = [], words = [],
            used = new Set(), gameOver = false, serverId = null, practiceIndex = null, startedAt = 0, refLen = 4,
            curTheme = '', curStar = '', curSolution = [];

        function setPuzzle(p) {
            sides = p.sides.map(s => s.map(normalizeArabic));
            letterSide = {};
            sides.forEach((s, si) => s.forEach(L => { letterSide[L] = si; }));
            allLetters = sides.flat();
            refLen = (p.solution && p.solution.length) || 4;
            curTheme = p.theme || ''; curStar = p.star || '';
            curSolution = (p.solution || []).map(normalizeArabic);
            renderTheme();
        }
        function renderTheme() {
            if (!themeEl) return;
            if (curTheme) { themeEl.innerHTML = `<span class="lb-flag">🇸🇦</span> بطابع سعودي · <b>${G.escapeHtml(curTheme)}</b>`; themeEl.hidden = false; }
            else themeEl.hidden = true;
        }
        function reset() {
            curWord = []; words = []; used = new Set(); gameOver = false; startedAt = Date.now();
            window.__sura.hints.memo('letterboxed').reset();   // لوحٌ جديد ⇒ لا تلميح مُقدَّم
            if (actionsEl) actionsEl.classList.add('hidden');
            renderBox(); renderWord(); renderChain(); renderUsed(); msg('');
        }
        function startWith(p) { setPuzzle(p); reset(); }
        function startDaily() {
            const lv = L.level('letterboxed');
            const idx = L.pickBankIndex('letterboxed', BANK, lv, practiceIndex !== null);
            startWith(BANK[idx] || BANK[0]);
        }

        const lastTapped = () => curWord[curWord.length - 1];
        const requiredStart = () => words.length ? words[words.length - 1].slice(-1) : null;

        function tap(L) {
            if (gameOver) return;
            if (!curWord.length) {
                const req = requiredStart();
                if (req && L !== req) { msg(`الكلمة التالية تبدأ بحرف «${req}»`); return; }
            } else if (letterSide[L] === letterSide[lastTapped()]) {
                msg('لا يمكن اختيار حرفين من نفس الجهة'); shakeBox(); return;
            }
            curWord.push(L); renderWord(); renderBox();
        }
        function del() { if (!curWord.length || gameOver) return; curWord.pop(); renderWord(); renderBox(); }
        function restartWord() { if (gameOver) return; curWord = []; renderWord(); renderBox(); }

        function submitWord() {
            if (gameOver) return;
            const w = normalizeArabic(curWord.join(''));
            if (w.length < 3) return reject('3 أحرف على الأقل');
            const req = requiredStart();
            if (req && w[0] !== req) return reject(`تبدأ بحرف «${req}»`);
            // Strict: must be a real listed word (board-exact, no inflections).
            if (!window.__sura.dict.ready) return reject('جارٍ تحميل قائمة الكلمات…');
            if (!window.__sura.dict.has(w)) return reject('ليست في القائمة');
            if (words.includes(w)) return reject('استخدمتها من قبل');
            words.push(w);
            [...w].forEach(ch => used.add(ch));
            curWord = [];
            renderWord(); renderChain(); renderUsed(); renderBox();
            if (used.size >= allLetters.length) return endGame();
            msg('أحسنت! تابع لاستخدام بقية الحروف');
        }
        function reject(why) { msg(why); shakeBox(); }

        function endGame() {
            gameOver = true;
            msg('رائع! استخدمت كل الحروف 🎉');
            if (actionsEl) actionsEl.classList.remove('hidden');
            celebrate();
            if (curStar && themeEl) {
                themeEl.innerHTML = `<span class="lb-flag">🇸🇦</span> من حلول هذه اللوحة: <b>${curSolution.map(G.escapeHtml).join(' ← ')}</b>`;
                themeEl.hidden = false;
            }
            const secs = Math.round((Date.now() - startedAt) / 1000);
            modal.dataset.shareSummary = `صندوق الحروف${curTheme ? ' · ' + curTheme : ''}: ${G.arNum(words.length)} كلمات`;
            G.submitResult({ puzzle_id: serverId, game_type: 'letterboxed', guess: { words }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            window.__sura.meta.serverStreak('letterboxed').then(streak => window.__sura.meta.onWin('letterboxed', { seconds: secs, streak }));
            if (practiceIndex === null) L.won('letterboxed');
        }

        function renderBox() {
            boxEl.innerHTML = '';
            sides.forEach((s, si) => {
                const sideDiv = document.createElement('div');
                sideDiv.className = `lb-side lb-${SIDE_POS[si]}`;
                s.forEach(L => {
                    const b = document.createElement('button');
                    b.className = 'lb-letter';
                    if (used.has(L)) b.classList.add('used');
                    if (curWord.includes(L)) b.classList.add('in-word');
                    if (lastTapped() === L) b.classList.add('active');
                    b.textContent = L;
                    b.addEventListener('click', () => tap(L));
                    sideDiv.appendChild(b);
                });
                boxEl.appendChild(sideDiv);
            });
        }
        function renderWord() {
            if (!curWord.length) {
                const req = requiredStart();
                wordEl.innerHTML = `<span class="wc-ph">${req ? `ابدأ بحرف «${req}»…` : 'كوّن كلمة…'}</span>`;
                return;
            }
            wordEl.textContent = curWord.join('');
        }
        function renderChain() {
            chainEl.innerHTML = words.map(w => `<span class="lb-chip">${G.escapeHtml(w)}</span>`).join('<span class="lb-arrow">‹</span>');
        }
        function renderUsed() { if (usedEl) usedEl.textContent = `${G.arNum(used.size)}/${G.arNum(allLetters.length)} حرفًا`; }
        function shakeBox() { boxEl.style.animation = 'shake 0.4s ease'; setTimeout(() => boxEl.style.animation = '', 400); }
        function celebrate() { boxEl.querySelectorAll('.lb-letter').forEach((c, i) => setTimeout(() => { c.style.boxShadow = '0 0 18px #ff7e5f'; setTimeout(() => c.style.boxShadow = '', 420); }, i * 60)); }

        let msgTimer = null;
        function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2500); }

        // Hint: a dictionary word playable from the required start letter that
        // introduces at least one unused board letter.
        window.__sura.hints.register('letterboxed', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const dict = G._dict;
            if (!dict || !dict.size) return { ok: false, message: 'القائمة لم تُحمّل بعد' };
            const H = window.__sura.hints.memo('letterboxed');
            const req = requiredStart();
            const board = new Set(allLetters);
            let found = null, scanned = 0;
            for (const w of dict) {
                if (scanned++ > 80000) break;
                if (w.length < 3 || w.length > 6) continue;
                if (req && w[0] !== req) continue;
                let ok = true;
                for (let i = 0; i < w.length; i++) {
                    if (!board.has(w[i])) { ok = false; break; }
                    if (i > 0 && letterSide[w[i]] === letterSide[w[i - 1]]) { ok = false; break; }
                }
                if (!ok) continue;
                if (![...w].some(ch => !used.has(ch))) continue;
                // المسح يبدأ من أول القائمة في كل مرّة، فكان يقف على الكلمة
                // نفسها ويعيد التلميح ذاته إن لم يلعبها اللاعب. البداية
                // المعروضة هي التلميح، فهي مفتاح التفرّد.
                if (!H.has(w.slice(0, 2))) { found = w; break; }
            }
            if (!found) return { ok: false, message: 'ما بقي مطلعٌ جديد أدلّك عليه' };
            H.take(found.slice(0, 2));
            // act on the board: flash the suggested starting letter's button
            const firstCh = found[0];
            boxEl.querySelectorAll('.lb-letter').forEach(b => {
                if (b.textContent === firstCh) {
                    b.classList.add('hint-cell');
                    setTimeout(() => b.classList.remove('hint-cell'), 2600);
                }
            });
            return { ok: true, message: `جرّب كلمة تبدأ بـ «${found.slice(0, 2)}»` };
        });
        window.__sura.hints.registerCtx('letterboxed', () => {
            if (gameOver || !allLetters.length) return null;
            return {
                difficulty: L.bandOf(L.level('letterboxed')).key,
                player_state: `كلماتك حتى الآن: ${words.length ? words.join('، ') : 'لا شيء بعد'}`,
                safe_context: `${curTheme ? 'الطابع: ' + curTheme + '. ' : ''}الحروف: ${allLetters.join('، ')} (لا تصل حرفين من نفس الضلع)`,
                solution: [curStar, ...curSolution].filter(Boolean).join('، ')
            };
        });

        async function openGame() {
            practiceIndex = null;
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'letterboxed');
            L.mountControls(modal, 'letterboxed', { onChange: () => { practiceIndex = null; startDaily(); } });
            await Promise.all([window.__sura.dict.load(), loadBank()]);
            const puzzle = await G.fetchPuzzle('letterboxed');
            // campaign board is level-seeded; serverId (if any) only posts the result
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            startDaily();
        }

        const close = () => modal.classList.remove('active');
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (enterBtn) enterBtn.addEventListener('click', submitWord);
        if (delBtn) delBtn.addEventListener('click', del);
        if (restartBtn) restartBtn.addEventListener('click', restartWord);
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('letterboxed', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => { serverId = null; practiceIndex = Math.floor(Math.random() * Math.max(1, BANK.length)); startDaily(); practiceIndex = null; });

        document.addEventListener('keydown', e => {
            if (!modal.classList.contains('active') || gameOver) return;
            if (e.key === 'Enter') { submitWord(); return; }
            if (e.key === 'Backspace') { del(); return; }
            if (/[؀-ۿ]/.test(e.key) && e.key.length === 1) {
                const n = normalizeArabic(e.key);
                if (allLetters.includes(n)) tap(n);
            }
        });
}
