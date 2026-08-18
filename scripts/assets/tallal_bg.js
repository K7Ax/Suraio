// scripts/assets/tallal_bg.js — يُحضّر خلفيّة صفحة ٤٠٤ («ضاع الطريق») للنشر.
//
// المصدر لوحةٌ واحدة: زقاقٌ نجديّ ليلًا، فانوسٌ واحد يضيء الحجر، والبابُ
// المنقوش يمينًا، والنصفُ الأيسر عتمةٌ خالصة. تلك العتمةُ ليست فراغًا في
// اللوحة بل **مكانُ النصّ**، ولذلك لا تُقصّ ولا يُعاد توسيطها.
//
// ولا تركيبَ هنا ولا طبقات — بخلاف `scripts/assets/tallal_assets.js` الذي بنى المشهد
// السابق من تسع قطع. لوحةٌ واحدة لا تحتاج إلّا أن تُصغَّر إلى ثلاثة مقاسات
// وتُحوَّل إلى WebP: هذا كلّ ما يفعله هذا الملفّ.
//
//   node scripts/assets/tallal_bg.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "_design-src", "tallal", "alley.png");
const OUT = path.join(ROOT, "public", "tallal");

// ثلاثة عروض. المصدر ١٦٧٢ عرضًا، فلا تكبير: التكبير في صورةٍ معتمةٍ كهذه
// يضيف بايتاتٍ ولا يضيف تفصيلًا واحدًا تراه العين.
const W = [1672, 1200, 820];
// جودةٌ عالية رغم العتمة: التدرّجات الطويلة في الظلّ هي أوّل ما يتشقّق
// (banding)، و`effort: 6` يشتري ذلك بوقت بناءٍ لا بوزن.
const Q = { quality: 76, effort: 6 };

async function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`مفقود: _design-src/tallal/alley.png — ضع اللوحة هناك ثمّ أعِد التشغيل.`);
        process.exit(1);
    }
    fs.mkdirSync(OUT, { recursive: true });
    const m = await sharp(SRC).metadata();
    console.log(`المصدر ${m.width}×${m.height}`);

    for (const w of W) {
        if (w > m.width) continue;
        const file = path.join(OUT, `alley-${w}.webp`);
        await sharp(SRC).resize({ width: w }).webp(Q).toFile(file);
        console.log(`  alley-${w}.webp  ${(fs.statSync(file).size / 1024).toFixed(0)}ك`);
    }

    // بطاقة المشاركة: قصٌّ إلى ١٢٠٠×٦٣٠ **من يمين الوسط** كي يقع الفانوس
    // والباب داخلها. لو قُصّت من المركز لخرجت بطاقةٌ سوداء بلا موضوع.
    const og = path.join(OUT, "alley-og.webp");
    await sharp(SRC)
        .resize({ width: 1200, height: 630, fit: "cover", position: sharp.strategy.attention })
        .webp({ quality: 74 }).toFile(og);
    console.log(`  alley-og.webp  ${(fs.statSync(og).size / 1024).toFixed(0)}ك`);
    console.log("TALLAL_BG_OK");
}

main().catch(e => { console.error(e); process.exit(1); });
