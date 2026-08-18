// «تحدي اليوم» — الوضع اليوميّ الذي يجاور الحملة ولا يمسّها.
//
// أخطر ما في هذا الملف هو البند الثاني: **النطاق لا يساوي ٣ أبدًا**. الطريق
// البديهيّ لتمثيل «جمعةٌ أصعب» هو إضافة BANDS[3]، وهو يكسر أربعة أشياء بصمت —
// أهمّها أن pickBankIndex يرشّح على `item.difficulty === band` وبنوك المحتوى
// تحمل ٠/١/٢ فقط، فيصير التجمّع فارغًا ويسقط إلى البنك كلّه: جمعةٌ **أسهل**
// لا أصعب. فالاختبار يحرس غياب النطاق الرابع لا وجود شيء.
//
// والبند السابع يحرس ما لا يُرى: بذرة اليوم يجب ألّا تصادف بذرة أي مستوى حملة،
// وإلّا لعب الزائر يوم الثلاثاء لوحًا يعرفه من المستوى ١٢.
const test = require("node:test");
const assert = require("node:assert/strict");

const LIVE = ['wordle', 'connections', 'spelling_bee', 'amthal', 'warmer', 'lamha'];
const load = () => import("../src/core/daily.mjs");
const loadP = () => import("../src/core/progression.mjs");

// YYYYMMDD لمسافة n يومًا بعد تاريخٍ مرجعيّ — كي نمسح ٦٠٠ يومًا بلا جدول ثابت
function dateIntAfter(startInt, offset) {
    const y = Math.floor(startInt / 10000), m = Math.floor(startInt / 100) % 100, d = startInt % 100;
    const t = new Date(Date.UTC(y, m - 1, d + offset));
    return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}
const SPAN = 600;
const START = 20260101;
const days = Array.from({ length: SPAN }, (_, i) => dateIntAfter(START, i));

test("weekdayOf يطابق التقويم الحقيقيّ", async () => {
    const { weekdayOf } = await load();
    for (const di of days) {
        const y = Math.floor(di / 10000), m = Math.floor(di / 100) % 100, d = di % 100;
        assert.equal(weekdayOf(di), new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
            `${di}: يوم الأسبوع خاطئ — كلّ توزيع الصعوبة مبنيّ عليه`);
    }
});

test("خريطة الصعوبة: أحد·اثنين سهل، ثلاثاء·أربعاء متوسط، خميس·سبت صعب، جمعة التحدي", async () => {
    const { tierFor, weekdayOf } = await load();
    const want = ['easy', 'easy', 'medium', 'medium', 'hard', 'hardest', 'hard'];
    for (const di of days) {
        assert.equal(tierFor(di).key, want[weekdayOf(di)], `${di}: درجة اليوم لا تطابق ما طلبه المالك`);
    }
});

test("النطاق لا يساوي ٣ أبدًا — ولا يخرج عن BANDS", async () => {
    const { dailyPlan } = await load();
    const { BANDS } = await loadP();
    for (const di of days) {
        const plan = dailyPlan(di, LIVE);
        assert.ok(plan.tier.band >= 0 && plan.tier.band < BANDS.length,
            `${di}: نطاقٌ خارج الجدول — pickBankIndex سيسقط إلى البنك كلّه فتصير الجمعة أسهل`);
        for (const e of plan.entries) assert.equal(e.band, plan.tier.band);
    }
});

test("كل الألعاب تعمل كل يوم — لا لعبةً واحدةً بالتناوب", async () => {
    // كان اليوم يحمل لعبةً واحدة (والجمعة كلَّها)، فمن فتح «قرّبها» يوم الثلاثاء
    // لم يجد فيها شيئًا. وضعٌ يوميّ مظلمٌ في خمس ألعابٍ من ستّ ليس وضعًا يوميًّا.
    const { dailyPlan } = await load();
    for (const di of days) {
        const plan = dailyPlan(di, LIVE);
        assert.equal(plan.games.length, LIVE.length, `${di}: ليست كل الألعاب`);
        assert.deepEqual(plan.entries.map(e => e.game).sort(), LIVE.slice().sort(),
            `${di}: قائمة المدخلات لا تطابق الألعاب الحيّة`);
        // ونطاق اليوم واحدٌ لكل ألعابه — الصعوبة خاصّةُ اليوم لا خاصّةُ اللعبة
        assert.ok(plan.entries.every(e => e.band === plan.tier.band), `${di}: نطاقٌ مختلط`);
        // و«لعبة الواجهة» تبقى واحدةً — قيد daily_challenge_one_featured يشترطها،
        // لكنها صارت تزيينًا للبطاقة لا قرارًا بمن يلعب
        assert.ok(plan.games.includes(plan.featured), `${di}: لعبة الواجهة ليست ضمن ألعاب اليوم`);
        assert.equal(plan.entries.filter(e => e.featured).length, 1, `${di}: عدد لعب الواجهة ليس واحدًا`);
    }
});

