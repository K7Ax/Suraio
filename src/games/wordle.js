// games/wordle - extracted from main.js (Phase 5 modularization). esbuild bundles
// this back into app.js; main.js calls initWordleGame() at the original point in
// init order - after window.__sura.games and window.__sura.dict exist, and BEFORE
// initSuraMeta()/initLevels(), which is why registration is deferred to the first
// openWordle() (see ensureWordleMeta below). Moving this call earlier or later
// changes which of those two facts still holds.
import { normalizeArabic } from '../core/util.js';
import { sb, SURA } from '../core/supabaseClient.js';
// ‏النطاقاتُ والمنحنى من `core/progression` مباشرةً لا عبر `window.__sura.levels`:
// ‏هذه الوحدةُ تُنادى قبل أن يوجد ذلك السطح (انظر ترويسةَ الملفّ).
import { levelInBandIndex, curves } from '../core/progression.mjs';
import { WORDLE_POOLS, WORDLE_PRACTICE } from '../core/banks.mjs';
import * as FX from '../core/fx.js';

export function initWordleGame() {
    // --- Playable Arabic Wordle Game Engine ("كَلِمة") ---
    const wordleTrigger = document.getElementById('wordle-trigger-card');
    const playWordleBtn = document.getElementById('play-wordle-btn');
    const wordleModal = document.getElementById('wordle-modal');
    const wordleModalClose = document.getElementById('wordle-modal-close');
    const wordleBoard = document.getElementById('wordle-board');
    const wordleKeyboard = document.getElementById('wordle-keyboard');
    const wordleMessage = document.getElementById('wordle-message');
    const wordleActions = document.getElementById('wordle-actions');
    const wordleRestartBtn = document.getElementById('wordle-restart-btn');

    if (!wordleModal) return;
    let SECRET_WORD = 'سلام';
    let WORD_LENGTH = 4;
    let PUZZLE_ID = null;
    let PUZZLE_HINT = '';
    const MAX_ATTEMPTS = 6;
    let startedAt = 0;

    let guesses = Array(MAX_ATTEMPTS).fill().map(() => Array(WORD_LENGTH).fill(''));
    let currentRow = 0;
    let currentTile = 0;
    let isGameOver = false;
    let wWon = false; // last round was a win → the action button climbs to next level

    // Difficulty rises by word length: easy=4 · medium=5 · hard=6 letters.
    // The word lists and their deterministic per-length shuffle moved to
    // core/banks.mjs UNCHANGED, so the Telegram bot (node) can see exactly the
    // words the site serves and gate a month of them before any are scheduled.
    // See the banks.mjs header for why; nothing about the selection changed.
    const POOL_ORDER = WORDLE_POOLS;
    // Band maths comes from core/progression so the edges live in one place —
    // imported directly rather than read off window.__sura.levels, which does
    // not exist yet at the moment this runs (see the file header).
    // NOTE: this module is initialized *before* the meta/levels/hints modules
    // are defined, so we can't touch window.__sura.levels/hints at init time.
    // Registration is deferred to the first openWordle() (runtime), by which
    // point those modules exist.
    const wordLenForLevel = curves.wordle.wordLen;
    let wLevel = 0;
    let wIsDaily = true;
    let wRegistered = false;
    const wHinted = new Set();   // الخانات التي كُشفت بتلميح — لا تُكرَّر
    function ensureWordleMeta() {
        if (wRegistered || !window.__sura.levels || !window.__sura.hints) return;
        wRegistered = true;
        window.__sura.levels.register('wordle', {
            mode: 'generated',
            diff: lv => ({ len: wordLenForLevel(lv) }),
            rules: 'خمّن الكلمة العربية خلال 6 محاولات. الأخضر: الحرف صحيح ومكانه صحيح، الأصفر: موجود بمكان آخر، الرمادي: غير موجود. كلّما تقدّمت المستويات زاد طول الكلمة (4 ← 5 ← 6) وصعوبتها.'
        });
        window.__sura.hints.register('wordle', wordleHintProvider);
        // safe context for the Groq hint: what the player sees + the secret
        // word (sent privately to the server, never revealed to the player).
        // المسار الذكي كان يعاني العلّة نفسها: لا يصله ما كشفه اللاعب، فيعيد
        // عليه ما يعرفه. نمرّر حصيلة الصفوف السابقة صراحةً مع منعٍ مباشر.
        window.__sura.hints.registerCtx('wordle', () => {
            const { secret, greens, seen } = wordleKnown();
            const done = [], pinned = new Set();
            for (let i = 0; i < WORD_LENGTH; i++) {
                if (!greens[i]) continue;
                done.push(`${arNumW(i + 1)}=«${[...SECRET_WORD][i]}»`);
                pinned.add(secret[i]);
            }
            const rest = [...seen].filter(c => c && !pinned.has(c));
            return {
                difficulty: window.__sura.levels.bandOf(wLevel).key,
                player_state: `المحاولة ${currentRow + 1} من 6. `
                    + (done.length ? `يعرف يقينًا: ${done.join('، ')}. ` : 'لم يثبّت أي حرف بعد. ')
                    + (rest.length ? `ويعرف أن هذه الحروف في الكلمة دون مكانها: ${rest.join('، ')}. ` : ''),
                safe_context: `كلمة عربية مكوّنة من ${WORD_LENGTH} أحرف. `
                    + 'ممنوع أن يدور التلميح حول ما يعرفه اللاعب أصلًا (المذكور في تقدّمه)؛ '
                    + 'وجّهه إلى خانةٍ أو حرفٍ لم يكشفه بعد.',
                solution: SECRET_WORD
            };
        });
        wLevel = window.__sura.levels.level('wordle');
    }
    function pickLevelWord(lv) {
        const len = wordLenForLevel(lv);
        const pool = (POOL_ORDER[len] && POOL_ORDER[len].length) ? POOL_ORDER[len] : WORDLE_PRACTICE;
        // (WORDLE_PRACTICE is the never-taken fallback for a length with no pool.)
        return pool[levelInBandIndex(lv) % pool.length];
    }
    // Word validation now uses the shared honest dictionary
    // (window.__sura.dict): strict membership, NO lenient fallback.
    // Submit is gated on the list being loaded so gibberish can never
    // slip through during the load window.
    const SDICT = window.__sura.dict;
    async function loadWordleDict() { await SDICT.load(); }
    const wordleSubtitle = document.getElementById('wordle-subtitle');
    const arNumW = window.__sura.games ? window.__sura.games.arNum : (n => String(n));
    function updateWordleHeader() {
        if (!wordleSubtitle) return;
        let t = `خمّن الكلمة المكوّنة من ${arNumW(WORD_LENGTH)} أحرف في 6 محاولات`;
        // التلميح لا يُعرض إلا في المحاولة الأخيرة (طلب المالك، ١٢ أغسطس
        // ٢٠٢٦). كان يُطبع من المحاولة الأولى، وكلّ كلمةٍ في البنك تحمل
        // تلميحًا صريحًا («يفتح الباب» لـ«مفتاح»)، فكان اللاعب يقرأ الجواب
        // قبل أن يضغط حرفًا. تأخيرُه يجعله شبكةَ أمانٍ لا مِفتاحًا مجّانيًّا.
        if (PUZZLE_HINT && currentRow >= MAX_ATTEMPTS - 1) t += ` · تلميح: ${PUZZLE_HINT}`;
        wordleSubtitle.textContent = t;
    }

    // ما كشفه اللاعب حتى الآن من الصفوف **المُسلَّمة** (لا الصفّ الجاري).
    //   greens[i] — خانةٌ خضراء في محاولةٍ سابقة: اللاعب يعرف حرفها ومكانه.
    //   seen      — حروفٌ عَلِم بوجودها في الكلمة (أخضر أو أصفر) دون مكانها.
    // كانت العلّة هنا بالضبط: المزوِّد القديم يقارن بالصفّ الجاري وحده، وهو
    // فارغٌ عادةً، فتصير كلّ الخانات «مجهولة» ويعيد التلميح حرفًا خضّره
    // اللاعب بنفسه — «عطاني الأحرف اللي جبتها صح».
    function wordleKnown() {
        const secret = normalizeArabic(SECRET_WORD).split('');
        const greens = Array(WORD_LENGTH).fill(false);
        const seen = new Set();
        for (let r = 0; r < currentRow; r++) {
            const row = guesses[r] || [];
            if (!row.some(Boolean)) continue;
            const st = scoreRow(row);
            for (let i = 0; i < WORD_LENGTH; i++) {
                if (st[i] === 'correct') { greens[i] = true; seen.add(secret[i]); }
                else if (st[i] === 'present') seen.add(normalizeArabic(row[i] || ''));
            }
        }
        return { secret, greens, seen };
    }

    // تلميحٌ يضيف معلومة. يرتّب الخانات المجهولة بأولويتين: حرفٌ لم يَعرف
    // اللاعب بوجوده أصلًا (أعلى قيمة)، ثم حرفٌ يعرف وجوده ويجهل مكانه.
    // والخانات المُلمَّح إليها سابقًا تُستبعَد فلا يتكرّر تلميحٌ واحد مرّتين.
    // فإن لم يبقَ مجهول، يرفض التلميح — و`trigger` لا يخصم عند `ok:false`،
    // فلا يدفع اللاعب ثمن لا شيء.
    function wordleHintProvider() {
        if (isGameOver) return { ok: false, message: 'انتهت اللعبة' };
        const { secret, greens, seen } = wordleKnown();
        const fresh = [], placing = [];
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (greens[i] || wHinted.has(i)) continue;
            (seen.has(secret[i]) ? placing : fresh).push(i);
        }
        if (!fresh.length && !placing.length) {
            return { ok: false, message: 'كشفتَ كل ما يمكن كشفه — الباقي تركيب الكلمة' };
        }
        const known = fresh.length === 0;
        const pos = (fresh.length ? fresh : placing)[0];
        const ch = [...SECRET_WORD][pos];
        wHinted.add(pos);
        // على اللوح: يُطبع الحرف طيفًا في خانة الصفّ الجاري إن كانت فارغة.
        // لا يُمسّ حرفٌ كتبه اللاعب — وسمُه بالطيف يوحي بأنه صحيح وهو ليس كذلك.
        const cell = document.getElementById(`cell-${currentRow}-${pos}`);
        if (cell && !guesses[currentRow][pos]) {
            cell.textContent = ch;
            cell.classList.add('hint-ghost');
            setTimeout(() => {
                cell.classList.remove('hint-ghost');
                if (!guesses[currentRow][pos]) cell.textContent = '';
            }, 2600);
        }
        return {
            ok: true,
            message: known
                ? `«${ch}» الذي تعرف أنه في الكلمة — مكانه الخانة ${arNumW(pos + 1)}`
                : `الحرف رقم ${arNumW(pos + 1)} هو «${ch}»`
        };
    }

    // `fetchDailyWordle` stood here and was called by nothing. It fetched
    // get-todays-puzzle?game=wordle, whose response used to carry the day's
    // secret word — audit finding A3. The endpoint no longer returns it, and
    // the only client that ever read it was this dead function, so both
    // halves of that leak are gone. Deleted rather than kept "just in case":
    // an unused fetch of a secret is the thing that gets re-wired one day by
    // someone who does not know what it carries.

    const openWordle = async () => {
        // No gate: play first, sign up after a win. (This was a second copy
        // of the auth gate, inline — the shared one lives in resolveSession.)
        await window.__sura.games.resolveSession();
        wordleModal.classList.add('active');
        ensureWordleMeta();
        window.__sura.hints.mountChrome(wordleModal, 'wordle');
        wLevel = window.__sura.levels.level('wordle');
        window.__sura.levels.mountControls(wordleModal, 'wordle', { noHudNext: true, onChange: lv => { wLevel = lv; startWordleLevel(); } });
        loadWordleDict(); // fire-and-forget; ready well before the first guess
        await startWordleLevel();
    };

    // Build the current level's board. The word is level-seeded (the same
    // fixed challenge for everyone), length grows with the band.
    async function startWordleLevel() {
        wLevel = window.__sura.levels.level('wordle');
        const pick = pickLevelWord(wLevel);
        PUZZLE_ID = null; // campaign board is local + deterministic
        SECRET_WORD = pick.word;
        WORD_LENGTH = [...pick.word].length;
        PUZZLE_HINT = pick.hint || '';
        wIsDaily = true;
        startedAt = Date.now();
        initWordle();
        window.__sura.levels.startLevel('wordle', wLevel);
        if (wordleModal) wordleModal.dataset.secret = SECRET_WORD; // test hook
    }

    if (wordleTrigger) {
        wordleTrigger.addEventListener('click', (e) => {
            if (e.target !== playWordleBtn) openWordle();
        });
    }
    if (playWordleBtn) playWordleBtn.addEventListener('click', openWordle);

    const closeWordle = () => {
        wordleModal.classList.remove('active');
    };
    if (wordleModalClose) wordleModalClose.addEventListener('click', closeWordle);
    wordleModal.addEventListener('click', (e) => {
        if (e.target === wordleModal) window.__sura.levels.confirmClose(wordleModal, !isGameOver, closeWordle);
    });

    function initWordle() {
        guesses = Array(MAX_ATTEMPTS).fill().map(() => Array(WORD_LENGTH).fill(''));
        wHinted.clear();          // لوحٌ جديد ⇒ لا شيء مكشوفًا بعد
        currentRow = 0;
        currentTile = 0;
        isGameOver = false;
        wWon = false;
        if (wordleRestartBtn) wordleRestartBtn.textContent = 'العب مجدداً';

        if (wordleMessage) {
            wordleMessage.textContent = '';
            wordleMessage.classList.remove('visible');
        }
        if (wordleActions) wordleActions.classList.add('hidden');
        updateWordleHeader();

        if (wordleBoard) {
            wordleBoard.innerHTML = '';
            for (let r = 0; r < MAX_ATTEMPTS; r++) {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'board-row';
                rowDiv.id = `row-${r}`;
                
                for (let c = 0; c < WORD_LENGTH; c++) {
                    const cellDiv = document.createElement('div');
                    cellDiv.className = 'board-cell';
                    cellDiv.id = `cell-${r}-${c}`;
                    rowDiv.appendChild(cellDiv);
                }
                wordleBoard.appendChild(rowDiv);
            }
        }

        if (wordleKeyboard) {
            wordleKeyboard.innerHTML = '';
            const keyRows = [
                ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج', 'د'],
                ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
                ['حذف', 'ئ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'إدخال']
            ];

            keyRows.forEach(rowKeys => {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'kbd-row';
                
                rowKeys.forEach(key => {
                    const btn = document.createElement('button');
                    btn.className = 'kbd-key';
                    btn.textContent = key;
                    btn.setAttribute('data-key', key);
                    
                    if (key === 'حذف' || key === 'إدخال') {
                        btn.classList.add('wide');
                    }
                    
                    btn.addEventListener('click', () => handleKeyPress(key));
                    rowDiv.appendChild(btn);
                });
                
                wordleKeyboard.appendChild(rowDiv);
            });
        }
    }

    function handleKeyPress(key) {
        if (isGameOver) return;

        if (key === 'حذف' || key === 'Backspace') {
            handleBackspace();
        } else if (key === 'إدخال' || key === 'Enter') {
            handleEnter();
        } else if (key.length === 1 && isArabicLetter(key)) {
            handleLetterInput(key);
        }
    }

    function isArabicLetter(char) {
        return /[\u0600-\u06FF]/.test(char);
    }

    function handleLetterInput(letter) {
        if (currentTile < WORD_LENGTH) {
            guesses[currentRow][currentTile] = letter;
            const cell = document.getElementById(`cell-${currentRow}-${currentTile}`);
            if (cell) {
                cell.textContent = letter;
                cell.classList.add('pop');
                setTimeout(() => cell.classList.remove('pop'), 150);
            }
            currentTile++;
        }
    }

    function handleBackspace() {
        if (currentTile > 0) {
            currentTile--;
            guesses[currentRow][currentTile] = '';
            const cell = document.getElementById(`cell-${currentRow}-${currentTile}`);
            if (cell) cell.textContent = '';
        }
    }

    function handleEnter() {
        if (currentTile < WORD_LENGTH) {
            showMessage('أكمل حروف الكلمة!');
            shakeRow(currentRow);
            return;
        }
        // Validate the guess. The answer is always allowed. Otherwise it
        // must be a real word in the shared dictionary — strict, no lenient
        // fallback. If the list hasn't loaded yet, block (don't accept).
        const guessWord = normalizeArabic(guesses[currentRow].join(''));
        const isAnswer = guessWord === normalizeArabic(SECRET_WORD);
        if (!SDICT.ready) {
            showMessage('جارٍ تحميل قائمة الكلمات…');
            loadWordleDict();
            shakeRow(currentRow);
            return;
        }
        const accepted = isAnswer || SDICT.has(guessWord);
        if (!accepted) {
            showMessage('الكلمة غير موجودة في القائمة');
            shakeRow(currentRow);
            return; // keep the letters so the player can edit and retry
        }
        revealTiles();
    }

    function showMessage(msg) {
        if (wordleMessage) {
            wordleMessage.textContent = msg;
            wordleMessage.classList.add('visible');
            setTimeout(() => {
                wordleMessage.classList.remove('visible');
            }, 2500);
        }
    }

    function shakeRow(rowIdx) {
        const row = document.getElementById(`row-${rowIdx}`);
        if (row) {
            row.classList.add('shake');
            row.style.animation = 'shake 0.4s ease';
            setTimeout(() => {
                row.classList.remove('shake');
                row.style.animation = '';
            }, 400);
        }
    }

    // تلوين صفٍّ واحد: أخضر ثم أصفر مع استهلاك حروف السرّ (لأجل التكرار).
    // مستخرَجةٌ هنا لأن التلميح يحتاج نفس الحساب على الصفوف السابقة ليعرف
    // ما الذي كشفه اللاعب فعلًا — ونسخةٌ ثانية منه كانت ستنحرف عن اللوح.
    function scoreRow(rowArr) {
        const g = rowArr.map(c => normalizeArabic(c || ''));
        const secretArr = normalizeArabic(SECRET_WORD).split('');
        const statuses = Array(WORD_LENGTH).fill('absent');
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (g[i] && g[i] === secretArr[i]) { statuses[i] = 'correct'; secretArr[i] = null; }
        }
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (statuses[i] === 'correct' || !g[i]) continue;
            const k = secretArr.indexOf(g[i]);
            if (k !== -1) { statuses[i] = 'present'; secretArr[k] = null; }
        }
        return statuses;
    }

    function revealTiles() {
        const rowGuess = guesses[currentRow].map(c => normalizeArabic(c));
        const statuses = scoreRow(guesses[currentRow]);

        for (let i = 0; i < WORD_LENGTH; i++) {
            const cell = document.getElementById(`cell-${currentRow}-${i}`);
            const status = statuses[i];
            
            setTimeout(() => {
                cell.classList.add(status);
                cell.style.transform = 'rotateX(360deg)';
                cell.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
                // one cue per tile as it lands — the 200ms stagger turns the
                // reveal into a rhythm instead of a silent flip
                FX.sfx(status === 'correct' ? 'correct' : status === 'present' ? 'tick' : 'wrong');
                if (status === 'correct') FX.haptic(10);


                const keyBtn = document.querySelector(`.kbd-key[data-key="${rowGuess[i]}"]`);
                if (keyBtn) {
                    if (status === 'correct') {
                        keyBtn.classList.remove('present', 'absent');
                        keyBtn.classList.add('correct');
                    } else if (status === 'present' && !keyBtn.classList.contains('correct')) {
                        keyBtn.classList.remove('absent');
                        keyBtn.classList.add('present');
                    } else if (status === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) {
                        keyBtn.classList.add('absent');
                    }
                }
                
                if (i === WORD_LENGTH - 1) {
                    checkGameState();
                }
            }, i * 200);
        }
    }

    function checkGameState() {
        const currentGuess = normalizeArabic(guesses[currentRow].join(''));
        const target = normalizeArabic(SECRET_WORD);

        if (currentGuess === target) {
            isGameOver = true;
            wWon = true;
            showMessage('رائع! أحسنت كشف لطائف الكلمة! 🎉');
            if (wordleActions) wordleActions.classList.remove('hidden');
            // make the main action climb to the next level (a NEW word), so
            // finishing visibly advances the puzzle.
            const last = window.__sura.levels.level('wordle') >= (window.__sura.levels.LEVELS - 1);
            if (wordleRestartBtn) wordleRestartBtn.textContent = last ? 'أكملت كل المستويات 🎉' : 'المستوى التالي ←';
            triggerWinCelebration();
            recordWordleResult(true);
            const secs = Math.round((Date.now() - startedAt) / 1000);
            // Rank on rows used: solving on row 1 is «أسطورة», the last row
            // still clears the level and earns «مُشارِك».
            const score01 = Math.max(0, 1 - currentRow / Math.max(1, MAX_ATTEMPTS - 1));
            const res = window.__sura.levels.finish('wordle', { won: true, score01, seconds: secs });
            window.__sura.meta.serverStreak('wordle').then(streak => window.__sura.meta.onWin('wordle', { seconds: secs, streak, rank: res.rank }));
        } else if (currentRow === MAX_ATTEMPTS - 1) {
            isGameOver = true;
            if (wordleActions) wordleActions.classList.remove('hidden');
            // Streak-saver: on a daily puzzle, offer a once-daily retry instead of
            // recording the loss (keeps the streak alive). Practice rounds just end.
            // The PUZZLE_ID guard made this unreachable in campaign play:
            // startWordleLevel() nulls PUZZLE_ID, so the saver never fired
            // for the mode most rounds are played in.
            if (window.__sura.meta.saver.left() > 0) {
                showMessage(`انتهت المحاولات! الكلمة: ${SECRET_WORD}`);
                window.__sura.meta.offerSaver('wordle', () => { startedAt = Date.now(); initWordle(); });
            } else {
                showMessage(`انتهت المحاولات! الكلمة السرية هي: ${SECRET_WORD}`);
                recordWordleResult(false);
            }
        } else {
            currentRow++;
            currentTile = 0;
            // بلوغُ الصفّ الأخير هو لحظةُ كشف التلميح — يُعاد رسم العنوان،
            // ويُنبَّه اللاعب مرّةً واحدة كي لا يمرّ الظهور دون أن يُرى.
            updateWordleHeader();
            if (PUZZLE_HINT && currentRow === MAX_ATTEMPTS - 1) {
                showMessage(`المحاولة الأخيرة · تلميح: ${PUZZLE_HINT}`);
            }
        }
    }

    async function recordWordleResult(won) {
        if (!sb || !PUZZLE_ID) return;
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
            if (won && window.__sura && window.__sura.openAuth) {
                setTimeout(() => window.__sura.openAuth('signup'), 800);
            }
            return; // anonymous players don't post to leaderboard
        }
        try {
            await fetch(`${SURA.SUPABASE_URL}/functions/v1/submit-guess`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SURA.SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    puzzle_id: PUZZLE_ID,
                    game_type: 'wordle',
                    guess: guesses[currentRow].join('')
                })
            });
        } catch (e) { /* silent */ }
    }

    function triggerWinCelebration() {
        FX.confetti(110);
        FX.sfx('win');
        FX.haptic([18, 60, 28]);
        for (let i = 0; i < WORD_LENGTH; i++) {
            const cell = document.getElementById(`cell-${currentRow}-${i}`);
            if (cell) {
                setTimeout(() => {
                    cell.style.boxShadow = '0 0 25px #ff7e5f';
                    setTimeout(() => {
                        cell.style.boxShadow = 'none';
                    }, 500);
                }, i * 150);
            }
        }
    }

    if (wordleRestartBtn) {
        // After a WIN this button climbs to the next level (a new word); after
        // a loss it retries the same level board.
        wordleRestartBtn.addEventListener('click', () => {
            if (wWon) window.__sura.levels.next('wordle');
            startWordleLevel();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (!wordleModal.classList.contains('active') || isGameOver) return;
        
        if (e.key === 'Backspace') {
            handleKeyPress('Backspace');
        } else if (e.key === 'Enter') {
            handleKeyPress('Enter');
        } else {
            handleKeyPress(e.key);
        }
    });
}
