// core/tallal — «ضاع الطريق»: صفحة ٤٠٤ في سُرى.
//
// المشهد لوحةٌ واحدة: زقاقٌ نجديّ ليلًا، فانوسٌ واحد على الحجر، وعتمةٌ خالصة
// في نصفه الأيسر. وتلك العتمةُ **هي التخطيط**: النصّ يجلس فيها، والحجاب
// المتدرّج يعمّقها ولا يطمس الصورة. (وقد سبقه مشهدٌ من تسع طبقاتٍ مركَّبة —
// `scripts/assets/tallal_assets.js` ولوازمه ما زالت في المستودع — واستُبدل بلوحةٍ
// واحدة بقرار المالك.)
//
// ---------------------------------------------------------------------------
// **لماذا لا GSAP.** موجودٌ في المشروع فعلًا (بطاقات الألعاب)، لكنه ١١٧
// كيلوبايت، وهذه الصفحة كلّها ≈٣ كيلوبايت مستقلّة عن `app.js` و`style.css`
// عمدًا: الصفحة التي تشرح أن شيئًا لم يُوجد يجب ألّا تعتمد على شيءٍ قد يكون
// فشلُه هو ما جاء بك إليها. وما يلزم هنا — تدرّجٌ، تأخيرٌ، مراحلُ في مسارٍ
// واحد — تعطيه WAAPI (`element.animate`) كاملًا وبلا بايتٍ واحد.
//
// **الاستثناء الثالث للسكون — وقد وُسِّع بأمر المالك.** §٢ في `docs/architecture/identity.md`
// تمنع حركةً تُشاهَد ولا تُستدعى، وبُنيت هذه الصفحة أوّلًا على ذلك: سقوطٌ مرّةً
// واحدة ثمّ سكونٌ تامّ. ورآها المالك فقال: **«ما أشوف أي حركات بالصورة + ٤٠٤
// ما أبيها تبقى ثابتة، أبيها تناقز loop لا نهائي»**. فصارت هذه الصفحة —
// **وحدها في الموقع** — حيّةً بعد وصولها، ورُفع الاستثناء في §٢ ليقول ذلك.
//
// وثلاثُ حركاتٍ دائمةٍ لا أكثر، وكلّها **مُعرَّفةٌ في ثابتٍ مُصدَّر** كي تبقى
// معدودةً لا متكاثرة:
//   `HOP`   — «٤٠٤» تُناقز موجةً بعد موجة (طلبُ المالك الصريح).
//   `GLOW`  — الفانوس يتنفّس. هذه هي «نبضةُ التوهّج» التي رُفضت أوّلًا لأنها
//             تخالف §٢، وأُقرّت الآن بالنصّ نفسه الذي رفع الاستثناء.
//   `DRIFT` — انسياقُ كاميرا بطيءٌ جدًّا على اللوحة (٢٦ ثانية للدورة)، وهو
//             جوابُ «ما أشوف أي حركات بالصورة»: الصورةُ نفسها تتنفّس.
//
// والثلاثة تسقط جميعًا تحت `prefers-reduced-motion` — ذلك حدٌّ لم يُرفَع.
// ---------------------------------------------------------------------------

// --- الزمن: كلّ رقمٍ يُضبَط من هنا وحده ---------------------------------------
//
// لا رقمَ زمنيّ واحدٌ في `404.html` ولا في الدالّة أدناه. تغييرُ الإحساس كلّه
// يقع في هذين الكائنين.

// المرحلة ١: دخول الخلفيّة. تكبيرٌ طفيفٌ ينحسر — الكاميرا تستقرّ، لا تندفع.
export const BG = { ms: 1300, from: 1.03, ease: 'cubic-bezier(.22,.61,.30,1)' };