test("الجمعة أصعب لا أسهل", async () => {
    const { DAILY_TIERS, dailyBudget, dailyDecoys } = await load();
    const fri = DAILY_TIERS.hardest, thu = DAILY_TIERS.hard;
    assert.equal(fri.band, thu.band, "الجمعة يجب أن تبقى في النطاق الأصعب القائم، لا نطاقًا رابعًا");
    assert.ok(dailyBudget(10, fri) < dailyBudget(10, thu), "ميزانية الجمعة ليست أضيق");
    assert.ok(dailyDecoys(8, fri) > dailyDecoys(8, thu), "مموّهات الجمعة ليست أكثر");
    // العضّة الحقيقيّة: تلميح الأرضيّة المجّاني هو ضمانةُ ألّا يصير مستوًى جدارًا
    assert.equal(fri.freeFloorHint, false, "الجمعة ما زالت تمنح تلميح الأرضيّة المجّاني");
    for (const k of ['easy', 'medium', 'hard']) {
        assert.equal(DAILY_TIERS[k].freeFloorHint, true, `${k}: سُحب تلميح الأرضيّة من يومٍ عاديّ`);
    }
});

test("الميزانية لا تنزل تحت ثلاث محاولات", async () => {
    const { DAILY_TIERS, dailyBudget } = await load();
    for (let n = 1; n <= 20; n++) {
        assert.ok(dailyBudget(n, DAILY_TIERS.hardest) >= 3,
            `ميزانية ${n} انهارت تحت ٣ — يصير النفاد رمية عملة لا تحدّيًا`);
    }
    assert.equal(dailyBudget(0, DAILY_TIERS.hardest), 0, "لعبةٌ بلا ميزانية اكتسبت واحدة");
});

test("الخطّة حتميّة بالتاريخ وحده", async () => {
    const { dailyPlan } = await load();
    for (const di of days.slice(0, 120)) {
        assert.deepEqual(dailyPlan(di, LIVE), dailyPlan(di, LIVE), `${di}: خطّتان مختلفتان لليوم نفسه`);
    }
});

test("دوران الألعاب منتظم — لا لعبةَ تظهر أكثر من غيرها", async () => {
    const { featuredGame } = await load();
    const count = {};
    LIVE.forEach(g => { count[g] = 0; });
    for (const di of days) count[featuredGame(di, LIVE)]++;
    const vals = Object.values(count);
    // القسمة على YYYYMMDD (لا على رقم اليوم) تقفز عند كل بداية شهر فتنحاز بنحو ١٥٪
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 1,
        `الدوران منحاز: ${JSON.stringify(count)} — أُقسِم على YYYYMMDD بدل رقم اليوم؟`);
});

test("بذرة اليوم لا تصادف أي بذرة مستوى في الحملة", async () => {
    const { dailySeed } = await load();
    const { levelSeed, SALT, MAX } = await loadP();
    const campaign = new Set();
    for (const g of Object.keys(SALT)) for (let lv = 0; lv <= MAX; lv++) campaign.add(levelSeed(g, lv));
    for (const di of days) for (const g of LIVE) {
        assert.ok(!campaign.has(dailySeed(g, di)),
            `${di}/${g}: لوح اليوم يطابق لوح مستوًى في الحملة — يعرفه اللاعب سلفًا`);
    }
});

