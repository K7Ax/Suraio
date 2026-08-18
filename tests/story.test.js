// قصّة الهيرو — الضمانات التي لو انكسرت لظهرت على الشاشة.
//
// كل اختبار هنا يقابل عطلًا محدّدًا يُرى:
//   · طبقةٌ لا تصل إلى مكانها في نهاية المسار، فيبقى المشهد ناقصًا للأبد,
//   · مشهدٌ يُقفَز فوقه أو يتداخل مع جاره فلا يُقرأ,
//   · نوافذُ تُبهَت بدل أن تُشعَل — وهي مخالفة §٢ نصًّا,
//   · انكشاف حافّة الشاشة عند طرف الـparallax,
//   · وأخطرها: تغييرُ ثابتٍ في المحرّك دون إعادة بناء الأصول.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const MOD = pathToFileURL(path.join(ROOT, "src", "core", "story.mjs")).href;
let S;

test("load story.mjs", async () => { S = await import(MOD); });

// --- الثابت الأهمّ ----------------------------------------------------------

test("نهاية المسار = حالة الراحة تمامًا، لكلّ طبقة", () => {
    assert.ok(S.restsAtEnd(), "طبقةٌ لا تستقرّ عند cam=1");
    for (const l of S.LAYERS) {
        assert.equal(S.layerY(1, l), 0, `${l.name} لم يستقرّ رأسيًّا`);
        assert.equal(S.layerX(1, l), 0, `${l.name} لم يستقرّ أفقيًّا`);
    }
});

test("كلّ طبقة تبدأ بعيدًا فعلًا — وإلّا فلا كشفَ أصلًا", () => {
    for (const l of S.LAYERS) {
        assert.equal(S.layerY(l.in, l), l.from,
            `${l.name} لا يبدأ من موضع بدايته`);
        assert.ok(Math.abs(l.from) >= 6,
            `${l.name} مسافته ${l.from}vh — أقلّ من أن تُرى`);
    }
});

test("لا طبقةَ تتحرّك خارج نافذتها", () => {
    for (const l of S.LAYERS) {
        assert.equal(S.layerY(l.in - 0.05, l), l.from, `${l.name} تحرّك قبل نافذته`);
        assert.equal(S.layerY(l.out + 0.05, l), 0, `${l.name} تحرّك بعد نافذته`);
    }
});

test("الحركة رتيبة داخل النافذة — لا ارتداد ولا تذبذب", () => {
    for (const l of S.LAYERS) {
        let prev = Math.abs(S.layerY(0, l));
        for (let c = 0; c <= 1.0001; c += 0.01) {
            const v = Math.abs(S.layerY(c, l));
            assert.ok(v <= prev + 1e-9, `${l.name} ارتدّ عند cam=${c.toFixed(2)}`);
            prev = v;
        }
    }
});

// --- الإخراج ----------------------------------------------------------------

test("الطبقات مرتّبة من العمق إلى القرب — ترتيب الرسم هو ترتيب المشهد", () => {
    for (let i = 1; i < S.LAYERS.length; i++) {
        assert.ok(S.LAYERS[i].d >= S.LAYERS[i - 1].d,
            `${S.LAYERS[i].name} أعمق ممّا خلفه`);
    }
});

test("المسافر وكثيبُه بعمقٍ واحد — وإلّا طفا فوق أرضه", () => {
    const near = S.LAYERS.find(l => l.name === "dune-near");
    const man = S.LAYERS.find(l => l.name === "traveller");
    assert.equal(man.d, near.d, "المسافر بعمقٍ مختلف عن الكثيب الذي يقف عليه");
});

test("المسافر وحده له دخولٌ أفقي", () => {
    const withX = S.LAYERS.filter(l => l.x);
    assert.equal(withX.length, 1);
    assert.equal(withX[0].name, "traveller");
    assert.ok(S.layerX(0, withX[0]) > 0, "لا يدخل من الحافّة");
});

test("المشاهد تقسّم المدى بلا فجوة ولا تداخل", () => {
    assert.equal(S.BEATS[0].from, 0);
    assert.equal(S.BEATS[S.BEATS.length - 1].to, 1);
    for (let i = 1; i < S.BEATS.length; i++) {
        assert.equal(S.BEATS[i].from, S.BEATS[i - 1].to,
            `فجوة أو تداخل عند ${S.BEATS[i].id}`);
    }
});

test("beatOf يعطي مشهدًا صالحًا على كامل المدى، والطرفان محسومان", () => {
    assert.equal(S.beatOf(0).id, S.BEATS[0].id);
    assert.equal(S.beatOf(1).id, S.BEATS[S.BEATS.length - 1].id);
    assert.equal(S.beatOf(-5).id, S.BEATS[0].id);
    assert.equal(S.beatOf(9).id, S.BEATS[S.BEATS.length - 1].id);
    for (let c = 0; c <= 1.0001; c += 0.01) {
        assert.ok(S.beatOf(c), `لا مشهد عند ${c.toFixed(2)}`);
    }
});

