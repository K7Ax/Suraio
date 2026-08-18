// core/story — الهيرو قصّةً تُعرَض مقطعًا، مرّةً واحدة لكل تحميل صفحة.
//
// كان هذا الملف يسحب القصّة بالتمرير على الشاشة (مدرج ٣٠٠vh + ScrollTrigger)
// ويعرضها مقطعًا على اللمس وحده. وبقرار المالك (٨ أغسطس ٢٠٢٦) صار العرض
// المقطعي هو السلوك الوحيد على كل جهاز: «خلّ الصور مقطع زي الجوال».
//
// وهو **مخالفٌ صراحةً** لـ`docs/architecture/identity.md` §٢ («حركة تُشاهَد ولا تُستدعى =
// ديكور») — البند نفسه الذي أسقط «مرور المكوك» و«النَّول المنجرف». مكتوبٌ هنا
// كي يُقرأ قرارًا مأخوذًا لا سهوًا: من أراد إرجاع السحب فليُرجع المدرج في
// style.css أوّلًا، فبدونه يقرأ ScrollTrigger تقدّمًا يبقى صفرًا.
//
// ---------------------------------------------------------------------------
// الدرس الذي بنى هذا الملف. الجولة السابقة (`src/core/hero.mjs`) حرّكت الطبقات
// بنموذجٍ فيزيائي بحت: الإزاحة = العمق × مقدار. وهو صحيح للـparallax وعاجزٌ
// تمامًا عن القصّ: لإخراج الكثبان البعيدة (d=0.14) من الإطار يحتاج النموذج
// رفعَ كاميرا بمقدار 321% من ارتفاع الشاشة — وعندها يقفز الكثيب الأمامي
// (d=0.72) بمقدار 231%، أي يعبر الإطار مرّتين. فالكشف **لا يُشتقّ** من العمق.
//
// فُصلت الحركتان، وهذا هو القرار المعماري كلّه:
//
//   الكشف (القصّة)   → نافذةٌ ومسافةٌ يعلنهما كلُّ طبقةٍ لنفسها (`in/out/from`).
//                       اختيارُ إخراجٍ، لا فيزياء. مقروء، ومضبوط، ومُختبَر.
//   العمق (الإحساس) → `d` — يخدم parallax المؤشّر وحده، صغيرًا ودقيقًا.
//
// ---------------------------------------------------------------------------
// عنصران لكل طبقة، وهذا شرطُ صحّة لا ترتيبُ ملفّات:
//
//   .film-layer       ← الخطّ الزمني المربوط بالتمرير يملكه (y, xPercent, opacity)
//   .film-layer__img  ← الـparallax يملكه                    (xPercent, yPercent)
//
// قاعدة ONE OWNER PER PROPERTY (`src/core/cards.mjs:167-176`). عنصران =
// مالكان منفصلان = التصادم **مستحيل بنيويًّا** لا محروسٌ بالانتباه.
// ---------------------------------------------------------------------------

// مدى الـparallax بالنسبة المئوية من العرض، عند أقصى زاوية للمؤشّر.
export const MAX = 4;
// الفائض: الطبقة تُرسم بعرض 108% مُزاحةً -4%، فلها 4% من كل جانب.
export const OVERSCAN = 8;