// المرحلة ٢: «٤٠٤» تسقط رقمًا رقمًا.
//
// و«ثقيلةٌ أنيقة لا مرحة» ليست وصفًا بل ثلاثة أرقام: السقوط يتسارع
// (`fallEase` منحنٍ متزايد كالجاذبيّة)، والارتدادُ بعده **٦ بكسل نزولًا**
// لا صعودًا — الرقم يضغط ما تحته ثمّ يستقرّ، ولا يقفز.
//
// و`tilt` ثابتةٌ لا عشوائيّة: العشوائيّة هنا تعطي نفس الإحساس بالضبط وتمنع
// أن يكون للصفحة مظهرٌ لا يمكن إعادة رؤيته أو قياسه.
export const DROP = {
    at: 260,          // بدء الرقم الأوّل
    step: 140,        // فارقُ البدء بين رقمٍ والذي يليه
    ms: 760,          // زمن سقوط الرقم الواحد
    from: -150,       // من أين يبدأ (بكسل فوق موضعه)
    tilt: [-5, 4, -3],// ميلُ كلّ رقمٍ أثناء سقوطه (درجات)
    settle: 6,        // عمقُ الاستقرار بعد الارتطام (بكسل نزولًا)
    fallEase: 'cubic-bezier(.42,0,.78,.46)',
    landEase: 'cubic-bezier(.22,.9,.30,1)',
    thudMs: 520,      // ظلٌّ يتّسع تحت الرقم عند آخر ارتطام — ليصير الوقوع ملموسًا
};

// المراحل ٣–٥: النصّ. ضبابٌ ينقشع لا انزلاقٌ فقط — الكلمة تتّضح، فتُقرأ
// وصولًا لا وصولَ عنصرٍ إلى مكانه.
export const TEXT = {
    afterDrop: 150,   // بعد استقرار آخر رقم
    titleMs: 620, titleY: 16, titleBlur: 8,
    bodyGap: 110, bodyMs: 560, bodyY: 12, bodyBlur: 6,
    btnGap: 90, btnMs: 500, btnY: 12, btnFrom: 0.98,
    ease: 'cubic-bezier(.22,.68,.28,1)',
};

// --- دوالّ نقيّة، مُختبَرة في tests/tallal.test.js --------------------------

const DIGITS = 3;

// متى يبدأ الرقم رقم `i` وبأي ميل. `i` من ٠ إلى ٢ بترتيب القراءة.
export function dropOf(i) {
    return {
        delay: DROP.at + i * DROP.step,
        ms: DROP.ms,
        from: DROP.from,
        tilt: DROP.tilt[i] || 0,
    };
}

// اللحظة التي يستقرّ عندها آخر رقم — مرساةُ كلّ ما بعدها.
export function dropEnd() {
    const last = dropOf(DIGITS - 1);
    return last.delay + last.ms;
}

// بداية كلّ مرحلةٍ نصّيّة. مشتقّةٌ من `dropEnd()` لا مكتوبةٌ بيد: تعديلُ
// `DROP.step` وحده يزيح النصّ معه بلا أن يتراكب أحدٌ على أحد.
export function textAt() {
    const title = dropEnd() + TEXT.afterDrop;
    const body = title + TEXT.bodyGap;
    return { title, body, btn: body + TEXT.btnGap };
}

// متى يقع ظلّ الارتطام: لحظةَ وصول **آخر** رقمٍ إلى موضعه (المفتاح ٠٫٦٠ في
// مسار السقوط)، لا لحظةَ انتهاء حركته.
export function thudAt() {
    return dropEnd() - DROP.ms * 0.4;
}

// ضوء الفانوس يتأخّر عن الصورة ويطول بعدها: اشتعالٌ بطيء لا ومضة.
export const LAMP = { at: 200, ms: BG.ms + 400 };

// --- الحركات الدائمة الثلاث ---------------------------------------------------
//
// كلٌّ منها يبدأ **بعد** أن تنتهي حركةُ الوصول التي تملك نفس الخاصّيّة، فلا
// يتنازع اثنان على شيءٍ واحد لحظةً واحدة.