test("bandRepLevel هو سقف النطاق لا أرضيّته", async () => {
    // كان يرجع b.start، فصار «صعب» يعني المستوى ١٥ من ١٥–٢٠ — أسهل يومٍ صعبٍ
    // ممكن. اليوميّ لوحٌ واحدٌ لمن اختار أن يأتي، لا سُلَّمًا يُتسلَّق، فمكانه السقف.
    const { bandRepLevel } = await load();
    const { BANDS, bandIndex } = await loadP();
    for (let b = 0; b < BANDS.length; b++) {
        const lv = bandRepLevel(b);
        assert.equal(bandIndex(lv), b, `النطاق ${b}: المستوى الممثِّل يقع في نطاقٍ آخر`);
        assert.equal(lv, BANDS[b].start + BANDS[b].size - 1,
            `النطاق ${b}: المستوى الممثِّل ليس سقف النطاق — عادت المعايرة إلى الأرضيّة؟`);
    }
    assert.deepEqual([0, 1, 2].map(bandRepLevel), [5, 14, 20]);
});

test("قائمة ألعابٍ فارغة لا تُسقط الخطّة", async () => {
    // العميل قد يستدعي الخطّة قبل أن يُهيَّأ LIVE_GAMES؛ الصفحة لا تنكسر لذلك.
    const { dailyPlan } = await load();
    const plan = dailyPlan(20260731, []);
    assert.equal(plan.games.length, 1);
    assert.ok(plan.featured);
});

