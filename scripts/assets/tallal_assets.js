// خطّ أنابيب أصول «الطَّلل» — ستّ طبقاتٍ من `_design-src/tallal/` + سماءُ القصّة ← مشهد 404.
//
// شقيقُ `scripts/assets/story_assets.js` لا امتدادٌ له. الاشتراك بينهما في المنطق
// (قصٌّ على صندوق المحتوى · تركيبان أفقيّ وعموديّ · بيانٌ يولّد الترميز) لكنّ
// **الهندسة مختلفة تمامًا**، وهذا هو الفرق الإخراجيّ الذي اختاره المالك:
//
//   الرئيسة   كاميرا عالية · مسافرٌ يملأ ٢٣٪ من الإطار · ثلاثة حروف كثبان · قمر
//   الطَّلل    كاميرا على بُعد ٣٠سم من الأرض · **لا أحد** · مستوًى منحسر · لا قمر
//
// ولذلك لا تُشارَك جداول `PLACE`: دمجُ الملفَّين كان يعني جدولًا واحدًا بشرطين،
// وأوّلُ تعديلٍ على الرئيسة يزيح مشهد 404 بلا أن يشتكي أحد.
//
// ما يُعاد استعماله فعلًا: `stars.png` و`milkyway.png` من طقم القصّة. سماءٌ
// ثانيةٌ لنفس الليل كانت ستكون تناقضًا بصريًّا وثمنًا في الوزن معًا.
//
//   node scripts/assets/tallal_assets.js
"use strict";
const sharp = require("sharp");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const SKY = path.join(ROOT, "_design-src", "story");   // سماء القصّة، تُستعار كما هي
const SRC = path.join(ROOT, "_design-src", "tallal");  // الطبقات الستّ التي ولّدها المالك
const OUT = path.join(ROOT, "public", "tallal");

// ألوان الليل من التوكنز نفسها (`style.css:505`) — لا لونَ مخترعًا هنا.
const NIGHT_TOP = { r: 0x07, g: 0x0d, b: 0x18 };
const NIGHT_BOT = { r: 0x0e, g: 0x16, b: 0x26 };

