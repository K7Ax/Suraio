// src/core/tier.mjs — ما يعرفه الموقع عن الجهاز الذي يعمل عليه، في مكانٍ واحد.
//
// قبل هذا الملفّ كانت المعرفة مبعثرة: `navigator.connection` تُقرأ في موضعٍ واحدٍ
// من `main.js` لأجل المقطع وحده، و`matchMedia('(pointer: fine)')` منسوخةً حرفًا
// بحرف في ثلاثة ملفّات، ولا أحد يقرأ `deviceMemory` ولا `hardwareConcurrency`
// أصلًا. فكان «بحسب إمكانيّات الجهاز» شعارًا لا تنفيذًا: الهاتف بذاكرةٍ جيغين
// يُحمَّل ما يُحمَّله الحاسوب حرفيًّا.
//
// ثلاث طبقات، وحدُّها الأعلى قرارُ المالك نفسه: **الحركة تُقلَّم، والفنّ يبقى**.
//
//   full     — كلّ شيء كما صُمّم.
//   lite     — ما يُحسَب كلّ إطارٍ يُنصَّف: قطعُ النَّول، دقّةُ الرسم، ‏Lottie،
//              والمقطعُ يصير إطارًا ثابتًا. الألوان والخطوط والتخطيط كما هي.
//   minimal  — يُقلَّم أكثر، ويُطفأ ميلُ البطاقات. ولا يزال الفنّ هو الفنّ:
//              لا لونَ يتغيّر، ولا خطَّ، ولا مقاسَ عنصر. لا نسخة «فقيرة» من سُرى.
//
// الدالّة نقيّة عمدًا: تأخذ بيئتها وسيطًا ولا تلمس `navigator` بنفسها، فتُختبَر
// بجدول حالاتٍ في node بلا متصفّح — وهو الفرق بين قاعدةٍ نعرف أنّها تصنّف
// صحيحًا وقاعدةٍ نأمل ذلك.

export const TIERS = ['full', 'lite', 'minimal'];

// ما يُسمَح به في كلّ طبقة. القيم أرقامٌ لا أعلامٌ حيث أمكن، كي يقرأها المستدعي
// مباشرةً بدل أن يعيد بناء الشرط عنده — وإلّا عاد التشتّت من الباب الخلفيّ.
// كانت الخطّة تحمل مفتاحًا لـLottie أيضًا. فُحص المستودع قبل كتابته فتبيّن أنّ
// ‏Lottie لم تعد في الشيفرة المشحونة أصلًا (بقيت في `package.json` وفي ملفّ
// عرضٍ متروك، ولا شيء في `src/` ولا في `index.html` يستدعيها). ومفتاحٌ لميزةٍ
// غير موجودة كذبٌ في الإعدادات، فحُذف بدل أن يُكتب.
export const BUDGET = {
    full: { segs: 16, dpr: 2, tilt: true, video: true },
    lite: { segs: 8, dpr: 1.5, tilt: true, video: false },
    minimal: { segs: 4, dpr: 1, tilt: false, video: false },
};

/**
 * يصنّف الجهاز إلى `full` أو `lite` أو `minimal`.
 *
 * `env` كائنٌ مسطّح لا كائنُ متصفّح، وكلّ حقولِه اختياريّة — فالمجهول ليس ضعفًا:
 * ‏Safari لا تُصرّح بـ`deviceMemory` ولا `hardwareConcurrency`، ولو عُدّ صمتُها
 * ضعفًا لهبط كلّ آيفون إلى `minimal` بلا سبب. فالافتراضُ عند الصمت هو `full`،
 * والهبوطُ يحتاج دليلًا صريحًا.
 *
 * @param {object} env
 * @param {number}  [env.memory]     navigator.deviceMemory (GB)
 * @param {number}  [env.cores]      navigator.hardwareConcurrency
 * @param {boolean} [env.coarse]     matchMedia('(pointer: coarse)').matches
 * @param {boolean} [env.saveData]   navigator.connection.saveData
 * @param {string}  [env.effectiveType] '4g' | '3g' | '2g' | 'slow-2g'
 * @param {boolean} [env.reduced]    prefers-reduced-motion: reduce
 * @param {string}  [env.override]   'full' | 'lite' | 'minimal' — يتقدّم على كلّ شيء
 * @returns {'full'|'lite'|'minimal'}
 */