// ---------------------------------------------------------------------------
// بطاقة «عدد اليوم» في النشرة — أن تتبع الخطّة، لا نصًّا مكتوبًا بيد
// ---------------------------------------------------------------------------
// العطب الذي يحرسه هذا الاختبار ليس في المنطق بل في **الانحراف**: البطاقة تعرض
// لعبةً واحدةً بعينها، والخطّة تختار لعبةً أخرى في ستّة أيامٍ من كلّ سبعة. ولا
// يظهر ذلك في أيّ اختبار وحدةٍ لأن كلا الطرفين صحيحٌ وحده.
test("بطاقة النشرة تعرف كلّ لعبةٍ حيّة، وتُشتقّ من الخطّة", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const MAIN = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    // الوحدة خرجت من `main.js` إلى ملفّها. الملفّ **كلّه** هو الكتلة الآن، فلا
    // مطابقةَ أقواسٍ تُحصيها ولا عمقَ تعشيشٍ يُثبَّت في نمط — وكلاهما كان يكسر
    // هذا الاختبار عند أوّل إعادة تنسيق لا عند عودة العطب.
    const block = [fs.readFileSync(path.join(__dirname, "..", "src", "ui", "featuredDaily.js"), "utf8")];

    // ٠. والملفّ لا يكفي وجوده: وحدةٌ لا تُستورَد ولا تُنادى تُبقي كلّ ما تحته
    //    أخضرَ بينما البطاقة على نصّها الثابت في `index.html` — وهو العطب عينه.
    assert.match(MAIN, /import \{ initFeaturedDaily \} from '\.\/ui\/featuredDaily\.js';/,
        "الوحدة غير مستورَدة في main.js");
    assert.match(MAIN, /\n {4}initFeaturedDaily\(\);/, "الوحدة مستورَدة ولا تُنادى");

    // ١. الروّاد الستّة: أي لعبةٍ تُضاف إلى LIVE_GAMES بلا نصٍّ في البطاقة تسقط
    //    إلى نصّ «كَلِمة» — فتقول البطاقة اسمًا وتفتح لعبةً أخرى.
    for (const g of LIVE) {
        assert.match(block[0], new RegExp(`^\\s+${g}: \\{`, 'm'), `البطاقة لا تعرف «${g}»`);
    }

    // ٢. مصدر الحقيقة واحد: العنوان يأتي من الخطّة لا من index.html.
    assert.match(block[0], /L\.daily\.state\(\)/);
    assert.match(block[0], /st\.featured/);

    // ٣. الزرّ يفتح لعبة اليوم في **وضع التحدي**. لولا نقر `.lvl-daily-btn`
    //    لفتح لوح الحملة بينما الزرّ يَعِد بتحدي اليوم.
    assert.match(block[0], /lvl-daily-btn/);
    assert.match(block[0], /\$\{slug\(game\)\}-trigger-card/);

    // ٤. لوح المعاينة **هو صورة اللعبة نفسها في صفحة الألعاب** (طلب المالك:
    //    «نفس الصورة»). يُستنسَخ من بطاقة الشبكة لا يُرسَم ثانيةً هنا، وإلّا
    //    عادت صورتان لشيءٍ واحد تنحرف إحداهما عن الأخرى بصمت.
    assert.match(block[0], /#\$\{slug\(g\)\}-trigger-card \.board-container/);
    assert.match(block[0], /cloneNode\(true\)/);
    // معرّفات SVG داخل النسخة تُعاد تسميتها، وإلّا كُرّر `id` في الصفحة
    // فسحب `url(#…)` تدرّجَ البطاقة الأصليّة إلى النسخة.
    assert.match(block[0], /-nl/);
    assert.match(block[0], /url\(#/);
    // ولا يعاد الاستنساخ إلّا عند تبدّل اللعبة (paint يعمل كلّ دقيقة).
    assert.match(block[0], /if \(g === boardGame\) return;/);

    // ٥. لا يقرأ اللوح حلًّا أبدًا.
    assert.ok(!/solution|answer/i.test(block[0]), "تسرّب حلٌّ إلى بطاقة النشرة");

    // ٦. لم يبقَ زرٌّ قديمٌ يفتح «كَلِمة» في كلّ يوم — في الملفّين معًا، لا في
    //    ‏`main.js` وحده: المعالجُ لو عاد فسيعود حيث تسكن البطاقةُ الآن.
    assert.ok(!/featuredPlayWordleBtn/.test(MAIN + block[0]),
        "المعالج القديم ما زال يفتح كَلِمة دائمًا");
});

// ---------------------------------------------------------------------------
// هويّة العدد: رقمٌ واسم يومٍ ونافذة أسبوع (جدول النشرة)
// ---------------------------------------------------------------------------
test("العدد رقمٌ متّصل يبدأ من ١ في يوم الإطلاق", async () => {
    const D = await load();
    assert.equal(D.issueNumber(D.ISSUE_EPOCH), 1);
    assert.equal(D.issueNumber(20260802), 2);
    // يعبر حدّ الشهر بلا قفزة: ٣١ أغسطس ثم ١ سبتمبر عددان متتاليان.
    assert.equal(D.issueNumber(20260901) - D.issueNumber(20260831), 1);
    // ولا يهبط تحت ١ قبل الإطلاق — «العدد ٠−» ليس عددًا.
    assert.equal(D.issueNumber(20260701), 1);
});

test("اسم اليوم يطابق weekdayOf ولا ينزلق", async () => {
    const D = await load();
    for (const d of [20260801, 20260812, 20260901, 20270101]) {
        assert.equal(D.weekdayName(d), D.WEEKDAY_AR[D.weekdayOf(d)]);
    }
});

test("shiftDate يعبر حدود الشهر والسنة", async () => {
    const D = await load();
    assert.equal(D.shiftDate(20260831, 1), 20260901);
    assert.equal(D.shiftDate(20260901, -1), 20260831);
    assert.equal(D.shiftDate(20261231, 1), 20270101);
    assert.equal(D.shiftDate(20260812, 0), 20260812);
});

test("weekAround: سبعة أيّام، اليوم في الوسط، وصعوبةٌ لكلٍّ منها", async () => {
    const D = await load();
    const w = D.weekAround(20260812);
    assert.equal(w.length, 7);
    assert.equal(w[3].date, 20260812);
    assert.equal(w[3].today, true);
    assert.equal(w.filter(r => r.today).length, 1);
    assert.equal(w.filter(r => r.past).length, 3);
    // متتالية بلا فجوة، وكلّ صفٍّ يحمل صعوبته واسم يومه ورقم عدده.
    for (let i = 1; i < w.length; i++) {
        assert.equal(w[i].date, D.shiftDate(w[i - 1].date, 1));
        assert.equal(w[i].issue, w[i - 1].issue + 1);
    }
    for (const r of w) {
        assert.equal(r.tier, D.tierFor(r.date));
        assert.ok(r.tier.label && r.weekdayName);
        // النطاق لا يساوي ٣ أبدًا — نفس الحارس، على مسار الجدول هذه المرّة.
        assert.ok(r.tier.band >= 0 && r.tier.band <= 2);
    }
    // الجدول لا يحمل ولا يمكن أن يحمل لوحًا أو حلًّا.
    assert.ok(!JSON.stringify(w).includes('seed'));
});
