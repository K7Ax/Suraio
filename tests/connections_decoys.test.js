// تنوّع التمويه في «تشابك» — «لا يتكرّر اللغز، ولا مفرداتُ تمويهه».
//
// العطل الذي أنتج هذا الملفّ (بلاغ المالك، ١٢ أغسطس ٢٠٢٦): «نفس الألغاز في كل
// الألعاب، بس قاعد تتغير طريقة الحل، حتى نفس الكلمات». والمجموعات الأربع كانت
// تتبدّل فعلًا — لكن في المستويات الصعبة نصفُ اللوح تمويهٌ، وكان التمويه يسحب
// من عشرين كلمةً فقط عبر السلّم كلّه، فيرى اللاعب طويق ولؤلؤ والسدو والزل في
// كلّ لوحٍ تقريبًا. قِيس قبل الإصلاح: ٨٤ خانةَ تمويهٍ، ٢٠ كلمةً متمايزة،
// وأسوأ تكرارٍ ×٨.
//
// سببان: مسحٌ يبدأ من ترتيبٍ «سعوديٌّ أوّلًا» فلا يبلغ الأربعَ والستّين
// العامّة، و`find` تأخذ أوّل كلمةٍ في المجموعة فتُسهم كلُّ مجموعةٍ بالكلمة
// نفسها دائمًا. العلاج: خلطةٌ مستقلّة على البنك كلّه + قرعةٌ داخل المجموعة.
//
// العتبات هنا دون المقيس بعد الإصلاح (٧٥ متمايزة، أسوأ تكرارٍ ×٢) بهامشٍ
// يحتمل نموّ البنك، وفوق المقيس قبله بمسافةٍ لا يعبرها انحدارٌ خفيّ.
const test = require("node:test");
const assert = require("node:assert/strict");

const norm = s => String(s)
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();

// منحنى التمويه كما في src/games/connections.js: ٠ سهل، ٤ متوسّط، ٨ صعب.
const decoysFor = lv => (lv <= 5 ? 0 : (lv <= 14 ? 4 : 8));

// `ordinal` مُمرَّرٌ في الحملة ومحجوبٌ في «تحدي اليوم» — يُفحص المساران معًا.
async function ladder(withOrdinal = true) {
    const B = await import("../src/core/banks.mjs");
    const P = await import("../src/core/progression.mjs");
    const rows = [];
    for (let lv = 0; lv < 21; lv++) {
        rows.push(B.assembleConnections(
            P.levelSeed("connections", lv), decoysFor(lv), norm, false,
            withOrdinal ? lv : null));
    }
    return rows;
}

const groupKey = g => g.words.map(norm).sort().join("|");

test("مفردات التمويه لا تنهار إلى حفنةٍ مكرّرة عبر السلّم", async () => {
    for (const withOrdinal of [true, false]) {
        const rows = await ladder(withOrdinal);
        assertDecoyVariety(rows, withOrdinal ? "الحملة" : "تحدي اليوم");
    }
});

function assertDecoyVariety(rows, where) {
    const words = rows.flatMap(r => r.decoys.map(norm));
    const distinct = new Set(words);
    assert.ok(words.length >= 80,
        `خانات التمويه أقلّ من المتوقّع (${words.length}) — تغيّر المنحنى؟`);
    assert.ok(distinct.size >= 60,
        `[${where}] مفردات التمويه ${distinct.size} فقط من ${words.length} خانة — `
        + "المسح عاد يقرأ ربع البنك (قِيس ٢٠ قبل الإصلاح، ٧٢–٧٥ بعده)");

    const count = new Map();
    for (const w of words) count.set(w, (count.get(w) || 0) + 1);
    const worst = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    assert.ok(worst[1] <= 4,
        `[${where}] «${worst[0]}» تتكرّر ${worst[1]} مرّة — التمويه صار قالبًا ثابتًا`);
}

test("لا مرحلتان متتاليتان تتشاركان مجموعة", async () => {
    // النصف الثاني من البلاغ. البذرة وحدها كانت سحبًا بإرجاع: قِيس ثلاثةُ
    // تجاورٍ على عشرين، أسوأها ٨/٩ تتشاركان مجموعتين — نصفَ اللوح — فيقرأ
    // اللاعب «نفس الكلمات». مسحُ الدورة يجعلها صفرًا.
    const rows = await ladder();
    for (let i = 1; i < rows.length; i++) {
        const prev = new Set(rows[i - 1].groups.map(groupKey));
        const shared = rows[i].groups.filter(g => prev.has(groupKey(g)));
        assert.equal(shared.length, 0,
            `المستويان ${i - 1} و${i} يتشاركان: ${shared.map(g => g.theme).join("، ")}`);
    }
});

test("السلّم يمسح البنك بدل أن يسحب منه بإرجاع", async () => {
    const rows = await ladder();
    const count = new Map();
    for (const r of rows) for (const g of r.groups) {
        const k = groupKey(g);
        count.set(k, (count.get(k) || 0) + 1);
    }
    assert.ok(count.size >= 60,
        `${count.size} مجموعةً متمايزة فقط في ٨٤ خانة (قِيس ٥٣ قبل، ٦٢ بعد)`);
    assert.ok(Math.max(...count.values()) <= 3,
        "مجموعةٌ تتكرّر أكثر من ثلاث مرّات — انكسر مسح الدورة");
    // الهويّة السعوديّة شرطٌ على كلّ لوح، ومسحُ الدورة لا يجوز أن يأكلها.
    for (const [i, r] of rows.entries()) {
        assert.equal(r.groups.filter(g => g.saudi).length, 2,
            `المستوى ${i} خرج بغير مجموعتين سعوديّتين`);
    }
});

test("لا كلمةَ تمويهٍ تخصّ مجموعةً على اللوح نفسه", async () => {
    // تمويهٌ ينتمي إلى إحدى مجموعات اللوح ليس تمويهًا بل غموض. تُفحص
    // المجموعة كلّها لا الكلمة وحدها: تسع عشرة كلمةً في البنك تسكن مجموعتين.
    for (const r of await ladder()) {
        const on = new Set(r.groups.flatMap(g => g.words.map(norm)));
        for (const d of r.decoys) {
            assert.ok(!on.has(norm(d)),
                `«${d}» تمويهٌ وهو من مجموعةٍ على اللوح`);
        }
    }
});

test("اللوح يبقى حتميًّا: النداء مرّتين يعطي النتيجة نفسها", async () => {
    // القرعة الجديدة تجري من `rng` المبذور نفسه. لو تسرّبت Math.random إلى
    // مسار الحملة لانفرط عقد «تحدي اليوم» ولاختلف لوح اللاعبَين في اليوم نفسه.
    const a = await ladder(), b = await ladder();
    assert.deepEqual(
        a.map(r => r.decoys), b.map(r => r.decoys),
        "التمويه غير حتميّ — تسرّبت عشوائيّةٌ غير مبذورة");
});
