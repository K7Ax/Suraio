// «السلسلة اليوميّة» — العدد الوحيد الذي يخسره اللاعب بغيابه، فهو العدد الوحيد
// الذي يستحقّ الدفاع عنه.
//
// أخطر بندين هنا:
//   • **الفارق يُحسَب بعدّاد الأيّام لا بأرقام YYYYMMDD.** طرحُ ٢٠٢٦٠٩٠١ من
//     ٢٠٢٦٠٨٣١ يعطي ٧٠، فكل سلسلةٍ تعبر أوّل الشهر كانت ستنكسر — والخطأ يظهر
//     مرّةً كل ثلاثين يومًا، أي بعد النشر بوقتٍ طويل.
//   • **القاعدة مكتوبةٌ مرّتين** (هنا وفي دالّة submit-daily بلغةٍ أخرى) لأن
//     الاستيراد بينهما مستحيل. فآخر اختبارٍ في هذا الملف يقرأ الملفّين ويطابق
//     بنود القاعدة نصًّا — نسق `normalize_arabic` نفسه في المستودع.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");

const load = () => import("../src/core/streak.mjs");

test("يومٌ يتلو يومًا يمدّ السلسلة", async () => {
    const S = await load();
    let s = { current: 0, max: 0, lastDay: 0 };
    s = S.advanceStreak(s, 20260810);
    assert.equal(s.current, 1); assert.equal(s.extended, false); assert.equal(s.reset, false);
    s = S.advanceStreak(s, 20260811);
    assert.equal(s.current, 2); assert.equal(s.extended, true);
    s = S.advanceStreak(s, 20260812);
    assert.equal(s.current, 3); assert.equal(s.max, 3);
});

test("إنهاءٌ ثانٍ في اليوم نفسه لا يضيف شيئًا — الجمعة ستّ ألعابٍ ويومٌ واحد", async () => {
    const S = await load();
    let s = S.advanceStreak({ current: 4, max: 9, lastDay: 20260810 }, 20260811);
    assert.equal(s.current, 5);
    for (let i = 0; i < 6; i++) {
        const again = S.advanceStreak(s, 20260811);
        assert.equal(again.already, true);
        assert.equal(again.changed, false);
        assert.equal(again.current, 5, "تكرار الإنهاء رفع العدّاد");
    }
});

test("الانقطاع يُصفّر إلى واحد لا إلى صفر — لأنه لعب اليوم فعلًا", async () => {
    const S = await load();
    const s = S.advanceStreak({ current: 30, max: 30, lastDay: 20260810 }, 20260815);
    assert.equal(s.current, 1);
    assert.equal(s.reset, true);
    assert.equal(s.max, 30, "الأعلى لا ينزل أبدًا");
});

test("عبور أوّل الشهر وأوّل السنة لا يكسر شيئًا", async () => {
    const S = await load();
    // ٣١ أغسطس ← ١ سبتمبر: فارق اليوم ١، وفارق الرقم ٧٠.
    let s = S.advanceStreak({ current: 5, max: 5, lastDay: 20260831 }, 20260901);
    assert.equal(s.current, 6, "انكسرت السلسلة عند حدّ الشهر");
    // ٢٨ فبراير ← ١ مارس في سنةٍ غير كبيسة.
    s = S.advanceStreak({ current: 2, max: 2, lastDay: 20270228 }, 20270301);
    assert.equal(s.current, 3, "انكسرت عند فبراير");
    // ٣١ ديسمبر ← ١ يناير: فارق الرقم ٨٨٦٩.
    s = S.advanceStreak({ current: 9, max: 9, lastDay: 20261231 }, 20270101);
    assert.equal(s.current, 10, "انكسرت عند رأس السنة");
});

test("سنةٌ كاملةٌ متتالية تعطي ٣٦٥ بالضبط", async () => {
    const S = await load();
    const D = await import("../src/core/daily.mjs");
    let s = { current: 0, max: 0, lastDay: 0 };
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 365; i++) {
        const t = new Date(start + i * 86400000);
        s = S.advanceStreak(s, t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate());
    }
    assert.equal(s.current, 365);
    assert.equal(D.dayNumber(s.lastDay) - D.dayNumber(20260101), 364);
});