test("كل مشهدٍ يبدأ بطبقةٍ جديدة تتحرّك فيه — وإلّا فهو مشهدٌ فارغ", () => {
    for (const b of S.BEATS) {
        const active = S.LAYERS.filter(l => l.in < b.to && l.out > b.from);
        assert.ok(active.length > 0, `المشهد ${b.id} لا يتحرّك فيه شيء`);
    }
});

// --- النوافذ (§٢) -----------------------------------------------------------

test("النوافذ تُشعَل بقفزاتٍ صحيحة، لا بتدرّج", () => {
    const seen = new Set();
    for (let c = 0; c <= 1.0001; c += 0.005) {
        const v = S.windowStep(c);
        assert.ok(Number.isInteger(v), `قيمة كسرية ${v} عند ${c.toFixed(3)}`);
        seen.add(v);
    }
    assert.equal(S.windowStep(0), 0, "أضواءٌ قبل مشهد البلدة");
    assert.equal(S.windowStep(1), S.WINDOW_STEPS, "الأضواء لم تكتمل");
    assert.ok(seen.size <= S.WINDOW_STEPS + 1,
        `${seen.size} حالة إضاءة — أكثر من القفزات المعلنة`);
});

test("الأضواء لا تنطفئ بالتقدّم للأمام", () => {
    let prev = 0;
    for (let c = 0; c <= 1.0001; c += 0.005) {
        const v = S.windowStep(c);
        assert.ok(v >= prev, `انطفأت أضواء عند ${c.toFixed(3)}`);
        prev = v;
    }
});

// --- parallax والحوافّ ------------------------------------------------------

test("المركز لا يزيح شيئًا، والطرفان متناظران", () => {
    for (const l of S.LAYERS) {
        assert.equal(S.depthShift(0.5, l.d), 0, `${l.name} انزاح والمؤشّر في المنتصف`);
        assert.ok(Math.abs(S.depthShift(0, l.d) + S.depthShift(1, l.d)) < 1e-12,
            `${l.name} غير متناظر`);
    }
});

test("يستحيل أن تنكشف حافّة عند الراحة", () => {
    assert.ok(S.overscanSafe(), "الفائض لا يغطّي أقصى إزاحة parallax");
});

test("الحارس يحرس فعلًا — مدًى مبالغٌ فيه يجب أن يسقط", () => {
    assert.equal(S.overscanSafe(S.LAYERS, 40, S.OVERSCAN), false,
        "overscanSafe تقبل مدًى مستحيلًا، فهي لا تفحص شيئًا");
});

// --- الربط بالأصول ----------------------------------------------------------

test("لكلّ طبقةٍ في المحرّك أصلٌ مبنيّ، والعكس", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(ROOT, "public", "story", "story.json"), "utf8"));
    const built = manifest.map(m => m.name).sort();
    const declared = S.LAYERS.map(l => l.name).sort();
    assert.deepEqual(built, declared,
        "الأصول والمحرّك لا يتّفقان على الطبقات — أعد تشغيل scripts/assets/story_assets.js");
});

test("الفائض الأفقي في الأصول يغطّي إزاحة parallax", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(ROOT, "public", "story", "story.json"), "utf8"));
    const byName = Object.fromEntries(manifest.map(m => [m.name, m]));
    for (const l of S.LAYERS) {
        const m = byName[l.name];
        // الطبقات المتفرّقة (قمر، بلدة، مسافر) لا تغطّي الإطار أصلًا ولا يُنتظر
        // منها ذلك؛ الشرط على الطبقات التي تمتدّ عبر الإطار.
        if (m.width < 0.999) continue;
        const need = Math.abs(S.depthShift(1, l.d)) / 100;
        const slack = (m.width - 1) / 2;
        assert.ok(slack + 1e-6 >= need,
            `${l.name}: فائض ${(slack * 100).toFixed(2)}% أقلّ من إزاحة ${(need * 100).toFixed(2)}%`);
    }
});

