// خطّ أنابيب أصول «القصّة» — ثمانية ملفّات مولَّدة ← طبقاتٌ جاهزة للتركيب.
//
// ملفٌّ جديد لا تعديلٌ على `scripts/assets/hero_layers.js`: ذاك يخدم `data-hero="layers"`،
// وهو مسار التراجع الذي وعدت به الخطة. تعديلُه كان يلغي التراجع بصمت.
//
// ما يفعله، بالترتيب:
//   ١. يُغلق ظلّ الكثيب الأمامي — المولّد رسم **خطّ الحرف** وحده وترك ما تحته
//      شفّافًا. الإغلاق حتميّ: لكلّ عمود، كل ما تحت أعلى بكسلٍ معتم يُملأ.
//      هذا ليس رسمَ فنّ؛ الخطّ من المالك، وأنا أُغلق شكلًا خطُّه موجود.
//   ٢. يستخرج ألفا العناصر المضيئة (قمر، مجرّة) من إضاءتها نفسها — لا هالة
//      قصٍّ لأنه لا يوجد قصّ أصلًا.
//   ٣. يقيس صندوق محتوى كل طبقة ويقصّها عليه. شحن ثماني صورٍ بمقاس الإطار
//      كامل هدرٌ محض: `town` حبرها 4.5% و`travaller` 11.5% من إطارها.
//   ٤. يضع المسافر بقدمَيه **على** حرف الكثيب — يقيس ارتفاع الحرف عند عموده
//      بدل أن يخمّنه. أي تخمينٍ هنا يجعله يطفو أو يغرق.
//   ٥. يُخرج بيانًا (`story.json`) بمواضع كل طبقة نسبةً للإطار، وهو ما يبني
//      الترميز — فلا رقم موضعٍ مكتوبٌ بيدٍ في index.html.
//   ٦. يركّب معاينةً كاملة للمشهد عند الراحة، وهي مرجع «النهاية = الراحة».
//
// التشغيل:  node scripts/assets/story_assets.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ‏المصدر والمخرَج مجلّدان مختلفان، وكانا واحدًا: الألواح الكاملة (١٦ ميغا) كانت
// ترقد في `public/` نفسها إلى جانب ما يُنشَر. لم تُنشَر يومًا — لأن
// `scripts/build/dist.js` ينسخ أربعة مجلّداتٍ بأسمائها لا `public/` كلّها —
// لكنّ مجلّدًا اسمُه «عامّ» لا يجوز أن يحوي ما لا يُعرَض. فانتقلت الألواح إلى
// `_design-src/` مع بقيّة الأصول، و`public/` صار كلّه مشحونًا.
const SRC = path.join(__dirname, '..', '..', '_design-src', 'story');
const OUT = path.join(__dirname, '..', '..', 'public', 'story');

// ألوان الليل من نظام التوكنز (`style.css:40,98,100`) — لا لونَ مخترعًا هنا.
const NIGHT_TOP = { r: 0x07, g: 0x0d, b: 0x18 };
const NIGHT_BOT = { r: 0x0e, g: 0x16, b: 0x26 };

