// تلميح «كلمة» يجب أن يضيف معلومة — لا أن يعيد ما كشفه اللاعب.
//
// العطل الذي أنتج هذا الملف: المزوِّد كان يقارن بالصفّ **الجاري** وحده، وهو
// فارغٌ عادةً، فتبدو كل الخانات مجهولة ويعيد التلميح حرفًا خضّره اللاعب في
// محاولةٍ سابقة. المعرفة تُبنى من الصفوف المُسلَّمة أو لا تُبنى إطلاقًا.
//
// المنطق حبيسُ إغلاقٍ داخل `initWordleGame` فلا يُستورَد؛ نحرس إذن الثوابت التي
// نقضُها يعيد العطل حرفيًّا — على نمط tests/modals.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { read } = require("./helpers/ui.js");

const ROOT = path.join(__dirname, "..");
const SRC = read("wordle");

// ‏قطعُ المقاطع بالاسم يصمت حين يغيب الاسم: `indexOf` يرجع −١، و`slice` تقبله
// ‏فتقصّ من آخر النصّ. وهذا حدث فعلًا هنا — حدُّ `provider` كان
// ‏`fetchDailyWordle`، وهي دالّةٌ حُذفت من زمن، فصار المقطعُ كلَّ ما بقي من
// الملفّ وكلُّ `assert` عليه أوسعَ ممّا يزعم. فليُقطع بحدٍّ موجودٍ يُتحقَّق منه.
function between(from, to) {
    const a = SRC.indexOf(from), b = SRC.indexOf(to);
    assert.notEqual(a, -1, `حدُّ البداية «${from}» لم يعد موجودًا في الوحدة`);
    assert.notEqual(b, -1, `حدُّ النهاية «${to}» لم يعد موجودًا في الوحدة`);
    assert.ok(b > a, `الحدّان انقلبا: «${from}» بعد «${to}»`);
    return SRC.slice(a, b);
}

const provider = between("function wordleHintProvider()", "const openWordle");

test("المعرفة تُبنى من الصفوف المُسلَّمة لا من الصفّ الجاري", () => {
    const known = between("function wordleKnown()", "function wordleHintProvider()");
    assert.ok(known.length > 100, "wordleKnown() غائبة — لا مصدر لمعرفة اللاعب");
    assert.match(known, /for\s*\(let r = 0; r < currentRow; r\+\+\)/,
        "لا يمرّ على الصفوف السابقة — وهذا هو العطل نفسه");
    assert.match(known, /scoreRow\(/,
        "لا يستعمل تلوين اللوح، فقد تنحرف معرفته عمّا يراه اللاعب");
    assert.doesNotMatch(provider, /guesses\[currentRow\]\s*\|\|/,
        "عاد يقرأ الصفّ الجاري بوصفه مصدرَ المعرفة");
});

test("الخانات المعروفة والمُلمَّح إليها مستبعَدة", () => {
    assert.match(provider, /if \(greens\[i\] \|\| wHinted\.has\(i\)\) continue;/,
        "لا يستبعد الأخضر ولا المكشوف سابقًا");
    assert.match(SRC, /const wHinted = new Set\(\)/, "wHinted غير معرَّفة");
    assert.match(SRC, /wHinted\.clear\(\)/, "wHinted لا تُصفَّر عند لوحٍ جديد");
    assert.match(provider, /wHinted\.add\(pos\)/, "الخانة المكشوفة لا تُسجَّل، فتتكرّر");
});

test("الأولوية لحرفٍ لم يَعرف اللاعب بوجوده أصلًا", () => {
    assert.match(provider, /seen\.has\(secret\[i\]\) \? placing : fresh/,
        "لا ترتيب بالقيمة: حرفٌ مجهول تمامًا يجب أن يسبق حرفًا معروف الوجود");
});

test("لا يُخصَم تلميحٌ لا يضيف شيئًا", () => {
    assert.match(provider, /if \(!fresh\.length && !placing\.length\)\s*\{\s*return \{ ok: false/,
        "لا رفضَ عند نفاد المجهول — يخصم من اللاعب مقابل لا شيء");
    // ‏العقد المقابل في المحرّك — وهو في `src/ui/meta.js` لا هنا: الخصم مشروطٌ
    // ‏بألّا يكون الردّ ok:false.
    assert.match(require("./helpers/live.js").META, /if \(res && res\.ok !== false\) consume\(gameType, 'local'\)/,
        "المحرّك صار يخصم على الرفض أيضًا، فبطل معنى الرفض");
});

test("لا يُوسَم بالطيف حرفٌ كتبه اللاعب", () => {
    assert.match(provider, /if \(cell && !guesses\[currentRow\]\[pos\]\)/,
        "قد يضع وسم التلميح على حرفٍ خاطئ كتبه اللاعب فيوحي بأنه صحيح");
});

test("المسار الذكي يعرف ما يعرفه اللاعب كذلك", () => {
    const ctx = between("registerCtx('wordle'", "function pickLevelWord");
    assert.match(ctx, /wordleKnown\(\)/, "سياق الذكاء لا يحمل حصيلة الصفوف السابقة");
    assert.match(ctx, /ممنوع أن يدور التلميح حول ما يعرفه اللاعب/,
        "لا منعَ صريحًا من إعادة المعروف");
});

test("تلوين الصفّ مُعرَّفٌ مرّةً واحدة", () => {
    assert.equal((SRC.match(/statuses\[i\] = 'correct'/g) || []).length, 1,
        "نسختان من حساب الألوان — ستنحرف إحداهما عن الأخرى");
});

test("الحزمة المبنيّة تحمل التصحيح", () => {
    const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    // صورة النصّ في الحزمة تتبع علم `--charset` (ascii يهرّب، utf8 لا)، والمقصود
    // وجود الرسالة لا شكلها — فيُقبَل الشكلان.
    const esc = s => [...s].map(c => c.charCodeAt(0) < 128 ? c
        : "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");
    const msg = "الباقي تركيب الكلمة";
    assert.ok(app.includes(msg) || app.includes(esc(msg)),
        "app.js لم يُبنَ بعد التعديل — الموقع ما زال على العطل بلا أي رسالة خطأ");
});