test("وزن الطقم داخل الميزانية", () => {
    const dir = path.join(ROOT, "public", "story");
    const sum = p => fs.readdirSync(dir).filter(p).reduce(
        (s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
    const full = sum(f => f.endsWith("-2560.webp") && !f.startsWith("flat"));
    const mobile = sum(f => f.endsWith("-1280.webp") && !f.startsWith("flat"));
    const flat = fs.statSync(path.join(dir, "flat-1280.webp")).size;
    assert.ok(full <= 420 * 1024, `طقم 2560 = ${(full / 1024).toFixed(0)}KB > 420KB`);
    assert.ok(mobile <= 180 * 1024, `طقم 1280 = ${(mobile / 1024).toFixed(0)}KB > 180KB`);
    assert.ok(flat <= 90 * 1024, `flat = ${(flat / 1024).toFixed(0)}KB > 90KB`);
});

// --- الإطار العمودي ---------------------------------------------------------
//
// الطقم الأفقي مركَّبٌ على نسبة 1.78 والجوّال 0.46، فوضعُ هندسته في مسرحٍ
// عمودي كان يمطّ كل طبقةٍ رأسيًّا ٣٫٨٥×. هذه الاختبارات تحرس الطقم الثاني
// وتربطه بالأوّل، لأن انحراف أحدهما عن الآخر لا يكسر شيئًا يشتكي.

const MP = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public", "story", "story.p.json"), "utf8"));

test("الطقم العمودي يحمل الطبقات الثماني نفسها", () => {
    assert.deepEqual(MP.map(m => m.name).sort(), S.LAYERS.map(l => l.name).sort(),
        "التركيبان لا يتّفقان على الطبقات — أعد تشغيل scripts/assets/story_assets.js");
});

test("index.html يحمل الهندستين كما بناهما المولّد", () => {
    // العطل الحقيقي الذي يحرسه هذا الاختبار ليس في الأرقام بل في **نسيانها**:
    // تعديل PLACE_P وإعادة تشغيل السكربت بلا لصق _markup.html في index.html
    // يترك الصفحة على هندسةٍ قديمة بلا أن يشتكي شيء — لا خطأ بناء ولا خطأ
    // وقت تشغيل، فقط طبقةٌ في غير مكانها. فتُقارَن الصفحة بالبيان مباشرةً.
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const pc = v => (v * 100).toFixed(3) + "%";
    const L = JSON.parse(
        fs.readFileSync(path.join(ROOT, "public", "story", "story.json"), "utf8"));
    for (const [manifest, k] of [[L, "l"], [MP, "p"]]) {
        for (const m of manifest) {
            for (const [prop, key] of [["left", "l"], ["top", "t"],
                                       ["width", "w"], ["height", "h"]]) {
                assert.ok(html.includes(`--${k}${key}:${pc(m[prop])}`),
                    `index.html ينقصه --${k}${key} لطبقة ${m.name} (${pc(m[prop])})`
                    + " — الصق public/story/_markup.html بعد إعادة البناء");
            }
        }
    }
    // ونسبة الإطار نفسها: هي ما يمنع المطّ، فلا تُترك بلا حارس.
    assert.ok(html.includes('--rp:0.5625'), "index.html لا يعلن نسبة الإطار العمودي");
    assert.ok(html.includes('--r:1.7778'), "index.html لا يعلن نسبة الإطار الأفقي");
});

test("الفائض الأفقي في الطقم العمودي يغطّي إزاحة parallax", () => {
    const byName = Object.fromEntries(MP.map(m => [m.name, m]));
    for (const l of S.LAYERS) {
        const m = byName[l.name];
        if (m.width < 0.999) continue;
        const need = Math.abs(S.depthShift(1, l.d)) / 100;
        const slack = (m.width - 1) / 2;
        assert.ok(slack + 1e-6 >= need,
            `${l.name}: فائض ${(slack * 100).toFixed(2)}% أقلّ من إزاحة ${(need * 100).toFixed(2)}%`);
    }
});

test("الطقم العمودي يملأ الإطار من أعلاه إلى قاعه", () => {
    // الكثيب الأمامي هو آخر ما يُرسم، فإن لم يصل قاع الإطار ظهر تدرّج الليل
    // شريطًا تحته. تُقاس القاعدة لا تُفترض.
    const near = MP.find(m => m.name === "dune-near");
    assert.ok(near.top + near.height >= 1,
        `قاع الكثيب الأمامي عند ${((near.top + near.height) * 100).toFixed(1)}% — لا يصل القاع`);
    const sky = MP.find(m => m.name === "stars");
    assert.ok(sky.top <= 0 && sky.top + sky.height >= 1, "السماء لا تغطّي الإطار");
});

test("العناصر البؤرية تنجو من قصّ الإطار العمودي", () => {
    // الإطار العمودي يغطّي الشاشة بالقصّ لا بالمطّ، فما زاد عرضُه على الشاشة
    // يُبتَر من الجانبين. أطول الأجهزة الشائعة 21:9، وعندها:
    //   عرض الإطار = 100vh × 0.5625، والمرئي = 100vw = 100vh × (9/21)
    //   المقصوص من كل جانب = (0.5625 − 0.4286) ÷ 2 ÷ 0.5625 ≈ 11.9%
    // فالقمر والمسافر — وهما وحدهما ما تنظر إليه العين مباشرةً — يجب أن يبقيا
    // خارج هذا الشريط. الكثبان والبلدة تُقصّ أطرافُها عمدًا ولا يضيرها.
    const TALLEST = 9 / 21;
    const R = 1440 / 2560;
    const crop = (R - TALLEST) / 2 / R;
    assert.ok(crop > 0.11 && crop < 0.13, `حساب القصّ انحرف: ${crop}`);
    for (const nm of ["moon", "traveller"]) {
        const m = MP.find(x => x.name === nm);
        assert.ok(m.left >= crop,
            `${nm} يبدأ عند ${(m.left * 100).toFixed(1)}% — داخل شريط القصّ ${(crop * 100).toFixed(1)}%`);
        assert.ok(m.left + m.width <= 1 - crop,
            `${nm} ينتهي عند ${((m.left + m.width) * 100).toFixed(1)}% — داخل شريط القصّ`);
    }
});

test("وزن الطقم العمودي داخل الميزانية", () => {
    const dir = path.join(ROOT, "public", "story");
    const sum = p => fs.readdirSync(dir).filter(p).reduce(
        (s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
    const full = sum(f => f.endsWith("-p1440.webp") && !f.startsWith("flat"));
    const small = sum(f => f.endsWith("-p720.webp") && !f.startsWith("flat"));
    assert.ok(full <= 260 * 1024, `طقم p1440 = ${(full / 1024).toFixed(0)}KB > 260KB`);
    assert.ok(small <= 110 * 1024, `طقم p720 = ${(small / 1024).toFixed(0)}KB > 110KB`);
});

// --- العرض التلقائي ---------------------------------------------------------

test("زمن العرض التلقائي يكفي لقراءة كل مشهد", () => {
    // أربعة مشاهد متساوية على خطٍّ خطّيّ، فنصيب المشهد = المدّة ÷ ٤. أقلّ من
    // ثانيتين لا يكفي لقراءة سطرٍ عربيّ، وأكثر من أربعٍ يصير انتظارًا.
    const per = S.AUTO.duration / S.BEATS.length;
    assert.ok(per >= 2 && per <= 4, `${per.toFixed(2)}s لكل مشهد — خارج المدى المقروء`);
    assert.ok(S.AUTO.delay >= 0 && S.AUTO.delay <= 1, "تأخير البداية خارج المعقول");
});

test("العرض التلقائي ينتهي عند حالة الراحة نفسها", () => {
    // الخطّ يقود `draw` بنفس القيمة التي يقودها بها التمرير، فالثابت واحد:
    // نهاية العرض = حالة CSS الافتراضية، ولا مشهدَ ناقصًا عند أي مقاطعة.
    assert.ok(S.restsAtEnd(), "نهاية القصّة ليست حالة الراحة");
    for (const l of S.LAYERS) {
        assert.equal(S.layerY(1, l), 0, `${l.name} لا يستقرّ`);
        assert.equal(S.layerX(1, l), 0, `${l.name} لا يستقرّ أفقيًّا`);
    }
});

// --- وصول العنوان ------------------------------------------------------------

test("«ابدأ سُراك» محجوبٌ على اللمس، وكاشفُه نقطةٌ واحدة", () => {
    // على الشاشة يفصل ٣٠٠vh من المدرج بين المطلع والعنوان، فيصل أخيرًا. وعلى
    // اللمس لا مدرج، فبلا هذا الحجب تُعرض الخاتمة قبل أن تبدأ الحكاية.
    const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const src = fs.readFileSync(path.join(ROOT, "src", "core", "story.mjs"), "utf8");

    assert.match(css, /\[data-story="playing"\][^{]*\.hero-inner-content\s*{[^}]*visibility:\s*hidden/,
        "قاعدة الحجب غائبة عن style.css");
    // `opacity` على حفيد .scroll-section يتجمّد على iOS Safari عند الرجوع من
    // مسارٍ آخر — العطل الموثّق نفسه الذي أفرغ الهيرو من قبل.
    assert.doesNotMatch(css, /\[data-story="playing"\][^{]*{[^}]*opacity:/,
        "الحجب بالشفافية — وهو ممنوعٌ على أحفاد .scroll-section");
    assert.match(html, /setAttribute\('data-story', 'playing'\)/,
        "السكربت السطري لا يضع السمة قبل أول طلاء");
    assert.match(html, /removeAttribute\('data-story'\)/,
        "لا شبكة أمان ترفع الحجب إن لم تقلع الحزمة");
    // الرفع في `rest()` وحدها: النقطة التي تُبلغ المشهدَ خاتمتَه مهما كان
    // السبب — اكتمال · مقاطعة · مغادرة · حركةٌ أقلّ.
    assert.equal((src.match(/removeAttribute\(['"]data-story['"]\)/g) || []).length, 1,
        "الرفع ليس في نقطةٍ واحدة داخل story.mjs");
});
