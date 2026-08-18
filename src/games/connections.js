// games/connections — extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initConnectionsGame() at the original point in init order.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle } from '../core/util.js';
import { curves } from '../core/progression.mjs';
import { CONNECTIONS_BANK, CONNECTIONS_SAUDI, CONNECTIONS_POOL, CONNECTIONS_NUM_GROUPS, assembleConnections } from '../core/banks.mjs';

export function initConnectionsGame() {
        const modal = document.getElementById('connections-modal');
        if (!modal) return;
        const G = window.__sura.games;
        const L = window.__sura.levels;
        L.register('connections', {
            mode: 'bank',
            // Lives by band (6 → 5 → 4). Deliberately one more at the top than the
            // old floor of 3: the difficulty now comes from the board (more decoys),
            // so the mistake budget can afford to be kinder.
            diff: lv => ({ lives: curves.connections.lives(lv) }),
            rules: 'أمامك مجموعات من 4 كلمات تجمعها فكرة مشتركة، وكلمات للتمويه لا تنتمي لأي مجموعة (هدفها خداعك فقط). جد المجموعات الأربع. لديك محاولات خاطئة محدودة تقلّ كلّما تقدّمت، وعدد كلمات التمويه يزيد.'
        });
        const board = document.getElementById('connections-board');
        const solvedEl = document.getElementById('connections-solved');
        const livesEl = document.getElementById('connections-lives');
        const msgEl = document.getElementById('connections-message');
        const actionsEl = document.getElementById('connections-actions');
        const submitBtn = document.getElementById('connections-submit');
        const shuffleBtn = document.getElementById('connections-shuffle');
        const deselectBtn = document.getElementById('connections-deselect');
        const closeBtn = document.getElementById('connections-modal-close');
        const trigger = document.getElementById('connections-trigger-card');
        const playBtn = document.getElementById('connections-play-btn');
        const shareBtn = document.getElementById('connections-share-btn');

        const COLOR_CLASSES = ['clr-green', 'clr-amber', 'clr-orange', 'clr-purple', 'clr-blue', 'clr-rose'];
        const BANK = CONNECTIONS_BANK;

        let groups = null, wordGroup = {}, remaining = [], selected = new Set(),
            solved = [], lives = 4, gameOver = false, serverId = null, startedAt = 0,
            serverMode = false, serverWords = [], busy = false, practiceIndex = null, numGroups = 4,
            decoys = [], decoySet = new Set();

        // GROUP_POOL and the assembly moved to core/banks.mjs, unchanged. They had
        // to leave this file so the Telegram bot (node) can build the exact board a
        // player will be handed weeks from now and gate it through core/checks.mjs
        // before it is ever scheduled — see the header of banks.mjs.
        const SAUDI_GROUPS = CONNECTIONS_SAUDI;
        const GROUP_POOL = CONNECTIONS_POOL;
        const NUM_GROUPS = CONNECTIONS_NUM_GROUPS;
        // Decoys scale so the CONTENT gets harder, not just the lives. The table
        // lives in core/progression (curves.connections.decoys) so the whole ladder
        // can be asserted monotonic in one place. Each decoy comes from a DIFFERENT
        // extra group, so decoys can never accidentally form a group — they only mislead.
        // Routed through L rather than read straight off the curve, because
        // «تحدي اليوم» adds the Friday decoy bonus on top of the band's count —
        // the one lever that raises تشابك's difficulty without ever creating a
        // second valid solution. Outside daily mode L returns the curve value
        // unchanged, so the campaign ladder is untouched.
        const decoysForLevel = lv => (L.decoysFor ? L.decoysFor('connections', lv) : curves.connections.decoys(lv));
        // Deterministic per level (random on practice).
        //
        // ترتيب المستوى يُمرَّر في الحملة وحدها. البذرةُ وحدها كانت سحبًا
        // بإرجاعٍ من بنك المجموعات، فتتشارك مرحلتان متتاليتان نصفَ اللوح
        // أحيانًا؛ وتمريرُ الترتيب يجعل السلّم يمسح البنك دورةً كاملة (انظر
        // assembleConnections). و«تحدي اليوم» يبقى على البذرة وحدها كي يظلّ
        // لوحه مطابقًا لما يحسبه البوت ويتحقّق منه مسبقًا.
        const inDaily = () => !!(L.daily && L.daily.active && L.daily.active('connections'));
        function assembleBoard(lv, random) {
            return assembleConnections(
                L.levelSeed('connections', lv), decoysForLevel(lv), normalizeArabic, random,
                (random || inDaily()) ? null : lv);
        }

        async function openGame() {
            practiceIndex = null;
            // Play first, sign up after a win: never blocks on auth.
            await G.resolveSession();
            modal.classList.add('active');
            window.__sura.hints.mountChrome(modal, 'connections');
            L.mountControls(modal, 'connections', { onChange: () => { practiceIndex = null; start(); } });
            const puzzle = await G.fetchPuzzle('connections');
            // Local-first: the tiered in-code bank powers the board so difficulty
            // levels AND smart hints work everywhere. serverId (when present) is
            // still used to post the result for streaks/leaderboard.
            serverMode = false; serverId = puzzle && puzzle.id ? puzzle.id : null;
            start();
        }

        function start() {
            const lv = L.level('connections');
            decoys = [];
            if (serverMode) {
                groups = null; wordGroup = {}; numGroups = 4;
                remaining = seededShuffle(serverWords, mulberry32(suraDailySeed()));
            } else {
                // Assemble the level's board: 4 groups (16 words) + the band's decoy
                // words (0 easy / 4 medium / 8 hard = 16/20/24 tiles). The decoys only
                // mislead — the win is still the 4 groups. Same board for everyone.
                const rng = practiceIndex !== null ? Math.random : mulberry32(L.levelSeed('connections', lv) ^ 0x5bd1);
                const board = assembleBoard(lv, practiceIndex !== null);
                groups = board.groups.map((g, idx) => ({ theme: g.theme, words: g.words, idx }));
                decoys = board.decoys.slice();
                numGroups = groups.length;
                wordGroup = {};
                groups.forEach(g => g.words.forEach(w => { wordGroup[normalizeArabic(w)] = g.idx; }));
                remaining = seededShuffle([...groups.flatMap(g => g.words), ...decoys], rng);
            }
            decoySet = new Set(decoys.map(normalizeArabic));
            selected = new Set(); solved = []; lives = L.diffFor('connections', lv).lives; gameOver = false; busy = false; startedAt = Date.now();
            window.__sura.hints.memo('connections').reset();   // لوحٌ جديد ⇒ لا تلميح مُقدَّم
            solvedEl.innerHTML = ''; actionsEl.classList.add('hidden'); msg('');
            renderLives(); renderBoard(); updateSubmit();
            L.hideRetry(modal);
            if (practiceIndex === null) L.startLevel('connections', lv);
        }

        function renderBoard() {
            board.innerHTML = '';
            remaining.forEach(w => {
                const b = document.createElement('button');
                b.className = 'conn-tile';
                b.textContent = w;
                if (selected.has(w)) b.classList.add('selected');
                b.addEventListener('click', () => toggle(w, b));
                board.appendChild(b);
            });
        }

        function toggle(w, b) {
            if (gameOver) return;
            if (selected.has(w)) { selected.delete(w); b.classList.remove('selected'); }
            else { if (selected.size >= 4) return; selected.add(w); b.classList.add('selected'); }
            updateSubmit();
        }

        function updateSubmit() { if (submitBtn) submitBtn.disabled = selected.size !== 4 || gameOver || busy; }

        function submitGroup() {
            if (selected.size !== 4 || gameOver || busy) return;
            const sel = [...selected];
            if (serverMode) {
                busy = true; updateSubmit();
                G.submitResult({ puzzle_id: serverId, game_type: 'connections', guess: sel })
                    .then(resp => {
                        busy = false; updateSubmit();
                        const r = resp && resp.result;
                        if (r && r.matched) lockGroup(sel, r.theme || 'مجموعة', COLOR_CLASSES[solved.length % COLOR_CLASSES.length]);
                        else mistake();
                    })
                    .catch(() => { busy = false; updateSubmit(); msg('تعذّر التحقق، حاول مجدداً'); });
                return;
            }
            if (sel.some(w => decoySet.has(normalizeArabic(w)))) {
                return mistake('إحدى الكلمات للتمويه ولا تنتمي لأي مجموعة!');
            }
            const gi = wordGroup[normalizeArabic(sel[0])];
            const grp = groups.find(g => g.idx === gi);
            const allSame = sel.every(w => wordGroup[normalizeArabic(w)] === gi);
            if (allSame && grp && !solved.includes(grp.theme)) {
                lockGroup(grp.words, grp.theme, COLOR_CLASSES[grp.idx % COLOR_CLASSES.length]);
            } else {
                const counts = {};
                sel.forEach(w => { const g = wordGroup[normalizeArabic(w)]; counts[g] = (counts[g] || 0) + 1; });
                const max = Math.max(...Object.values(counts));
                mistake(max === 3 ? 'قريب جداً! ثلاث كلمات من نفس المجموعة' : 'حاول مرة أخرى');
            }
        }

        function mistake(text) {
            shakeSelected();
            lives--; renderLives();
            if (window.__sura.fx) { window.__sura.fx.sfx('wrong'); window.__sura.fx.haptic(20); }
            window.__sura.rush.miss();
            msg(text || 'حاول مرة أخرى');
            if (lives <= 0) {
                revealRemaining();
                endGame(false);
                // Running out used to be a hard stop: board revealed, nothing to
                // do. Both a free retry and the streak-saver are offered now.
                L.showRetry(modal, 'connections', () => start());
                window.__sura.meta.offerSaver('connections', () => start());
            }
        }

        function lockGroup(words, theme, colorClass) {
            if (solved.includes(theme)) { selected = new Set(); renderBoard(); updateSubmit(); return; }
            solved.push(theme);
            window.__sura.rush.hit();
            if (window.__sura.fx) window.__sura.fx.sfx('correct');
            remaining = remaining.filter(w => !words.includes(w));
            selected = new Set();
            appendSolvedRow({ theme, words, colorClass });
            renderBoard(); updateSubmit();
            if (solved.length >= numGroups) endGame(true);
            else msg('أحسنت!');
        }

        function appendSolvedRow(g, revealed) {
            const cls = g.colorClass || COLOR_CLASSES[(g.idx != null ? g.idx : solved.length) % COLOR_CLASSES.length];
            const row = document.createElement('div');
            row.className = `conn-solved-row ${cls}${revealed ? ' revealed' : ''}`;
            row.innerHTML = `<span class="conn-theme">${G.escapeHtml(g.theme)}</span><span class="conn-words">${g.words.map(G.escapeHtml).join(' · ')}</span>`;
            solvedEl.appendChild(row);
        }

        function revealRemaining() {
            // Only the in-code bank knows the remaining groups; server mode can't reveal them.
            if (!serverMode && groups) {
                groups.forEach(g => { if (!solved.includes(g.theme)) appendSolvedRow(g, true); });
            }
            remaining = []; renderBoard();
        }

        // Reveal the 4 decoy words at game end so the player sees they belonged to
        // no group (they were only there to mislead).
        function revealDecoys() {
            if (serverMode || !decoys.length) return;
            const row = document.createElement('div');
            row.className = 'conn-solved-row conn-decoy-row revealed';
            row.innerHTML = `<span class="conn-theme">للتمويه</span><span class="conn-words">${decoys.map(G.escapeHtml).join(' · ')}</span>`;
            solvedEl.appendChild(row);
            remaining = remaining.filter(w => !decoySet.has(normalizeArabic(w)));
            renderBoard();
        }

        function endGame(won) {
            gameOver = true; updateSubmit();
            actionsEl.classList.remove('hidden');
            if (won) { msg('رائع! حللت كل المجموعات 🎉'); celebrate(); }
            else msg('انتهت المحاولات');
            revealDecoys();
            const secs = Math.round((Date.now() - startedAt) / 1000);
            const startLives = L.diffFor('connections', L.level('connections')).lives;
            modal.dataset.shareSummary = won
                ? `تشابك: حُلّت ${G.arNum(numGroups)}/${G.arNum(numGroups)} بـ ${G.arNum(startLives - lives)} أخطاء`
                : `تشابك: ${G.arNum(solved.length)}/${G.arNum(numGroups)} مجموعات`;
            // In server mode each group was already validated via submit-guess during play.
            // Only the offline (in-code) path needs a best-effort post here.
            if (!serverMode && serverId) {
                G.submitResult(
                    { puzzle_id: serverId, game_type: 'connections', guess: solved.join(','), time_seconds: secs },
                    () => { if (won) window.__sura.meta.promptSignup(); }
                );
            }
            // Rank on lives remaining; a loss still earns credit for the groups
            // that WERE solved, so an unfinished board is never worth nothing.
            const score01 = won
                ? Math.max(0, lives / Math.max(1, startLives))
                : Math.max(0, (solved.length / Math.max(1, numGroups)) * 0.55);
            let res = { rank: window.__sura.ranks.tierFor(score01).idx };
            if (practiceIndex === null) res = L.finish('connections', { won, score01 });
            if (won) {
                window.__sura.meta.serverStreak('connections').then(streak => window.__sura.meta.onWin('connections', { seconds: secs, streak, rank: res.rank, timed: res.timed, rushMax: res.rushMax }));
            } else {
                window.__sura.meta.onPartial('connections', { rank: res.rank, kind: 'out_of_lives' });
            }
        }

        // Smart hint (practice/offline only — the daily server puzzle keeps its
        // groups server-side): pre-select two words from one unsolved group.
        window.__sura.hints.register('connections', () => {
            if (gameOver) return { ok: false, message: 'انتهت اللعبة' };
            if (serverMode || !groups) return { ok: false, message: 'التلميح متاح في وضع التدريب' };
            const H = window.__sura.hints.memo('connections');
            const un = groups.filter(g => !solved.includes(g.theme) && g.words.some(w => remaining.includes(w)));
            if (!un.length) return { ok: false, message: 'لا يوجد تلميح متاح' };
            // الاختيار العشوائي كان قد يعيد المجموعة نفسها فيحدّد الكلمتين
            // ذاتهما مرّة أخرى. مجموعةٌ لم تُلمَّح بعد، وإلّا فرفض.
            const virgin = un.filter(g => !H.has(g.theme));
            if (!virgin.length) return { ok: false, message: 'لمّحتُ لكل مجموعةٍ متبقّية' };
            const g = virgin[Math.floor(Math.random() * virgin.length)];
            H.take(g.theme);
            const pick = g.words.filter(w => remaining.includes(w)).slice(0, 2);
            selected = new Set(pick); renderBoard(); updateSubmit();
            // نسمّي الكلمتين: هما محدَّدتان على اللوح أصلًا فلا كشفَ زائدًا، لكن
            // الجملة المبهمة كانت تُقرأ «نفس التلميح» مع كل مجموعةٍ جديدة.
            return { ok: true, message: `«${pick.join('» و«')}» من مجموعة واحدة` };
        });
        window.__sura.hints.registerCtx('connections', () => {
            if (serverMode || !groups) return null; // AI hint only in practice/level mode
            const un = groups.filter(g => !solved.includes(g.theme));
            return {
                difficulty: L.bandOf(L.level('connections')).key,
                player_state: `حللت ${solved.length} من 4 مجموعات، تبقّى ${lives} محاولات`,
                safe_context: `الكلمات الظاهرة: ${remaining.join('، ')}`,
                solution: un.map(g => `${g.theme}: ${g.words.join('، ')}`).join(' | ')
            };
        });

        function celebrate() {
            const rows = solvedEl.querySelectorAll('.conn-solved-row');
            rows.forEach((r, i) => setTimeout(() => {
                r.style.boxShadow = '0 0 22px #ff7e5f';
                setTimeout(() => { r.style.boxShadow = 'none'; }, 450);
            }, i * 160));
        }

        function renderLives() {
            livesEl.innerHTML = '';
            for (let i = 0; i < 4; i++) {
                const d = document.createElement('span');
                d.className = 'conn-dot' + (i < lives ? '' : ' lost');
                livesEl.appendChild(d);
            }
        }

        function shakeSelected() {
            board.querySelectorAll('.conn-tile.selected').forEach(t => {
                t.style.animation = 'shake 0.4s ease';
                setTimeout(() => { t.style.animation = ''; }, 400);
            });
        }

        let msgTimer = null;
        function msg(t) {
            if (!msgEl) return;
            msgEl.textContent = t;
            msgEl.classList.toggle('visible', !!t);
            clearTimeout(msgTimer);
            if (t) msgTimer = setTimeout(() => msgEl.classList.remove('visible'), 2500);
        }

        const close = () => modal.classList.remove('active');
        if (trigger) trigger.addEventListener('click', e => { if (e.target !== playBtn) openGame(); });
        if (playBtn) playBtn.addEventListener('click', openGame);
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) L.confirmClose(modal, !gameOver, close); });
        if (submitBtn) submitBtn.addEventListener('click', submitGroup);
        if (deselectBtn) deselectBtn.addEventListener('click', () => { selected = new Set(); renderBoard(); updateSubmit(); });
        if (shuffleBtn) shuffleBtn.addEventListener('click', () => { remaining = seededShuffle(remaining, Math.random ? () => Math.random() : mulberry32(Date.now ? 1 : 1)); renderBoard(); });
        if (shareBtn) shareBtn.addEventListener('click', () => G.share('connections', modal.dataset.shareSummary || ''));
        // "لغز جديد" — a fresh random puzzle from the in-code bank (practice, no leaderboard).
        const newBtn = document.getElementById('connections-new-btn');
        if (newBtn) newBtn.addEventListener('click', () => {
            serverMode = false; serverId = null;
            practiceIndex = Math.floor(Math.random() * BANK.length);
            start();
        });

        document.addEventListener('keydown', e => {
            if (!modal.classList.contains('active') || gameOver) return;
            if (e.key === 'Enter' && !submitBtn.disabled) submitGroup();
        });
}
