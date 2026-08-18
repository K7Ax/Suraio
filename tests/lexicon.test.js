// تنقية المعجم — الحواجز التي تمنع الذكاء الاصطناعيّ أن يصير مؤلِّفًا.
//
// «نحلة» ألواحُها مُبرهَنةٌ بالبناء، وقاعدةُ الجولة كلّها أن **الكود يولّد
// وGroq يراجع**. وفتحُ بابٍ للتصنيف يقترب من هذا الحدّ اقترابًا يستحقّ الحراسة:
// لو سقط سطرٌ واحد — سطر التقاطع — لصارت كلمات النموذج تدخل البنك مباشرةً،
// ولما ظهر ذلك في أي اختبارٍ آخر ولا في الشاشة، بل في كلمةٍ مخترَعةٍ يراها لاعب.
//
// فهذه الاختبارات تحرس الحدّ نفسه، لا سلوكًا.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const VET = read("scripts/bank/vet_lexicon.js");
const GEN = read("scripts/bank/gen_bee_bank.js");
const FN = read("supabase/functions/groq-author/index.ts");

test("التقاطع قائم — كلمةٌ يخترعها النموذج لا تنجو من الرحلة", () => {
    // هذا هو الضمان البنيويّ كلّه. الردّ يُصفّى على ما أُرسِل، فالنموذج يصنّف
    // ولا يضيف. وبدونه يصير «نحلة» مُؤلَّفًا بالذكاء الاصطناعيّ فعلًا.
    assert.match(VET, /const sent = new Set\(batch\)/, "لم تُبنَ مجموعة المُرسَل");
    assert.match(VET, /\.filter\(w => sent\.has\(w\)\)/, "سقط التقاطع — النموذج يستطيع الإضافة");
});