// موضع كل طبقة نسبةً للإطار. `top`/`bottom` تخصّ **صندوق المحتوى** لا الملف،
// ولهذا تُقاس الصناديق أولًا: ملفّات المولّد تترك هوامش شفّافة مختلفة.
const PLACE = [
    // `cover` = طبقة سماءٍ تملأ الإطار: تُحجَّم لتغطّيه وتُقصّ من المنتصف، بلا
    // قصٍّ على صندوق المحتوى. مصادر السماء نسبتها 3:2 والإطار 16:9، فالتحجيم
    // بالعرض وحده كان يُخرج صورةً أطول من الإطار — وهو ما أوقف التركيب أوّل مرّة.
    // `blend` = تُركَّب بـmix-blend-mode: screen. قرارٌ وفّر ٧٠٪ من وزن الطقم
    // وهو في الوقت نفسه **أصحّ فيزيائيًّا**: الوهج يُجمَع على ما تحته ولا
    // يحجبه. القناع كان يفرض قناة ألفا ضجيجيّة بحجم الإطار — أغلى من الصورة
    // نفسها — لأن ألفا نجمٍ بعرض بكسل لا تنضغط.
    { name: 'stars', src: 'stars.png', mode: 'alpha', cover: true, blend: true },
    { name: 'milkyway', src: 'milkyway.png', mode: 'luma', cover: true, blend: true },
    { name: 'moon', src: 'moon.png', mode: 'luma', w: 0.52, top: 0.06, left: 0.08, blend: true },
    { name: 'dunes-far', src: 'dunes-far.png', mode: 'alpha', w: 1.05, top: 0.575, left: -0.025 },
    { name: 'town', src: 'town.png', mode: 'alpha', w: 0.72, bottom: 0.635, left: 0.13 },
    { name: 'dunes-mid', src: 'dues-mid.png', mode: 'alpha', w: 1.08, top: 0.615, left: -0.04 },
    { name: 'dune-near', src: 'dune-near.png', mode: 'alpha', w: 1.16, top: 0.715, left: -0.08, fill: true },
    // المسافر: عرضه يُشتقّ من ارتفاعه، وقدماه تُوضعان على الحرف بالقياس.
    { name: 'traveller', src: 'travaller.png', mode: 'alpha', h: 0.235, standAt: 0.655 },
];

// التركيب العمودي — إطارٌ ثانٍ، لا تحجيمٌ للأوّل.
//
// السبب رقمٌ مقيس: نسبة الإطار الأفقي 1.78 ونسبة شاشة الجوّال 0.46، فوضعُ
// الهندسة الأفقية في مسرحٍ عمودي كان يمطّ **كل** طبقة رأسيًّا 1.78÷0.46 =
// ٣٫٨٥×. القمر صار بيضاويًّا والمسافر صار عمودًا عرضه ٢١px وطوله ١٩٨.
// وأيّ حيلة `object-fit` لا تُصلح هذا: `cover` على 390×844 يُبقي ٢٦٪ من العرض
// فقط، والمسافر عند 62.8٪ فيُقَصّ خارج الكادر. فالحلّ الوحيد الصحيح تركيبٌ
// ثانٍ — وهو ما يفعله مدير التصوير حين يعيد تأطير 16:9 إلى 9:16.
//
// والمنطق الإخراجي: الإطار العمودي **أضيق**، فالعناصر الأرضية تُكبَّر (`w`
// أكبر) لتملأ عرضه وتصل قاعدته، والسماء تأخذ النصف العلوي كاملًا لأن الطول
// عندها فائضٌ لا عجز. المسافر يبقى بنفس حجمه البصري تقريبًا (13.5٪ من ارتفاع
// الإطار مقابل 23.5٪ أفقيًّا — أي نفس عدد البكسلات على الشاشة).
const PLACE_P = [
    { name: 'stars', src: 'stars.png', mode: 'alpha', cover: true, blend: true },
    { name: 'milkyway', src: 'milkyway.png', mode: 'luma', cover: true, blend: true },
    // القمر بعيدٌ عن الحافّة بقدر ما يقصّه الإطار. الإطار العمودي يُغطّي الشاشة
    // بالقصّ، وأطول الأجهزة (21:9) تقصّ ~١٢٪ من عرضه من كل جانب — فالقمر عند
    // ٩٪ كان يُبتَر. المسافةُ الآمنة محروسةٌ باختبارٍ لا بالعين.
    { name: 'moon', src: 'moon.png', mode: 'luma', w: 0.98, top: 0.085, left: 0.17, blend: true },
    { name: 'dunes-far', src: 'dunes-far.png', mode: 'alpha', w: 1.30, top: 0.545, left: -0.15 },
    { name: 'town', src: 'town.png', mode: 'alpha', w: 0.95, bottom: 0.605, left: 0.04 },
    { name: 'dunes-mid', src: 'dues-mid.png', mode: 'alpha', w: 1.45, top: 0.585, left: -0.22 },
    { name: 'dune-near', src: 'dune-near.png', mode: 'alpha', w: 1.75, top: 0.655, left: -0.37, fill: true },
    // مُزاحٌ عن مركز الإطار عمدًا: العنوان والأزرار عمودٌ مركزيّ على الجوّال،
    // ووقوفُه في المنتصف كان يضعه **خلف زرّ «ابدأ اللعب»** بالضبط. وهو مُزاحٌ
    // في التركيب الأفقي أيضًا (62.8%) للسبب نفسه.
    { name: 'traveller', src: 'travaller.png', mode: 'alpha', h: 0.135, standAt: 0.79 },
];

