// تقدّم المستوى — «المستوى يتقدّم بالفوز، واللوح يبقى لوحَ المستوى المفتوح».
//
// العطل الذي أنتج هذا الملف (بلاغ المالك، ١٢ أغسطس ٢٠٢٦): «المستويات تتكرر
// في الألعاب، لعبت بدون تسجيل دخول، وإذا انتقلت لمستوى جديد تتكرر نفس
// المرحلة السابقة».
//
// السبب: `level(game)` ترتدّ إلى `frontier(game)` ما لم يُخزَّن مستوًى
// صراحةً — وهي حال كلّ لاعبٍ جديد لم يفتح المُنتقي قطّ. والفوز يحرّك القناع،
// فتتحرّك الجبهة، فتتحرّك `level()` **في لحظة الفوز نفسها**: يعلن الشريط
// «المستوى ٢» بينما اللوح على الشاشة ما زال لوح المستوى ١، ويقرأ اللاعب ذلك
// تكرارًا للمرحلة. العلاج: `complete()` تثبّت المستوى الحاليّ قبل تحريك
// القناع، فيبقى التقدّم بيد `pendingNext` وزرّ «المستوى التالي» وحدهما.
//
// الحراسة بنيويّة لأن `complete()` تعيش في وحدةِ الواجهة لا في وحدةٍ نقيّة
// يمكن استيرادها — وهذا ما جعل الانحدار ممكنًا أصلًا. (كانت في `src/main.js`
// وصارت في `src/ui/levels.js`؛ الموضعُ يُسأل عنه في `helpers/ui.js` مرّةً.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = require("./helpers/ui.js").read("levels");
const BUNDLE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// جسد `complete()` كاملًا: من ترويستها إلى ترويسة الدالّة التالية.
function completeBody() {
    const i = SRC.indexOf("function complete(game)");
    assert.notEqual(i, -1, "لم يُعثر على complete() — أعيدت تسميتها؟");
    const rest = SRC.slice(i + 10);
    const j = rest.indexOf("\n        function ");
    return rest.slice(0, j === -1 ? 2000 : j);
}

test("complete() تثبّت المستوى قبل أن تحرّك القناع", () => {
    const body = completeBody();
    const lvlWrite = body.indexOf("`lvl.${game}.level`");
    const maskWrite = body.indexOf("`lvl.${game}.mask`");
    assert.notEqual(lvlWrite, -1,
        "complete() لا تكتب المستوى — فـlevel() سترتدّ إلى frontier() وتقفز عند الفوز");
    assert.notEqual(maskWrite, -1, "complete() لا تكتب القناع");
    assert.ok(lvlWrite < maskWrite,
        "المستوى يجب أن يُثبَّت **قبل** القناع: بعده تكون الجبهة قد تحرّكت أصلًا");
});

test("pendingNext ما زالت هي صاحبة التقدّم التلقائيّ", () => {
    // التثبيت لا يجوز أن يُلغي التقدّم عند الفتح التالي: لاعبٌ فاز ثم أغلق
    // النافذة بلا ضغط «التالي» يجب أن يجد المستوى التالي في انتظاره.
    assert.match(completeBody(), /setPendingNext\(game,\s*1\)/,
        "الفوز لم يعُد يرفع pendingNext — سيعود اللاعب إلى مستوًى أتمّه");
});

test("الحزمة المبنيّة تحمل التثبيت نفسه", () => {
    // `npm run build` قد يتأخّر عن `src/`، وهذا بذاته انحدار: المتصفّح لا
    // يقرأ إلا `app.js`. الأسماء مختصرةٌ بعد البناء، فيُبحَث عن الترتيب:
    // كتابةُ مستوًى يتبعها عن قربٍ كتابةُ قناعٍ للمتغيّر نفسه.
    const re = /lvl\.\$\{([A-Za-z_$][\w$]*)\}\.level/g;
    let m, found = false;
    while ((m = re.exec(BUNDLE))) {
        const near = BUNDLE.slice(m.index, m.index + 260);
        if (near.includes("lvl.${" + m[1] + "}.mask")) { found = true; break; }
    }
    assert.ok(found,
        "app.js لا يحمل تثبيت المستوى قبل القناع — شغّل npm run build");
});

// ────────────────────────────────────────────────────────────────────────────
// ‏شريطُ المستوى يتبع المستوى — لا يتجمّد على «المستوى ١».
//
// ‏العطلُ الذي أنتج هذه الحراسة (مسحُ ٢١×٦، ١٥ أغسطس ٢٠٢٦): `refresh()` كانت
// تُنادى عند تركيب الشريط وبعد الفوز فقط. فمن فتح المُنتقي واختار المستوى ٢١
// حصل على لوحِ المستوى ٢١ (اللوحُ يُبنى، والكلمةُ السرّيّة تتغيّر، ومنحنى
// الصعوبة يتحرّك ٤→٥→٦ أحرف) بينما يقول له الشريط «المستوى ١ · سهل ١/٦».
//
// ‏وما يثبت أنّه سهوٌ لا تصميم: مُعالِجُ «تحدي اليوم» في الملفّ نفسِه كان
// ينادي `bars[game].refresh()` صراحةً. فطريقان من ثلاثةٍ فاتا.
//
// ‏الحراسةُ بنيويّة للسبب ذاته المشروح أعلاه: `mountControls` في `ui/levels.js`.
{
    const SRC = require("./helpers/ui.js").read("levels");
    const from = SRC.indexOf("function mountControls");
    const to = SRC.indexOf("const infoEl = bar.querySelector('.lvl-info')");

    test("مُعالِجا «التالي ←» والمُنتقي ينادِيان refresh()", () => {
        assert.ok(from > 0 && to > from, "تعذّر عزلُ مُعالِجات mountControls");
        const handlers = SRC.slice(from, to);

        const nextLine = handlers.split("\n").find(l => l.includes("lvl-next-btn") && l.includes("addEventListener"));
        assert.ok(nextLine, "لم يُعثر على مُعالِج «المستوى التالي ←»");
        assert.match(nextLine, /refresh\(\)/, "«التالي ←» يغيّر المستوى بلا إعادة رسم الشريط");

        const pickerStart = handlers.indexOf("picker.addEventListener");
        assert.ok(pickerStart > 0, "لم يُعثر على مُعالِج المُنتقي");
        const pickerBody = handlers.slice(pickerStart);
        assert.match(pickerBody, /setLevel\(game, n\)/, "المُنتقي لم يعد يضبط المستوى");
        assert.match(pickerBody, /refresh\(\)/, "المُنتقي يغيّر المستوى بلا إعادة رسم الشريط");
    });

    test("refresh() ما زالت ترسم رقمَ المستوى من level()", () => {
        // ‏لو رُسم الرقمُ من متغيّرٍ محفوظٍ بدل `level(game)` لعاد العطلُ نفسُه
        // من بابٍ آخر: شريطٌ يقول رقمًا لا يطابق ما يلعبه اللاعب.
        const body = SRC.slice(SRC.indexOf("function refresh()", from));
        const line = body.split("\n").find(l => l.includes("lvl-num") && l.includes("المستوى"));
        assert.ok(line, "سطرُ رسم رقم المستوى اختفى");
        assert.match(line, /arNum\(lv \+ 1\)/, "الرقم لم يعد مشتقًّا من lv");
        assert.match(body.slice(0, body.indexOf(line)), /const lv = level\(game\)/,
            "lv لم يعد مقروءًا من level(game) قبل الرسم");
    });
}
