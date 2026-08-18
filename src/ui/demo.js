// ============================================================
// Visual demo (شرح مرئي) — a short auto-playing, captioned walkthrough
// for every game, "as if Sura is playing for you" so the player learns
// how it's played. Self-contained illustration (does not drive the real
// board, so it can never break game state). One reusable overlay.
//
// ‏تُنادى **بعد** `window.__sura.meta` و`window.__sura.rules`: تُسجّل
// ‏`window.__sura.demo` الذي يقرؤه شريطُ كلّ لعبة، وتقرأ هي الاثنين وقتَ
// النقر لا وقتَ التركيب — فالترتيبُ يخصّ التسجيلَ وحده.
// ============================================================
import { escapeHtmlShared } from '../core/util.js';

export function initDemo() {
    const EMOJI = { wordle: '🔤', connections: '🔗', sudoku: '🔢', spelling_bee: '🐝', letterboxed: '🔡', strands: '🧵', tiles: '🔷', pips: '🎲', amthal: '🗣️', missing_word: '✏️', story_order: '🧩', warmer: '🎯', lamha: '💡', zayid: '🃏', report: '🐞' };
    const titleOf = g => (window.__sura.meta && window.__sura.meta.titleOf && window.__sura.meta.titleOf(g)) || g;

    // ---- tiny illustration builders (on-brand, inline-styled) ----
    const GREEN = 'background:#3aa655;border-color:#3aa655;color:#fff';
    const AMBER = 'background:#c9a227;border-color:#c9a227;color:#fff';
    const GRAY = 'background:#5b5f66;border-color:#5b5f66;color:#fff';
    const SEL = 'background:#2d4a63;border-color:#7fb2e0;color:#fff';
    const DECOY = 'background:#3a3f47;border:1px dashed rgba(255,255,255,0.4);color:#cfd3da';
    const esc = escapeHtmlShared;
    const cellsRow = list => `<div class="demo-row">${list.map(([t, s]) => `<span class="demo-cell" style="${s || ''}">${esc(t)}</span>`).join('')}</div>`;
    const tilesWrap = list => `<div class="demo-tiles">${list.map(([t, s]) => `<span class="demo-tile" style="${s || ''}">${esc(t)}</span>`).join('')}</div>`;
    const solvedRow = (theme, words, bg) => `<div class="demo-solved" style="background:${bg}">${esc(theme)} · ${words.map(esc).join(' · ')}</div>`;
    const grid9 = () => {
        let h = '<div class="demo-sudoku">';
        const sample = [5, 3, 0, 0, 7, 0, 0, 0, 0, 6, 0, 0, 1, 9, 5, 0, 0, 0, 0, 9, 8, 0, 0, 0, 0, 6, 0, 8, 0, 0, 0, 6, 0, 0, 0, 3, 4, 0, 0, 8, 0, 3, 0, 0, 1, 7, 0, 0, 0, 2, 0, 0, 0, 6, 0, 6, 0, 0, 0, 0, 2, 8, 0, 0, 0, 0, 4, 1, 9, 0, 0, 5, 0, 0, 0, 0, 8, 0, 0, 7, 9];
        sample.forEach((n, i) => { h += `<span class="demo-sq${i === 2 ? ' hl' : ''}">${n ? window.__sura.games.arNum(n) : ''}</span>`; });
        return h + '</div>';
    };

    // ---- per-game scripts: [{cap, html}] ----
    const DEMOS = {
        wordle: [
            { cap: 'الهدف: خمّن الكلمة المخفية. اكتب كلمةً صحيحة بعدد أحرفها ثم اضغط «إدخال».', html: cellsRow([['س'], ['ل'], ['ا'], ['م']]) },
            { cap: 'الأخضر: حرفٌ صحيح وفي مكانه الصحيح.', html: cellsRow([['س', GREEN], ['ل', GRAY], ['ا', GRAY], ['م', AMBER]]) },
            { cap: 'الأصفر: الحرف موجود في الكلمة لكن في موضع آخر. الرمادي: غير موجود.', html: cellsRow([['س', GREEN], ['ح', GRAY], ['ا', GREEN], ['ب', AMBER]]) },
            { cap: 'حلّل الألوان وكرّر — لديك 6 محاولات حتى تكتمل الكلمة خضراء وتفوز!', html: cellsRow([['س', GREEN], ['ح', GREEN], ['ا', GREEN], ['ب', GREEN]]) }
        ],
        connections: [
            { cap: 'أمامك 20 كلمة: 4 مجموعات من 4 كلمات تجمعها فكرة، و4 كلمات للتمويه.', html: tilesWrap([['الرياض'], ['دلة'], ['جدة'], ['طويق'], ['فنجان'], ['أبها'], ['السودة'], ['هيل']]) },
            { cap: 'اختر 4 كلمات تجمعها فكرة واحدة ثم تحقّق (هنا: مدن سعودية).', html: tilesWrap([['الرياض', SEL], ['دلة'], ['جدة', SEL], ['طويق'], ['فنجان'], ['أبها', SEL], ['السودة'], ['مكة', SEL]]) },
            { cap: 'صحيح! تُقفل المجموعة بلونها وتختفي من اللوح.', html: solvedRow('مدن سعودية', ['الرياض', 'جدة', 'أبها', 'مكة'], '#264a37') },
            { cap: '⚠ احذر كلمات التمويه — تبدو مقنعة لكنها لا تنتمي لأي مجموعة.', html: tilesWrap([['طويق', DECOY], ['فنجان', DECOY], ['هيل', DECOY], ['السودة', DECOY]]) }
        ],
        sudoku: [
            { cap: 'املأ الشبكة 9×9 بالأرقام من 1 إلى 9.', html: grid9() },
            { cap: 'كل صف، وكل عمود، وكل مربّع 3×3 يجب أن يحوي 1–9 دون تكرار.', html: grid9() },
            { cap: 'اختر خانة فارغة ثم اضغط الرقم المناسب. أكمل الشبكة لتفوز!', html: grid9() }
        ],
        spelling_bee: [
            { cap: 'كوّن كلمات عربية من الحروف المعروضة.', html: cellsRow([['ك', AMBER], ['ت', GRAY], ['ا', GRAY], ['ب', GRAY], ['ر', GRAY], ['س', GRAY], ['م', GRAY]]) },
            { cap: 'شرطان: 4 أحرف على الأقل، وكل كلمة تحوي الحرف الأوسط (الذهبي).', html: cellsRow([['ك', AMBER], ['ت', GREEN], ['ا', GREEN], ['ب', GREEN]]) },
            { cap: 'اجمع عدد الكلمات المطلوب لتفوز. كلمة تستخدم كل الحروف = «بانجرام» 🎉', html: cellsRow([['م', GREEN], ['ك', AMBER], ['ا', GREEN], ['ت', GREEN], ['ب', GREEN]]) }
        ],
        letterboxed: [
            { cap: '12 حرفًا موزّعة على أضلاع مربّع. كوّن كلمات بالتنقل بينها.', html: cellsRow([['ق'], ['ل'], ['م'], ['د'], ['ر'], ['س']]) },
            { cap: 'القاعدة: لا تختر حرفين متتاليين من نفس الضلع.', html: cellsRow([['ق', GREEN], ['ل', SEL], ['م', GREEN]]) },
            { cap: 'كل كلمة جديدة تبدأ بآخر حرف من الكلمة السابقة.', html: cellsRow([['م', AMBER], ['د', GREEN], ['ر', GREEN], ['س', GREEN]]) },
            { cap: 'استخدم كل الحروف الـ12 لتفوز!', html: cellsRow([['12', GREEN], ['/', ''], ['12', GREEN]]) }
        ],
        strands: [
            { cap: 'كل الكلمات مرتبطة بفكرة واحدة (الموضوع).', html: tilesWrap([['ا'], ['ل'], ['ر'], ['ي'], ['ا'], ['ض']]) },
            { cap: 'اسحب إصبعك على الحروف المتجاورة لتكوين الكلمة.', html: tilesWrap([['ا', SEL], ['ل', SEL], ['ر', SEL], ['ي', SEL], ['ا', SEL], ['ض', SEL]]) },
            { cap: 'الكلمة الممتدة «سبانجرام» تعبر الشبكة وتكشف الموضوع. جد كل الكلمات لتفوز!', html: solvedRow('مدن سعودية', ['الرياض', 'جدة', 'مكة'], '#264a37') }
        ],
        tiles: [
            { cap: 'بلاطات مقلوبة — خلف كل اثنتين رمزٌ متطابق.', html: tilesWrap([['؟'], ['؟'], ['؟'], ['؟'], ['؟'], ['؟']]) },
            { cap: 'اقلب بلاطتين، واحفظ مواضعها إن لم تتطابقا.', html: tilesWrap([['🌙', SEL], ['؟'], ['؟'], ['🌙', SEL], ['؟'], ['؟']]) },
            { cap: 'طابق كل الأزواج بأقل عدد محاولات لتفوز!', html: tilesWrap([['🌙', GREEN], ['⭐', GREEN], ['🌴', GREEN], ['🌙', GREEN], ['⭐', GREEN], ['🌴', GREEN]]) }
        ],
        pips: [
            { cap: 'ضع أحجار الدومينو لتملأ اللوح بالكامل.', html: tilesWrap([['•'], ['••'], ['•••'], ['••']]) },
            { cap: 'كل منطقة ملوّنة لها شرط على مجموع نقاطها.', html: tilesWrap([['•', SEL], ['••', SEL], ['•••', GREEN], ['••', GREEN]]) },
            { cap: 'حقّق كل الشروط واملأ اللوح لتفوز!', html: tilesWrap([['•', GREEN], ['••', GREEN], ['•••', GREEN], ['••', GREEN]]) }
        ],
        amthal: [
            { cap: 'يظهر معنى المثل، وتحته صندوقٌ فارغ لكل كلمة.', html: tilesWrap([['__'], ['__'], ['__']]) },
            { cap: 'اكتب كل كلمة في صندوقها معتمدًا على المعنى — تنقّل بالمسافة.', html: tilesWrap([['الصبر', SEL], ['__'], ['__']]) },
            { cap: 'اضغط «تحقّق»: الكلمة الصحيحة تُقفل بالأخضر، وتصحّح الباقي.', html: tilesWrap([['الصبر', GREEN], ['مفتاح', GREEN], ['الفرح', DECOY]]) },
            { cap: 'اكتب المثل كاملًا صحيحًا لتفوز! «الصبر مفتاح الفرج».', html: solvedRow('المثل', ['الصبر', 'مفتاح', 'الفرج'], '#264a37') }
        ],
        missing_word: [
            { cap: 'تظهر عبارةٌ مألوفة وفيها كلمةٌ ناقصة (___).', html: cellsRow([['الوقت'], ['من'], ['__', AMBER]]) },
            { cap: 'أمامك أربعة خيارات — اختر الكلمة التي يكملها المعنى.', html: tilesWrap([['ذهب', SEL], ['فضة'], ['حديد'], ['ماء']]) },
            { cap: 'الصحيح يُقفل بالأخضر ويكمل العبارة، والخطأ يُستبعَد لتعيد المحاولة.', html: tilesWrap([['ذهب', GREEN], ['فضة', DECOY]]) },
            { cap: 'أكملها دون خطأ أو تلميح لتنال ⭐⭐⭐! «الوقت من ذهب».', html: solvedRow('العبارة', ['الوقت', 'من', 'ذهب'], '#264a37') }
        ],
        story_order: [
            { cap: 'تظهر أجزاء سالفةٍ يومية مبعثرة — رتّبها حسب تسلسلها المنطقي.', html: tilesWrap([['رجع يعتذر'], ['فهم الموضوع غلط'], ['زعل صاحبه'], ['قال كلام وهو معصب']]) },
            { cap: 'اضغط كل جزء بالترتيب الصحيح — السبب أولًا ثم النتيجة.', html: tilesWrap([['فهم الموضوع غلط', SEL], ['قال كلام وهو معصب', SEL], ['زعل صاحبه'], ['رجع يعتذر']]) },
            { cap: 'اضغط «تحقّق»: الترتيب الغلط ننبّهك عليه دون كشف الحل لتعيد المحاولة.', html: tilesWrap([['زعل صاحبه', AMBER], ['رجع يعتذر', SEL]]) },
            { cap: 'رتّبها صح لتُقفل بالأخضر وتظهر السالفة كاملة وتفوز! ⭐⭐⭐', html: solvedRow('السالفة', ['فهم غلط', 'قال وهو معصب', 'زعل صاحبه', 'رجع يعتذر'], '#264a37') }
        ],
        warmer: [
            { cap: 'في بالنا كلمة مخفية — خمّنها بالكتابة (بدون خيارات).', html: tilesWrap([['؟ الكلمة المخفية', AMBER]]) },
            { cap: 'كلمة بعيدة بالمعنى تطلع «باردة» ❄️.', html: tilesWrap([['ماء  ❄️ بارد', DECOY]]) },
            { cap: 'كل ما قربت بالمعنى تسخن: 🌡️ دافئ ← 🔥 قريب ← 🔥🔥 قريب جدًا.', html: tilesWrap([['شاي  🌡️ دافئ'], ['فنجان  🔥🔥 قريب جدًا', SEL]]) },
            { cap: 'لمن تضبط الكلمة تُقفل خضراء وتفوز! 🎯 «قهوة».', html: solvedRow('الكلمة', ['قهوة'], '#264a37') }
        ],
        lamha: [
            { cap: 'كلمة مخفية، ونكشف لك تلميحًا تلو تلميح. لو خمّنتها من الأول = ⭐⭐⭐.', html: tilesWrap([['① ينزل من السماء', SEL], ['⭐⭐⭐', GREEN]]) },
            { cap: 'ما عرفتها؟ اكشف التلميح التالي — بس نجومك تنقص نجمة.', html: tilesWrap([['② الأودية تسيل والناس تفرح', SEL], ['⭐⭐☆', AMBER]]) },
            { cap: 'التلميح الثالث شبه كاشف — آخر فرصة بنجمة وحدة.', html: tilesWrap([['③ تشمّ ريحته في التراب', SEL], ['⭐☆☆', DECOY]]) },
            { cap: 'اكتب الجواب صح فيُقفل بالأخضر وتفوز! 💡 «المطر».', html: solvedRow('الجواب', ['المطر'], '#264a37') }
        ],
        zayid: [
            { cap: 'يطلع موضوع، وتزايد خصمك: كم شيء تقدر تذكر؟ مثال: «كم مدينة سعودية؟».', html: tilesWrap([['🏙️ مدن سعودية', AMBER]]) },
            { cap: 'تتناوبون رفع الرقم… «أذكر ٨» ← «أنا ١٠» ← «١٢» لين واحد يستسلم.', html: tilesWrap([['أنت: أذكر ١٠', SEL], ['فهد: أنا ١٢', DECOY]]) },
            { cap: 'اللي يستسلم، الثاني لازم يذكرهم فعليًا قبل الوقت — يقدر يفوز، يعجز يخسر.', html: tilesWrap([['الرياض', GREEN], ['جدة', GREEN], ['مكة', GREEN], ['…', AMBER]]) },
            { cap: 'خصمك «شبح» = لاعب حقيقي سابق، يعني ما يعرف أكثر مما ذكره — لو بلَف استسلم وتكشفه وتفوز! 🃏', html: solvedRow('كسبت المستوى', ['كشفت البلَف'], '#264a37') }
        ],
        // Not a game. The report form is the one place on the site where the
        // player is asked to WRITE something, and «ما يشتغل وبس» is what an
        // unexplained textarea collects. The same four captioned frames that
        // teach a board teach a good bug report, and reusing the mechanism
        // means there is nothing new to maintain.
        report: [
            { cap: 'وجدتَ خللًا؟ أخبرنا. صندوقٌ واحد فقط — والتفاصيل التقنية تُرفق وحدها.', html: tilesWrap([['🐞 أبلغ عن مشكلة', AMBER]]) },
            { cap: 'اكتب ما حدث بكلماتك: «ضغطت تلميح في كَلِمة فصارت الشاشة سوداء». لا حدّ أدنى ولا نموذج.', html: cellsRow([['ما المشكلة؟', SEL]]) },
            { cap: 'اللعبة والمستوى والجهاز والمتصفّح تُرفق تلقائيًّا — لا تكتبها.', html: tilesWrap([['كَلِمة · مستوى ٧', GREEN], ['جوّال · Chrome', GREEN]]) },
            { cap: 'لا تحبّ الكتابة؟ اضغط «إملاء» وتكلّم. وأرفق صورة إن أمكن — ثم «أرسل».', html: tilesWrap([['إملاء', SEL], ['أرفق صورة', SEL], ['أرسل البلاغ', GREEN]]) }
        ]
    };

    // `titleOf` reads the game title table, and «البلاغ» is not a game. One
    // override beats registering a fake game in TITLES, which every other
    // consumer of that table would then have to know to skip.
    const DEMO_TITLES = { report: 'أبلغ عن مشكلة' };

    // ---- overlay (built once, reused) ----
    let modal, stageEl, capEl, dotsEl, prevBtn, nextBtn, playBtn, headEl;
    let steps = [], idx = 0, timer = null, playing = false;
    function build() {
        modal = document.createElement('div');
        modal.className = 'demo-modal';
        modal.innerHTML =
            '<div class="demo-card">'
            + '<button type="button" class="demo-close" aria-label="إغلاق">✕</button>'
            + '<div class="demo-head"></div>'
            + '<div class="demo-stage"></div>'
            + '<div class="demo-cap"></div>'
            + '<div class="demo-dots"></div>'
            + '<div class="demo-nav">'
            + '<button type="button" class="demo-prev">‹ السابق</button>'
            + '<button type="button" class="demo-play">⏸ إيقاف</button>'
            + '<button type="button" class="demo-next">التالي ›</button>'
            + '</div></div>';
        document.body.appendChild(modal);
        headEl = modal.querySelector('.demo-head');
        stageEl = modal.querySelector('.demo-stage');
        capEl = modal.querySelector('.demo-cap');
        dotsEl = modal.querySelector('.demo-dots');
        prevBtn = modal.querySelector('.demo-prev');
        nextBtn = modal.querySelector('.demo-next');
        playBtn = modal.querySelector('.demo-play');
        modal.querySelector('.demo-close').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        prevBtn.addEventListener('click', () => { pause(); go(idx - 1); });
        nextBtn.addEventListener('click', () => { pause(); idx >= steps.length - 1 ? go(0) : go(idx + 1); });
        playBtn.addEventListener('click', () => { playing ? pause() : play(); });
        dotsEl.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { pause(); go(Number(b.dataset.i)); } });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) close(); });
    }
    function render() {
        const s = steps[idx] || { cap: '', html: '' };
        stageEl.innerHTML = s.html;
        stageEl.classList.remove('demo-pop'); void stageEl.offsetWidth; stageEl.classList.add('demo-pop');
        capEl.textContent = s.cap;
        dotsEl.innerHTML = steps.map((_, i) => `<button type="button" data-i="${i}" class="demo-dot${i === idx ? ' on' : ''}" aria-label="خطوة ${i + 1}"></button>`).join('');
        prevBtn.disabled = idx === 0;
        nextBtn.textContent = idx >= steps.length - 1 ? 'أعد ↺' : 'التالي ›';
    }
    function go(i) { idx = Math.max(0, Math.min(steps.length - 1, i)); render(); }
    function tick() { timer = setTimeout(() => { if (idx >= steps.length - 1) { pause(); } else { go(idx + 1); tick(); } }, 3000); }
    function play() { playing = true; playBtn.textContent = '⏸ إيقاف'; clearTimeout(timer); tick(); }
    function pause() { playing = false; playBtn.textContent = '▶ تشغيل'; clearTimeout(timer); }
    function open(game) {
        steps = DEMOS[game];
        if (!steps || !steps.length) { if (window.__sura.rules) window.__sura.rules.open(game); return; }
        if (!modal) build();
        headEl.innerHTML = `<span class="demo-emoji">${EMOJI[game] || '🎮'}</span><span class="demo-title">${esc(DEMO_TITLES[game] || titleOf(game))}</span><span class="demo-tag">شرح مرئي</span>`;
        idx = 0; render(); modal.classList.add('active'); play();
    }
    function close() { pause(); if (modal) modal.classList.remove('active'); }

    // First play of a given game auto-plays its walkthrough. Reading rules is
    // work; watching three captioned frames is not, and a first-timer facing a
    // grid of Arabic tiles with no idea what to do just leaves. Once-per-game,
    // persisted, and it never fires again after the player has seen it.
    function seenKey(game) { return `demoSeen.${game}`; }
    function seen(game) {
        const m = window.__sura.meta;
        return !m || !!m.read(seenKey(game), 0);
    }
    function markSeen(game) {
        const m = window.__sura.meta;
        if (m) m.write(seenKey(game), 1);
    }
    function maybeAutoOpen(game, bar) {
        if (!DEMOS[game] || seen(game)) return false;
        markSeen(game);
        // Let the game's own modal paint first — opening both in the same frame
        // reads as a glitch rather than a guided intro.
        setTimeout(() => {
            open(game);
            // Leave a breadcrumb: the ▶ they can press to see it again.
            const btn = bar && bar.querySelector('.demo-btn');
            if (btn) btn.classList.add('nudge');
        }, 650);
        return true;
    }
    window.__sura.demo = { open, close, maybeAutoOpen, seen, markSeen };
}