// الأفق عند منتصف الإطار تقريبًا، وهذا ليس ذوقًا: الأفق يقع عند **مستوى
// العين** دائمًا، وكاميرا الطَّلل أفقيّةٌ على ارتفاع ٣٠سم — فمن أرادها أعلى
// فقد رفع الكاميرا وألغى الفكرة.
//
// المفاتيح:
//   w        عرض الطبقة نسبةً لعرض الإطار (يشتقّ المقياس)
//   top      أعلى **صندوق المحتوى** نسبةً لارتفاع الإطار
//   bottom   أسفله (يُستعمل حين يهمّ استقرارها على الأرض لا نزولها من الأفق)
//   left     يسار صندوق المحتوى؛ سالبٌ = يتجاوز الإطار عمدًا (فائض parallax)
//   fill     يُغلق ما تحت الحرف بلون الليل — للأرض وحدها، وإلّا ظهر فراغٌ أسفل
//            الإطار حين تُزاح مع المؤشّر
//   squash   ضغطٌ رأسيّ (تصحيح منظور). أثر الخيمة وُلّد بزاوية ٣/٤ وارتفاعه
//            في الإطار ٦١٪ — أي لوحٌ يطفو فوق الأرض لا أثرٌ عليها. الأرضُ
//            المستوية المرئيّة من ٣٠سم تُقرأ **شريطًا** لا دائرة، والضغط
//            الرأسيّ هو بالضبط ما تفعله الكاميرا المنخفضة بها.
//   skirt    عددُ صفوفٍ تُمَدّ أسفل الطبقة بلون قاعها — لدفن وصلٍ حادّ تحت
//            طبقةٍ تعلوه (تفصيلُ القياس عند `skirtDown`)
//   feather  تليينُ ألفا عند حواف صندوق المحتوى بنسبةٍ من مقاسه — لطبقةٍ
//            حافّتُها في ملفّها قطعٌ لا تدرّج (تفصيلُه عند `featherEdges`)
//   vignette تلاشٍ **إهليلجيّ** من المركز بدل تلاشي الحواف الأربع. الفرق ليس
//            درجةً بل شكلًا: `feather` يبقي مستطيلًا حوافُّه ناعمة، والعين
//            تمسك المستطيل مهما نعمت حوافّه (تفصيلُه عند `vignetteAlpha`)
//   tone     ضربُ قنوات RGB بثلاثة معاملات — لمطابقة إضاءة طبقةٍ وُلّدت في
//            نهارٍ آخر بليل المشهد (تفصيلُ القياس عند `toneTo`)
//   shade    الطبقة ظلُّ تماسٍّ مشتقٌّ من ألفا الملفّ المذكور، لا صورةٌ
//            مرسومة (تفصيلُه عند `contactShade`)
//   light    طبقة ضوءٍ (سماء ونار): ألفاها **مشتقّةٌ من لمعانها** في
//            `lumaToAlpha`، فتُركَّب تركيبًا عاديًّا وتعطي ما كان `screen`
//            يعطيه. ولا `mix-blend-mode` في الصفحة إطلاقًا: أغلفة الطبقات
//            تحمل `z-index` (والجمرة `opacity`)، وكلاهما يفتح سياق تراصٍّ
//            يجعل «ما خلف» الصورة داخله لا شيء — فيبقى أسود الجمرة مستطيلًا
//            حادًّا في الرماد. العَلَم هنا وثائقيّ بعد أن صار الحلّ في البكسل.
const PLACE = [
    { name: "stars", src: SKY + "/stars.png", mode: "alpha", cover: true, light: true },
    { name: "milkyway", src: SKY + "/milkyway.png", mode: "luma", cover: true, light: true },
    // الحرف البعيد: شريطٌ لا منظر. يجلس على الأفق ويختفي معظمه خلف الأرض.
    //
    // و`tone` هنا **علاجُ عطبٍ في الأصل لا ذوق**: `_design-src/tallal/ridge.png` يكرّر التلّ
    // نفسه أربع مرّاتٍ ولكلّ تكرارٍ حافّةٌ بيضاء عالية اللمعان، فالعين تمسك
    // الإيقاع المتكرّر فورًا («ماحسيته متراكب»). وليس لي أن أرسم بديلًا، لكنّ
    // ما يحمل التكرار هو **التباين** لا الشكل: بضرب القنوات في ٠٫٣ تسقط الحافّة
    // البيضاء إلى ظلٍّ أزرق، فيبقى الخطّ ويذهب النمط. وهو أيضًا الصواب فيزيائيًّا
    // — لا قمر في هذا المشهد، فلا شيء يضيء تلًّا على بُعد كيلومترات.
    { name: "ridge", src: SRC + "/ridge.png", mode: "alpha", w: 1.14, top: 0.425, left: -0.07, skirt: 150, tone: [0.30, 0.34, 0.47] },
    // الأرض: تبدأ من الأفق وتخرج من أسفل الإطار. أعرض طبقةٍ لأنها تُزاح أكثر.
    // ومُعتَّمةٌ لنفس السبب: أرضٌ مغمورةٌ بالضوء تحت سماءٍ بلا قمر تجعل الجمرة
    // — وهي مصدر الضوء الوحيد المفترض — أضعف من الأرض التي يُفترض أنها تضيئها.
    { name: "ground", src: SRC + "/ground.png", mode: "alpha", w: 1.20, top: 0.45, left: -0.10, fill: true, tone: [0.50, 0.54, 0.66] },
    // أثر الخيمة: مركزُ المعنى. مضغوطٌ رأسيًّا ليستلقي على الأرض، وموضوعٌ
    // خلف الموقد ومحيطًا به — الموقد كان في وسط الخيمة لا بجانبها.
    { name: "trace", src: SRC + "/trace.png", mode: "alpha", w: 0.74, squash: 0.5, vignette: 0.42, bottom: 0.845, left: 0.13, tone: [0.50, 0.54, 0.68] },
    // ظلّ التماسّ: يسبق الموقد في الرسم لأنه **تحته**. مشتقٌّ من ألفا الموقد
    // نفسه فيتبعه إن تغيّر حجمه، ومضغوطٌ إلى ٠٫٢٦ لأن الظلّ على أرضٍ مستوية
    // مرئيّةٍ من ٣٠سم يقع شريطًا لا دائرة — كأثر الخيمة تمامًا.
    { name: "shade", src: SRC + "/hearth.png", shade: 26, w: 0.40, squash: 0.26, onHearth: [0.50, 0.99] },
    // الموقد: البطل، في قلب الأثر. أُنزل معه بنفس النسبة تقريبًا كي **لا**
    // يتغيّر ترتيب السطوع: يبقى أفتح من أرضه (لأن الجمرة تحته) وأدنى منها.
    { name: "hearth", src: SRC + "/hearth.png", mode: "alpha", w: 0.30, bottom: 0.885, left: 0.36, tone: [0.46, 0.49, 0.60] },
    // الجمرة: الضوء الوحيد في الصفحة. موضعها يُقاس على الموقد لا يُخمَّن.
    // ولم تُعتَّم مع الباقي **عمدًا**: تعتيمُ كلّ شيءٍ حولها هو ما يجعلها أخيرًا
    // أسطعَ شيءٍ في الكادر، وهو ما يعنيه «مصدرُ ضوءٍ وحيد».
    { name: "ember", src: SRC + "/ember.png", mode: "luma", w: 0.125, onHearth: [0.50, 0.62], light: true },
    // الحجر الأمامي: خارج بؤرة العدسة، لا يظهر منه إلّا قمّتُه في الزاوية.
    // وأشدُّ الطبقات عتمةً: هو الأقرب إلى الكاميرا وأبعد ما يكون عن الجمرة،
    // فيقرأ ظلًّا أماميًّا يفتح عمق المشهد بدل أن ينافس مركزه.
    { name: "stone-near", src: SRC + "/stone-near.png", mode: "alpha", w: 0.52, bottom: 1.17, left: -0.09, tone: [0.34, 0.37, 0.50] },
];

// التركيب العمودي — إطارٌ ثانٍ لا تحجيمٌ للأوّل، للسبب المقيس في
// `story_assets.js:53`: نسبة 1.78 داخل مسرحٍ نسبته 0.5625 تمطّ كلّ طبقةٍ
// رأسيًّا ٣٫١٦×، فيصير الحجر الأمامي عمودًا والجمرة خيطًا.
//
// والمنطق الإخراجي هنا أوضح منه في القصّة: الإطار العمودي أضيق، فالموقد
// يُكبَّر ليبقى مقروءًا، والأثر يُكبَّر ليخرج من الجانبين (وهو المطلوب: أثرٌ
// أكبر من الكادر يعني مكانًا كان أكبر من أن يُرى)، والأفق يهبط قليلًا لأن
// النصّ يأخذ النصف العلوي.
const PLACE_P = [
    { name: "stars", src: SKY + "/stars.png", mode: "alpha", cover: true, light: true },
    { name: "milkyway", src: SKY + "/milkyway.png", mode: "luma", cover: true, light: true },
    { name: "ridge", src: SRC + "/ridge.png", mode: "alpha", w: 1.30, top: 0.545, left: -0.15, skirt: 150, tone: [0.30, 0.34, 0.47] },
    { name: "ground", src: SRC + "/ground.png", mode: "alpha", w: 1.45, top: 0.565, left: -0.22, fill: true, tone: [0.50, 0.54, 0.66] },
    { name: "trace", src: SRC + "/trace.png", mode: "alpha", w: 1.28, squash: 0.5, vignette: 0.42, bottom: 0.845, left: -0.14, tone: [0.50, 0.54, 0.68] },
    { name: "shade", src: SRC + "/hearth.png", shade: 26, w: 0.69, squash: 0.26, onHearth: [0.50, 0.99] },
    { name: "hearth", src: SRC + "/hearth.png", mode: "alpha", w: 0.52, bottom: 0.875, left: 0.25, tone: [0.46, 0.49, 0.60] },
    { name: "ember", src: SRC + "/ember.png", mode: "luma", w: 0.22, onHearth: [0.50, 0.62], light: true },
    { name: "stone-near", src: SRC + "/stone-near.png", mode: "alpha", w: 0.95, bottom: 1.10, left: -0.16, tone: [0.34, 0.37, 0.50] },
];

