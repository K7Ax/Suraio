// games/bee — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initBeeGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle } from '../core/util.js';
import { curves } from '../core/progression.mjs';
import { BEE_BANK } from '../core/banks.mjs';

export function initBeeGame() {
        const modal = document.getElementById('bee-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('spelling_bee', {
            mode: 'bank',
            // The level's goal is a FRACTION of the board, not an absolute count.
            // It used to be `3 + 0.8*lv` capped at 20, but boards only hold 7–12
            // words, so the runtime clamp swallowed the curve from about L11 up and
            // every later level silently became the same task ("find them all").
            // A fraction keeps every level genuinely distinct on any board size.
            // The hard band also asks for the board's pangram.
            diff: lv => ({
                needFrac: curves.spelling_bee.needFrac(lv),   // L0 → 30% of the board, L20 → 85%
                pangram: curves.spelling_bee.pangram(lv)      // hard band, L17+
            }),
            rules: 'كوّن كلمات (4 أحرف فأكثر) من الحروف السبعة بشرط أن تحتوي الحرف المركزي. كلمة تستخدم كل الحروف = «بانجرام». هدف كل مستوى: إيجاد عدد محدّد من الكلمات الحقيقية — يزيد كلّما تقدّمت.'
        });
        const hiveEl = document.getElementById('bee-hive');
        const wordEl = document.getElementById('bee-word');
        const foundEl = document.getElementById('bee-found');
        const foundCountEl = document.getElementById('bee-found-count');
        const rankEl = document.getElementById('bee-rank');
        const progFill = document.getElementById('bee-progress-fill');
        const msgEl = document.getElementById('bee-message');
        const delBtn = document.getElementById('bee-delete');
        const enterBtn = document.getElementById('bee-enter');
        const shuffleBtn = document.getElementById('bee-shuffle');
        const closeBtn = document.getElementById('bee-modal-close');
        const trigger = document.getElementById('bee-trigger-card');
        const playBtn = document.getElementById('bee-play-btn');
        const actionsEl = document.getElementById('bee-actions');
        const shareBtn = document.getElementById('bee-share-btn');

        // Hand-curated boards. `difficulty` (0 easy / 1 medium / 2 hard) is graded by
        // how much there is to find: the level goal is a FRACTION of the board, so a
        // sparse board means each remaining word is harder to dig out, while a rich
        // board hands the player plenty of early wins.
        //
        // NOTE ON PANGRAMS: bank/words_ar.json contains no word longer than 6 letters,
        // so no word can ever use all 7 board letters — a true pangram is impossible
        // on this dictionary. needPangram is ANDed with boardHasPangram at runtime, so
        // the requirement silently self-disables and never makes a level unwinnable.
        //
        // BANK SIZE: 8 boards for a 21-level ladder means levels reuse boards. Auto-
        // generating more from the dictionary was tried and rejected — it yields
        // affixed fragments (فقطط، بنفنن، بفمك) rather than real words. More boards
        // need curating by hand or through the reviewed AI content pipeline.
        const BANK = BEE_BANK;
        const RANKS = [
            [0, 'مبتدئ'], [0.05, 'جيد'], [0.1, 'لطيف'], [0.2, 'جيد جداً'],
            [0.3, 'رائع'], [0.45, 'ممتاز'], [0.6, 'خبير'], [0.8, 'عبقري'], [1, 'ملكة النحل']
        ];

        let center = '', outer = [], letters = [], wordSet = new Set(),
            maxScore = 0, found = new Set(), score = 0, cur = '', gameOver = false,
            serverId = null, serverMode = false, serverOuter = [], busy = false, practiceIndex = null, awarded = false,
            needWords = 4, needPangram = false, pangramFound = false;

        function scoreWord(w) {
            const n = normalizeArabic(w);
            let s = n.length === 4 ? 1 : n.length;
            if (new Set(n.split('')).size >= 7) s += 7;
            return s;
        }

        function start() {
            const lv = L.level('spelling_bee');
            if (serverMode) {
                // letters/center come from the server payload; the valid word list
                // stays server-side and is checked via submit-guess (evalBee).
                outer = seededShuffle(serverOuter, mulberry32(suraDailySeed()));
                letters = [center, ...outer];
                wordSet = null; maxScore = 0;
            } else {
                const idx = L.pickBankIndex('spelling_bee', BANK, lv, practiceIndex !== null);
                const rng = practiceIndex !== null ? (() => Math.random()) : mulberry32(L.levelSeed('spelling_bee', lv));
                const p = BANK[idx];
                center = normalizeArabic(p.center);
                outer = seededShuffle(p.outer.map(normalizeArabic), rng);
                letters = [center, ...outer];
                wordSet = new Set(p.words.map(normalizeArabic));
                maxScore = [...wordSet].reduce((a, w) => a + scoreWord(w), 0);
            }
            // The level's goal as a share of THIS board, so the curve survives any
            // board size. Floor of 3 keeps an easy level from being a single word;
            // the board's own count is the ceiling, so it is never impossible.
            const d = L.diffFor('spelling_bee', lv);
            const boardWords = wordSet ? wordSet.size : 12;
            const boardHasPangram = wordSet && [...wordSet].some(w => new Set(normalizeArabic(w).split('')).size >= 7);
            needWords = Math.max(3, Math.min(boardWords, Math.ceil((d.needFrac || 0.5) * boardWords)));
            needPangram = !!(d.pangram && boardHasPangram);
            pangramFound = false;
            found = new Set(); score = 0; cur = ''; busy = false; awarded = false; gameOver = false;
            window.__sura.hints.memo('spelling_bee').reset();   // لوحٌ جديد ⇒ لا تلميح مُقدَّم
            const bud = L.budgetFor('spelling_bee', lv);
            if (bud) L.mountBudget(modal, 'spelling_bee', bud.n, bud.label);
            L.hideRetry(modal);
            renderHive(); renderWord(); renderFound(); updateRank();
            if (practiceIndex === null) L.startLevel('spelling_bee', lv);
            msg(`هدفك: جِد ${G.arNum(needWords)} كلمات` + (needPangram ? ' + بانجرام' : ''));
            if (actionsEl) actionsEl.classList.add('hidden');
        }

        function renderHive() {
            hiveEl.innerHTML = '';
            const layout = [[outer[0], outer[1]], [outer[2], center, outer[3]], [outer[4], outer[5]]];
            layout.forEach(rowLetters => {
                const row = document.createElement('div');
                row.className = 'bee-row';
                rowLetters.forEach(L => {
                    const b = document.createElement('button');
                    b.className = 'bee-cell' + (L === center ? ' center' : '');
                    b.textContent = L;
                    b.addEventListener('click', () => addLetter(L));
                    row.appendChild(b);
                });
                hiveEl.appendChild(row);
            });
        }

        function addLetter(L) { cur += L; renderWord(); }
        function del() { cur = cur.slice(0, -1); renderWord(); }
        function renderWord() {
            if (!cur) { wordEl.innerHTML = '<span class="wc-ph">اكتب كلمة…</span>'; return; }
            wordEl.innerHTML = [...cur].map(ch => {
                const cls = ch === center ? 'wc-center' : (letters.includes(ch) ? '' : 'wc-bad');
                return `<span class="${cls}">${G.escapeHtml(ch)}</span>`;
            }).join('');
        }

        function submit() {
            if (busy) return;
            const w = normalizeArabic(cur);
            cur = ''; renderWord();
            if (w.length < 4) return reject('الكلمة قصيرة جداً');
            if (!w.includes(center)) return reject('يجب أن تحتوي الحرف المركزي');
            if (![...w].every(ch => letters.includes(ch))) return reject('حروف غير متاحة', true);
            if (found.has(w)) return reject('وجدتها من قبل');
            if (serverMode) {
                busy = true;
                G.submitResult({ puzzle_id: serverId, game_type: 'spelling_bee', guess: w })
                    .then(resp => {
                        busy = false;
                        const r = resp && resp.result;
                        if (r && r.valid) accept(w, !!r.pangram);
                        else reject('ليست في القائمة', true);
                    })
                    .catch(() => { busy = false; reject('تعذّر التحقق'); });
                return;
            }
            // Strict acceptance (Round 4): a curated daily answer OR an EXACT
            // dictionary entry. No morphological invention — random letter
            // combinations that merely "decompose" into affix+stem are rejected,
            // so only real Arabic words count.
            if (!wordSet.has(w)) {
                if (!window.__sura.dict.ready) return reject('جارٍ تحميل قائمة الكلمات…');
                if (!window.__sura.dict.has(w)) return reject('ليست في القائمة', true);
            }
            accept(w, new Set(w.split('')).size >= 7);
        }

        function accept(w, pangram) {
            found.add(w);
            if (pangram) pangramFound = true;
            const pts = scoreWord(w);
            score += pts;
            addFoundChip(w); updateRank();
            window.__sura.rush.hit();
            const left = Math.max(0, needWords - found.size);
            const goal = left > 0 ? ` · باقٍ ${G.arNum(left)}` : (needPangram && !pangramFound ? ' · باقٍ البانجرام' : '');
            msg((pangram ? `بانجرام! +${G.arNum(pts)} ✨` : `+${G.arNum(pts)} 🎉`) + goal);
            if (pangram) celebrate();
            if (actionsEl) actionsEl.classList.remove('hidden');
            const reached = found.size >= needWords && (!needPangram || pangramFound);
            if (!awarded && reached) {
                awarded = true;
                celebrate();
                // Rank on how far PAST the goal the player got — the goal is the
                // floor, finding the whole board is «أسطورة».
                const extra = Math.max(0, (wordSet ? wordSet.size : needWords) - needWords);
                const over = extra ? (found.size - needWords) / extra : 1;
                const score01 = Math.max(0, Math.min(1, 0.45 + 0.55 * over));
                const res = (practiceIndex === null)
                    ? L.finish('spelling_bee', { won: true, score01 })
                    : { rank: window.__sura.ranks.tierFor(score01).idx };
                msg('رائع! أكملت هدف المستوى 🎉');
                window.__sura.meta.serverStreak('spelling_bee').then(streak => window.__sura.meta.onWin('spelling_bee', { streak, rank: res.rank, timed: res.timed, rushMax: res.rushMax }));
            }
        }

        // `cost` marks a genuine miss (a word that simply isn't valid). Housekeeping
        // rejects — the dictionary still loading, a duplicate, a too-short stub —
        // are free: they are not the player being wrong.
        function reject(why, cost) {
            msg(why);
            if (cost) window.__sura.rush.miss();
            if (window.__sura.fx) window.__sura.fx.sfx('wrong');
            wordEl.style.animation = 'shake 0.4s ease';
            setTimeout(() => { wordEl.style.animation = ''; }, 400);
            if (cost && L.spendBudget('spelling_bee')) exhausted();
        }

        // Out of rejected-word budget. The words already found are the score, so
        // a full board's worth of effort is never wiped out.
        function exhausted() {
            gameOver = true;
            const score01 = Math.max(0, Math.min(0.5, (found.size / Math.max(1, needWords)) * 0.5));
            const res = (practiceIndex === null)
                ? L.finish('spelling_bee', { won: false, score01 })
                : { rank: window.__sura.ranks.tierFor(score01).idx };
            window.__sura.meta.onPartial('spelling_bee', { rank: res.rank, kind: 'rejects_out' });
            msg(`انتهت محاولاتك — وجدت ${G.arNum(found.size)} من ${G.arNum(needWords)}`);
            if (actionsEl) actionsEl.classList.remove('hidden');
            L.showRetry(modal, 'spelling_bee', () => start());
            window.__sura.meta.offerSaver('spelling_bee', () => { L.resetBudget('spelling_bee'); start(); });
        }

        // مُرتِّبٌ واحدٌ للصفحة كلّها. `a.localeCompare(b,'ar')` يطلب مُرتِّبًا
        // **في كل مقارنة**، ولوحٌ ممتلئ يحمل ٢٢–٨١ كلمة، فالفرز الكامل كان
        // يبني مئاتِ المُرتِّبات عند كلّ كلمةٍ تُقبَل. الترتيب الناتج هو نفسه.
        const COLL = new Intl.Collator('ar');

        function chipHtml(w) { return `<span class="bee-chip">${G.escapeHtml(w)}</span>`; }

        function renderFound() {
            if (foundCountEl) foundCountEl.textContent = G.arNum(found.size);
            foundEl.innerHTML = [...found].sort(COLL.compare).map(chipHtml).join('');
        }

        // إدراجُ كلمةٍ واحدةٍ في موضعها بدل إعادة فرز القائمة وتسلسلها كلّها.
        // بحثٌ ثنائيّ على العُقد المعروضة ثم `insertBefore` — O(log n) مقارنة
        // وعقدةٌ واحدة تُنشَأ، بدل O(n log n) و`innerHTML` كامل لكلّ قبول.
        function addFoundChip(w) {
            if (foundCountEl) foundCountEl.textContent = G.arNum(found.size);
            if (!foundEl) return;
            const kids = foundEl.children;
            let lo = 0, hi = kids.length - 1, at = kids.length;
            while (lo <= hi) {
                const m = (lo + hi) >> 1;
                if (COLL.compare(kids[m].textContent, w) > 0) { at = m; hi = m - 1; }
                else lo = m + 1;
            }
            const tmp = document.createElement('div');
            tmp.innerHTML = chipHtml(w);
            foundEl.insertBefore(tmp.firstChild, kids[at] || null);
        }

        // Percent-based ranks (offline bank: max score is known).
        function rankFor(pct) {
            let name = RANKS[0][1];
            for (const [th, nm] of RANKS) if (pct >= th) name = nm;
            return name;
        }
        // Absolute-score ranks (server mode: total possible score is unknown client-side).
        const ABS_RANKS = [[0, 'مبتدئ'], [5, 'جيد'], [10, 'لطيف'], [20, 'جيد جداً'], [35, 'رائع'], [55, 'ممتاز'], [80, 'خبير'], [110, 'عبقري']];
        function rankAbs(s) {
            let name = ABS_RANKS[0][1];
            for (const [th, nm] of ABS_RANKS) if (s >= th) name = nm;
            return name;
        }
        function currentRankLabel() { return maxScore ? rankFor(score / maxScore) : rankAbs(score); }
        function updateRank() {
            const pctWidth = maxScore ? Math.round(score / maxScore * 100) : Math.round(score / 110 * 100);
            if (rankEl) rankEl.textContent = `${currentRankLabel()} · ${G.arNum(score)}`;
            if (progFill) progFill.style.width = `${Math.min(100, pctWidth)}%`;
        }

        function celebrate() {
            hiveEl.querySelectorAll('.bee-cell').forEach((c, i) => setTimeout(() => {
                c.style.boxShadow = '0 0 20px #feb47b';
                setTimeout(() => { c.style.boxShadow = ''; }, 400);
            }, i * 70));
        }

        let msgTimer = null;
        function msg(t) {
            if (!msgEl) return;
            msgEl.textContent = t;
            msgEl.classList.toggle('visible', !!t);
            clearTimeout(msgTimer);
            if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2000);
        }

        async function openGame() {
            practiceIndex = null;
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'spelling_bee');
            L.mountControls(modal, 'spelling_bee', { onChange: () => { start(); } });
            window.__sura.dict.load(); // enable accepting real inflections offline
            const puzzle = await G.fetchPuzzle('spelling_bee');
            // Local-first: the tiered in-code bank powers the board so difficulty
            // levels AND smart hints work everywhere. serverId is still used for
            // streak posting when present.
            serverMode = false; serverId = puzzle && puzzle.id ? puzzle.id : null;
            start();
        }

        // Smart hint (practice/offline only): reveal the first two letters of an
        // unfound valid word.
        window.__sura.hints.register('spelling_bee', () => {
            if (serverMode || !wordSet) return { ok: false, message: 'التلميح متاح في وضع التدريب' };
            const H = window.__sura.hints.memo('spelling_bee');
            const rest = [...wordSet].filter(w => !found.has(w));
            if (!rest.length) return { ok: false, message: 'وجدت كل الكلمات!' };
            // الاختيار العشوائي وحده كان يعيد الكلمة نفسها. المفتاح هو بداية
            // الكلمة وطولها لأنه ما يراه اللاعب فعلًا — كلمتان بالبداية والطول
            // نفسيهما تلميحٌ واحد مهما اختلفتا.
            const key = w => w.slice(0, 2) + ':' + w.length;
            const virgin = rest.filter(w => !H.has(key(w)));
            if (!virgin.length) return { ok: false, message: 'أعطيتك بداية كل كلمةٍ متبقّية' };
            const w = virgin[Math.floor(Math.random() * virgin.length)];
            H.take(key(w));
            return { ok: true, message: `جرّب كلمة تبدأ بـ «${w.slice(0, 2)}» (${G.arNum(w.length)} أحرف)` };
        });
        window.__sura.hints.registerCtx('spelling_bee', () => {
            if (serverMode || !wordSet) return null;
            const rest = [...wordSet].filter(w => !found.has(w));
            if (!rest.length) return null;
            return {
                difficulty: L.bandOf(L.level('spelling_bee')).key,
                player_state: `وجدت ${found.size} من ${wordSet.size} كلمة`,
                safe_context: `الحرف الإلزامي «${center}» والحروف المتاحة: ${[center, ...outer].join('، ')}`,
                solution: rest.join('، ')
            };
        });

        const close = () => modal.classList.remove('active');
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (delBtn) delBtn.addEventListener('click', del);
        if (enterBtn) enterBtn.addEventListener('click', submit);
        if (shuffleBtn) shuffleBtn.addEventListener('click', () => { outer = seededShuffle(outer, () => Math.random()); renderHive(); });
        if (shareBtn) shareBtn.addEventListener('click', () => {
            // Words were already validated/recorded server-side as they were found.
            G.share('spelling_bee', `نحلة الإملاء: ${G.arNum(found.size)} كلمات · ${currentRankLabel()}`);
        });
        // "لغز جديد" — fresh random letter set from the in-code bank (practice).
        const newBtn = document.getElementById('bee-new-btn');
        if (newBtn) newBtn.addEventListener('click', () => {
            serverMode = false; serverId = null;
            practiceIndex = Math.floor(Math.random() * BANK.length);
            start();
        });

        document.addEventListener('keydown', e => {
            if (!modal.classList.contains('active')) return;
            if (e.key === 'Enter') { submit(); return; }
            if (e.key === 'Backspace') { del(); return; }
            if (/[؀-ۿ]/.test(e.key) && e.key.length === 1) {
                const n = normalizeArabic(e.key);
                if (letters.includes(n)) addLetter(n);
            }
        });
}
