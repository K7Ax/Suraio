// ============================================================
// «عدد اليوم» — بطاقة النشرة تتبع خطّة اليوم لا نصًّا مكتوبًا بيد.
//
// كانت البطاقة تقول «كَلِمة» في كلّ يومٍ من أيام السنة: العنوان والوصف
// ولوحة المعاينة كلّها مكتوبةٌ في `index.html`. وبما أن `dailyPlan()` تختار
// لعبةً مختلفةً كلّ يوم (اليوم كَلِمة، وغدًا تشابك، وبعده نحلة)، فالبطاقة
// كانت **تكذب في ستّة أيامٍ من كلّ سبعة** — وهي أوّل ما يراه زائرٌ نزل إلى
// النشرة. هذا هو الربط الناقص بين واجهة الصفحة والمحرّك اليوميّ.
//
// القاعدة هنا: **لا مصدر ثانٍ للحقيقة**. كلّ ما تعرضه البطاقة مشتقٌّ من
// `daily.plan()` — وهي دالّةٌ نقيّةٌ في التاريخ، فتعمل بلا شبكةٍ وبلا حساب،
// ويرى الزائر المسجَّل وغير المسجَّل الشيء نفسه. وما في `index.html` يبقى
// إطارًا احتياطيًّا يظهر لو لم يعمل JS إطلاقًا.
//
// وشارة «معاينة اللغز» استُبدلت بعدّاد «يتبدّل بعد …» عمدًا: اللوح المرسوم
// زخرفةٌ تهجّي اسم اللعبة، لا لمحةٌ من لغز اليوم — وادّعاء المعاينة يوحي
// للزائر بأنّ فيه معلومةً عن الحلّ. الوقت المتبقّي معلومةٌ صادقةٌ ومفيدة.
//
// ‏**موضعُ النداء جزءٌ من العقد.** `window.__sura.levels` تُقرأ هنا وقتَ
// التركيب لا وقتَ الرسم، فنداءٌ قبل تسجيل المحرّك اليوميّ يخرج فورًا
// ويترك البطاقةَ على إطارها الاحتياطيّ المكتوب في `index.html` — أي على
// الكذبة نفسِها التي وُجدت هذه الوحدة لإزالتها، وبلا خطأٍ في السجلّ.
// ============================================================
import { arNum, escapeHtmlShared } from '../core/util.js';
import * as D from '../core/daily.mjs';

