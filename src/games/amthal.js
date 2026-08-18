// games/amthal — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initAmthalGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle, loadBankJSON } from '../core/util.js';
import { curves } from '../core/progression.mjs';

export function initAmthalGame() {
        const modal = document.getElementById('amthal-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('amthal', {
            mode: 'bank',
            // The real curve is scaffold(lv) below; expose it so the level ladder is
            // inspectable and testable rather than hidden in a private helper.
            diff: lv => scaffold(lv),
            rules: 'اكتب المثل الشعبي مستعينًا بالمعنى — صندوقٌ لكل كلمة، والنقاط (···) تدل على عدد أحرفها. في المستويات السهلة تظهر بعض الكلمات جاهزة وحروفها الأولى، وتقلّ المساعدة كلما تقدّمت حتى تكتب من ذاكرتك. تنقّل بالمسافة أو Enter، واضغط «تحقّق»: الصحيح يُقفل بالأخضر ويبقى. اجمع الكلمات المتتالية لسلسلة 🔥، وأنهِ المثل دون أخطاء أو تلميح لتنال ⭐⭐⭐.'
        });
        const meaningEl = document.getElementById('amthal-meaning');
        const answerEl = document.getElementById('amthal-answer');
        const progEl = document.getElementById('amthal-progress');
        const msgEl = document.getElementById('amthal-message');
        const clearBtn = document.getElementById('amthal-clear');
        const checkBtn = document.getElementById('amthal-check');
        const actionsEl = document.getElementById('amthal-actions');
        const shareBtn = document.getElementById('amthal-share-btn');
        const newBtn = document.getElementById('amthal-new-btn');
        const closeBtn = document.getElementById('amthal-modal-close');
        const trigger = document.getElementById('amthal-trigger-card');
        const playBtn = document.getElementById('amthal-play-btn');

        const FALLBACK = [{ proverb: 'الصبر مفتاح الفرج', meaning: 'بالصبر تُفرَّج الشدائد ويأتي الخير.', difficulty: 0 }];
        let BANK = [], bankLoaded = false;
        async function loadBank() {
            if (bankLoaded) return;
            BANK = await loadBankJSON('bank/saudi/amthal.json', FALLBACK, 'أمثال');
            if (!BANK || !BANK.length) BANK = FALLBACK;
            bankLoaded = true;
        }

        // Lenient Arabic equality: drop tashkeel/tatweel, fold alef/ya/ta-marbuta/hamza.
        function norm(s) {
            return String(s).normalize('NFC')
                .replace(/[ً-ْٰـ]/g, '')
                .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
                .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
                .replace(/\s+/g, ' ').trim();
        }

        let answerWords = [], normAns = [], meaning = '', solved = [], placeholders = [],
            gameOver = false, serverId = null, practiceIndex = null, startedAt = 0,
            mistakes = 0, hintsUsed = 0, combo = 0;

        function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
        function shuffleWith(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

        // SCAFFOLD CURVE — keeps full-typing approachable early, ruthless late.
        // Easy: pre-fill ~half the words + show 2 leading letters & length on the
        // rest. Medium: fewer pre-filled, 1 leading letter. Hard: nothing pre-filled,
        // only length dots. Top (L18+): blank — pure recall.
        //
        // Retuned for the 6/9/6 bands. The old decay (-0.06/level) hit zero help at
        // ~L9, which under the new split is only the second level of the MEDIUM band —
        // the scaffolding vanished while the player was still mid-ladder. The gentler
        // slope now reaches zero exactly at L15, the first hard level, so help fades
        // across the whole medium band instead of falling off a cliff inside it.
        const scaffold = curves.amthal.scaffold;

        function startWith(p, lv, random) {
            answerWords = p.proverb.trim().split(/\s+/);
            normAns = answerWords.map(norm);
            meaning = p.meaning || '';
            const N = answerWords.length, sc = scaffold(lv);
            const rng = random ? Math.random : seededRng(L.levelSeed('amthal', lv) + N * 131);
            const revealCount = Math.min(Math.round(sc.revealFrac * N), N - 1);
            const revealSet = new Set(shuffleWith([...Array(N).keys()], rng).slice(0, revealCount));
            solved = answerWords.map((_, i) => revealSet.has(i));
            placeholders = answerWords.map(w => {
                const chars = [...w];
                const lead = chars.slice(0, sc.leadLetters).join('');
                const rest = sc.showLen ? '·'.repeat(Math.max(0, chars.length - sc.leadLetters)) : '';
                return (lead + rest) || '…';
            });
            gameOver = false; startedAt = Date.now(); mistakes = 0; hintsUsed = 0; combo = 0;
            const bud = L.budgetFor('amthal', lv);
            if (bud) L.mountBudget(modal, 'amthal', bud.n, bud.label);
            L.hideRetry(modal);
            if (actionsEl) actionsEl.classList.add('hidden');
            if (meaningEl) meaningEl.textContent = '💡 ' + meaning;
            render(); updateProgress(); msg('');
            if (practiceIndex === null) L.startLevel('amthal', lv);
            focusFirstUnsolved();
        }
        function startDaily() {
            const lv = L.level('amthal');
            const idx = L.pickBankIndex('amthal', BANK, lv, practiceIndex !== null);
            startWith(BANK[idx] || BANK[0], lv, practiceIndex !== null);
        }

        const boxes = () => [...answerEl.querySelectorAll('.amthal-wbox')];
        function focusFirstUnsolved() {
            const b = boxes().find((el, i) => !solved[i]);
            if (b) setTimeout(() => b.focus(), 30);
        }
        function updateProgress() {
            const n = solved.filter(Boolean).length;
            if (progEl) progEl.textContent = `${G.arNum(n)}/${G.arNum(answerWords.length)}`;
        }

        function render() {
            answerEl.innerHTML = '';
            answerWords.forEach((w, i) => {
                const inp = document.createElement('input');
                inp.type = 'text'; inp.className = 'amthal-wbox';
                inp.setAttribute('dir', 'rtl'); inp.setAttribute('autocomplete', 'off');
                inp.setAttribute('aria-label', `الكلمة ${G.arNum(i + 1)}`);
                inp.dataset.i = String(i);
                if (solved[i]) { inp.value = answerWords[i]; inp.readOnly = true; inp.classList.add('correct'); }
                else { inp.placeholder = placeholders[i] || '…'; }
                inp.addEventListener('keydown', e => onKey(e, i));
                inp.addEventListener('input', () => inp.classList.remove('wrong'));
                answerEl.appendChild(inp);
            });
        }

        function onKey(e, i) {
            const els = boxes();
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                for (let j = i + 1; j < els.length; j++) if (!solved[j]) { els[j].focus(); return; }
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const next = els.slice(i + 1).find((el, k) => !solved[i + 1 + k]);
                if (next) next.focus(); else check();
                return;
            }
            if (e.key === 'Backspace' && !els[i].value) {
                for (let j = i - 1; j >= 0; j--) if (!solved[j]) { els[j].focus(); return; }
            }
        }

        function check() {
            if (gameOver) return;
            const els = boxes();
            let anyEmpty = false, anyFilledWrong = false, newCorrect = 0;
            els.forEach((el, i) => {
                if (solved[i]) return;
                const v = norm(el.value);
                if (!v) { anyEmpty = true; return; }
                if (v === normAns[i]) {
                    solved[i] = true; el.value = answerWords[i]; el.readOnly = true;
                    el.classList.remove('wrong'); el.classList.add('correct', 'pop');
                    setTimeout(() => el.classList.remove('pop'), 320);
                    newCorrect++;
                } else { anyFilledWrong = true; el.classList.add('wrong'); }
            });
            updateProgress();
            if (solved.every(Boolean)) { combo += newCorrect; return endGame(); }
            if (anyFilledWrong) {
                mistakes++; combo = 0;
                answerEl.style.animation = 'shake 0.4s ease';
                setTimeout(() => { answerEl.style.animation = ''; }, 420);
                msg('بعض الكلمات غير صحيحة — راجع المعنى وصحّحها');
                if (window.__sura.fx) window.__sura.fx.sfx('wrong');
                window.__sura.rush.miss();
                // Only a check with actual WRONG text costs an attempt — pressing
                // «تحقّق» on empty boxes is free.
                if (L.spendBudget('amthal')) return exhausted();
            } else if (newCorrect) {
                if (window.__sura.fx) window.__sura.fx.sfx('correct');
                for (let i = 0; i < newCorrect; i++) window.__sura.rush.hit();
                combo += newCorrect;
                msg(combo >= 2 ? `🔥 ${G.arNum(combo)} كلمات متتالية! ${anyEmpty ? 'أكمل الباقي' : ''}` : 'أحسنت! أكمل بقية الكلمات');
            } else if (anyEmpty) {
                msg('أكمل بقية الكلمات ثم اضغط «تحقّق»');
            }
            focusFirstUnsolved();
        }

        // Budget exhausted. Not a loss screen: the words already solved earn a
        // rank and partial XP, the answer is revealed, and a free retry plus the
        // streak-saver are both offered.
        function exhausted() {
            gameOver = true;
            boxes().forEach((el, i) => { if (!solved[i]) { el.value = answerWords[i]; el.readOnly = true; el.classList.add('missed'); } });
            const got = solved.filter(Boolean).length;
            const score01 = Math.max(0, (got / Math.max(1, answerWords.length)) * 0.55);
            const res = (practiceIndex === null)
                ? L.finish('amthal', { won: false, score01 })
                : { rank: window.__sura.ranks.tierFor(score01).idx };
            window.__sura.meta.onPartial('amthal', { rank: res.rank, kind: 'failed_checks' });
            msg(`المثل: «${answerWords.join(' ')}»`);
            if (actionsEl) actionsEl.classList.remove('hidden');
            L.showRetry(modal, 'amthal', () => startDaily());
            window.__sura.meta.offerSaver('amthal', () => { L.resetBudget('amthal'); startDaily(); });
        }

        function endGame() {
            gameOver = true;
            boxes().forEach(el => { el.readOnly = true; el.classList.remove('wrong'); el.classList.add('correct'); });
            // Quality of the round, 0..1 — the rank layer turns this into a tier.
            // A clean solve is 1.0; every mistake or hint erodes it but never to 0,
            // so finishing always earns at least «مُشارِك».
            const score01 = Math.max(0, 1 - mistakes * 0.12 - hintsUsed * 0.18);
            const res = (practiceIndex === null)
                ? L.finish('amthal', { won: true, score01 })
                : { rank: window.__sura.ranks.tierFor(score01).idx, tier: window.__sura.ranks.tierFor(score01) };
            const tier = res.tier || window.__sura.ranks.TIERS[res.rank];
            msg(`أحسنت! ${tier.icon} ${tier.name} — «${answerWords.join(' ')}»`);
            if (actionsEl) actionsEl.classList.remove('hidden');
            const secs = Math.round((Date.now() - startedAt) / 1000);
            modal.dataset.shareSummary = `أمثال ${tier.icon} ${tier.name}: «${answerWords.join(' ')}»`;
            G.submitResult({ puzzle_id: serverId, game_type: 'amthal', guess: { proverb: answerWords.join(' ') }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            window.__sura.meta.serverStreak('amthal').then(streak => window.__sura.meta.onWin('amthal', { seconds: secs, streak, rank: res.rank, timed: res.timed, rushMax: res.rushMax }));
        }

        function clearAll() {
            if (gameOver) return;
            boxes().forEach((el, i) => { if (!solved[i]) { el.value = ''; el.classList.remove('wrong'); } });
            msg(''); focusFirstUnsolved();
        }

        let msgTimer = null;
        function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2600); }

        // Hint: reveal & lock the next unsolved word.
        window.__sura.hints.register('amthal', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const i = solved.findIndex(s => !s);
            if (i < 0) return { ok: false, message: 'لا كلمات متبقية' };
            // التلميح لا يفوز باللعبة. كان يكشف كلمةً كاملة ثمّ ينادي
            // `endGame()` إن كانت الأخيرة — وفي المستويات الدنيا يملأ السقّالة
            // نصف الكلمات سلفًا، والتلميح الأوّل على واجهةٍ لم تُفتَح مجّانيّ،
            // فقيس فوزٌ كاملٌ بضغطتين: مستوًى يتقدّم، و٥٠ نقطة، ولمعةُ «أحسنت»،
            // وصفُّ إتمامٍ في التحليلات التي تُقاس عليها أهداف الصعوبة.
            // فوزٌ لا يقيس شيئًا يفسد المقياس نفسه، لا مجرّد اللحظة.
            //
            // فيبقى للاعب آخرُ فراغٍ يكتبه بيده. والرفض لا يخصم شيئًا: طبقة
            // التلميحات تُعيد الشحنة عند `ok:false` (وهي الضمانة التي بُنيت
            // في جولة التلميحات نفسها).
            if (solved.filter(s => !s).length <= 1) {
                return { ok: false, message: 'ما بقي إلا كلمة — اكتبها بنفسك' };
            }
            hintsUsed++; combo = 0;
            solved[i] = true;
            const el = boxes()[i];
            if (el) { el.value = answerWords[i]; el.readOnly = true; el.classList.remove('wrong'); el.classList.add('correct', 'hint-cell'); setTimeout(() => el.classList.remove('hint-cell'), 1800); }
            updateProgress();
            if (solved.every(Boolean)) endGame(); else focusFirstUnsolved();
            return { ok: true, message: `كشفنا الكلمة «${answerWords[i]}»` };
        });
        window.__sura.hints.registerCtx('amthal', () => {
            if (gameOver || !answerWords.length) return null;
            const done = solved.filter(Boolean).length;
            return {
                difficulty: L.bandOf(L.level('amthal')).key,
                player_state: `أكمل ${done} من ${answerWords.length} كلمات المثل`,
                safe_context: `معنى المثل: ${meaning}. عدد كلماته ${answerWords.length}.`,
                solution: answerWords.join(' ')
            };
        });

        async function openGame() {
            practiceIndex = null;
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'amthal');
            L.mountControls(modal, 'amthal', { onChange: () => { practiceIndex = null; startDaily(); } });
            await loadBank();
            const puzzle = await G.fetchPuzzle('amthal');
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            startDaily();
        }

        const close = () => modal.classList.remove('active');
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (clearBtn) clearBtn.addEventListener('click', clearAll);
        if (checkBtn) checkBtn.addEventListener('click', check);
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('amthal', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => { serverId = null; practiceIndex = Math.floor(Math.random() * Math.max(1, BANK.length)); startDaily(); practiceIndex = null; });
}