// الإطاران. `tag` يدخل في اسم الملف، و`targets` هو سلّم المقاسات لكل إطار:
// الأفقي يُقاس بعرضه (2560/1280) والعمودي بعرضه أيضًا (1440/720) لأن واصف
// `w` في srcset عرضٌ دائمًا.
const FRAMES = [
    { tag: '', W: 2560, H: 1440, place: PLACE, targets: [2560, 1280], manifest: 'story.json', preview: '_preview.png' },
    { tag: 'p', W: 1440, H: 2560, place: PLACE_P, targets: [1440, 720], manifest: 'story.p.json', preview: '_preview_p.png' },
];

// جودة WebP لكل طبقة. ليست ذوقًا: الطبقات الغنيّة بالضجيج (نجوم، غبار المجرّة،
// حبيبات الرمل) تكلّف أضعاف الطبقات الملساء عند نفس الجودة، وهي في الوقت نفسه
// **الأقلّ حساسيةً للفقد** لأن الضجيج يخفي القطع الرقمي. الطبقات الحادّة —
// البلدة بنوافذها، والمسافر بحافّته، والقمر بحوافّ فوّهاته — تُترك عالية لأنها
// وحدها ما تنظر إليه العين مباشرةً.
const Q = {
    stars: 46, milkyway: 50, 'dunes-far': 58, 'dunes-mid': 58,
    'dune-near': 74, town: 84, traveller: 86, moon: 84,
};

// جودة قناة الألفا — وهي، لا جودة اللون، ما يحكم وزن هذا الطقم. قياسٌ على
// `dues-mid`: تغيير `quality` من ٤٠ إلى ٧٤ حرّك الملفّ ١٤٦←١٥١KB (لا شيء)،
// بينما `alphaQuality` من ٧٠ إلى ٨٥ حرّكه ٢٠←١٤٧KB. السبب أن libwebp يتحوّل
// فوق ~٧٢ إلى ألفا بلا فقد.
//
// فالكثبان الناعمة عند ٧٠: متوسّط خطأ الحافّة ٤٫١ من ٢٥٥ (١٫٦٪) على حافّةٍ
// ضبابية أصلًا — غير مرئي. والطبقات الحادّة الصغيرة (البلدة بنوافذها،
// والمسافر بحدّه، والحرف) تبقى فوق العتبة: هي التي تُرى حوافُّها، ومجموعها
// أصلًا أقلّ من ١٢٠KB فالتوفير فيها لا يساوي المخاطرة بهالة قصّ.
const AQ = {
    'dunes-far': 70, 'dunes-mid': 70,
    'dune-near': 82, town: 82, traveller: 82,
};

// الفائض المُعطى لطبقات السماء (نسبة من الإطار، موزّعة على الجانبين).
const COVER_SLACK = 0.04;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- أدوات ------------------------------------------------------------------

// قناع المحتوى: ألفا للطبقات المقصوصة، وإضاءةٌ للمضيئة على أسود.
async function maskOf(buf, w, h, mode) {
    if (mode === 'alpha') {
        return sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer();
    }
    return sharp(buf).greyscale().raw().toBuffer();
}

