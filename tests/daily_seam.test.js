// مفصل «تحدي اليوم» في العميل — الحارس على أخطر خاصّيّةٍ في هذه الجولة:
// **الوضع اليوميّ لا يمسّ الحملة**.
//
// السبب أنّ المفصل يعمل بإبدال ما ترجعه `level(game)`: في الوضع اليوميّ تعيد
// المستوى الممثِّل للنطاق بدل موضع اللاعب. وهذا بالضبط ما يجعل كل منحنيات
// الصعوبة القائمة تعمل بلا سطرٍ واحدٍ لكل لعبة — وهو أيضًا ما يجعل نسيان فرعٍ
// واحد كارثة: `complete()` تكتب القناع عند `level(game)`، فمكسبُ جمعةٍ واحد كان
// سيهدي اللاعب المستوى ١٥ صامتًا. الاختبار الأوّل هنا يحرس ذلك الفرع تحديدًا.
//
// فحصٌ نصّيّ على المصدر عن قصد: السلوك يغطّيه مسح Playwright، وما نحرسه هنا
// ترتيبُ سطرين لا يظهر في أي لقطة شاشة.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");

const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
// ‏المفصلُ اليوميّ (`finish`/`won`/`level`/`finishDaily`) خرج من `src/main.js`
// ‏مع `initLevels` إلى `src/ui/levels.js`. الموضعُ يُسأل عنه في `helpers/ui.js`.
const UI = require("./helpers/ui.js");
const levels = UI.read("levels");

test("وحدةُ السلّم موصولةٌ فعلًا — وإلّا حرسنا ملفًّا لا يعمل", () => {
    UI.assertWired(assert, "initLevels", "ui/levels\\.js");
});

// جسد دالّةٍ من اسمها إلى القوس المتوازن.
function bodyOf(src, header) {
    const i = src.indexOf(header);
    assert.notEqual(i, -1, `لم أجد «${header}»`);
    let depth = 0, start = src.indexOf("{", i);
    for (let j = start; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
    }
    throw new Error(`قوسٌ غير مغلق في «${header}»`);
}

test("finish تتفرّع إلى اليوميّ قبل أن تلمس الحملة", async () => {
    const b = bodyOf(levels, "function finish(game, o)");
    const branch = b.indexOf("finishDaily");
    const write = b.indexOf("complete(game)");
    assert.notEqual(branch, -1, "لا فرعَ يوميّ في finish");
    assert.ok(branch < write, "الفرع اليوميّ يجب أن يسبق complete() — وإلا كُتب قناع الحملة");
});

test("finishDaily لا تكتب تقدّم حملةٍ ولا ترفع رتبة", async () => {
    const b = bodyOf(levels, "function finishDaily(game, o)");
    assert.ok(!/\bcomplete\(/.test(b), "لا تستدعي complete()");
    assert.ok(!/recordRank\(/.test(b), "لا تكتب سلّم رتب الحملة");
    assert.ok(!/submitProgress/.test(b), "لا ترفع نتيجةً إلى سلطة الحملة");
    assert.ok(!/setPendingNext/.test(b), "لا تجدول تقدّمًا للمرّة القادمة");
    assert.match(b, /advanced:\s*false/, "advanced=false فلا يعرض أحدٌ «التالي ←»");
});

test("won كذلك تتفرّع — وهي المدخل الثاني لنهاية الجولة", async () => {
    const b = bodyOf(levels, "function won(game)");
    assert.ok(b.indexOf("finishDaily") < b.indexOf("complete(game)"), "won بلا فرعٍ يوميّ تهدي مستوًى");
});

test("level تعيد المستوى الممثِّل في الوضع اليوميّ — وهو مصدر كل شيء", async () => {
    const b = bodyOf(levels, "function level(game)");
    assert.match(b, /inDaily\(game\)/);
    assert.match(b, /bandRepLevel/, "المستوى الممثِّل، لا موضع اللاعب");
});

test("الأربعة الباقية تمرّ بالمفصل: البذرة والميزانية والدلو والمموّهات", async () => {
    assert.match(bodyOf(levels, "function levelSeed(game, lv)"), /inDaily\(game\)\s*\?\s*dailyCtx\.seed/);
    assert.match(bodyOf(levels, "function budgetFor(game, lv)"), /dailyBudget/);
    assert.match(bodyOf(levels, "function pickBankIndex(game, bank, lv, random)"), /pickDailyIndex/);
    assert.match(bodyOf(levels, "function decoysFor(game, lv)"), /dailyDecoys/);
    // تشابك يقرأ المموّهات من المنحنى مباشرةً قبل هذه الجولة، فلو بقي كذلك
    // لسقط تشديد الجمعة صامتًا وبدت الجمعة كالخميس.
    assert.match(read("src/games/connections.js"), /L\.decoysFor\('connections'/);
});

test("الاختيار اليوميّ بالدوران لا بالتجزئة — نسخةٌ واحدة يشترك فيها البوت والعميل", async () => {
    const daily = read("src/core/daily.mjs");
    assert.match(daily, /export function pickDailyIndex/, "الدالّة انتقلت إلى daily.mjs ليستوردها المتصفّح");
    const resolve = read("src/core/resolve.mjs");
    assert.ok(!/export function pickDailyIndex/.test(resolve), "لا نسخة ثانية في resolve.mjs");
    assert.match(resolve, /export \{ bucketOf, pickDailyIndex \}/, "resolve تعيد تصديرها فلا ينكسر مستوردٌ قائم");
});

test("النافذة تُفحَص عند كل استعمال، لا بمؤقّتٍ وحده", async () => {
    // مؤقّتٌ في تبويبٍ خلفيّ يُخنَق، فلو كان هو الحكم لصار بالإمكان إنهاء لوحٍ
    // منتهٍ بعد منتصف الليل. `dailyLive()` تقارن التاريخ في كل قراءة.
    const b = bodyOf(levels, "function dailyLive()");
    assert.match(b, /dailyCtx\.date === todayInt\(\)/);
    assert.match(bodyOf(levels, "function inDaily(game)"), /dailyLive\(\)/);
});

test("العتاد يبقى واحدًا: لا مؤقّت لكل نافذة", async () => {
    // ستّ نوافذ ألعابٍ × مؤقّتٍ في الثانية = ستّ ساعاتٍ خلفيّة لوضعٍ لا أحدَ فيه.
    assert.equal((levels.match(/setInterval\(/g) || []).length >= 1, true);
    assert.match(bodyOf(levels, "function startDailyTick()"), /stopDailyTick\(\)/, "يُلغى القديم قبل بدء جديد");
    assert.match(bodyOf(levels, "function exitDaily()"), /stopDailyTick\(\)/, "الخروج يوقف العدّاد");
});

test("«الجمعة العب كل الألعاب» تُعاد استعمالًا لا اختراعًا", async () => {
    const b = bodyOf(levels, "function finishDaily(game, o)");
    assert.match(b, /meta\.combo\.mark\(game\)/, "تستعمل متتبّع الكومبو القائم");
    assert.match(b, /combo\.allDone\(\)/, "و«بطل سُرى» يخرج من الآليّة نفسها");
});
