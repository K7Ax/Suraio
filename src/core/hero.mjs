// core/hero — الهيرو مشهدًا مفصول الطبقات، لا مقطعًا.
//
// ما يستبدله، ولماذا. المقطع الذي كان هنا كان يخالف الدستور
// (`docs/architecture/identity.md` §٢: «في السكون لا شيء يتحرّك، صفر إطارات») بحركةٍ دائمة
// بلا سبب — وهو نفس ما أسقط «النَّول المنجرف» و«مرور المكوك». هذا المشهد
// **ساكنٌ تمامًا** بعد الدخول، ولا يتحرّك إلا استجابةً للمؤشّر. فهو ليس تنازلًا
// عن الفيلم بل تطبيقٌ لنصّ §٢: صمتٌ حتى يُلمَس، ثم استجابةٌ دقيقة، ثم صمت.
//
// وهو أخفّ (102KB بدل 1.3MB)، وحادٌّ على أي كثافة بكسل — وهما الشكويان
// اللتان بدأت منهما الجولة.
//
// ---------------------------------------------------------------------------
// عنصران لكل طبقة، وهذا شرطُ صحّة لا ترتيبُ ملفّات:
//
//   .film-layer       ← الدخول يملكه   (scale, y)
//   .film-layer__img  ← الـparallax يملكه (xPercent, yPercent)
//
// قاعدة **ONE OWNER PER PROPERTY** موثّقة في `src/core/cards.mjs:100-107`،
// وقد كلّفت دورة تصحيح كاملة في هذه الجولة نفسها: البطاقات علقت على
// `scale(0.985)` لأن `gsap.to` و`quickTo` تنازعتا خاصيّة واحدة. هنا الدخول
// يحرّك `y` بـ`gsap.to` والـparallax يحرّكه بـ`quickTo` — فلو كانا على عنصر
// واحد لتكرّر العطل حرفيًّا. عنصران = مالكان منفصلان = العطل **مستحيل بنيويًّا**
// لا محروسٌ بالانتباه.
// ---------------------------------------------------------------------------
import { gsap } from 'gsap';
import { reduced as reducedMotion, finePointer } from './tier.mjs';

// أعماق الطبقتين. العمق المحسوس هو **الفرق** بينهما (0.62) لا عددهما — ولهذا
// أُسقطت طبقتا القمر والبلدة في `scripts/assets/hero_layers.js`: فرقهما عن السماء
// كان يعطي 3px و7px عند 2560، أي أقلّ من عتبة الإدراك، بثمن قصّتين وثقبين.
export const LAYERS = [
    { name: 'sky', d: 0.03 },
    { name: 'near', d: 0.65 },
];

// مدى الـparallax بالنسبة المئوية من العرض، عند أقصى زاوية للمؤشّر.
export const MAX = 4;
// الفائض: الطبقة تُرسم بعرض 108% مُزاحةً -4%، فلها 4% من كل جانب.
export const OVERSCAN = 8;

// كانت هاتان نسختَين محلّيتَين من قراءتَين تكرّرتا حرفيًّا في ثلاثة ملفّات.
// صارتا في `tier.mjs` تُقرآن مرّةً واحدةً وتُحفظان — و`matchMedia` قراءةُ
// تخطيطٍ لا تتغيّر خلال الجلسة، فلا معنى لإعادتها لكلّ حركة مؤشّر.
const REDUCED = () => reducedMotion();
const FINE = () => finePointer();

// --- دوال نقيّة، مُختبَرة في tests/hero.test.js ----------------------------

// إزاحة طبقة عمقُها d حين يكون المؤشّر عند `norm` (‏0..1 على المحور).
// المركز (0.5) يعطي صفرًا، والطرفان ‎±d*max/2.
export function depthShift(norm, d, max = MAX) {
    const n = Math.max(0, Math.min(1, norm)) - 0.5;
    return n * d * max;
}