// الطبقات بترتيب z من الخلف إلى الأمام. الترتيب هنا **هو** ترتيب الرسم.
//
//   d     — العمق، للـparallax فقط (0 = لا نهاية، 1 = عند الكاميرا)
//   from  — موضع البداية بوحدة vh؛ موجب = تحت الإطار، سالب = فوقه
//   in/out— نافذة الطبقة على مسار التمرير [0..1]
//   x     — إزاحة أفقية للدخول (vw)، للمسافر وحده
//
// المسافر وكثيبه بنفس العمق عمدًا: هو واقفٌ **على** هذا الكثيب، وعمقٌ مختلف
// يجعله يطفو فوق أرضه — عطلٌ يُرى من الثانية الأولى. طبقتان منفصلتان لأن له
// دخولًا أفقيًّا خاصًّا به، لا لأن له عمقًا خاصًّا به.
export const LAYERS = [
    { name: 'stars', d: 0.00, from: -6, in: 0.00, out: 0.30 },
    { name: 'milkyway', d: 0.02, from: -14, in: 0.00, out: 0.36 },
    { name: 'moon', d: 0.05, from: -34, in: 0.10, out: 0.46 },
    { name: 'dunes-far', d: 0.14, from: 46, in: 0.22, out: 0.58 },
    { name: 'town', d: 0.18, from: 40, in: 0.34, out: 0.68 },
    { name: 'dunes-mid', d: 0.34, from: 62, in: 0.30, out: 0.74 },
    { name: 'dune-near', d: 0.72, from: 78, in: 0.58, out: 0.96 },
    { name: 'traveller', d: 0.72, from: 78, in: 0.70, out: 1.00, x: 26 },
];

// المشاهد الأربعة. تقسيمٌ صارم للمدى [0,1] بلا فجوة ولا تداخل — يُختبَر.
export const BEATS = [
    { id: 'sky', from: 0.00, to: 0.25, caption: 'في الليلِ لا يبدأُ الطريقُ إلّا بخطوة' },
    { id: 'horizon', from: 0.25, to: 0.50, caption: 'والليلُ لا يُخفي المدى، بل يُظهرُه' },
    { id: 'town', from: 0.50, to: 0.75, caption: 'وهناك، ضوءٌ ينتظر' },
    { id: 'traveller', from: 0.75, to: 1.00, caption: '' },   // العنوان نفسه يصل هنا
];

// نوافذ البلدة تُشعَل على قفزات، لا بتدرّج. أضواءٌ تُفتَح لا صورةٌ تُبهَت —
// وهو أيضًا ما يبقيها داخل استثناء «نافذة واحدة» في §٢ شكلًا ومعنًى.
export const WINDOW_STEPS = 4;

// التشغيل التلقائي — على كل جهاز منذ ٨ أغسطس ٢٠٢٦.
//
// بدأ استثناءً للّمس وحده (٢٨ يوليو ٢٠٢٦): لا مؤشّر هناك فلا parallax، والمدرج
// ١٤٠vh لا ٣٠٠vh فالسحب لا يكفي أربعة مشاهد — أي أن الاختيار لم يكن بين
// «مسحوبة» و«تُشاهَد» بل بين «مبتورة» و«كاملة». ثم عمّمه المالك على الشاشة
// أيضًا. وتُعرَض **مرّةً واحدة لكل تحميل صفحة**: العودة إلى الواجهة تجد
// المشهد عند راحته، لا تعيده من أوّله.
//
// و`duration` مقسومةٌ ضمنًا على أربعة مشاهد = ~٢٫٣s لكل سطر — زمنُ قراءةِ
// جملةٍ عربيةٍ قصيرة مرّةً واحدة بلا استعجال.
export const AUTO = { delay: 0.4, duration: 9.2 };

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- دوال نقيّة، مُختبَرة في tests/story.test.js ---------------------------