export function detectTier(env) {
    const e = env || {};

    // التجاوز اليدويّ أوّلًا وبلا شرط: هو الطريقةُ الوحيدة لتجربة الطبقات على
    // جهازٍ قويّ. ولو خضع لأيّ استدلالٍ بعده لما كان تجاوزًا.
    if (TIERS.indexOf(e.override) !== -1) return e.override;

    // «قلّل الحركة» ليس تقديرًا لقدرةٍ بل طلبٌ صريح، فيُطاع بلا مساومة. وهو
    // أقصى تقليمٍ لأنّ صاحبه طلبه — لا لأنّ جهازه عاجز.
    if (e.reduced === true) return 'minimal';

    // «وفّر البيانات» طلبٌ صريحٌ آخر، لكنّه عن السلك لا عن المعالج: يكفيه أن
    // يسقط المقطعُ و‏Lottie، ولا داعي لإطفاء ميل البطاقات معه.
    if (e.saveData === true) return 'lite';

    // شبكةٌ بطيئةٌ حقًّا. `4g` لا تُعدّ إشارةَ ضعفٍ لأنّ Chromium تُصنّف كلّ ما
    // هو أسرع من ذلك `4g` أيضًا، فهي سقفٌ لا وصف.
    if (/^(slow-2g|2g)$/.test(e.effectiveType || '')) return 'minimal';
    if (e.effectiveType === '3g') return 'lite';

    // العتاد. الرقمان اللذان يُصرَّح بهما مقيَّدان عمدًا في المتصفّحات (‏Chrome
    // تسقف `deviceMemory` عند ٨ وتُقرّبها إلى قوى اثنين) فيصلحان للترتيب لا
    // للقياس — وهو كلّ المطلوب هنا.
    const mem = typeof e.memory === 'number' ? e.memory : null;
    const cpu = typeof e.cores === 'number' ? e.cores : null;
    if (mem !== null && mem <= 1) return 'minimal';
    if (cpu !== null && cpu <= 2) return 'minimal';
    if (mem !== null && mem <= 2) return 'lite';
    if (cpu !== null && cpu <= 4) return 'lite';

    // ولمسٌ بلا رقمٍ يدلّ على الضعف: هاتفٌ لم يُصرّح بشيء. لا يُحطّ إلى
    // `minimal` — كثيرٌ من الهواتف الحديثة أقوى من حواسيب — لكنّه لا يُمنح
    // `full` بلا دليل، فالوسط أصدق.
    if (e.coarse === true && mem === null && cpu === null) return 'lite';

    return 'full';
}

/** ميزانيّةُ الطبقة. تُرجع ميزانيّة `full` لأيّ اسمٍ مجهول — الشكّ لا يُقلّم. */
export function budgetFor(tier) {
    return BUDGET[tier] || BUDGET.full;
}

/**
 * يقرأ البيئة الحيّة من المتصفّح. مفصولةٌ عن `detectTier` كي تبقى تلك نقيّة.
 * @param {Window} [win]
 */
export function readEnv(win) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return {};
    const mq = q => { try { return w.matchMedia(q).matches; } catch (e) { return false; } };
    const nav = w.navigator || {};
    const con = nav.connection || nav.mozConnection || nav.webkitConnection || null;

    // التجاوز: من العنوان مرّةً واحدة ثمّ يُحفظ، كي يبقى بعد أوّل تنقّل — فتجربةُ
    // طبقةٍ على الجوّال لا تحتمل إعادة لصق الرابط في كلّ صفحة.
    let override = '';
    try {
        const q = new w.URLSearchParams(w.location.search).get('tier');
        if (TIERS.indexOf(q) !== -1) { override = q; w.localStorage.setItem('sura_tier', q); }
        else if (q === 'auto') w.localStorage.removeItem('sura_tier');
        else override = w.localStorage.getItem('sura_tier') || '';
    } catch (e) { /* بلا تخزين، فبلا تجاوز */ }

    return {
        memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
        cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
        coarse: mq('(pointer: coarse)'),
        fine: mq('(pointer: fine)'),
        saveData: con ? !!con.saveData : undefined,
        effectiveType: con ? con.effectiveType : undefined,
        reduced: mq('(prefers-reduced-motion: reduce)'),
        override,
    };
}

// الحالة الحيّة. تُحسب مرّةً واحدة ثمّ تُحفظ: هذه القراءات تلمس التخطيط
// (`matchMedia`) ولا تتغيّر خلال الجلسة، فإعادةُ حسابها لكلّ بطاقةٍ لكلّ حركةِ
// مؤشّرٍ كانت هي المشكلة لا الحلّ.
let cached = null;
function state(win) {
    if (cached) return cached;
    const env = readEnv(win);
    const tier = detectTier(env);
    cached = { env, tier, budget: budgetFor(tier) };
    return cached;
}

/** @returns {'full'|'lite'|'minimal'} */
export function tier(win) { return state(win).tier; }
/** ميزانيّةُ هذا الجهاز. */
export function budget(win) { return state(win).budget; }
/** البيئة كما قُرئت — للتشخيص وللنداءات التي تحتاج حقلًا بعينه. */
export function env(win) { return state(win).env; }
/** `prefers-reduced-motion` — بديلُ النسخ الستّ المتفرّقة. */
export function reduced(win) { return !!state(win).env.reduced; }
/** مؤشّرٌ دقيق (فأرة) — بديلُ النسخ الثلاث المتفرّقة. */
export function finePointer(win) { return !!state(win).env.fine; }

/**
 * يكتب الطبقة على `<html data-tier="…">` كي تفرّع CSS بلا JS، ويردّها.
 * يُنادى مرّةً واحدة عند الإقلاع.
 */
export function applyTier(win) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    const t = tier(w);
    try { w.document.documentElement.setAttribute('data-tier', t); } catch (e) { }
    return t;
}

/** للاختبار وحده: يُنسي الحالة المحفوظة. */
export function _resetTier() { cached = null; }