// «٤٠٤» تُناقز. والقفزة انحناءةٌ ثمّ ارتفاعٌ ثمّ ملامسةٌ تنضغط ثمّ **سكونٌ
// يملأ أكثر من نصف الدورة** — وذلك السكون هو ما يمنعها أن تُقرأ صورةً
// متحرّكة مبتذلة: تقفز، ثمّ تنتظر، ثمّ تقفز.
export const HOP = {
    ms: 1600,      // الدورة كاملةً: قفزةٌ ≈٥٢٪ ثمّ سكون
    step: 140,     // فارقُ الموجة بين رقمٍ والذي يليه — نفسُ تعاقب السقوط
    rise: 16,      // أعلى ارتفاع (بكسل)
    squash: 0.05,  // شدّة الانضغاط عند الانحناءة والملامسة
};

// الفانوس يتنفّس: شفافيّةٌ تهبط ثمّ تعود. بطيءٌ عمدًا (٥٫٢s) كي يُقرأ
// اشتعالًا لا وميضًا.
export const GLOW = { ms: 5200, dim: 0.72 };

// انسياقُ الكاميرا على اللوحة. ٢٦ ثانيةً للدورة الواحدة، وإزاحةٌ ٠٫٢٢٪ —
// أبطأ وأصغر من أن يُلاحَظ بالنظر المباشر، وكافٍ ليمنع الصورةَ أن تُقرأ ورقةً
// مطبوعة. ودورتُه تبدأ وتنتهي عند الصفر بالضبط فلا تُرى «عودة».
export const DRIFT = { ms: 26000, x: 0.22, y: 0.16, to: 1.014 };

// متى تبدأ قفزةُ الرقم `i`: بعد أن يستقرّ آخر رقمٍ لا بعد أن يستقرّ هو —
// كي تُقرأ الموجة موجةً واحدةً على المجموعة، لا ثلاثَ قفزاتٍ مبعثرة.
export function hopAt(i) { return dropEnd() + i * HOP.step; }

// سقفُ حركة **الوصول** وحدها: آخر لحظةٍ في التتابع الذي يقع مرّةً لكلّ تحميل.
// (الحركات الدائمة الثلاث خارجَه بحكم تعريفها، وحدُّها أنها معدودةٌ ومقيسة.)
export function revealTotal() {
    const t = textAt();
    return Math.max(
        BG.ms,
        LAMP.at + LAMP.ms,
        thudAt() + DROP.thudMs,
        t.title + TEXT.titleMs,
        t.body + TEXT.bodyMs,
        t.btn + TEXT.btnMs,
    );
}

// --- parallax: النصفُ الثاني من §٢ -------------------------------------------
//
// §٢ عقدان لا عقدٌ واحد: «لا شيء يتحرّك في السكون» و«يستجيب فورًا عند اللمس».
// صفحةٌ تسقط مرّةً ثمّ تتجمّد تفي بالأوّل وتُخلف الثاني. فالإزاحة هنا **٠٫٥٪**
// من عرض الصورة عند أقصى زاوية — تحت عتبة الملاحظة الواعية، وفوق عتبة
// الإحساس بأن الصفحة حيّة. والصورة مكبَّرةٌ ١٫٠٣ في CSS، فالفائضُ ١٫٥٪ على كلّ
// جانب: ثلاثةُ أضعاف أقصى إزاحة، فلا تنكشف حافّةٌ أبدًا.
export const PARALLAX = { bg: 0.5, lamp: 1.4, slack: 1.5 };

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// إزاحة عنصرٍ معامله `k` حين يكون المؤشّر عند `norm` (٠..١ على المحور).
// الوسط = صفر، فحالةُ الراحة هي اللوحة بالضبط لا تقريبٌ لها.
export function shift(norm, k) {
    return (clamp01(norm) - 0.5) * 2 * k;
}

