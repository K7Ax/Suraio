// نافذة الأربع والعشرين ساعة — «كل لغز حسب صعوبة يومه يجلس يوم فقط ٢٤ ساعة ثم
// ينتهي وينزل الجديد، والموعد ١٢:٠٠ منتصف الليل».
//
// خطر هذا الملف كلّه في كلمة «منتصف الليل»: منتصف ليل **مَن**؟ لو قرأناها منتصف
// ليل الجهاز لصار لاعبٌ في برلين يستلم لوح الغد قبل لاعبٍ في جدّة بإحدى عشرة
// ساعة، ولانقسمت لوحة الصدارة على منطقةٍ زمنيّة. فالمنتصف واحدٌ للعالم كلّه:
// ٠٠:٠٠ بتوقيت الرياض — الساعة نفسها التي يقولها `suraDailySeed()` في المتصفّح
// و`(now() at time zone 'Asia/Riyadh')::date` في SQL.
//
// وكل ما هنا يأخذ `nowMs` وسيطًا، فلا اختبارَ يقرأ الساعة الحقيقيّة ولا واحدٌ
// منها ينجح اليوم ويسقط بعد ستّة أشهر.
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/core/daily.mjs");
const HOUR = 3600000, DAY = 86400000;
// ٢٠٢٦-٠٨-١٤ الساعة ٠٠:٠٠ بتوقيت الرياض = ٢٠٢٦-٠٨-١٣ الساعة ٢١:٠٠ UTC
const AUG14_START = Date.UTC(2026, 7, 13, 21, 0, 0);

test("منتصف الليل رياضيّ لا محلّيّ: التاريخ يتحوّل عند ٢١:٠٠ UTC بالضبط", async () => {
    const D = await load();
    assert.equal(D.dateIntAt(AUG14_START - 1), 20260813, "قبل اللحظة بميلي ثانية: ما زال أمس");
    assert.equal(D.dateIntAt(AUG14_START), 20260814, "عند اللحظة نفسها: نزل الجديد");
    assert.equal(D.dateIntAt(AUG14_START + DAY - 1), 20260814, "آخر ميلي ثانية في النافذة");
    assert.equal(D.dateIntAt(AUG14_START + DAY), 20260815, "وبعدها مباشرة: الذي يليه");
});

test("النافذة ٢٤ ساعة كاملة، لا ٢٣ ولا ٢٥", async () => {
    const D = await load();
    // لا انتقالَ صيفيّ في الرياض إطلاقًا، فالفرق ثابتٌ في كل شهور السنة —
    // وهذا هو سبب اختيار التوقيت الثابت بدل مكتبة مناطق زمنيّة.
    for (let d = 0; d < 400; d++) {
        const dateInt = D.dateIntAt(AUG14_START + d * DAY);
        assert.equal(D.dayEndMs(dateInt) - D.dayStartMs(dateInt), DAY, `اليوم ${dateInt}`);
    }
});

test("dateIntAt توافق suraDailySeed حرفًا بحرف", async () => {
    const D = await load();
    // suraDailySeed() هي هذه الدالّة بالساعة الحقيقيّة. لو انحرفت إحداهما عن
    // الأخرى لصار العميل يشتقّ لوحًا ليوم والخادم يجيز لوحًا ليومٍ آخر.
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "core", "util.js"), "utf8");
    assert.match(src, /3\s*\*\s*3600000/, "suraDailySeed ما زالت على +٣ ساعات");
    assert.equal(D.RIYADH_OFFSET_MS, 3 * 3600000);
});

test("العدّاد يبلغ الصفر ولا ينزل تحته", async () => {
    const D = await load();
    assert.equal(D.msLeft(20260814, AUG14_START), DAY, "أوّل اللحظة: يومٌ كامل");
    assert.equal(D.msLeft(20260814, AUG14_START + 18 * HOUR), 6 * HOUR);
    assert.equal(D.msLeft(20260814, AUG14_START + DAY), 0, "عند الانتهاء: صفر");
    assert.equal(D.msLeft(20260814, AUG14_START + 9 * DAY), 0, "وبعد أيّام: صفرٌ لا سالب");
});

test("لا أمسِ ولا غدٍ — يومٌ واحدٌ حيّ", async () => {
    const D = await load();
    const now = AUG14_START + 5 * HOUR;
    assert.equal(D.isLive(20260814, now), true);
    assert.equal(D.isLive(20260813, now), false, "أمس انتهى — لا لحاق");
    assert.equal(D.isLive(20260815, now), false, "غدًا لم ينزل — ولا يُسرَّب");
});

test("الخطّة تتغيّر مع اليوم: لوحُ اليوم ليس لوحَ أمس", async () => {
    const D = await load();
    const LIVE = ['wordle', 'connections', 'spelling_bee', 'amthal', 'warmer', 'lamha'];
    // البذرة هي ما يبني اللوح. الأيّام المتتالية نادرًا ما تشترك في لعبة (إلّا
    // الجمعة)، فالفحص الصحيح ليس «يومًا بيوم» بل: كل ظهورٍ للعبةٍ على مدى أربعة
    // أشهر يحمل بذرةً لم تُستعمَل قطّ. لو تكرّرت بذرةٌ لصار «الجديد» نسخةً من
    // «المنتهي» — وهو نقض الوعد كلّه.
    const seen = {}; let checked = 0;
    LIVE.forEach(g => (seen[g] = new Set()));
    for (let d = 0; d < 120; d++) {
        const date = D.dateIntAt(AUG14_START + d * DAY);
        D.dailyPlan(date, LIVE).entries.forEach(e => {
            assert.equal(seen[e.game].has(e.seed), false, `«${e.game}» ${date}: بذرةٌ مكرَّرة`);
            seen[e.game].add(e.seed); checked++;
        });
    }
    assert.ok(checked > 150, `المسح فحص عيّنةً معتبرة (${checked})`);
});

test("الدالّة الطرفيّة ترفض الماضي والمستقبل معًا", async () => {
    // تُقرأ من المصدر لا تُنفَّذ (Deno)، لكنّ هذين الشرطين هما العقد كلّه:
    // ٤١٠ لنافذةٍ أُغلِقت، و٤٠٠ لنافذةٍ لم تُفتح — والثانية خاصّيّة أمان لا
    // ذوق: الشهر كلّه مجدولٌ مسبقًا، ووصفةٌ مسرَّبة لوحٌ مسرَّب.
    const fs = require("node:fs"), path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "get-daily-challenge", "index.ts"), "utf8");
    assert.match(src, /asked\s*<\s*today/, "يفرّق بين ما مضى وما لم يأتِ");
    assert.match(src, /410/, "المنتهي: 410");
    assert.match(src, /"not yet"/, "القادم: مرفوض");
    assert.match(src, /status.*published|eq\("status", "published"\)/s, "لا يُخدَم إلا المنشور");
    assert.ok(!/solution/.test(src.replace(/\/\/.*$/gm, "")), "لا يقترب من عمود الحلّ");
    assert.match(src, /no-store/, "لا يُخزَّن ردٌّ عمرُه ساعات");
});