// هل يستحيل أن تنكشف حافّة؟ أقصى إزاحة لأعمق طبقة يجب أن تبقى داخل نصف
// الفائض. هذا الشرط هو الفرق بين parallax يعمل وparallax يُظهر خلفية سوداء
// عند طرف الشاشة — ويُختبَر عدديًّا بدل أن يُجرَّب بصريًّا.
export function overscanSafe(layers = LAYERS, max = MAX, overscan = OVERSCAN) {
    const deepest = layers.reduce((m, l) => Math.max(m, l.d), 0);
    return Math.abs(depthShift(1, deepest, max)) <= overscan / 2;
}

// حالة الدخول لكل طبقة: الأعمق يقطع أكبر مسافة، والسماء بالكاد تتحرّك.
// وهذا وحده ما يُقرأ اقترابَ كاميرا؛ الاقتراب المتساوي يُقرأ تكبيرَ صورة.
export function entranceFrom(d) {
    return { scale: 1 + d * 0.22, y: d * -40 };
}

// --- المحرّك ---------------------------------------------------------------

export function createHero(stage, opts) {
    const o = opts || {};
    if (!stage) return { enter() { }, still() { }, stop() { }, get up() { return false; } };

    const els = LAYERS.map(l => {
        const outer = stage.querySelector(`.film-layer[data-layer="${l.name}"]`);
        return outer ? { ...l, outer, img: outer.querySelector('.film-layer__img') } : null;
    }).filter(Boolean);
    if (!els.length) return { enter() { }, still() { }, stop() { }, get up() { return false; } };

    let tl = null, quick = null, onMove = null, running = false;

    // الدخول يُعاش مرّة واحدة في الجلسة. إعادته مع كل رجوعٍ إلى الواجهة تحوّله
    // من لحظةٍ إلى تكرار — وهي نفس الحجّة التي حذفت شاشة الإقلاع.
    function seen() {
        try { return sessionStorage.getItem('sura.hero') === '1'; } catch (e) { return false; }
    }
    function mark() {
        try { sessionStorage.setItem('sura.hero', '1'); } catch (e) { }
    }

    function bindParallax() {
        if (quick || !FINE()) return;
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
    }

    return {
        get up() { return running; },

        // تُستدعى حين تصير الواجهة هي المسار المعروض.
        enter() {
            if (running) return;
            running = true;

            // حركةٌ أقلّ: المشهد ساكنٌ كما هو، وهو التصميم النهائي أصلًا لا
            // نسخةٌ منقوصة منه. لا دخول ولا parallax ولا مستمعات.
            if (REDUCED()) return;

            bindParallax();
            if (seen()) return;
            mark();

            // بلا `opacity` إطلاقًا (style.css:118-143): iOS Safari يُجمّد إطار
            // البداية حين يعود قسمٌ ثابت من display:none، وإطارُ بدايةٍ شفاف
            // يعني محتوى غير مرئي إلى الأبد.
            tl = gsap.timeline({
                onComplete: () => { tl = null; },   // ثم سكونٌ تامّ: لا tween حيّ، ومؤقّت GSAP ينام
            });
            els.forEach((l, i) => {
                tl.fromTo(l.outer, entranceFrom(l.d),
                    { scale: 1, y: 0, duration: 1.8, ease: 'expo.out' },
                    i * 0.055);
            });
        },

        // المسار الضعيف: لوحةٌ مسطّحة واحدة. المحرّك لا يملك شيئًا هنا —
        // main.js يعرض `.film-flat` ويحرّكها بـgsapDrift الموجودة.
        still() {
            unbindParallax();
            if (tl) { tl.kill(); tl = null; }
        },

        stop() {
            running = false;
            unbindParallax();
            if (tl) { tl.kill(); tl = null; }
            // تُترك الطبقات في وضع الراحة، لا تُمسح: مسحُها يعيدها إلى إطار
            // البداية عند الرجوع، وهو أسوأ من إبقائها ساكنة صحيحة.
            gsap.set(els.map(l => l.outer), { scale: 1, y: 0 });
            gsap.set(els.map(l => l.img), { xPercent: 0, yPercent: 0 });
        },
    };
}