// هل يستحيل أن تنكشف حافّة؟ يُقاس عدديًّا بدل أن يُجرَّب بالعين. والانسياق
// يُحسَب معها: إزاحتان تقعان على نفس اللوحة وقد تجتمعان في نفس الاتّجاه.
export function overscanSafe(p = PARALLAX) {
    return Math.abs(shift(1, p.bg)) + DRIFT.x <= p.slack;
}

// --- المحرّك -----------------------------------------------------------------

const mq = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };
const NOOP = { destroy() { } };

const can = el => el && typeof el.animate === 'function';

// كلّ حركةٍ هنا بـ`fill: 'backwards'` **لا `'forwards'`**: حالةُ الراحة في CSS
// هي التصميم النهائي، والحركة تملأ ما **قبل** بدايتها وحدها ثمّ تتخلّى عن
// الخاصّيّة تمامًا. وهذا ما يجعل الصفحة صحيحةً حتى لو لم يعمل السكربت إطلاقًا،
// ويعيد `transform` إلى الـparallax بلا تنازعٍ على المِلكيّة.
const play = (el, frames, ms, delay, easing) =>
    can(el) && el.animate(frames, { duration: ms, delay, easing, fill: 'backwards' });

// والدائمة بـ`fill: 'none'` **لا `'backwards'`**: حركةٌ دائمةٌ تأتي بعد حركةِ
// وصولٍ على نفس الخاصّيّة، ولو ملأت ما قبلها لداست تلك الوصول من أوّل إطار
// (المتأخّرُ إنشاءً يفوز). فلا تكتب شيئًا حتى يحين موعدُها.
const loop = (el, frames, ms, delay, easing) =>
    can(el) && el.animate(frames, { duration: ms, delay, easing, iterations: Infinity, fill: 'none' });

// «حركةٌ أقلّ»: لا سقوط ولا ارتطام. تدرّجٌ واحدٌ قصير للمجموعة كلّها — لأن
// ظهورًا فوريًّا تامًّا يُقرأ قفزةً، وما يُطلَب حذفُه هو **الارتداد** لا الانتقال.
export const CALM = { ms: 420, y: 10, step: 60 };

function playCalm(parts) {
    parts.forEach((el, i) => play(el,
        [{ transform: `translate3d(0, ${CALM.y}px, 0)`, opacity: 0 },
        { transform: 'translate3d(0, 0, 0)', opacity: 1 }],
        CALM.ms, i * CALM.step, TEXT.ease));
}