function bbox(mask, w, h, t) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x] < t) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) throw new Error('صندوق المحتوى فارغ — الملف شفّاف بالكامل');
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// شدّة الضوء الحافّي على حرف الكثيب الأمامي كما جاء من المولّد: ١٫٠ يبقيه كما
// هو، وهو عندها يُقرأ **خطًّا إسفلتيًّا** يسحب العين من المسافر — أسطعُ شيءٍ في
// إطارٍ يُفترض أن يقوده ضوءُ البلدة. مُخفَّض إلى نصفه ليعود ضوءًا حافًّا.
const RIM = 0.5;

// إغلاق الظلّ: لكل عمود، كل ما تحت أعلى بكسلٍ معتم يصير معتمًا.
// يُرجع أيضًا خطّ الحرف (أعلى y لكل عمود) — وهو ما يقف عليه المسافر.
async function closeSilhouette(file) {
    const im = sharp(file);
    const m = await im.metadata();
    const w = m.width, h = m.height;
    const rgba = await sharp(file).ensureAlpha().raw().toBuffer();
    const crest = new Int32Array(w).fill(-1);

    for (let x = 0; x < w; x++) {
        let top = -1;
        for (let y = 0; y < h; y++) {
            if (rgba[(y * w + x) * 4 + 3] >= 40) { top = y; break; }
        }
        if (top < 0) continue;
        crest[x] = top;
        for (let y = top; y < h; y++) {
            const p = (y * w + x) * 4;
            if (rgba[p + 3] >= 250) {
                // الخطّ المولَّد يبقى شكلًا، ويُخفَّض سطوعًا نحو أسود الليل.
                for (let c = 0; c < 3; c++) {
                    const base = c === 0 ? NIGHT_TOP.r : c === 1 ? NIGHT_TOP.g : NIGHT_TOP.b;
                    rgba[p + c] = Math.round(base + (rgba[p + c] - base) * RIM);
                }
                continue;
            }
            const a = rgba[p + 3] / 255;
            // مزجٌ فوق أسود الظلّ: ما كان نصف شفّافٍ يبقى ناعمًا على الحافّة،
            // وما كان فارغًا يصير أسود صلبًا.
            rgba[p] = a * rgba[p] + (1 - a) * NIGHT_TOP.r;
            rgba[p + 1] = a * rgba[p + 1] + (1 - a) * NIGHT_TOP.g;
            rgba[p + 2] = a * rgba[p + 2] + (1 - a) * NIGHT_TOP.b;
            rgba[p + 3] = 255;
        }
    }
    const buf = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    return { buf, w, h, crest };
}

