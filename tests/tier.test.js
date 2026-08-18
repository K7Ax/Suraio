// الطبقات — التصنيف الذي يقرّر كم يُحسَب على هذا الجهاز في كلّ إطار.
//
// كلّ اختبارٍ هنا يثبّت قرارًا اتُّخذ بحجّة، لا سلوكًا صادف أن يقع. وأهمّها
// الاختبارات التي تمنع الهبوط: قاعدةٌ تُصنّف بحماسٍ زائد تُخرج آيفون سليمًا
// إلى `minimal` فيرى المالكُ موقعَه مقلَّمًا على جهازٍ قادر — وهذا العطل أسوأ
// من ألّا نصنّف أصلًا، لأنّه صامت.
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/core/tier.mjs");

test("الصمت ليس ضعفًا — بيئةٌ فارغة تبقى full", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({}), "full");
    assert.equal(detectTier(), "full");
    assert.equal(detectTier(null), "full");
});

test("آيفون: لمسٌ بلا أيّ رقمٍ مُصرَّح ← lite لا minimal", async () => {
    const { detectTier } = await load();
    // Safari لا تُصرّح بـdeviceMemory ولا hardwareConcurrency. لو عُدّ صمتُها
    // ضعفًا لهبط كلّ آيفون — بما فيها الأقوى من هذا الحاسوب — إلى أقصى تقليم.
    assert.equal(detectTier({ coarse: true }), "lite");
});

test("أندرويد قويّ يُصرّح بأرقامه يبقى full ولو كان لمسًا", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ coarse: true, memory: 8, cores: 8, effectiveType: "4g" }), "full");
});

test("العتاد الضعيف يهبط: ذاكرةٌ ١ أو نواتان ← minimal", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ memory: 1, cores: 8 }), "minimal");
    assert.equal(detectTier({ memory: 8, cores: 2 }), "minimal");
});

test("العتاد المتوسّط ينزل درجةً واحدة: ٢ جيغا أو ٤ أنوية ← lite", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ memory: 2, cores: 8 }), "lite");
    assert.equal(detectTier({ memory: 8, cores: 4 }), "lite");
});

test("«قلّل الحركة» طلبٌ صريح ويتقدّم على قوّة العتاد", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ reduced: true, memory: 8, cores: 16 }), "minimal");
});

test("«وفّر البيانات» عن السلك لا عن المعالج ← lite فقط", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ saveData: true, memory: 8, cores: 16 }), "lite");
});

test("الشبكة: 2g ← minimal · 3g ← lite · 4g ليست إشارةَ ضعف", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ effectiveType: "slow-2g" }), "minimal");
    assert.equal(detectTier({ effectiveType: "2g" }), "minimal");
    assert.equal(detectTier({ effectiveType: "3g" }), "lite");
    // Chromium تُصنّف كلّ ما هو أسرع من 4g بأنّه 4g أيضًا، فهي سقفٌ لا وصف.
    assert.equal(detectTier({ effectiveType: "4g" }), "full");
});

test("التجاوز اليدويّ يتقدّم على كلّ شيء — وإلّا لم يكن تجاوزًا", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ override: "full", reduced: true, memory: 1, cores: 1 }), "full");
    assert.equal(detectTier({ override: "minimal", memory: 16, cores: 16 }), "minimal");
});

test("تجاوزٌ باسمٍ مجهول يُهمَل ولا يُعطّل التصنيف", async () => {
    const { detectTier } = await load();
    assert.equal(detectTier({ override: "turbo", memory: 8, cores: 8 }), "full");
    assert.equal(detectTier({ override: "turbo", memory: 1 }), "minimal");
});

test("كلّ طبقةٍ لها ميزانيّة، وهي تنقص أبدًا لا تزيد", async () => {
    const { BUDGET, TIERS, budgetFor } = await load();
    for (const t of TIERS) assert.ok(BUDGET[t], "طبقةٌ بلا ميزانيّة: " + t);
    assert.ok(BUDGET.full.segs > BUDGET.lite.segs);
    assert.ok(BUDGET.lite.segs > BUDGET.minimal.segs);
    assert.ok(BUDGET.full.dpr >= BUDGET.lite.dpr);
    assert.ok(BUDGET.lite.dpr >= BUDGET.minimal.dpr);
    // الشكّ لا يُقلّم: اسمٌ مجهولٌ يأخذ الميزانيّة الكاملة لا الأدنى.
    assert.equal(budgetFor("nope"), BUDGET.full);
    assert.equal(budgetFor(undefined), BUDGET.full);
});

test("الميزانيّة تُقلّم الحركة وحدها — لا حقلَ فيها للون أو خطٍّ أو تخطيط", async () => {
    const { BUDGET } = await load();
    // حارسُ نيّة: قرارُ المالك «الحركة تُقلَّم والفنّ يبقى». فإن أضاف أحدٌ
    // يومًا حقلًا للألوان أو الخطوط إلى الميزانيّة، يسقط هنا لا في الإنتاج.
    const allowed = new Set(["segs", "dpr", "tilt", "video"]);
    for (const t of Object.keys(BUDGET))
        for (const k of Object.keys(BUDGET[t]))
            assert.ok(allowed.has(k), `حقلٌ خارج الحركة في ميزانيّة ${t}: ${k}`);
});