function playDrop(digits, thud) {
    for (let i = 0; i < digits.length; i++) {
        const d = dropOf(i);
        play(digits[i], [
            {
                offset: 0, opacity: 0,
                transform: `translate3d(0, ${d.from}px, 0) rotate(${d.tilt}deg) scale(.97)`,
                easing: DROP.fallEase,
            },
            { offset: 0.16, opacity: 1, easing: DROP.fallEase },
            // الارتطام: وصلَ موضعَه واستوى ميلُه.
            { offset: 0.60, transform: 'translate3d(0,0,0) rotate(0deg) scale(1)', easing: DROP.landEase },
            // ثمّ يضغط ما تحته قليلًا…
            { offset: 0.78, transform: `translate3d(0, ${DROP.settle}px, 0) rotate(0deg) scale(1.015)`, easing: DROP.landEase },
            // …ويستقرّ.
            { offset: 1, transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
        ], d.ms, d.delay, 'linear');
    }
    // ظلّ الارتطام: يتّسع ويخفت مرّةً واحدة عند وصول آخر رقم. بدونه يهبط
    // الرقم إلى لا شيء — والوزن كلّه في ما يتركه الوقوع، لا في الوقوع.
    play(thud, [
        { offset: 0, opacity: 0, transform: 'translate3d(-50%,0,0) scaleX(.35)' },
        { offset: 0.22, opacity: 0.55, transform: 'translate3d(-50%,0,0) scaleX(1.05)' },
        { offset: 1, opacity: 0, transform: 'translate3d(-50%,0,0) scaleX(1.25)' },
    ], DROP.thudMs, thudAt(), 'cubic-bezier(.2,.7,.3,1)');
}

// الحركات الدائمة الثلاث. كلٌّ منها دورةٌ تبدأ وتنتهي عند **نفس** الإطار
// تمامًا، فلا يُرى قطعٌ ولا «عودةٌ إلى البداية» عند التفاف الدورة.
function playAmbient(digits, thud, lamp, bg) {
    const s = HOP.squash;
    for (let i = 0; i < digits.length; i++) {
        loop(digits[i], [
            { offset: 0, transform: 'translate3d(0,0,0) scale(1,1)' },
            // انحناءةٌ قبل القفز: بدونها يبدو الرقم مسحوبًا بخيط.
            { offset: 0.07, transform: `translate3d(0,3px,0) scale(${1 + s},${1 - s})`, easing: 'cubic-bezier(.4,0,.6,1)' },
            { offset: 0.25, transform: `translate3d(0,${-HOP.rise}px,0) scale(${1 - s * 0.6},${1 + s * 0.6})`, easing: DROP.fallEase },
            // ملامسةٌ تنضغط…
            { offset: 0.40, transform: `translate3d(0,0,0) scale(${1 + s},${1 - s})`, easing: DROP.landEase },
            // …ثمّ استواءٌ، ثمّ سكونٌ يملأ باقي الدورة.
            { offset: 0.52, transform: 'translate3d(0,0,0) scale(1,1)' },
            { offset: 1, transform: 'translate3d(0,0,0) scale(1,1)' },
        ], HOP.ms, hopAt(i), 'linear');
    }
    // والظلّ يومض مع **ملامسة آخر رقم** (المفتاح ٠٫٤٠)، فيبقى الوقوع ملموسًا
    // في كلّ دورة كما كان في الأولى.
    const last = digits.length - 1;
    if (last >= 0) loop(thud, [
        { offset: 0, opacity: 0, transform: 'translate3d(-50%,0,0) scaleX(.5)' },
        { offset: 0.34, opacity: 0, transform: 'translate3d(-50%,0,0) scaleX(.5)' },
        { offset: 0.42, opacity: 0.42, transform: 'translate3d(-50%,0,0) scaleX(1)' },
        { offset: 0.62, opacity: 0, transform: 'translate3d(-50%,0,0) scaleX(1.15)' },
        { offset: 1, opacity: 0, transform: 'translate3d(-50%,0,0) scaleX(.5)' },
    ], HOP.ms, hopAt(last), 'cubic-bezier(.2,.7,.3,1)');

    // نَفَسُ الفانوس.
    loop(lamp, [
        { offset: 0, opacity: 1 },
        { offset: 0.5, opacity: GLOW.dim },
        { offset: 1, opacity: 1 },
    ], GLOW.ms, LAMP.at + LAMP.ms, 'cubic-bezier(.4,0,.6,1)');

    // انسياقُ اللوحة. على **الغلاف** لا على الصورة: الصورة يملكها الـparallax،
    // والغلاف فرغ من حركة الدخول عند `BG.ms` فصار حرًّا.
    loop(bg, [
        { offset: 0, transform: 'translate3d(0,0,0) scale(1)' },
        { offset: 0.5, transform: `translate3d(${-DRIFT.x}%,${-DRIFT.y}%,0) scale(${DRIFT.to})` },
        { offset: 1, transform: 'translate3d(0,0,0) scale(1)' },
    ], DRIFT.ms, BG.ms, 'cubic-bezier(.4,0,.6,1)');
}

// `root` = `.tallal`. تُرجع كائنًا له `destroy()` وحده — لا حالةَ عامّة، ولا
// مؤقّتات، ولا شيء يعمل حين لا يتحرّك أحد.
export function createTallal(root) {
    if (!root || typeof window === 'undefined') return NOOP;

    const q = s => root.querySelector(s);
    const bg = q('.tallal-bg');
    const img = q('.tallal-bg__img');
    const lamp = q('.tallal-lamp');
    const num = q('.tallal-num');
    const digits = num ? [...num.querySelectorAll('.tallal-digit')] : [];
    const thud = q('.tallal-thud');
    const title = q('.tallal-title');
    const body = q('.tallal-body');
    const btn = q('.tallal-cta');

    const calm = mq('(prefers-reduced-motion: reduce)');

    if (calm) {
        playCalm([num, title, body, btn].filter(Boolean));
        return NOOP;                       // ولا parallax: الاستجابة نفسها حركة
    }

    // المرحلة ١ — الخلفيّة. الغلاف يملك `scale`+`opacity`، والصورة بداخله
    // تملك `translate` وحدها: مالكٌ واحدٌ لكلّ خاصّيّة، وإلّا داس أحدهما الآخر.
    play(bg,
        [{ opacity: 0, transform: `scale(${BG.from})` }, { opacity: 1, transform: 'scale(1)' }],
        BG.ms, 0, BG.ease);
    // والضوءُ يتأخّر قليلًا ويطول: يُقرأ اشتعالًا بطيئًا لا ومضةً مع الصورة.
    play(lamp, [{ opacity: 0 }, { opacity: 1 }], LAMP.ms, LAMP.at, 'cubic-bezier(.4,0,.5,1)');

    // المرحلة ٢ — «٤٠٤».
    playDrop(digits, thud);

    // المراحل ٣–٥ — النصّ.
    const t = textAt();
    play(title,
        [{ opacity: 0, transform: `translate3d(0,${TEXT.titleY}px,0)`, filter: `blur(${TEXT.titleBlur}px)` },
        { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' }],
        TEXT.titleMs, t.title, TEXT.ease);
    play(body,
        [{ opacity: 0, transform: `translate3d(0,${TEXT.bodyY}px,0)`, filter: `blur(${TEXT.bodyBlur}px)` },
        { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' }],
        TEXT.bodyMs, t.body, TEXT.ease);
    play(btn,
        [{ opacity: 0, transform: `translate3d(0,${TEXT.btnY}px,0) scale(${TEXT.btnFrom})` },
        { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }],
        TEXT.btnMs, t.btn, TEXT.ease);

    // بعد الوصول: الصفحة تبقى حيّة — المناقزة والنَّفَس والانسياق.
    playAmbient(digits, thud, lamp, bg);

    // --- الاستجابة: إطارٌ واحدٌ لكلّ رسمة ------------------------------------
    // الحدث يسجّل الموضع فقط، والكتابة تقع مرّةً في `requestAnimationFrame`.
    // بلا هذا يكتب مؤشّرٌ بمعدّل ١٢٠Hz تحويلين في كلّ حدث.
    let px = 0, py = 0, queued = false;

    function draw() {
        queued = false;
        const nx = px / Math.max(1, innerWidth);
        const ny = py / Math.max(1, innerHeight);
        if (img) img.style.transform =
            `translate3d(${-shift(nx, PARALLAX.bg)}%, ${-shift(ny, PARALLAX.bg) * 0.5}%, 0)`;
        if (lamp) lamp.style.transform =
            `translate(-50%,-50%) translate3d(${-shift(nx, PARALLAX.lamp)}%, ${-shift(ny, PARALLAX.lamp) * 0.5}%, 0)`;
    }
    function onMove(e) {
        px = e.clientX; py = e.clientY;
        if (queued) return;
        queued = true;
        requestAnimationFrame(draw);
    }
    // مغادرة النافذة تعيد المشهد إلى راحته بدل أن تجمّده على آخر إطار.
    function onLeave() {
        px = innerWidth / 2; py = innerHeight / 2;
        if (queued) return;
        queued = true;
        requestAnimationFrame(draw);
    }

    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerout', onLeave, { passive: true });

    return {
        destroy() {
            removeEventListener('pointermove', onMove);
            removeEventListener('pointerout', onLeave);
        },
    };
}