const FRAMES = [
    { tag: "", W: 2560, H: 1440, place: PLACE, targets: [2560, 1280], manifest: "tallal.json", preview: "_preview.png" },
    { tag: "p", W: 1440, H: 2560, place: PLACE_P, targets: [1440, 720], manifest: "tallal.p.json", preview: "_preview_p.png" },
];

// الجودة لكلّ طبقة. نفس مبدأ طقم القصّة: الطبقات الضجيجيّة (نجوم، حصى، رماد)
// تكلّف أضعافًا عند نفس الجودة وهي **الأقلّ حساسيةً للفقد** لأن الحبيبات تخفي
// القطع الرقمي؛ والطبقات التي تنظر إليها العين مباشرةً (الموقد، الجمرة) تبقى
// عالية.
const Q = { stars: 46, milkyway: 50, ridge: 54, ground: 60, trace: 62, "stone-near": 72, hearth: 84, ember: 82, shade: 40 };
// جودة ألفا هي — لا جودة اللون — ما يحكم الوزن (القياس في `story_assets.js:101`).
// وطبقاتُ الضوء الثلاث ألفاها **هي صورتها** بعد أن استغنينا عن `screen`: سحقُها
// يسحق النجوم والمجرّة والجمرة نفسها، فتُرفع فوق الباقي.
const AQ = {
    ridge: 70, ground: 74, trace: 74, "stone-near": 82, hearth: 84,
    stars: 88, milkyway: 88, ember: 92,
    // الظلّ لونُه ثابتٌ وكلّ محتواه في ألفاه: تُرفَع وحدها، ويُترك اللون
    // لأدنى جودةٍ في الطقم بلا خسارةٍ تُرى.
    shade: 88,
};

const COVER_SLACK = 0.04;
const T = 24;                                  // عتبة «هذا محتوى» في قناع ألفا
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- أدوات ------------------------------------------------------------------

function bbox(mask, w, h, t) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x] < t) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) throw new Error("صندوق المحتوى فارغ — الملف شفّاف بالكامل");
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const alphaOf = buf => sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer();

