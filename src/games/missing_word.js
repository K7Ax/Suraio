// games/missing_word (كلمة ناقصة) — fill the missing word(s) in a familiar
// Arabic phrase (proverb, daily expression, spoken phrase, or context sentence)
// by picking from options. Single-blank keeps the simple "pick the right option"
// flow; multi-blank uses fill-next-empty with tap-to-reselect. Pure-local,
// date-seeded daily + 21-level campaign. Modeled on games/amthal.js so it reuses
// the shared HUD (hint/demo/rules), levels, streaks and onWin reward. esbuild
// bundles this into app.js; main.js calls initMissingWordGame() in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle, loadBankJSON } from '../core/util.js';

export function initMissingWordGame() {
        const modal = document.getElementById('missingword-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('missing_word', {
            mode: 'bank',
            diff: () => ({}),
            rules: 'تظهر عبارةٌ مألوفة (مثل، أو تعبير يومي، أو جملة من سياق) وفيها كلمةٌ ناقصة أو أكثر (___)، وتحتها خيارات. اختر الكلمة الصحيحة من معنى الجملة. في الفراغ الواحد: الصحيح يُقفل بالأخضر، والخطأ يُستبعَد لتعيد المحاولة. في عدة فراغات: كل اختيار يملأ الفراغ التالي، واضغط على فراغٍ معبّأ لتغييره، ولا يُقفل الفراغ بالأخضر إلا إذا كانت كلمته صحيحة — أكمل كل الفراغات لتفوز. الصعوبة تأتي من عدد الفراغات وقرب الخيارات والسياق، لا من غرابة الكلمات. أكمل دون خطأ أو تلميح لتنال ⭐⭐⭐.'
        });
        const promptEl = document.getElementById('missingword-prompt');
        const optionsEl = document.getElementById('missingword-options');
        const msgEl = document.getElementById('missingword-message');
        const actionsEl = document.getElementById('missingword-actions');
        const shareBtn = document.getElementById('missingword-share-btn');
        const newBtn = document.getElementById('missingword-new-btn');
        const closeBtn = document.getElementById('missingword-modal-close');
        const trigger = document.getElementById('missingword-trigger-card');
        const playBtn = document.getElementById('missingword-play-btn');

        const FALLBACK = [{ prompt: 'الصبر مفتاح ___', answer: 'الفرج', accepted: ['الفرج', 'فرج'], options: ['الفرج', 'الباب', 'النجاح', 'الخير'], hints: ['النتيجة بعد طول انتظار.', 'انفراج الهمّ.', 'تبدأ بحرف الفاء.'], difficulty: 0 }];
        let BANK = [], bankLoaded = false;
        async function loadBank() {
            if (bankLoaded) return;
            BANK = await loadBankJSON('bank/saudi/missing_word.json', FALLBACK, 'الكلمة الناقصة');
            if (!BANK || !BANK.length) BANK = FALLBACK;
            bankLoaded = true;
        }

        // Lenient Arabic equality (matches amthal): drop tashkeel/tatweel, fold
        // alef/ya/ta-marbuta/hamza so accepted variants and option text compare equal.
        function norm(s) {
            return String(s).normalize('NFC')
                .replace(/[ً-ْٰـ]/g, '')
                .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
                .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
                .replace(/\s+/g, ' ').trim();
        }

        function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
        function shuffleWith(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

        // ---- inline styles (no style.css change) ----
        const S_EMPTY = 'display:inline-block;min-width:3.2em;border-bottom:2px dashed currentColor;text-align:center;margin:0 .15em;opacity:.8;cursor:pointer';
        const S_ACTIVE = 'display:inline-block;min-width:3.2em;border-bottom:2px solid #c9a227;text-align:center;margin:0 .15em;background:rgba(201,162,39,.18);border-radius:4px 4px 0 0;cursor:pointer';
        const S_WRONG = 'display:inline-block;min-width:3.2em;text-align:center;margin:0 .15em;color:#c0392b;border-bottom:2px solid #c0392b;cursor:pointer';
        const S_LOCK = 'display:inline-block;min-width:3.2em;text-align:center;margin:0 .15em;color:#3aa655;border-bottom:2px solid #3aa655';
        const S_OK = 'background:#3aa655;border-color:#3aa655;color:#fff';
        const S_OFF = 'opacity:.4;text-decoration:line-through';
        const S_USED = 'opacity:.5';

        let item = null, parts = [''], blanks = 1, multi = false,
            answersDisplay = [], answersNorm = [],           // per blank
            sel = [], locked = [], forced = null,            // per blank state
            options = [], gameOver = false, serverId = null, practiceIndex = null,
            startedAt = 0, mistakes = 0, hintsUsed = 0;

        function startWith(p, lv, random) {
            item = p;
            parts = String(p.prompt || '').split('___');
            blanks = Math.max(1, parts.length - 1);
            multi = blanks > 1;
            if (Array.isArray(p.answers)) {
                answersDisplay = p.answers.slice();
                answersNorm = p.answers.map((a, i) => {
                    const acc = (p.accepted && p.accepted[i] && p.accepted[i].length) ? p.accepted[i] : [a];
                    return acc.map(norm);
                });
            } else {
                answersDisplay = [p.answer];
                const acc = (p.accepted && p.accepted.length) ? p.accepted : [p.answer];
                answersNorm = [acc.map(norm)];
            }
            // keep parts/answers in sync (single-blank phrases have exactly 2 parts)
            if (parts.length - 1 !== answersDisplay.length) {
                blanks = answersDisplay.length;
                while (parts.length < blanks + 1) parts.push('');
            }
            sel = answersDisplay.map(() => null);
            locked = answersDisplay.map(() => false);
            forced = null;
            const rng = random ? Math.random : seededRng(L.levelSeed('missing_word', lv) + (p.options ? p.options.length : 4) * 131);
            options = shuffleWith(p.options && p.options.length ? p.options : answersDisplay.slice(), rng);
            gameOver = false; startedAt = Date.now(); mistakes = 0; hintsUsed = 0;
            if (actionsEl) actionsEl.classList.add('hidden');
            renderSlots(); renderOptions(); msg('');
        }
        // ---- deterministic UNIQUE campaign assignment -------------------------
        // The shared L.pickBankIndex picks per-level by `levelSeed % bucketSize`
        // with no cross-level uniqueness, so a band with more levels than items
        // repeats exact prompts (the old bug). We instead deal each of the 21
        // campaign levels a UNIQUE bank item: shuffle each difficulty bucket with
        // a fixed seed, then assign one unused item per level by the level's band,
        // borrowing from the nearest band if a bucket runs short. Deterministic
        // (same campaign for everyone) but varied and never repeating.
        const LEVELS_TOTAL = 21; // mirrors main.js initLevels LEVELS (0..20)
        let assignMap = null;
        function buildAssign() {
            const buckets = { 0: [], 1: [], 2: [] };
            BANK.forEach((b, i) => { const d = (b && b.difficulty != null) ? b.difficulty : 1; (buckets[d] || (buckets[d] = [])).push(i); });
            const rng = seededRng(((L.levelSeed ? L.levelSeed('missing_word', 0) : 1031000) ^ 0x9e3779b9) >>> 0);
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
            const lv = L.level('missing_word');
            const idx = (practiceIndex !== null)
                ? Math.floor(Math.random() * Math.max(1, BANK.length)) // «عبارة جديدة» — free practice may repeat
                : levelItemIndex(lv);                                  // campaign — guaranteed unique per level
            startWith(BANK[idx] || BANK[0], lv, practiceIndex !== null);
        }

        function firstEmpty() { for (let i = 0; i < blanks; i++) if (!locked[i] && sel[i] == null) return i; return -1; }
        function activeIndex() {
            if (forced != null && !locked[forced]) return forced;
            const e = firstEmpty();
            if (e >= 0) return e;
            return locked.findIndex(l => !l); // all filled but some wrong → first unlocked
        }
        const isCorrectSomewhere = (opt) => answersNorm.some(arr => arr.includes(norm(opt)));
        const usedLocked = (opt) => answersNorm.some((arr, j) => locked[j] && arr.includes(norm(opt)));

        function slotHtml(i) {
            if (locked[i]) return `<b style="${S_LOCK}">${escapeHtmlShared(sel[i] || answersDisplay[i])}</b>`;
            if (sel[i] != null) return `<span class="mw-slot" data-i="${i}" style="${S_WRONG}">${escapeHtmlShared(sel[i])}</span>`;
            const active = multi && activeIndex() === i;
            return `<span class="mw-slot" data-i="${i}" style="${active ? S_ACTIVE : S_EMPTY}">&nbsp;&nbsp;&nbsp;</span>`;
        }
        function renderSlots() {
            let html = escapeHtmlShared(parts[0]);
            for (let i = 0; i < blanks; i++) html += slotHtml(i) + escapeHtmlShared(parts[i + 1] || '');
            promptEl.innerHTML = html;
            if (multi && !gameOver) {
                [...promptEl.querySelectorAll('.mw-slot')].forEach(el => el.addEventListener('click', () => reselect(Number(el.dataset.i))));
            }
        }
        function renderOptions() {
            optionsEl.innerHTML = '';
            options.forEach(opt => {
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'conn-btn mw-option';
                b.textContent = opt;
                if (usedLocked(opt)) { b.disabled = true; b.style.cssText = S_USED; }
                b.addEventListener('click', () => multi ? pickMulti(b, opt) : pickSingle(b, opt));
                optionsEl.appendChild(b);
            });
        }

        // ---- single-blank: keep the original behavior ----
        function pickSingle(btn, opt) {
            if (gameOver || btn.disabled) return;
            if (answersNorm[0].includes(norm(opt))) {
                sel[0] = opt; locked[0] = true;
                btn.style.cssText = S_OK;
                [...optionsEl.querySelectorAll('.mw-option')].forEach(b => { b.disabled = true; });
                renderSlots();
                return endGame();
            }
            mistakes++;
            btn.disabled = true; btn.style.cssText = S_OFF;
            shake();
            msg('قريب! جرّب خيارًا آخر');
        }

        // ---- multi-blank: fill-next-empty with tap-to-reselect ----
        function pickMulti(btn, opt) {
            if (gameOver || btn.disabled) return;
            const i = activeIndex();
            if (i < 0) return;
            forced = null;
            sel[i] = opt;
            if (answersNorm[i].includes(norm(opt))) {
                locked[i] = true;
            } else {
                mistakes++;
                shake();
            }
            renderSlots(); renderOptions();
            if (locked.every(Boolean)) return endGame();
            if (!locked[i]) msg('قريب! غيّر اختيارك أو اضغط على فراغٍ لتعدّله');
        }
        function reselect(i) {
            if (gameOver || locked[i]) return;
            sel[i] = null; forced = i;
            renderSlots(); renderOptions();
        }

        function shake() { optionsEl.style.animation = 'shake 0.4s ease'; setTimeout(() => { optionsEl.style.animation = ''; }, 420); }

        function fullPhrase() { let s = parts[0]; for (let i = 0; i < blanks; i++) s += answersDisplay[i] + (parts[i + 1] || ''); return s.trim(); }

        function endGame() {
            gameOver = true;
            for (let i = 0; i < blanks; i++) { sel[i] = answersDisplay[i]; locked[i] = true; }
            renderSlots();
            const stars = (mistakes === 0 && hintsUsed === 0) ? 3 : (mistakes + hintsUsed <= 2 ? 2 : 1);
            const starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
            const full = fullPhrase();
            msg(`أحسنت! ${starStr} «${full}»`);
            if (window.__sura.meta && window.__sura.meta.toast) {
                window.__sura.meta.toast(`<span class="t-ico">${stars === 3 ? '🌟' : '🏅'}</span> ${starStr} — ${full}`);
            }
            if (item && item.explain && msgEl) setTimeout(() => msg('💡 ' + item.explain), 1500);
            if (actionsEl) actionsEl.classList.remove('hidden');
            const secs = Math.round((Date.now() - startedAt) / 1000);
            modal.dataset.shareSummary = `كلمة ناقصة ${starStr}: «${full}»`;
            G.submitResult({ puzzle_id: serverId, game_type: 'missing_word', guess: { answer: answersDisplay.join(' '), prompt: item && item.prompt }, time_seconds: secs },
                () => { window.__sura.meta.promptSignup(); });
            window.__sura.meta.serverStreak('missing_word').then(streak => window.__sura.meta.onWin('missing_word', { seconds: secs, streak, stars }));
            if (practiceIndex === null) L.won('missing_word');
        }

        let msgTimer = null;
        function msg(t) { if (!msgEl) return; msgEl.textContent = t; msgEl.classList.toggle('visible', !!t); clearTimeout(msgTimer); if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2600); }

        // Local hint (AI-free). First serve the puzzle's OWN graded hints
        // (item.hints[]: L1 gentle → L3 near-answer) which relate directly to this
        // prompt/answer; then, once they're exhausted, fall back to eliminating a
        // PURE distractor (a word wrong for every blank) — never removing a word
        // that's correct somewhere. hintsUsed doubles as the graded index.
        window.__sura.hints.register('missing_word', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            const authored = (item && Array.isArray(item.hints)) ? item.hints : [];
            if (hintsUsed < authored.length) {
                const h = authored[hintsUsed];
                hintsUsed++;
                return { ok: true, message: h };
            }
            const candidates = [...optionsEl.querySelectorAll('.mw-option')]
                .filter(b => !b.disabled && !isCorrectSomewhere(b.textContent));
            if (!candidates.length) return { ok: false, message: 'ما عاد فيه تلميح إضافي' };
            hintsUsed++;
            const b = candidates[Math.floor(Math.random() * candidates.length)];
            b.disabled = true; b.style.cssText = S_OFF;
            // نسمّي المستبعَد: كل استبعادٍ خيارٌ آخر، والجملة المبهمة تُقرأ تكرارًا.
            return { ok: true, message: `استبعدنا «${b.textContent}» — لا يناسب أي فراغ` };
        });
        window.__sura.hints.registerCtx('missing_word', () => {
            if (gameOver || !item) return null;
            const i = activeIndex();
            const phrase = parts.join('___');
            return {
                difficulty: L.bandOf(L.level('missing_word')).key,
                player_state: multi ? `يملأ الفراغ ${arNum((i < 0 ? 0 : i) + 1)} من ${arNum(blanks)}` : `يختار الكلمة الناقصة من ${arNum(options.length)} خيارات`,
                safe_context: `العبارة: «${phrase}». الخيارات: ${options.join('، ')}.`,
                solution: answersDisplay.join(' / ')
            };
        });

        async function openGame() {
            practiceIndex = null;
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'missing_word');
            L.mountControls(modal, 'missing_word', { onChange: () => { practiceIndex = null; startDaily(); } });
            await loadBank();
            const puzzle = await G.fetchPuzzle('missing_word');
            serverId = puzzle && puzzle.id ? puzzle.id : null;
            startDaily();
        }

        const close = () => modal.classList.remove('active');
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('missing_word', modal.dataset.shareSummary || ''));
        if (newBtn) newBtn.addEventListener('click', () => { serverId = null; practiceIndex = Math.floor(Math.random() * Math.max(1, BANK.length)); startDaily(); practiceIndex = null; });
}