export function initFeaturedDaily() {
    const card = document.querySelector('.featured-issue-section');
    const L = window.__sura.levels;
    if (!card || !L || !L.daily) return;

    const tagEl = card.querySelector('.issue-tag');
    const titleEl = card.querySelector('.featured-wordle-title');
    const lineEl = card.querySelector('.featured-wordle-tagline');
    const descEl = card.querySelector('.featured-wordle-desc');
    const playBtn = document.getElementById('featured-play-wordle-btn');
    const badgeEl = card.querySelector('.live-badge');
    const serialEl = card.querySelector('.card-serial');

    // اسم النافذة في DOM لا يطابق مفتاح اللعبة في ثلاث حالات، فتُذكر صراحةً
    // بدل اشتقاقٍ ذكيٍّ ينكسر صامتًا عند إضافة لعبةٍ عاشرة.
    const SLUG = { spelling_bee: 'bee', missing_word: 'missingword', story_order: 'storyorder' };
    const slug = g => SLUG[g] || g;

    // النصّ وحده هنا. الصورة تُستنسخ من بطاقة اللعبة نفسها (paintBoard أدناه)
    // فلا تُكتب مرّتين.
    const CARD = {
        wordle: {
            title: 'كَلِمة',
            line: '«حين تتكشف الحروف، تنكشف معها لطائف اللغة.»',
            desc: 'خمّن الكلمة العربية المخفية في ستّ محاولات ذكيّة. لغزٌ يوميّ مصمَّم لتأمّل جماليّات لغة الضاد وتوسيع الإدراك.'
        },
        connections: {
            title: 'تشابك',
            line: '«ما يجمع الأشياء أخفى ممّا يفرّقها.»',
            desc: 'ستّ عشرة كلمةً بينها أربع صلاتٍ خفيّة، وكلماتٌ دخيلةٌ لا تنتمي لشيء. اكشف المجموعات قبل أن تنفد محاولاتك.'
        },
        spelling_bee: {
            title: 'نحلة الإملاء',
            line: '«من سبعة حروفٍ يُبنى معجمٌ صغير.»',
            desc: 'كوّن أكبر عددٍ من الكلمات من سبعة حروف، على ألّا تخلو كلمةٌ من الحرف الأوسط. كلّ كلمةٍ صحيحةٌ ترفعك رتبة.'
        },
        amthal: {
            title: 'أمثال',
            line: '«المثل كلامٌ اختصر التجربة.»',
            desc: 'اكتب المثل السعوديّ كاملًا مسترشدًا بمعناه. الحروف تتكشّف كلّما ارتقيت، حتى تصير الذاكرة وحدها دليلك.'
        },
        warmer: {
            title: 'قرّبها',
            line: '«القرب يُقاس بالحدس قبل الرقم.»',
            desc: 'خمّن، فيقول لك اللغز «أدفأ» أو «أبرد»، فتضيّق الدائرة حتى تقع على الإجابة بأقلّ عددٍ من المحاولات.'
        },
        lamha: {
            title: 'لمحة',
            line: '«لمحةٌ تكفي مَن عرَف.»',
            desc: 'تنكشف الصورة قليلًا قليلًا. احزرها من أقلّ لمحةٍ ممكنة — فكلّ لمحةٍ إضافيّةٍ تكلّفك من رصيدك.'
        }
    };
    const FALLBACK = CARD.wordle;

    // ما تعرضه البطاقة يُشتقّ كلّه من هنا، فلا يمكن لجزءٍ منها أن يتحدّث عن
    // لعبةٍ ويتحدّث جزءٌ آخر عن غيرها.
    function today() {
        const st = L.daily.state();
        const game = st.featured;
        return { st, game, card: CARD[game] || FALLBACK };
    }

    // «٥س ٣٢د» — ساعاتٌ ودقائق لا ثوانٍ: هذه بطاقةٌ في صفحةٍ يُمرّ عليها، لا
    // عدّادٌ داخل لعبة، وعقربُ ثوانٍ هنا يعني مؤقّتًا يعمل بلا فائدة.
    function leftText() {
        const ms = L.daily.msLeft();
        if (ms <= 0) return 'ينزل الآن';
        const m = Math.floor(ms / 60000);
        const h = Math.floor(m / 60);
        return h > 0 ? `يتبدّل بعد ${arNum(h)}س ${arNum(m % 60)}د` : `يتبدّل بعد ${arNum(m % 60)}د`;
    }

    // صورة اللعبة نفسها التي في صفحة الألعاب (طلب المالك: «نفس الصورة»).
    //
    // تُستنسخ `.board-container` من بطاقة اللعبة في الشبكة بدل رسم لوحٍ ثانٍ
    // هنا: لكلّ لعبةٍ رسمها ونسيجها (`texture-sadu`, `texture-wax` …)، ونسخةٌ
    // ثانيةٌ منها في هذا الملفّ تعني رسمين لشيءٍ واحد ينحرف أحدهما عن الآخر
    // عند أوّل تعديل. الاستنساخ يجعل صفحة الألعاب **المصدر الوحيد** للصورة،
    // ويكسب أي لعبةٍ تُضاف لاحقًا صورتَها في النشرة بلا سطرٍ إضافيّ.
    let boardGame = null;
    function paintBoard(g) {
        if (g === boardGame) return;              // إعادة الاستنساخ كلّ دقيقة تعيد تشغيل حركات الرسم بلا سبب
        const src = document.querySelector(`#${slug(g)}-trigger-card .board-container`);
        const holder = card.querySelector('.featured-preview-card');
        const cur = holder && holder.querySelector('.board-container');
        if (!src || !cur) return;
        const clone = src.cloneNode(true);
        clone.classList.add('large-preview', 'featured-board');
        clone.setAttribute('aria-hidden', 'true');   // زخرفةٌ مكرَّرة: قارئ الشاشة يقرأ العنوان والوصف لا الرسم
        // المعرّفات داخل SVG (تدرّجٌ مثلًا) تصير مكرّرةً في المستند بعد
        // الاستنساخ، و`url(#id)` يتعلّق بأوّل مطابقةٍ لا بالأقرب — فتُلاحق
        // الإشاراتُ معرّفَها الجديد.
        const ids = [...clone.querySelectorAll('[id]')].map(el => el.id).filter(Boolean);
        if (ids.length) {
            let html = clone.innerHTML;
            for (const id of ids) {
                html = html.split(`id="${id}"`).join(`id="${id}-nl"`).split(`url(#${id})`).join(`url(#${id}-nl)`);
            }
            clone.innerHTML = html;
        }
        cur.replaceWith(clone);
        boardGame = g;
        // ونسيج البطاقة يتبع صورتها: «صخر بركاني» تحت لوح تشابك المنسوج
        // بالسدو نصٌّ يخصّ لعبةً أخرى.
        const tex = document.querySelector(`#${slug(g)}-trigger-card .card-texture`);
        const dst = card.querySelector('.card-footer-info .card-texture');
        if (tex && dst) dst.textContent = tex.textContent.trim();
    }

    // فتح لعبةٍ **في وضع التحدي** لا في الحملة. والدخول يمرّ بزرّ «تحدي اليوم»
    // في شريط النافذة نفسه بدل استدعاء `daily.enter()` مباشرةً: ذلك الزرّ هو
    // المسار الوحيد الذي يعيد بناء اللوح ويحدّث الشريط، واستدعاء الدالّة
    // وحدها يترك اللاعب أمام لوح الحملة بينما يظنّ أنّه في التحدي.
    function openDaily(game) {
        const trigger = document.getElementById(`${slug(game)}-trigger-card`);
        if (!trigger) return;
        trigger.click();
        requestAnimationFrame(() => {
            const modal = document.getElementById(`${slug(game)}-modal`);
            const btn = modal && modal.querySelector('.lvl-daily-btn');
            if (btn && !btn.classList.contains('hidden') && !btn.classList.contains('on')) btn.click();
        });
    }

    // ---- ألعاب اليوم كلّها -------------------------------------------------
    // البطاقة كانت تبرز لعبةً واحدة، والخطّة تفتح **كلّ** لعبةٍ حيّة كل يوم
    // بصعوبة ذلك اليوم — فكان الزائر يظنّ أن تحدي اليوم لعبةٌ واحدة ويغلق
    // الصفحة. الشرائح تُشتقّ من `plan.entries` فتكسب أيُّ لعبةٍ تُضاف مكانَها
    // هنا بلا سطر.
    //
    // ولا تعرض الشريحة رقم مستوًى. كانت تعرض `bandRepLevel` — سقفَ نطاق
    // صعوبة اليوم (٥ / ١٤ / ٢٠) — وهو رقمٌ داخليّ وُضع كي تظلّ منحنيات
    // الصعوبة المكتوبة لكلّ مستوًى صالحةً في وضع التحدّي. لكنّ اللاعب
    // يقرؤه على أنّه موضعه من الحملة: سأل المالك «رقم المستوى في لعبة
    // اليوم لأيّ شيء يرمز؟» وهو على المستوى ١ في «تشابك» والشريحة تقول
    // «المستوى ٢٠» (١٣ أغسطس ٢٠٢٦). الصعوبة وحدها هي المعلومة الصادقة:
    // لوح اليوم واحدٌ للجميع، ولا علاقة له بسلّم أحد.
    const rosterEl = document.getElementById('daily-roster');
    function paintRoster(st) {
        if (!rosterEl) return;
        const plan = L.daily.plan();
        const html = plan.entries.map(e => {
            const t = escapeHtmlShared((window.__sura.meta && window.__sura.meta.titleOf(e.game)) || e.game);
            const done = L.daily.done(e.game);
            return `<button type="button" class="dr-chip${done ? ' done' : ''}${e.featured ? ' feat' : ''}" data-game="${escapeHtmlShared(e.game)}" aria-label="${t} — ${st.tier.label}${done ? ' — أنجزته' : ''}">`
                + `<span class="dr-tick" aria-hidden="true">${done ? '✓' : ''}</span>`
                + `<span class="dr-name">${t}</span>`
                + `<span class="dr-meta"><span class="dr-tier t-${st.tier.key}">${st.tier.label}</span></span>`
                + '</button>';
        }).join('');
        if (rosterEl.innerHTML !== html) rosterEl.innerHTML = html;
    }
    if (rosterEl) {
        rosterEl.addEventListener('click', ev => {
            const b = ev.target.closest('.dr-chip');
            if (b && b.dataset.game) openDaily(b.dataset.game);
        });
    }

    function paint() {
        const { st, game, card: c } = today();
        // «العدد ١٢ · الأربعاء · متوسط» — رقمٌ واسم يومٍ وصعوبة، بأمر المالك.
        if (tagEl) tagEl.textContent =
            `العدد ${arNum(D.issueNumber(st.date))} · ${D.weekdayName(st.date)} · ${st.tier.label}`;
        if (titleEl) titleEl.textContent = c.title;
        if (lineEl) lineEl.textContent = c.line;
        if (descEl) descEl.textContent = c.desc;
        // «١١ . ٠٨» — اليوم ثم الشهر، مصفَّرًا كي لا يتغيّر عرض البطاقة بين
        // شهرٍ من رقمٍ وشهرٍ من رقمين. كان «12 . PL» رقمًا مخترعًا لا يعني شيئًا.
        const two = n => arNum(n < 10 ? '0' + n : String(n));
        if (serialEl) serialEl.textContent = `${two(st.date % 100)} . ${two(Math.floor(st.date / 100) % 100)}`;
        if (badgeEl) badgeEl.textContent = leftText();
        if (playBtn) {
            // «✓ لعبتَه» بدل «ابدأ»: البطاقة تعرف أنّ اليوم انتهى بالنسبة إليه،
            // والزرّ يظلّ يعمل ليراجع لوحه.
            playBtn.textContent = L.daily.done(game) ? 'أنجزتَ تحدي اليوم ✓' : 'ابدأ تحدي اليوم ←';
            playBtn.dataset.game = game;
        }
        paintBoard(game);
        paintRoster(st);
        paintWeek(st);
    }

    // ---- رزنامة الأسبوع ---------------------------------------------------
    // صفٌّ لكلّ يومٍ من سبعة: ثلاثةٌ مضت، واليوم في الوسط، وثلاثةٌ قادمة —
    // فيرى الزائر أنّ للصعوبة إيقاعًا يُخطَّط له لا مزاجًا. الجدول كلّه مشتقٌّ
    // من `weekAround()` وهي دالّةٌ نقيّةٌ في التاريخ، فلا شبكةَ ولا حساب، ولا
    // بذرةَ لغزٍ تتسرّب إلى الصفحة: أسماء أيّامٍ وأعدادٌ وصعوبات فقط.
    const weekRows = document.getElementById('week-rows');
    function paintWeek(st) {
        if (!weekRows) return;
        const html = D.weekAround(st.date).map(d => {
            const cls = ['week-row', d.today ? 'today' : (d.past ? 'past' : 'next')].join(' ');
            return `<tr class="${cls}">`
                + `<td class="wk-day"><span class="wk-dot" aria-hidden="true"></span>${d.weekdayName}${d.today ? '<span class="wk-now">اليوم</span>' : ''}</td>`
                + `<td class="wk-issue">${arNum(d.issue)}</td>`
                + `<td class="wk-tier"><span class="dr-tier t-${d.tier.key}">${d.tier.label}</span></td>`
                + '</tr>';
        }).join('');
        if (weekRows.innerHTML !== html) weekRows.innerHTML = html;
    }

    // الزرّ يفتح لعبة اليوم **في وضع التحدي**، لا في الحملة. والدخول يمرّ
    // بزرّ «تحدي اليوم» في شريط النافذة نفسه بدل استدعاء `daily.enter()`
    // مباشرةً: ذلك الزرّ هو المسار الوحيد الذي يعيد بناء اللوح ويحدّث
    // الشريط، واستدعاء الدالّة وحدها يترك اللاعب أمام لوح الحملة بينما
    // يظنّ أنّه في التحدي.
    if (playBtn) {
        playBtn.addEventListener('click', () => openDaily(playBtn.dataset.game || today().game));
    }

    paint();
    // دقيقةٌ واحدة تكفي لعدّادٍ بالدقائق، وهي أيضًا ما يجعل البطاقة تنقلب
    // إلى لعبة الغد وحدها عند منتصف الليل بلا إعادة تحميل.
    setInterval(paint, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
    // إنهاءُ تحدٍّ يعيد الرسم فورًا — انظر التعليق عند `sura:daily-done`.
    document.addEventListener('sura:daily-done', () => paint());
}