// إغلاق ما تحت الحرف. الأرض المولَّدة حافّتها العليا مهدَّبةٌ (وهو المطلوب)
// لكنّ ما تحتها ليس معتمًا بالضرورة حتى الحافّة السفلى للملف، وأيّ ثقبٍ هناك
// يصير فجوةً في أسفل الشاشة حين تُزاح الطبقة مع المؤشّر.
//
// وخلافًا لنظيرتها في طقم القصّة، هذه **لا تخفض سطوع البكسلات المعتمة**: هناك
// كان الحرفُ خطًّا مضيئًا يسحب العين من المسافر فخُفّض إلى نصفه، وهنا الأرض
// هي المشهد نفسه — تخفيضُها يمحو الحصى الذي وُلّد من أجله.
async function closeBelow(file) {
    const m = await sharp(file).metadata();
    const w = m.width, h = m.height;
    const rgba = await sharp(file).ensureAlpha().raw().toBuffer();
    for (let x = 0; x < w; x++) {
        let top = -1;
        for (let y = 0; y < h; y++) {
            if (rgba[(y * w + x) * 4 + 3] >= 40) { top = y; break; }
        }
        if (top < 0) continue;
        for (let y = top; y < h; y++) {
            const p = (y * w + x) * 4;
            if (rgba[p + 3] >= 250) continue;          // معتمٌ أصلًا: لا يُمَسّ
            const a = rgba[p + 3] / 255;
            rgba[p] = a * rgba[p] + (1 - a) * NIGHT_TOP.r;
            rgba[p + 1] = a * rgba[p + 1] + (1 - a) * NIGHT_TOP.g;
            rgba[p + 2] = a * rgba[p + 2] + (1 - a) * NIGHT_TOP.b;
            rgba[p + 3] = 255;
        }
    }
    return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// ألفا من الإضاءة: الجمرة والمجرّة مولَّدتان على أسود، فسطوعُهما **هو**
// تغطيتهما. لا قصَّ هنا أصلًا، فلا هالة قصّ ممكنة.
//
// واللون يُرفَع بقسمته على الألفا. بدون ذلك يخسر الضوءُ الخافت مرّتين: مرّةً
// لأنه خافت ومرّةً لأن ألفاه صغيرة — فتذوب المجرّة في السماء. وبالقسمة يصير
// `S·a + B·(1−a)` مساويًا عمليًّا لـ`B + S − B·S` الذي كان `screen` يعطيه،
// فنستغني عن نمط المزج **وعن فخّه**: `mix-blend-mode` يحتاج خلفيّةً داخل سياق
// التراصّ نفسه، وأغلفة الطبقات هنا تفتح سياقاتها بـ`z-index` و`opacity`،
// فتُمزَج الجمرة مع العدم ويبقى أسودها مستطيلًا حادًّا في وسط الرماد.
async function lumaToAlpha(file) {
    const m = await sharp(file).metadata();
    const w = m.width, h = m.height;
    const rgb = await sharp(file).removeAlpha().raw().toBuffer();
    const out = Buffer.alloc(w * h * 4);
    for (let i = 0, p = 0, q = 0; i < w * h; i++, p += 3, q += 4) {
        const l = 0.2126 * rgb[p] + 0.7152 * rgb[p + 1] + 0.0722 * rgb[p + 2];
        const a = clamp(Math.round(Math.pow(l / 255, 0.85) * 300 - 12), 0, 255);
        const k = a > 0 ? 255 / a : 0;
        out[q] = clamp(Math.round(rgb[p] * k), 0, 255);
        out[q + 1] = clamp(Math.round(rgb[p + 1] * k), 0, 255);
        out[q + 2] = clamp(Math.round(rgb[p + 2] * k), 0, 255);
        out[q + 3] = a;
    }
    return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// ذيلٌ للحرف البعيد. الحرف في ملفّه شريطٌ يقف على قاع الملف: قمّتُه مهدَّبة
// وقاعُه **مقطوعٌ حادًّا** بعرض الصورة كلّها. وقيس على الشاشة أن ذلك القطع خطٌّ
// أفقيّ مستقيم عبر المشهد: أُخفيت طبقة الحرف فارتفع متوسّط اللمعان فوق السطر
// من ٢٣ إلى ٤١ ولم يتغيّر تحته شيء — أي أن الخطّ هو قاع الحرف لا حافّةُ الأثر
// كما بدا. وسببه أن الأرض عند ذلك الارتفاع ما زالت شفّافةً ٣٥٪ (ألفاها تبلغ
// ٠٫٩ بعد ١١٩ صفًّا من أعلى صندوقها)، فلا تُغطّي القطع.
//
// والعلاج **ليس** تليين القاع — تليينُه يكشف السماء تحته فيصير الخطّ فاتحًا
// بدل داكن. بل يُمَدّ الحرف نزولًا بلون قاعه نفسه، فينزل الوصل إلى حيث الأرض
// معتمةٌ تمامًا ويُدفَن. ولا يتحرّك رأس الحرف بذلك بكسلًا واحدًا.
//
// ⚠ والذيل يُبنى من **متوسّطٍ مموّه أفقيًّا**، لا من البكسل الأخير لكلّ عمود.
// النسخةُ الأولى نسخت آخر بكسلٍ معتمٍ في كلّ عمود ومدّته ٢٦٠ صفًّا، فصار كلّ
// اختلافٍ بين عمودَين متجاورَين شريطًا رأسيًّا بطول ٢٦٠ بكسلًا: **تمشيطٌ** رآه
// المالك بعينه ووصفه بأن المشهد غير متراكب. والقاع طبيعيًّا مليء بذلك الاختلاف
// (حصى وظلال)، فالعيب كان حتميًّا لا عارضًا.
//
// فيُؤخَذ الآن متوسّط آخر `AVG` صفوفٍ لكلّ عمود، ثمّ يُمرَّر صفُّ الألوان الناتج
// على مرشّح صندوقيّ عرضه `SMOOTH` — أي يُطمَس الفرق بين الأعمدة قبل أن يُمَدّ،
// فينزل لونٌ واحدٌ متدرّجٌ ببطء بدل ١٢٥٤ شريطًا.
const SKIRT_AVG = 10;      // كم صفًّا يُتوسَّط لكلّ عمود
const SKIRT_SMOOTH = 61;   // عرض المرشّح الصندوقيّ (فردي: مركزُه عمودٌ حقيقيّ)
async function skirtDown(file, rows) {
    const m = await sharp(file).metadata();
    const w = m.width, h = m.height;
    const src = await sharp(file).ensureAlpha().raw().toBuffer();

    // ١. لونُ قاعِ كلّ عمود = متوسّط آخر صفوفه المعتمة (0 إن لم يكن له قاع).
    const col = new Float64Array(w * 3), has = new Uint8Array(w);
    const base = new Int32Array(w);            // قاعُ كلّ عمود — يبدأ منه المدّ
    for (let x = 0; x < w; x++) {
        let last = -1;
        for (let y = h - 1; y >= 0; y--) if (src[(y * w + x) * 4 + 3] >= 250) { last = y; break; }
        if (last < 0) continue;
        has[x] = 1; base[x] = last;
        let n = 0, r = 0, g = 0, b = 0;
        for (let y = last; y > last - SKIRT_AVG && y >= 0; y--) {
            const p = (y * w + x) * 4;
            if (src[p + 3] < 250) continue;
            r += src[p]; g += src[p + 1]; b += src[p + 2]; n++;
        }
        if (!n) { has[x] = 0; continue; }
        col[x * 3] = r / n; col[x * 3 + 1] = g / n; col[x * 3 + 2] = b / n;
    }

    // ٢. تمويهٌ أفقيّ للصفّ كلّه — هذا هو ما يمحو التمشيط.
    const sm = new Float64Array(w * 3);
    const half = (SKIRT_SMOOTH - 1) / 2;
    for (let x = 0; x < w; x++) {
        let n = 0, r = 0, g = 0, b = 0;
        for (let i = x - half; i <= x + half; i++) {
            if (i < 0 || i >= w || !has[i]) continue;
            r += col[i * 3]; g += col[i * 3 + 1]; b += col[i * 3 + 2]; n++;
        }
        if (!n) continue;
        sm[x * 3] = r / n; sm[x * 3 + 1] = g / n; sm[x * 3 + 2] = b / n;
    }

    // ٣. المدّ — **من قاع العمود نفسه** لا من قاع اللوحة.
    //
    // ⚠ وهذا العطب الثاني: النسخة الأولى بدأت المدّ عند `y = h` (أسفل الصورة)
    // بينما قاعُ كلّ عمودٍ فوق ذلك بمقدارٍ مختلف. فما بين القاعَين بقي **شفّافًا**،
    // فظهر الذيلُ أسنانًا رأسيّةً بينها فجواتٌ تُرى منها السماء — وهو ما بقي
    // يُقرأ «تمشيطًا» حتى بعد تنعيم اللون. القاع الحقيقيّ هو `last[x]`.
    const H2 = h + rows;
    const out = Buffer.alloc(w * H2 * 4);
    src.copy(out, 0);
    for (let x = 0; x < w; x++) {
        if (!has[x]) continue;
        const r = Math.round(sm[x * 3]), g = Math.round(sm[x * 3 + 1]), b = Math.round(sm[x * 3 + 2]);
        for (let y = base[x] + 1; y < H2; y++) {
            const q = (y * w + x) * 4;
            out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = 255;
        }
    }
    return sharp(out, { raw: { width: w, height: H2, channels: 4 } }).png().toBuffer();
}

// تليينُ الحافّة. أثر الخيمة يبدأ في ملفّه **دفعةً واحدة**: قِيس صندوق محتواه
// عند عتباتٍ من ١ إلى ٤٨ فلم يتزحزح إلّا بكسلَين — أي أن المولّد لم يقصّ تدرّجًا
// بل أن التدرّج غير موجود أصلًا. وذلك مقبولٌ عند سكونه (٠٫١٤) وفاضحٌ عند القرب
// (٠٫٦٢): يظهر **مستطيلٌ فاتح** حافّته العليا خطٌّ مستقيم عبر الرماد، فيُقرأ
// لوحًا موضوعًا على الأرض لا أثرًا فيها — وهو نقيض ما تعنيه الطبقة.
//
// فتُضرَب ألفاها بمنحدرٍ ناعم (smoothstep) عند الحواف. لا يُخترع محتوى: ما كان
// شفّافًا يبقى شفّافًا، وإنّما يُذاب الخطّ الذي كانت العين تمسك به.
async function featherEdges(buf, frac) {
    const m = await sharp(buf).metadata();
    const w = m.width, h = m.height;
    const rgba = await sharp(buf).ensureAlpha().raw().toBuffer();
    const fx = Math.max(1, Math.round(w * frac)), fy = Math.max(1, Math.round(h * frac));
    const ramp = (d, f) => { const t = clamp(d / f, 0, 1); return t * t * (3 - 2 * t); };
    for (let y = 0; y < h; y++) {
        const gy = Math.min(ramp(y, fy), ramp(h - 1 - y, fy));
        for (let x = 0; x < w; x++) {
            const g = Math.min(gy, ramp(x, fx), ramp(w - 1 - x, fx));
            if (g >= 1) continue;
            const q = (y * w + x) * 4 + 3;
            rgba[q] = Math.round(rgba[q] * g);
        }
    }
    return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// تلاشٍ إهليلجيّ. `featherEdges` أعلاه تُلَيّن الحواف الأربع، لكنّ الشكل يبقى
// **مستطيلًا**، والعين تقرأ المستطيل قبل أن تقرأ نعومته: قِيس على الشاشة أن
// بقعة الأثر أفتح ممّا حولها بـ٥٠٪ (لمعان ٢٠ مقابل ١٣ على نفس الارتفاع) وحدودُها
// أربعة خطوطٍ مستقيمة — فيُقرأ لوحًا ضبابيًّا موضوعًا على الأرض، وهو نقيض
// «أثرٍ فيها». والأثر في الأرض ليس له حدٌّ أصلًا: يخفت حتى يُشتبه به.
//
// `frac` = نصف القطر الذي يبقى فيه الأثر كاملًا (نسبةً من نصف الصندوق). ما بعده
// ينحدر إلى الصفر عند الحافّة بمنحدرٍ ناعم.
async function vignetteAlpha(buf, frac) {
    const m = await sharp(buf).metadata();
    const w = m.width, h = m.height;
    const rgba = await sharp(buf).ensureAlpha().raw().toBuffer();
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let y = 0; y < h; y++) {
        const dy = (y - cy) / cy;
        for (let x = 0; x < w; x++) {
            const dx = (x - cx) / cx;
            const r = Math.sqrt(dx * dx + dy * dy);
            if (r <= frac) continue;
            const t = clamp((1 - r) / (1 - frac), 0, 1);
            const q = (y * w + x) * 4 + 3;
            rgba[q] = Math.round(rgba[q] * t * t * (3 - 2 * t));
        }
    }
    return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// مطابقةُ الإضاءة. الموقد وُلّد مضاءً بمصدرٍ ليس في هذا المشهد: قِيس لمعانُ
// حجارته على الشاشة **٩٥** بينما الأرض التي يجلس عليها **٥٢** — أي أسطع
// بـ١٫٨×. وهذا وحده يكفي ليُقرأ ملصقًا: العين تحكم بالجلوس من تطابق الضوء قبل
// أن تحكم به من الشكل.
//
// والمعاملات الثلاثة غير متساوية عمدًا (٠٫٦٠ / ٠٫٦٤ / ٠٫٧٣): الليل هنا أزرق،
// وخفضٌ متساوٍ يُبقي الحجارة رمليّةً دافئة وسط رمادٍ بارد. الأزرقُ يُخفَض أقلّ
// فتميل الحجارة إلى ضوء السماء، ويبقى الدفء الوحيد في الإطار **للجمرة** — وهي
// طبقةٌ لا تُطبَّق عليها هذه الدالّة، فيصير الدفء دليلًا على النار لا زينة.
async function toneTo(buf, [kr, kg, kb]) {
    const m = await sharp(buf).metadata();
    const w = m.width, h = m.height;
    const rgba = await sharp(buf).ensureAlpha().raw().toBuffer();
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        rgba[p] = clamp(Math.round(rgba[p] * kr), 0, 255);
        rgba[p + 1] = clamp(Math.round(rgba[p + 1] * kg), 0, 255);
        rgba[p + 2] = clamp(Math.round(rgba[p + 2] * kb), 0, 255);
    }
    return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// ظلّ التماسّ. البند الثاني في «الجلوس»، وهو أشدّ من الأوّل: قِيس اللمعان أسفل
// الموقد مباشرةً **٦٨** بينما الأرض البعيدة عنه ٥٢ — أي أن الجسم كان **يُفتح**
// ما تحته لا يُظلمه. جسمٌ بلا ظلٍّ يطفو، مهما ضبطتَ لونه.
//
// والظلّ هنا **مشتقٌّ لا مرسوم**: قناعُ ألفا الموقد نفسه، مموّهٌ بـ`sigma`،
// ملوَّنٌ بأسود الليل. فإن تغيّر شكل الموقد أو حجمه تغيّر ظلّه معه، ولا يمكن
// أن يفترقا. ويُركَّب `over` كبقيّة الطبقات — لا `multiply`: المشهد ليلٌ داكن
// أصلًا، فتغطيتُه بأسودَ شفّافٍ تساوي إظلامه، بلا نمط مزجٍ يحتاج خلفيّةً داخل
// سياق تراصٍّ مغلق (وهو الفخّ الذي أخرج مستطيل الجمرة الأسود من قبل).
async function contactShade(file, sigma) {
    const m = await sharp(file).metadata();
    const w = m.width, h = m.height;
    const a = await sharp(file).ensureAlpha().extractChannel(3).blur(sigma).raw().toBuffer();
    const out = Buffer.alloc(w * h * 4);
    for (let i = 0, q = 0; i < w * h; i++, q += 4) {
        out[q] = 0x03; out[q + 1] = 0x05; out[q + 2] = 0x0a;
        // ٠٫٧٢ سقفًا: ظلٌّ معتمٌ تمامًا يصير ثقبًا في الأرض ويمحو الحصى الذي
        // وُلّدت الأرض من أجله. المطلوب إظلامُ ما تحت الجسم لا حذفُه.
        out[q + 3] = Math.round(a[i] * 0.72);
    }
    return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// طبقاتٌ تتجاوز الإطار عمدًا؛ sharp ترفض إزاحةً سالبة. تُقصّ **للمعاينة فقط**
// أمّا ملفّات الويب فتُصدَّر كاملةً لأن الفائض هو المطلوب.
async function clipToFrame(buf, cm, left, top, W, H) {
    const x0 = Math.max(0, left), y0 = Math.max(0, top);
    const x1 = Math.min(W, left + cm.width), y1 = Math.min(H, top + cm.height);
    if (x1 <= x0 || y1 <= y0) return null;
    if (x0 === left && y0 === top && x1 === left + cm.width && y1 === top + cm.height) {
        return { input: buf, left, top };
    }
    const input = await sharp(buf).extract({
        left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0,
    }).toBuffer();
    return { input, left: x0, top: y0 };
}

// --- البناء -----------------------------------------------------------------

// تحضيرُ طبقةٍ واحدة: بكسلاتُها النهائيّة وموضعُها في الإطار. مفصولةٌ عن
// `buildFrame` لأن طبقتين تُوضَعان **بالقياس على الموقد** (الجمرة فوقه وظلُّه
// تحته)، وإحداهما تسبقه في ترتيب الرسم — فلا بدّ من حساب صندوقه قبل الحلقة.
async function prepare(P, F, hearthBox) {
    const { W, H } = F;
    if (!fs.existsSync(P.src)) throw new Error("ملفٌّ مفقود: " + P.src);

    // ١. تحضير المصدر
    let buf;
    if (P.shade) {
        buf = await contactShade(P.src, P.shade);
    } else if (P.fill) {
        buf = await closeBelow(P.src);
    } else if (P.skirt) {
        buf = await skirtDown(P.src, P.skirt);
    } else if (P.mode === "luma") {
        buf = await lumaToAlpha(P.src);
    } else {
        buf = await fs.promises.readFile(P.src);
    }
    if (P.tone) buf = await toneTo(buf, P.tone);
    const { width: sw, height: sh } = await sharp(buf).metadata();

    // ٢. السماء: تغطيةٌ وقصٌّ من المنتصف، وانتهى أمرها.
    let cropped, cm;
    if (P.cover) {
        const cw = Math.round(W * (1 + COVER_SLACK)), ch = Math.round(H * (1 + COVER_SLACK));
        cropped = await sharp(buf)
            .resize(cw, ch, { fit: "cover", position: "centre", kernel: "lanczos3" }).toBuffer();
        cm = { width: cw, height: ch };
    } else {
        const box = bbox(await alphaOf(buf), sw, sh, T);
        // المقياس من عرض **الملف** لا عرض المحتوى: `w` في الجدول أعلاه
        // يصف اتّساع الطبقة في الإطار كما لو كانت كاملة، فيبقى تعديلها
        // مستقلًّا عن كم اقتطع المولّد من هوامشها.
        const scale = (P.w * W) / sw;
        // القصّ ثم التحجيم بهذا الترتيب: التحجيم أوّلًا يضخّم بكسلاتٍ
        // شفّافة ثمّ يرميها.
        cropped = await sharp(buf)
            .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
            .resize(Math.max(1, Math.round(box.w * scale)),
                Math.max(1, Math.round(box.h * scale * (P.squash || 1))),
                { fit: "fill", kernel: "lanczos3" })
            .toBuffer();
        if (P.feather) cropped = await featherEdges(cropped, P.feather);
        if (P.vignette) cropped = await vignetteAlpha(cropped, P.vignette);
        cm = await sharp(cropped).metadata();
    }

    // ٣. الموضع
    let left, top;
    if (P.cover) {
        left = -Math.round(W * COVER_SLACK / 2);
        top = -Math.round(H * COVER_SLACK / 2);
    } else if (P.onHearth) {
        // الجمرة وظلُّه يُوضَعان بالقياس على صندوق الموقد لا بنسبةٍ من الإطار:
        // تغييرُ حجمه أو موضعه يحرّكهما معه، فلا تطفو الجمرة خارج الرماد ولا
        // ينزلق الظلّ عن قاعدته بصمت.
        if (!hearthBox) throw new Error("طبقةٌ تُوضَع على الموقد قبل قياسه");
        const [fx, fy] = P.onHearth;
        left = Math.round(hearthBox.left + hearthBox.width * fx - cm.width / 2);
        top = Math.round(hearthBox.top + hearthBox.height * fy - cm.height / 2);
    } else if (P.bottom != null) {
        left = Math.round(P.left * W);
        top = Math.round(P.bottom * H - cm.height);
    } else {
        left = Math.round(P.left * W);
        top = Math.round(P.top * H);
    }
    return { cropped, cm, left, top };
}

async function buildFrame(F) {
    const { W, H, place, tag } = F;
    const name = (stem, t) => `${stem}-${tag}${t}.webp`;
    const manifest = [];
    const composite = [];

    // الموقد يُحضَّر أوّلًا مهما كان موضعه في الجدول، ويُحتفَظ بناتجه فلا
    // يُحضَّر مرّتين. وصندوقُه هو مرجع الجمرة والظلّ معًا.
    const hp = place.find(p => p.name === "hearth");
    const cache = new Map();
    let hearthBox = null;
    if (hp) {
        const r = await prepare(hp, F, null);
        cache.set(hp, r);
        hearthBox = { left: r.left, top: r.top, width: r.cm.width, height: r.cm.height };
    }

    for (const P of place) {
        const { cropped, cm, left, top } = cache.get(P) || await prepare(P, F, hearthBox);

        // ٤. مقاسان لكلّ طبقة
        for (const target of F.targets) {
            const k = target / W;
            let pipe = sharp(cropped).resize(
                Math.max(1, Math.round(cm.width * k)), Math.max(1, Math.round(cm.height * k)),
                { fit: "fill", kernel: "lanczos3" });
            await pipe.webp({ quality: Q[P.name] ?? 78, alphaQuality: AQ[P.name] ?? 80, effort: 6 })
                .toFile(path.join(OUT, name(P.name, target)));
        }

        manifest.push({
            name: P.name,
            left: +(left / W).toFixed(5),
            top: +(top / H).toFixed(5),
            width: +(cm.width / W).toFixed(5),
            height: +(cm.height / H).toFixed(5),
            // العرض الفعليّ بالبكسل لكلّ مقاس — يصير واصفَ `w` في srcset. بدونه
            // يظنّ المتصفّح أن ملفّ الجمرة عرضه 2560 فيختار الأثقل دائمًا.
            px: [Math.round(cm.width), Math.round(cm.width / 2)],
        });

        // ولا `blend: "screen"` هنا: المعاينة تُركّب `over` تمامًا كما يفعل
        // المتصفّح الآن، فما تراه في `_preview.png` هو ما يُرسَم — وكان الفرق
        // بينهما هو ما أخفى مستطيل الجمرة الأسود حتى ظهر على الشاشة.
        const piece = await clipToFrame(cropped, cm, left, top, W, H);
        composite.push(piece);
        const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
        console.log(
            P.name.padEnd(11),
            `${cm.width}x${cm.height}`.padEnd(11),
            `@ ${(left / W * 100).toFixed(1)}%,${(top / H * 100).toFixed(1)}%`.padEnd(18),
            `${kb(name(P.name, F.targets[0]))}KB / ${kb(name(P.name, F.targets[1]))}KB`);
    }

    // خلفية الليل تدرّجًا من التوكنز: الطبقات كلّها تطفو فوقها، فلا يمكن
    // لحركةٍ أن تكشف فراغًا — تغطيةٌ مضمونةٌ بالبناء لا بحساب فائض.
    const grad = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
        const t = y / (H - 1);
        const r = Math.round(NIGHT_TOP.r + (NIGHT_BOT.r - NIGHT_TOP.r) * t);
        const g = Math.round(NIGHT_TOP.g + (NIGHT_BOT.g - NIGHT_TOP.g) * t);
        const b = Math.round(NIGHT_TOP.b + (NIGHT_BOT.b - NIGHT_TOP.b) * t);
        for (let x = 0; x < W; x++) {
            const p = (y * W + x) * 3;
            grad[p] = r; grad[p + 1] = g; grad[p + 2] = b;
        }
    }
    const flat = await sharp(grad, { raw: { width: W, height: H, channels: 3 } })
        .composite(composite.filter(Boolean)).png().toBuffer();

    // المسطّحة = المشهد عند الراحة بالضبط، لا نسخةٌ منه. وهي **بطاقة المشاركة**:
    // رابط ٤٠٤ يُلصَق في محادثةٍ فيُظهر المشهد نفسه لا صندوقًا فارغًا.
    //
    // مقاسٌ واحدٌ فقط (١٢٨٠/٧٢٠). كان اثنين، والثاني (٢٥٦٠) لم يكن يُطلَب من أيّ
    // مكان: الصفحة تعرض الطبقات لا المسطّحة، وبطاقة المشاركة تُصغَّر أصلًا.
    // وكلّ ملفٍّ هنا يخرج في `dist/` ويُدفَع ثمنه في كلّ نشر.
    await sharp(flat).resize(F.targets[1]).webp({ quality: 78 })
        .toFile(path.join(OUT, `flat-${tag}${F.targets[1]}.webp`));
    await sharp(flat).resize(F.targets[1]).png().toFile(path.join(OUT, F.preview));
    fs.writeFileSync(path.join(OUT, F.manifest), JSON.stringify(manifest, null, 2));

    const total = manifest.reduce((s, m) => s + fs.statSync(path.join(OUT, name(m.name, F.targets[0]))).size, 0);
    console.log("\nطقم", F.targets[0], "=", (total / 1024).toFixed(0) + "KB",
        "· flat =", (fs.statSync(path.join(OUT, `flat-${tag}${F.targets[1]}.webp`)).size / 1024).toFixed(0) + "KB");
    return manifest;
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const built = {};
    for (const F of FRAMES) {
        console.log("\n=== إطار " + F.W + "x" + F.H + " ===");
        built[F.tag || "l"] = await buildFrame(F);
    }

    // الترميز يُولَّد من البيانَين ولا يُكتب بيد: ثماني طبقات × ثمانية أرقام
    // موضعٍ = ٦٤ رقمًا، وأيُّ واحدٍ يُنسَخ خطأً يزيح طبقةً بلا أن يكسر شيئًا
    // يُلاحَظ. يُلصَق الناتج في 404.html.
    const byName = m => Object.fromEntries(m.map(x => [x.name, x]));
    const L = byName(built.l), P = byName(built.p);
    const pc = v => (v * 100).toFixed(3) + "%";
    const set = (m, k) => `--${k}l:${pc(m.left)};--${k}t:${pc(m.top)};--${k}w:${pc(m.width)};--${k}h:${pc(m.height)}`;
    // المسارات **جذريّة** (`/public/...`) لا نسبيّة، وهذا فرقٌ وظيفيّ لا أسلوبيّ:
    // صفحة ٤٠٤ تُخدَم على العنوان الخاطئ نفسه مهما كان عمقه. زائرٌ يفتح
    // `/games/wordle/x` يحصل على هذه الصفحة، ومسارٌ نسبيّ فيها يطلب
    // `/games/wordle/public/tallal/…` — أي ٤٠٤ داخل ٤٠٤، ومشهدٌ فارغٌ تمامًا.
    const srcset = (n, tg, px, t) =>
        `/public/tallal/${n}-${tg}${t[1]}.webp ${px[1]}w, /public/tallal/${n}-${tg}${t[0]}.webp ${px[0]}w`;

    const R = FRAMES.map(F => (F.W / F.H).toFixed(4));
    const frame = `        <div class="film-frame" style="--r:${R[0]};--ri:${(1 / R[0]).toFixed(4)};`
        + `--rp:${R[1]};--rpi:${(1 / R[1]).toFixed(4)}">`;

    const markup = built.l.map(m => {
        const p = P[m.name];
        return `        <div class="film-layer" data-layer="${m.name}"
             style="${set(m, "l")};${set(p, "p")}">
            <picture>
                <source media="(orientation: portrait)"
                        srcset="${srcset(m.name, "p", p.px, [1440, 720])}">
                <img class="film-layer__img" alt="" decoding="async" loading="eager"
                     src="/public/tallal/${m.name}-1280.webp"
                     srcset="${srcset(m.name, "", m.px, [2560, 1280])}">
            </picture>
        </div>`;
    }).join("\n");
    // الهالة: العنصر الوحيد في المشهد بلا ملفّ — ضوءٌ يرسمه المتصفّح. وموضعها
    // مشتقٌّ من **صندوق الموقد المركَّب** لا مكتوبٌ بيد، لنفس السبب الذي جعل
    // الجمرة تُوضع بـ`onHearth`: أوّل تعديلٍ لحجم الموقد كان سيترك الضوء يشتعل
    // في رمادٍ فارغ على بُعد شبرٍ منه، وهو عطبٌ لا يكسر شيئًا فلا يشتكي أحد.
    const halo = (m, k, mul) => {
        const cx = m.left + m.width * 0.50, cy = m.top + m.height * 0.62;
        return `--${k}l:${pc(cx)};--${k}t:${pc(cy)};--${k}w:${pc(m.width * mul)}`;
    };
    const haloDiv = `        <div class="tallal-halo" style="`
        + `${halo(L.hearth, "h", 1.14)};${halo(P.hearth, "ph", 1.2)}"></div>`;

    // ضبابُ الأفق: شريطٌ يجلس على **قاع الحرف البعيد** فيدفن الوصل بين حافّةٍ
    // بعيدة وأرضٍ قريبة. وهو ما كان ناقصًا: بلا مسافةٍ جوّيّةٍ بينهما تُقرأ
    // الحافّة **جدارًا خلف أرضيّة** لا أفقًا، وهذا نصفُ إحساس «غير متراكب».
    // ولا يُخبَز في بكسل: موضعُه يتبع صندوق الحرف المركَّب كما تتبع الهالةُ
    // الموقد، ووزنه صفر بايت.
    // والمرساة **حافّة الأرض العليا** لا قاعُ الحرف: قاعُ الحرف مدفونٌ خلف
    // الأرض (وهذا مقصود)، فشريطٌ عليه يُرسَم تحت شيءٍ يحجبه ولا يُرى. خطُّ
    // الأفق الذي **تراه العين** هو حيث تبدأ الأرض.
    const band = (m, k) => {
        const h = 0.24;                             // ارتفاع الشريط من الإطار
        return `--${k}t:${pc(m.top - h * 0.52)};--${k}h:${pc(h)}`;
    };
    const horizonDiv = `        <div class="tallal-horizon" style="`
        + `${band(L.ground, "z")};${band(P.ground, "pz")}"></div>`;

    // انسكابُ الجمرة على الأرض: بيضاويٌّ مفلطحٌ مركزُه قاعدةُ الموقد. الهالة
    // ضوءٌ في الهواء، وهذا ضوءٌ **على الأرض** — وغيابُه كان يجعل الموقد مضيئًا
    // فوق أرضٍ لا تعلم أن فيها نارًا.
    // (الارتفاع يُترك لـ`aspect-ratio` في CSS لا يُحسَب هنا: النِّسَب المئويّة
    // الرأسيّة تُقاس على ارتفاع المسرح والأفقيّة على عرضه، فحسابُ ارتفاعٍ
    // «٠٫٣٠ من العرض» بالنسب يتطلّب نسبة الإطار — و`aspect-ratio` يفعلها بلا رقم.)
    const spill = (m, k, mul) => {
        const cx = m.left + m.width * 0.50, cy = m.top + m.height * 0.99;
        return `--${k}l:${pc(cx)};--${k}t:${pc(cy)};--${k}w:${pc(m.width * mul)}`;
    };
    const glowDiv = `        <div class="tallal-glow" style="`
        + `${spill(L.hearth, "g", 2.6)};${spill(P.hearth, "pg", 2.2)}"></div>`;

    const block = [frame, markup, horizonDiv, glowDiv, haloDiv, "        </div>"].join("\n") + "\n";
    fs.writeFileSync(path.join(OUT, "_markup.html"), block);

    // ويُزرَع في الصفحة مباشرةً بين العلامتين. النسخُ باليد كان سيعمل مرّةً
    // واحدة: أوّل إعادة تركيبٍ تُغيّر ٦٤ رقمًا، ونسيانُ اللصق يترك صفحةً تعرض
    // مشهدَ الأمس بلا أيّ خطأ في أيّ مكان.
    const PAGE = path.join(ROOT, "404.html");
    if (fs.existsSync(PAGE)) {
        const before = fs.readFileSync(PAGE, "utf8");
        const re = /(<!-- TALLAL:BEGIN[^\n]*-->\n)[\s\S]*?(<!-- TALLAL:END -->)/;
        if (!re.test(before)) throw new Error("علامتا TALLAL:BEGIN/END مفقودتان من 404.html");
        const after = before.replace(re, (_, a, b) => a + block + b);
        if (after !== before) { fs.writeFileSync(PAGE, after); console.log("404.html: زُرع الترميز"); }
    }

    const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
    console.log("\nالمسطّحة: أفقي", kb("flat-1280.webp") + "KB · عمودي", kb("flat-p720.webp") + "KB");
    console.log("TALLAL_OK — الترميز في public/tallal/_markup.html");
    void L;
})();