// ألفا من الإضاءة: العنصر مولَّدٌ على أسود، فسطوعُه **هو** تغطيته.
async function lumaToAlpha(file) {
    const m = await sharp(file).metadata();
    const w = m.width, h = m.height;
    const rgb = await sharp(file).removeAlpha().raw().toBuffer();
    const out = Buffer.alloc(w * h * 4);
    for (let i = 0, p = 0, q = 0; i < w * h; i++, p += 3, q += 4) {
        const l = 0.2126 * rgb[p] + 0.7152 * rgb[p + 1] + 0.0722 * rgb[p + 2];
        out[q] = rgb[p]; out[q + 1] = rgb[p + 1]; out[q + 2] = rgb[p + 2];
        // منحنًى خفيف: يطرح ضجيج الأسود ويبقي الوهج الحقيقي.
        out[q + 3] = clamp(Math.round(Math.pow(l / 255, 0.85) * 300 - 12), 0, 255);
    }
    return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// طبقاتٌ تتجاوز الإطار عمدًا (الكثبان أعرض منه ليبقى للـparallax فائض)، وsharp
// ترفض تركيبًا بإزاحةٍ سالبة أو بمقاسٍ أكبر من اللوحة. فتُقصّ للمنطقة المرئية
// **للمعاينة فقط** — أمّا ملفّات الويب فتُصدَّر كاملةً، لأن الفائض هو المطلوب.
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

async function buildFrame(F) {
    const { W, H, place: PLACE, tag } = F;
    const suf = tag ? tag : '';                 // '' أفقي، 'p' عمودي
    const name = (stem, t) => `${stem}-${suf}${t}.webp`;
    const manifest = [];
    const composite = [];
    let crestInfo = null;

    for (const P of PLACE) {
        const file = path.join(SRC, P.src);
        if (!fs.existsSync(file)) throw new Error('ملفٌّ مفقود: ' + P.src);

        // ١. تحضير المصدر
        let buf, sw, sh;
        if (P.fill) {
            const r = await closeSilhouette(file);
            buf = r.buf; sw = r.w; sh = r.h;
            crestInfo = r;
        } else if (P.mode === 'luma') {
            buf = await lumaToAlpha(file);
            const m = await sharp(buf).metadata(); sw = m.width; sh = m.height;
        } else {
            buf = await fs.promises.readFile(file);
            const m = await sharp(buf).metadata(); sw = m.width; sh = m.height;
        }

        // ٢. طبقة السماء: تغطية الإطار وقصٌّ من المنتصف، وانتهى أمرها.
        let cropped, cm;
        const T = 24;
        if (P.cover) {
            // فائضٌ صريح حتى لطبقات السماء. بناؤها بعرض الإطار **بالضبط** بدا
            // بديهيًّا وكان عطلًا: المجرّة عمقُها 0.02 فتنزاح 0.04% مع المؤشّر،
            // وبلا فائضٍ يعني ذلك شريطًا فارغًا على الحافّة. أسقطه اختبار
            // «الفائض الأفقي في الأصول» قبل أن يصل الشاشة.
            cropped = await sharp(buf)
                .resize(Math.round(W * (1 + COVER_SLACK)), Math.round(H * (1 + COVER_SLACK)),
                    { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
                .toBuffer();
            cm = { width: Math.round(W * (1 + COVER_SLACK)), height: Math.round(H * (1 + COVER_SLACK)) };
        } else {
            // صندوق المحتوى في المصدر
            const mask = await maskOf(buf, sw, sh, 'alpha');
            const box = bbox(mask, sw, sh, T);

            // ٣. المقياس: إمّا بعرض الطبقة أو بارتفاع محتواها (المسافر)
            const scale = P.w != null ? (P.w * W) / sw : (P.h * H) / box.h;

            // ٤. القصّ على الصندوق ثم التحجيم — بهذا الترتيب: التحجيم أولًا
            //    يضخّم بكسلاتٍ شفّافة ثم يرميها.
            cropped = await sharp(buf)
                .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
                .resize(Math.max(1, Math.round(box.w * scale)),
                    Math.max(1, Math.round(box.h * scale)),
                    { fit: 'fill', kernel: 'lanczos3' })
                .toBuffer();
            cm = await sharp(cropped).metadata();
        }

        // ٥. الموضع في الإطار المرجعي
        let left, top;
        if (P.cover) {
            left = -Math.round(W * COVER_SLACK / 2);
            top = -Math.round(H * COVER_SLACK / 2);
        } else if (P.standAt != null) {
            // قدما المسافر على الحرف: يُقاس ارتفاع الحرف عند عموده، لا يُخمَّن.
            if (!crestInfo) throw new Error('المسافر يُوضع بعد الكثيب الأمامي');
            const near = PLACE.find(p => p.fill);
            const nearScale = (near.w * W) / crestInfo.w;
            const nearLeft = (near.left || 0) * W;
            const nearMask = await maskOf(
                (await closeSilhouette(path.join(SRC, near.src))).buf,
                crestInfo.w, crestInfo.h, 'alpha');
            const nearBox = bbox(nearMask, crestInfo.w, crestInfo.h, T);
            const nearTop = near.top * H;

            left = Math.round(P.standAt * W - cm.width / 2);
            // العمود المقابل في المصدر لمنتصف قدمَي المسافر
            const srcX = clamp(Math.round((P.standAt * W - nearLeft) / nearScale), 0, crestInfo.w - 1);
            const crestY = crestInfo.crest[srcX];
            if (crestY < 0) throw new Error('لا حرفَ تحت المسافر عند هذا العمود');
            // موضع الحرف في الإطار = أعلى صندوق الكثيب + إزاحة العمود داخله
            const crestInFrame = nearTop + (crestY - nearBox.y) * nearScale;
            top = Math.round(crestInFrame - cm.height);
        } else if (P.bottom != null) {
            left = Math.round((P.left || 0) * W);
            top = Math.round(P.bottom * H - cm.height);
        } else {
            left = Math.round((P.left || 0) * W);
            top = Math.round(P.top * H);
        }

        // ٦. إخراج مقاسَين
        const stem = P.name;
        for (const target of F.targets) {
            const k = target / W;
            let pipe = sharp(cropped).resize(
                Math.max(1, Math.round(cm.width * k)),
                Math.max(1, Math.round(cm.height * k)),
                { fit: 'fill', kernel: 'lanczos3' });
            // طبقات screen تُصدَّر معتمة على أسود: القناة الرابعة لا معنى لها
            // هناك، وحذفُها هو كلّ التوفير.
            if (P.blend) pipe = pipe.flatten({ background: '#000000' });
            await pipe
                .webp({ quality: Q[stem] ?? 80, alphaQuality: AQ[stem] ?? 80, effort: 6 })
                .toFile(path.join(OUT, name(stem, target)));
        }

        manifest.push({
            name: stem,
            blend: !!P.blend,
            left: +(left / W).toFixed(5),
            top: +(top / H).toFixed(5),
            width: +(cm.width / W).toFixed(5),
            height: +(cm.height / H).toFixed(5),
            // العرض الفعلي بالبكسل لكل مقاس — يصير واصفَ `w` في srcset. بدونه
            // يظنّ المتصفّح أن ملفّ القمر عرضه 2560 فيختار الأثقل دائمًا.
            px: [Math.round(cm.width), Math.round(cm.width / 2)],
        });
        const piece = await clipToFrame(cropped, cm, left, top, W, H);
        if (piece && P.blend) piece.blend = 'screen';
        composite.push(piece);
        const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
        console.log(
            stem.padEnd(10),
            `${cm.width}x${cm.height}`.padEnd(11),
            `@ ${(left / W * 100).toFixed(1)}%,${(top / H * 100).toFixed(1)}%`.padEnd(18),
            `${kb(name(stem, F.targets[0]))}KB / ${kb(name(stem, F.targets[1]))}KB`
        );
    }

    // خلفية الليل: تدرّجٌ من التوكنز. الطبقات كلّها تطفو فوقه، فلا يمكن لحركةٍ
    // أن تكشف حافّة — التغطية مضمونةٌ بالبناء لا بحسابِ فائض.
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

    // المسطّحة للمسار الضعيف = المشهد الرابع بالضبط، لا نسخةٌ منه.
    for (const target of F.targets) {
        await sharp(flat).resize(target).webp({ quality: 80 })
            .toFile(path.join(OUT, `flat-${suf}${target}.webp`));
    }
    await sharp(flat).resize(F.targets[1]).png().toFile(path.join(OUT, F.preview));

    fs.writeFileSync(path.join(OUT, F.manifest), JSON.stringify(manifest, null, 2));

    const total = manifest.reduce(
        (s, m) => s + fs.statSync(path.join(OUT, name(m.name, F.targets[0]))).size, 0);
    console.log('\nطقم', F.targets[0], '=', (total / 1024).toFixed(0) + 'KB',
        '· flat =', (fs.statSync(path.join(OUT, `flat-${suf}${F.targets[0]}.webp`)).size / 1024).toFixed(0) + 'KB');
    return manifest;
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const built = {};
    for (const F of FRAMES) {
        console.log('\n=== إطار ' + F.W + 'x' + F.H + ' ===');
        built[F.tag || 'l'] = await buildFrame(F);
    }

    // الترميز يُولَّد من البيانَين لا يُكتب بيد: ثماني طبقات × **ثمانية** أرقام
    // موضعٍ الآن (أربعة لكل إطار) = ٦٤ رقمًا، وأيُّ واحدٍ منها يُنسَخ خطأً يزيح
    // طبقةً بلا أن يكسر شيئًا يُلاحَظ. يُلصَق الناتج في index.html.
    //
    // والهندستان تُمرَّران كمتغيّرات CSS لا كخصائص مباشرة، لأن `style` السطري
    // يهزم أيّ media query: قاعدةٌ في الورقة لا تستطيع تجاوز `left:8%` مكتوبةً
    // على العنصر. مع المتغيّرات تبقى القاعدة في CSS والقيم في الترميز، وينتقل
    // الاختيار بينهما إلى `@media (orientation: portrait)` — وهو أيضًا ما يجعل
    // تدوير الجهاز يعيد التخطيط بلا سطر JS.
    const byName = m => Object.fromEntries(m.map(x => [x.name, x]));
    const L = byName(built.l), P = byName(built.p);
    const pc = v => (v * 100).toFixed(3) + '%';
    const set = (m, k) => `--${k}l:${pc(m.left)};--${k}t:${pc(m.top)};--${k}w:${pc(m.width)};--${k}h:${pc(m.height)}`;
    const srcset = (n, tag, px, t) =>
        `public/story/${n}-${tag}${t[1]}.webp ${px[1]}w, public/story/${n}-${tag}${t[0]}.webp ${px[0]}w`;

    // الإطار الحامل. بدونه تبقى النِّسَب رهينةَ نسبة الجهاز: الطقم العمودي
    // مركَّبٌ على 0.5625 وشاشة الجوّال 0.462، فيبقى مطٌّ 1.22× مهما دقَّقنا
    // التركيب — ولا يمكن ملاحقة كل جهاز. والحلّ أن تُقفَل نسبة الإطار وتُغطّي
    // الشاشةَ بالقصّ لا بالمطّ، فتصير الطبقات في نظام إحداثيّاتٍ واحدٍ صلب
    // ونسبةُ كل صندوقٍ تساوي نسبةَ صورته بالضبط على **أي** شاشة.
    const R = FRAMES.map(F => (F.W / F.H).toFixed(4));
    const frame = `            <div class="film-frame" style="--r:${R[0]};--ri:${(1 / R[0]).toFixed(4)};`
        + `--rp:${R[1]};--rpi:${(1 / R[1]).toFixed(4)}">`;

    const markup = built.l.map(m => {
        const p = P[m.name];
        return `            <div class="film-layer" data-layer="${m.name}"${m.blend ? ' data-blend="screen"' : ''}
                 style="${set(m, 'l')};${set(p, 'p')}">
                <picture>
                    <source media="(orientation: portrait)"
                            data-srcset="${srcset(m.name, 'p', p.px, [1440, 720])}">
                    <img class="film-layer__img" alt="" decoding="async"
                         data-src="public/story/${m.name}-1280.webp"
                         data-srcset="${srcset(m.name, '', m.px, [2560, 1280])}">
                </picture>
            </div>`;
    }).join('\n');
    fs.writeFileSync(path.join(OUT, '_markup.html'),
        frame + '\n' + markup.replace(/^/gm, '    ') + '\n            </div>\n');

    const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
    console.log('\nالمسطّحة: أفقي', kb('flat-1280.webp') + 'KB · عمودي', kb('flat-p720.webp') + 'KB');
})();