test("الردّ المعطوب يُرمى ولا يُقرأ رفضًا شاملًا", () => {
    // إرجاع [] عند فشل التحليل لا يُميّز عن «رُفضت الستّون كلّها»، والمُنادي
    // يحفظها حينئذٍ كـ«مُصنَّفة» فتضيع ستّون كلمةً حقيقيّةً بلا أثر. وقع ذلك
    // مرّتين فعلًا في أوّل جولة (٠/٦٠ بالضبط).
    assert.ok(!/catch\s*\{\s*return \[\];\s*\}/.test(VET), "عاد الابتلاع الصامت لفشل التحليل");
    assert.match(VET, /throw new Error\("ردٌّ غير صالح \(JSON\)/);
    assert.match(VET, /if \(!Array\.isArray\(parsed\.ok\)\) throw/);
});

test("حدّ المعدّل انتظارٌ بالمهلة المُعلَنة لا بثابتٍ مُخمَّن", () => {
    assert.match(VET, /try again in \(\[\\d\.\]\+\)s/, "لا تُقرأ المهلة من ردّ Groq");
    assert.match(VET, /e\.retryAfter/, "لا يُميَّز حدّ المعدّل عن الفشل الحقيقيّ");
    // ولا تدور المحاولات إلى ما لا نهاية
    assert.match(VET, /attempt < 6/);
});

test("«نحلة» تُصنَّف ولا تُؤلَّف — بابان لا باب", () => {
    // الفتحة الوحيدة المسموحة. لو دخلت spelling_bee في AUTHORABLE لصار /author
    // يخترع لها كلماتٍ عربيّةً غير موجودة (عيب الجولة ٤).
    const authorable = FN.match(/const AUTHORABLE = new Set\(\[[^\]]*\]\)/)[0];
    assert.ok(!/spelling_bee/.test(authorable), "نحلة دخلت قائمة التأليف");
    assert.match(FN, /const VETTABLE = new Set\(\[\.\.\.AUTHORABLE, "spelling_bee"/);
    // والبوّابة تختار القائمة بالوضع، ولا تقبل وضعًا ثالثًا
    assert.match(FN, /mode !== "author" && mode !== "vet"/, "وضعٌ غير معروف يمرّ");
    assert.match(FN, /mode === "vet" \? VETTABLE : AUTHORABLE/, "القائمتان لا تُفرَّقان بالوضع");
});

test("التصنيف حتميّ — الحرارة صفر", () => {
    // «هل هذه كلمة» يجب ألّا يتغيّر جوابها بتغيّر الجولة، وإلّا نُقّي المعجم
    // نفسه تنقيتين مختلفتين ولم يعد قابلًا للمراجعة.
    assert.match(FN, /temperature: mode === "vet" \? 0 : 0\.8/);
});

test("لا يُدرَّب المُرجِّح ولا يُقرأ المعجم من بنكٍ مولَّدٍ آليًّا", () => {
    // letterboxed.json و saudi/spelling_bee.json مولَّدان من words_ar.json نفسه،
    // فالقراءة منهما تغسل التوسّع الصرفيّ عبر ملفٍّ يبدو يدويًّا — وهي المصيدة
    // التي أعطت «اباتي» و«ابادوا» و«ابداوا» في أوّل تشغيل.
    for (const src of [GEN, VET]) {
        assert.match(src, /letterboxed\.json/);
        assert.match(src, /spelling_bee\.json/);
    }
    assert.match(GEN, /NOT_CURATED\.has\(f\.name\)/, "الاستبعاد غير مُطبَّق في المولّد");
});

test("المولّد يحفظ الألواح الثمانية اليدويّة ولا يكتب خارج العلامتين", () => {
    // ألواحٌ صنعها إنسانٌ ولا يجوز أن يمحوها تشغيلُ سكربت.
    assert.match(GEN, /@gen:bee:start/);
    assert.match(GEN, /@gen:bee:end/);
    assert.match(GEN, /لم أجد العلامتين/, "الكتابة لا تفشل عند غياب العلامتين");
    assert.match(GEN, /BEE_CURATED/, "الألواح اليدويّة غير مفصولة");
});

test("قواعد الترشيح تُبقي الكلمة وتُسقط الصيغة", () => {
    // القواعد نصٌّ يُقرأ ويُناقَش — وهذا الاختبار يمنع حذف أيٍّ منها بصمت.
    for (const rule of [
        /if \(\/\(\.\)\\1\\1\/u\.test\(w\)\) continue/,   // ثلاثة أحرفٍ متتالية
        /if \(\/\^\(\.\)\\1\/u\.test\(w\)\) continue/,     // حرفٌ أوّلُ مضاعف
        /if \(\/\^ال\/u\.test\(w\)\) continue/,            // أداة التعريف
    ]) assert.match(VET, rule, `سقطت قاعدة ترشيح: ${rule}`);
    assert.match(VET, /PREFIX\.some/);
    assert.match(VET, /SUFFIX\.some/);
});

test("الميزانية موزّعةٌ على الحروف لا على الدرجة وحدها", () => {
    // الفرز العالميّ وحده يضع «انال، امال، اموال، انوار» في القمّة — كلماتٌ
    // حقيقيّة كلّها من ا ل م ن ر و، فيخرج معجمٌ لا يبني إلا ألواحًا على ستّة
    // حروف: مشكلة التكرار نفسها بثوبٍ جديد.
    assert.match(VET, /PER_LETTER/);
    assert.match(VET, /quota\[rarest\]/, "الكلمة لا تُحتسب على أندر حروفها");
});

test("اللوح المُتشابه صرفيًّا يُرفض — الكلمة سليمة والعِشرة ليست", () => {
    // ٣١٪ من المعجم المُنقّى ينتهي بـ«ـين»، وربعه مضارعٌ بضمير. كلٌّ منها عربيّةٌ
    // صحيحة، لكنّها تتكتّل: مجموعةٌ فيها ت ي ن تمتلئ بصرف فعلٍ واحد فتُحصى ٢٣
    // كلمةً وهي لوحٌ واحد. وعدد الكلمات هو إشارة الصعوبة هنا، فاللوح الرتيب
    // ليس مملًّا فحسب، بل مُصنَّفٌ في النطاق الخطأ.
    assert.match(GEN, /const skeleton = w =>/, "سقط مقياس الرتابة");
    assert.match(GEN, /if \(monotonous\(ws\)\) \{ skipped\+\+; continue; \}/, "البوّابة غير مُطبَّقة");
    // والحكم على اللوح لا على الكلمة: تحبين تصلح في لوحٍ ليس مصنوعًا من إخوتها
    const src = GEN.match(/function skew\([\s\S]*?\n {4}\}/)[0];
    assert.match(src, /Math\.max\(\.\.\.fam\.values\(\)\) \/ ws\.length/);
    assert.match(GEN, /const monotonous = ws => skew\(ws\) > SKEW/);
});

test("المعجم المُنقّى — إن وُجد — نظيفٌ بالفعل", () => {
    const p = path.join(__dirname, "..", "bank/lexicon_ar.json");
    if (!fs.existsSync(p)) return;   // الجولة لم تُشغَّل بعد
    const words = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.ok(Array.isArray(words));
    for (const w of words) {
        const n = [...w].length;
        assert.ok(n >= 4 && n <= 6, `«${w}» خارج ٤–٦ حروف`);
        assert.ok(!/^ال/.test(w), `«${w}» بأداة تعريف`);
        assert.ok(!/(.)\1\1/u.test(w), `«${w}» بثلاثة أحرفٍ متتالية`);
        assert.ok(!/[ةءئؤ]/.test(w), `«${w}» يحمل حرفًا مستبعَدًا`);
    }
    // ولا تكرار: الملفّ مجموعةٌ مرتّبة
    assert.equal(new Set(words).size, words.length, "المعجم يحمل مكرّرات");
});