// تخفيفٌ متماثل الطرفين: يبدأ ساكنًا وينتهي ساكنًا، فلا تصل طبقةٌ إلى مكانها
// وهي ما تزال مسرعة — وهذا وحده الفرق بين «استقرار» و«توقّف مفاجئ».
export function ease(t) {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// تقدّم طبقةٍ داخل نافذتها: 0 قبلها، 1 بعدها، ومخفَّفٌ بينهما.
export function progress(cam, l) {
    const span = l.out - l.in;
    if (span <= 0) return 1;
    return ease((clamp01(cam) - l.in) / span);
}

// الإزاحة الرأسية لطبقةٍ عند موضع تمرير `cam`، بوحدة vh.
// عند `cam >= l.out` تساوي صفرًا حتمًا — وهو الثابت الذي يجعل نهاية المسار
// **هي** حالة الراحة في CSS، فلا يمكن لأي فشلٍ أن يترك المشهد ناقصًا.
export function layerY(cam, l) {
    const y = l.from * (1 - progress(cam, l));
    return y === 0 ? 0 : y;      // يطبّع ‎-0 الناتج عن `from` سالب عند الاستقرار
}

// الإزاحة الأفقية — للمسافر وحده. يدخل من الحافّة اليمنى (RTL: من حيث يأتي
// السائرُ في هذه اللغة) ويستقرّ على الحرف.
export function layerX(cam, l) {
    if (!l.x) return 0;
    return l.x * (1 - progress(cam, l));
}

// أي مشهدٍ نحن فيه. يُرجع الأخير عند 1 تمامًا كي لا يسقط الطرف.
export function beatOf(cam) {
    const c = clamp01(cam);
    for (const b of BEATS) if (c < b.to) return b;
    return BEATS[BEATS.length - 1];
}

// كم نافذةً أُضيئت في البلدة عند هذا الموضع: 0 قبل مشهد البلدة، ثم قفزاتٌ
// صحيحة حتى WINDOW_STEPS، وتبقى مضاءة بعده. الأضواء لا تنطفئ بالرجوع للأعلى
// عشوائيًّا — بل تتراجع بنفس القفزات، لأن موضع التمرير هو الحالة.
export function windowStep(cam, steps = WINDOW_STEPS) {
    const b = BEATS[2];
    const p = clamp01((clamp01(cam) - b.from) / (b.to - b.from));
    return Math.min(steps, Math.ceil(p * steps));
}

// إزاحة parallax لطبقة عمقُها d حين يكون المؤشّر عند `norm` (0..1 على المحور).
export function depthShift(norm, d, max = MAX) {
    return (clamp01(norm) - 0.5) * d * max;
}

// هل يستحيل أن تنكشف حافّةٌ عند الراحة؟ أقصى إزاحة parallax لأعمق طبقة يجب
// أن تبقى داخل نصف الفائض. يُقاس عدديًّا بدل أن يُجرَّب بصريًّا.
export function overscanSafe(layers = LAYERS, max = MAX, overscan = OVERSCAN) {
    const deepest = layers.reduce((m, l) => Math.max(m, l.d), 0);
    return Math.abs(depthShift(1, deepest, max)) <= overscan / 2;
}

// هل تنتهي كلّ طبقةٍ عند الراحة تمامًا في نهاية المسار؟ هذا **أهمّ ثابتٍ في
// الملف**: نهاية القصّة يجب أن تطابق حالة CSS الافتراضية بالضبط، وإلّا صار
// سقوطُ JS أو فشلُ ScrollTrigger مشهدًا ناقصًا بدل مشهدٍ ساكنٍ صحيح.
export function restsAtEnd(layers = LAYERS) {
    return layers.every(l => layerY(1, l) === 0 && layerX(1, l) === 0);
}

// --- المحرّك ---------------------------------------------------------------

import { reduced as reducedMotion, finePointer } from './tier.mjs';

// النسختان المحلّيتان انتقلتا إلى `tier.mjs` — انظر التعليق هناك. الاستيراد
// آمنٌ في node رغم أنّ هذا الملفّ يُختبَر بلا DOM: ‏`tier.mjs` لا تستورد GSAP
// ولا تلمس `window` إلّا خلف فحصِ وجود.
const REDUCED = () => reducedMotion();
const FINE = () => finePointer();
// (فحصُ اللمس حُذف مع مسار التمرير: العرض واحدٌ على كل جهاز الآن.)

const NOOP = { enter() { }, leave() { }, destroy() { }, get up() { return false; } };

// `gsap` يُمرَّر حقنًا لا استيرادًا: هذا الملف يُختبَر في Node حيث لا DOM،
// واستيراد GSAP في أعلاه كان سيُسقط ملفّ الاختبار كلّه على وحدةٍ لا تعمل خارج
// المتصفّح. (ScrollTrigger كان يُمرَّر هنا أيضًا، وسقط مع مسار التمرير.)
export function createStory(stage, scroller, gsap) {
    if (!stage || !scroller || !gsap) return NOOP;

    const els = LAYERS.map(l => {
        const outer = stage.querySelector(`.film-layer[data-layer="${l.name}"]`);
        return outer ? { ...l, outer, img: outer.querySelector('.film-layer__img') } : null;
    }).filter(Boolean);
    if (!els.length) return NOOP;

    const caps = stage.querySelectorAll('.film-caption');
    let quick = null, onMove = null, running = false, beat = null;
    let tl = null, played = false;

    // حالة الراحة = المشهد الأخير. تُطبَّق صراحةً عند كل مغادرة كي لا يبقى
    // إطارٌ وسيط عالقًا إن قُتل ScrollTrigger في منتصف المسار.
    function rest() {
        unbindSkip();
        for (const l of els) gsap.set(l.outer, { y: 0, x: 0 });
        stage.dataset.win = String(WINDOW_STEPS);
        showBeat(BEATS[BEATS.length - 1]);
        // «ابدأ سُراك» يصل مع خاتمة المشهد لا قبلها (يحجبه السكربت السطري في
        // index.html على اللمس وحده). هنا نقطةٌ واحدة تكشفه مهما كان سبب بلوغ
        // الراحة: اكتمالُ العرض · مقاطعته · مغادرة المسار · «حركةٌ أقلّ».
        try { document.documentElement.removeAttribute('data-story'); } catch (e) { }
    }

    // السطور داخل `.film-stage` لا داخل `#home`: المسرح شقيق `<main>` وليس
    // حفيد `.scroll-section`، فمنعُ الـopacity (style.css:118-143، خلل iOS
    // Safari) لا يسري عليه. لو وُضعت في القسم لتجمّدت شفّافةً عند الرجوع.
    function showBeat(b) {
        if (b === beat) return;                       // لا عمل ما لم يتغيّر المشهد
        beat = b;
        for (const c of caps) {
            const on = c.dataset.beat === b.id && !!b.caption;
            gsap.to(c, { opacity: on ? 1 : 0, duration: 0.45, ease: 'power2.out', overwrite: true });
        }
    }

    // الرسم: دالّةٌ واحدة من موضع التمرير إلى المشهد. ليست tween — ScrollTrigger
    // يستدعيها بقيمةٍ مخمّدة، فالتخميد يحدث مرّةً واحدة في مكانٍ واحد.
    // `layerY` بوحدة vh و`layerX` بوحدة vw، وتُحوَّلان هنا إلى بكسل.
    // استعمال `yPercent` كان يبدو أنظف وهو **خطأ**: النسبة فيه من ارتفاع
    // العنصر نفسه، وارتفاعات الطبقات هنا تتراوح بين 6% و75% من الإطار — فكانت
    // كل طبقةٍ تُزاح بمقدارٍ مختلف تمامًا عمّا تقوله الرياضيات المُختبَرة.
    //
    // ‏`gsap.set` كانت تُستدعى هنا **لكلّ طبقةٍ في كلّ إطار**، وهي ليست كتابةَ
    // خاصيّة: كلّ نداءٍ منها يُنشئ tween صفريّ المدّة كاملًا — تخصيصٌ، وقراءةُ
    // النمط السطريّ وحفظُه (`_saveStyle`)، وتهيئةٌ، ثمّ عرضٌ، ثمّ إهمال. قيس
    // على Pixel 5 مخنوقًا ٤×: ‏**٢٨٥ms في `Tween2.set` و٩١ms في `_saveStyle`
    // من ٦٦٣ms جملةَ زمنِ JS** — أي أنّ أكثر من نصف حساب الإقلاع كان ثمنَ
    // الطريقة لا ثمنَ الحركة. ولم تكن الطبقاتُ ولا عددُ القطع سببًا: خفضُ قطع
    // النَّول إلى الربع لم يحرّك الرقم إطلاقًا، وهذا ما دلّ على أنّ الكلفة هنا.
    //
    // ‏`quickSetter` هي علاج GSAP نفسها لهذا بعينه: يُبنى الكاتب مرّةً واحدة
    // فيحتفظ بمرجع الخاصيّة، ثمّ لا يفعل في الإطار إلّا الكتابة. النتيجة على
    // الشاشة **هي هي حرفًا بحرف** — نفس الخاصيّتين، نفس القيمتين، نفس المالك
    // الوحيد لهما (قاعدة ONE OWNER PER PROPERTY في `cards.mjs:100-107` باقية:
    // ‏`l.outer` يملك y/x، و`l.img` وحده يملك xPercent/yPercent).
    const setters = new WeakMap();
    function setterFor(el) {
        let s = setters.get(el);
        if (!s) {
            s = { y: gsap.quickSetter(el, 'y', 'px'), x: gsap.quickSetter(el, 'x', 'px') };
            setters.set(el, s);
        }
        return s;
    }

    function draw(cam) {
        const vh = innerHeight / 100, vw = innerWidth / 100;
        for (const l of els) {
            const s = setterFor(l.outer);
            s.y(layerY(cam, l) * vh);
            s.x(layerX(cam, l) * vw);
        }
        stage.dataset.win = String(windowStep(cam));
        showBeat(beatOf(cam));
    }

    // العرض التلقائي: نفس `draw` بالضبط، ومصدرُ القيمة وحده هو ما تغيّر — زمنٌ
    // بدل إصبع. لا خطّ ثانٍ ولا مالك ثانٍ لأي خاصيّة، فالمشهد الذي يُعرض هنا
    // هو المشهد نفسه الذي يُسحب على الشاشة حرفًا بحرف.
    // التخطّي. القصّة تبقى كما هي — تُعرَض كاملةً لمن تركها تُعرَض — لكنّها
    // تكفّ عن كونها **إلزامًا**. قيس المشهد: عشر ثوانٍ من التحميل قبل أن يظهر
    // العنوان، وإحدى عشرة قبل «ابدأ اللعب»، ونقرةٌ أو دولابٌ أو مفتاحٌ في
    // الثانية الثانية لا يغيّر الجدول بشيء — والصفحة لا تتمرّر (‏scrollHeight
    // = innerHeight) فلا مهرب. وهذا يناقض §٢ من `docs/architecture/identity.md` في أصرح
    // بنودها: «عند اللمس: استجابة خلال ١٠٠ms». لمسةٌ لا يتبعها شيءٌ ثماني
    // ثوانٍ ليست بطئًا في الاستجابة، بل غيابٌ لها.
    //
    // ولا يُقفَز إلى النهاية قفزًا: `timeScale` تُسرّع الباقي فيصل المشهد إلى
    // راحته في نحو نصف ثانية متّصلة — استجابةٌ فوريّة، ثمّ سكونٌ تامّ، بلا
    // قطعٍ مفاجئ وبلا ذيل. و`restsAtEnd()` تضمن أنّ النهاية **هي** حالة CSS،
    // فالتسريع لا يمكن أن يترك مشهدًا ناقصًا مهما وقع في أثنائه.
    const SKIP_EVENTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'];
    let skipOn = null;
    function unbindSkip() {
        if (!skipOn) return;
        for (const t of SKIP_EVENTS) removeEventListener(t, skipOn);
        skipOn = null;
    }
    function bindSkip() {
        unbindSkip();
        skipOn = () => { unbindSkip(); if (tl) tl.timeScale(12); };
        for (const t of SKIP_EVENTS) addEventListener(t, skipOn, { passive: true });
    }

    function play() {
        const cam = { v: 0 };
        draw(0);
        bindSkip();
        tl = gsap.to(cam, {
            v: 1,
            duration: AUTO.duration,
            delay: AUTO.delay,
            ease: 'none',                 // التخفيف داخل `progress` لكل طبقةٍ على حدة
            onUpdate: () => draw(cam.v),
            // شبكة الأمان نفسها: النهاية **هي** حالة CSS الافتراضية، فمقاطعةُ
            // الخطّ (مغادرة المسار في منتصفه) لا تترك مشهدًا ناقصًا.
            onComplete: rest,
            onInterrupt: rest,
        });
    }

    function bindParallax() {
        if (quick || !FINE()) return;
        // على العنصر الداخلي حصرًا — الخارجي يملكه التمرير.
        quick = els.map(l => ({
            l,
            x: gsap.quickTo(l.img, 'xPercent', { duration: 0.9, ease: 'power3' }),
            y: gsap.quickTo(l.img, 'yPercent', { duration: 0.9, ease: 'power3' }),
        }));
        onMove = e => {
            const nx = e.clientX / Math.max(1, innerWidth);
            const ny = e.clientY / Math.max(1, innerHeight);
            for (const q of quick) {
                q.x(-depthShift(nx, q.l.d));
                // الرأسي أضعف: الشاشة أقصر من عرضها، وإزاحةٌ رأسية بنفس القدر
                // تُقرأ اهتزازًا لا عمقًا.
                q.y(-depthShift(ny, q.l.d) * 0.55);
            }
        };
        addEventListener('pointermove', onMove, { passive: true });
    }

    function unbindParallax() {
        if (onMove) removeEventListener('pointermove', onMove);
        onMove = null; quick = null;
        gsap.set(els.map(l => l.img), { xPercent: 0, yPercent: 0 });
    }

    return {
        get up() { return running; },

        // تُستدعى بعد أن يصير `home` هو المسار المعروض فعلًا — لا قبله:
        // القسم يكون `display:none` فتقرأ ScrollTrigger مقاييس تمرير صفرية.
        enter() {
            if (running) return;
            running = true;

            // حركةٌ أقلّ: المشهد عند الراحة هو التصميم النهائي أصلًا، لا نسخةٌ
            // منقوصة منه. لا ربط، ولا مستمعات، ولا مدرج (يُصفَّر في CSS).
            if (REDUCED()) { rest(); return; }

            // المسار الوحيد منذ ٨ أغسطس ٢٠٢٦: القصّة تُعرَض مقطعًا مرّةً على كل
            // جهاز، ثم تستقرّ على المشهد الأخير. كانت الشاشة تسحبها بالتمرير
            // (ScrollTrigger على مدرج ٣٠٠vh) واللمسُ وحده يعرضها مقطعًا، فطلب
            // المالك أن تكون على الشاشة كما هي على الجوّال. فحُذف المدرج من
            // CSS وحُذف معه المسار الذي كان يقرؤه: ربطُ مُشغّلٍ على حاويةٍ لا
            // تتمرّر يعطي تقدّمًا يبقى صفرًا، أي مشهدًا لا يكتمل أبدًا.
            //
            // وهذا يخالف ما يقوله رأس هذا الملف نقلًا عن `docs/architecture/identity.md` §٢
            // («حركة تُشاهَد ولا تُستدعى = ديكور»). القرار قرار المالك، ومكتوبٌ
            // هنا كي لا يُقرأ لاحقًا انحرافًا سها عنه أحد.
            //
            // `played` يجعلها مرّةً واحدة في الجلسة: العودة إلى `home` تصل إلى
            // المشهد الأخير مباشرةً بدل إعادة الحكاية على من سمعها.
            if (played) { rest(); return; }
            played = true;
            // العمق يبقى على المؤشّر الدقيق: مالكه `.film-layer__img` والخطّ
            // الزمني يملك `.film-layer` — مالكان منفصلان، فلا تصادم.
            bindParallax();
            play();
        },

        // تُستدعى عند مغادرة المسار. قتلُ الخطّ إلزامي: `onInterrupt` يستدعي
        // `rest()` فلا يبقى إطارٌ وسيط عالقًا إن غُودر المسار في منتصف العرض.
        leave() {
            running = false;
            unbindParallax();
            unbindSkip();
            if (tl) { tl.kill(); tl = null; }
            rest();
        },

        destroy() { this.leave(); },
    };
}
