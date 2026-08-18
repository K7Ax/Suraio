// الهيرو المفصول الطبقات — الضمانات التي لو انكسرت لظهرت على الشاشة.
//
// كل اختبار هنا يثبّت خاصيّة يقابلها عطلٌ محدّد يُرى:
//   · انكشاف حافّة الشاشة عند طرفها,
//   · طبقاتٌ تقترب بالتساوي فتُقرأ تكبيرَ صورة لا اقترابَ كاميرا,
//   · وأخطرها: تغييرُ ثابتٍ في المحرّك دون إعادة بناء الأصول, فيصير الشريط
//     المرمّم تحت حرف الكثيب أقصرَ من الإزاحة التي تكشفه.
//
// يُحمَّل بـimport() الديناميكي لأن src/core/hero.mjs وحدة ESM وهذا الملف
// CommonJS — نفس ترتيب loom.test.js وpixel.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MOD = pathToFileURL(path.join(__dirname, "..", "src", "core", "hero.mjs")).href;
let H;

test("load hero.mjs", async () => { H = await import(MOD); });

test("المركز لا يزيح شيئًا، والطرفان متناظران", () => {
    for (const l of H.LAYERS) {
        assert.equal(H.depthShift(0.5, l.d), 0, `${l.name} انزاح والمؤشّر في المنتصف`);
        assert.ok(Math.abs(H.depthShift(0, l.d) + H.depthShift(1, l.d)) < 1e-12,
            `${l.name} غير متناظر بين الطرفين`);
    }
});

test("الطبقة الأعمق تزيح أكثر — وإلا فلا عمق أصلًا", () => {
    const sorted = [...H.LAYERS].sort((a, b) => a.d - b.d);
    for (let i = 1; i < sorted.length; i++) {
        assert.ok(
            Math.abs(H.depthShift(1, sorted[i].d)) > Math.abs(H.depthShift(1, sorted[i - 1].d)),
            `${sorted[i].name} لا يزيح أكثر من ${sorted[i - 1].name}`);
    }
});

test("المؤشّر خارج الشاشة لا يزيد الإزاحة عن حدّها", () => {
    for (const l of H.LAYERS) {
        const edge = Math.abs(H.depthShift(1, l.d));
        for (const n of [-3, -0.4, 1.4, 9]) {
            assert.ok(Math.abs(H.depthShift(n, l.d)) <= edge + 1e-12,
                `${l.name} تجاوز حدّه عند norm=${n}`);
        }
    }
});

test("مستحيلٌ رياضيًّا أن تنكشف حافّة", () => {
    assert.equal(H.overscanSafe(), true);
});

test("والاختبار السابق يحرس فعلًا: مدى أوسع يُسقطه", () => {
    // لو كان `overscanSafe` يعيد true دائمًا لمرّ الاختبار الذي قبله بلا معنى.
    assert.equal(H.overscanSafe(H.LAYERS, 40, H.OVERSCAN), false);
    assert.equal(H.overscanSafe(H.LAYERS, H.MAX, 1), false);
});

test("الدخول اقترابُ كاميرا لا تكبيرُ صورة", () => {
    const sky = H.entranceFrom(0.03), near = H.entranceFrom(0.65);
    assert.ok(near.scale > sky.scale, "الطبقتان تقتربان بالتساوي");
    assert.ok(Math.abs(near.y) > Math.abs(sky.y), "الطبقتان تنزلقان بالتساوي");
    // السماء تكاد لا تتحرّك — هي عند اللانهاية بصريًّا.
    assert.ok(sky.scale < 1.01 && Math.abs(sky.y) < 2);
    // ولا `opacity` في أي إطار: أحفاد .scroll-section لا تُحرَّك شفافيّتها
    // إطلاقًا (style.css:118-143 — خلل iOS Safari الموثّق).
    for (const f of [sky, near]) {
        assert.equal("opacity" in f, false, "إطار الدخول يحمل opacity");
    }
});

test("كل الطبقات تنتهي عند حالة الراحة نفسها", () => {
    // أي طبقة تنتهي عند scale ≠ 1 تترك المشهد مفكّكًا بعد الدخول.
    for (const l of H.LAYERS) {
        const f = H.entranceFrom(l.d);
        assert.ok(f.scale >= 1, `${l.name} يبدأ أصغر من حالته النهائية فينكشف ما خلفه`);
    }
});

// الاختبار الذي يربط المحرّك بالأصول. `scripts/assets/hero_layers.js` يرمّم شريطًا
// بارتفاع FILL تحت حرف الكثيب، وقد حُسب من أعمق عمق × المدى. فلو رُفع MAX أو
// عُمّق الكثيب دون إعادة بناء الطبقات، انكشف ما لم يُرمَّم — ولا شيء في الكود
// يشتكي، إنما يظهر خطٌّ فارغ على الشاشة. هذا الاختبار هو الشكوى.
test("شريط الترميم في الأصول يغطّي أقصى إزاحة يسمح بها المحرّك", () => {
    const src = fs.readFileSync(
        path.join(__dirname, "..", "scripts", "assets", "hero_layers.js"), "utf8");
    const fill = Number(/const FILL = (\d+)/.exec(src)[1]);
    const W = Number(/const W = (\d+)/.exec(src)[1]);
    assert.ok(Number.isFinite(fill) && Number.isFinite(W), "تعذّرت قراءة ثوابت البناء");

    const deepest = H.LAYERS.reduce((m, l) => Math.max(m, l.d), 0);
    const shiftPx = Math.abs(H.depthShift(1, deepest) - H.depthShift(1, 0)) / 100 * W;
    const entrancePx = Math.abs(H.entranceFrom(deepest).y);
    assert.ok(fill >= shiftPx + entrancePx,
        `FILL=${fill}px لا يكفي: الإزاحة القصوى ${shiftPx.toFixed(0)}px + الدخول ${entrancePx.toFixed(0)}px`);
});

test("ملفات الطبقات مبنيّة وبمقاسيها", async () => {
    const dir = path.join(__dirname, "..", "public", "hero");
    for (const n of H.LAYERS.map(l => l.name)) {
        for (const w of [1280, 2560]) {
            const f = path.join(dir, `${n}-${w}.webp`);
            assert.ok(fs.existsSync(f), `ناقص: ${f} — شغّل scripts/assets/hero_layers.js`);
        }
    }
    // والمسار الضعيف لا يُنسى: لوحةٌ مسطّحة واحدة بدل الطبقات.
    assert.ok(fs.existsSync(path.join(dir, "flat-1280.webp")));

    // ميزانية الوزن. الهيرو كلّه أخفّ من ربع المقطع الذي حلّ محلّه.
    const bytes = H.LAYERS.reduce(
        (n, l) => n + fs.statSync(path.join(dir, `${l.name}-2560.webp`)).size, 0);
    assert.ok(bytes <= 360 * 1024,
        `طبقات الهيرو ${(bytes / 1024).toFixed(0)}KB — تجاوزت ميزانية 360KB`);
});