test("القراءة صادقة: سلسلةٌ فاتها يومان تُقرأ صفرًا قبل اللعب", async () => {
    const S = await load();
    assert.equal(S.streakAsOf({ current: 12, max: 12, lastDay: 20260811 }, 20260811), 12, "اليوم: قائمة");
    assert.equal(S.streakAsOf({ current: 12, max: 12, lastDay: 20260810 }, 20260811), 12, "أمس: قائمة");
    assert.equal(S.streakAsOf({ current: 12, max: 12, lastDay: 20260809 }, 20260811), 0, "قبل أمس: انقطعت");
    assert.equal(S.streakAsOf({ current: 0, max: 4, lastDay: 0 }, 20260811), 0);
    // لا نعرضها سليمةً ثم تنهار أمام عينيه عند أوّل فوز — هذا أسوأ توقيتٍ ممكن.
});

test("النسختان لا تتباعدان: العميل والدالّة الطرفيّة تقولان القاعدة نفسها", async () => {
    const root = path.join(__dirname, "..");
    const fn = fs.readFileSync(path.join(root, "supabase", "functions", "submit-daily", "index.ts"), "utf8");
    const cl = fs.readFileSync(path.join(root, "src", "core", "streak.mjs"), "utf8");

    // ١) لا تمديد إلا بفارق يومٍ واحدٍ بالضبط.
    assert.match(fn, /dayGap\(last,\s*today\)\s*===\s*1/, "الدالّة لا تشترط فارق يومٍ واحد");
    assert.match(cl, /===\s*1/, "العميل لا يشترط فارق يومٍ واحد");
    // ٢) الانقطاع يعود إلى ١ لا إلى ٠.
    assert.match(fn, /continued\s*\?\s*cur\s*\+\s*1\s*:\s*1/);
    assert.match(cl, /continued\s*\?\s*cur\s*\+\s*1\s*:\s*1/);
    // ٣) لا تكرار في اليوم نفسه.
    assert.match(fn, /last\s*===\s*today/);
    assert.match(cl, /last\s*===\s*today/);
    // ٤) الأعلى لا ينزل.
    assert.match(fn, /Math\.max\(current,\s*max\)/);
    assert.match(cl, /Math\.max\(current,\s*max\)/);
    // ٥) الفارق محسوبٌ على عدّاد الأيّام، لا على أرقام التاريخ.
    assert.match(fn, /86400000/, "الدالّة تطرح أرقام تاريخٍ لا أيّامًا");
    assert.match(cl, /dayNumber/, "العميل يطرح أرقام تاريخٍ لا أيّامًا");
});

test("التاريخ للخادم وحده، والعميل لا يكتب السلسلة أبدًا", async () => {
    const root = path.join(__dirname, "..");
    const fn = fs.readFileSync(path.join(root, "supabase", "functions", "submit-daily", "index.ts"), "utf8");
    // أرخص تزويرٍ ممكن: تقديم ساعة الجهاز يومًا. فالتاريخ يُشتقّ من ساعة الخادم
    // ولا يُقرأ من الجسم إطلاقًا.
    assert.match(fn, /riyadhToday\(Date\.now\(\)\)/);
    assert.ok(!/body\.(date|day|last_day)/.test(fn), "الدالّة تقرأ تاريخًا من العميل");
    assert.match(fn, /getUser\(\)/, "بلا جلسةٍ لا كتابة");

    const mig = fs.readFileSync(path.join(root, "supabase", "migrations", "20260730_02_daily_streaks.sql"), "utf8");
    assert.match(mig, /enable row level security/);
    assert.match(mig, /for select using \(true\)/, "قراءةٌ عامّة للوحة «أطول سلسلة» لاحقًا");
    assert.ok(!/for (insert|update|all)/i.test(mig), "أي سياسة كتابةٍ للعميل تُفقِد الرقم معناه");
    assert.match(mig, /max_streak >= current_streak/, "قيدٌ يمنع صفًّا متناقضًا");
});

test("العميل يتبنّى رقم الخادم ولا يرفع رقمه إليه", async () => {
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    assert.match(main, /adoptServerStreak/, "لا مسار تبنٍّ لرقم الخادم");
    // submitDaily ترسل اللعبة فقط. لو أرسلت العدّاد لصار المحلّيّ مصدرًا،
    // وهي القاعدة نفسها التي ستحكم محفظة التلميحات.
    const body = main.match(/JSON\.stringify\(\{ game \}\)/);
    assert.ok(body, "submitDaily ترسل أكثر من اسم اللعبة");
    assert.ok(!/submitDaily\([^)]*current/.test(main), "العميل يرسل عدّاده إلى الخادم");
});
