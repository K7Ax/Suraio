// «ضاع الطريق» — صفحة ٤٠٤. الضمانات التي لو انكسرت لظهرت على الشاشة.
//
// وأخطرها هنا **حدود الاستثناء الثالث**: هذه الصفحة وحدها في الموقع تتحرّك من
// تلقاء نفسها عند الفتح، وذلك مخالفٌ لـ§٢ في `docs/architecture/identity.md` أقرّه المالك
// بحدودٍ مكتوبة. الكتلة الأخيرة أدناه هي تلك الحدود **مقيسةً**؛ بدونها يصير
// الاستثناء إذنًا مفتوحًا يتمدّد بأوّل تعديل.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src", "core", "tallal.mjs");
const MOD = pathToFileURL(SRC).href;
const PAGE = fs.readFileSync(path.join(ROOT, "404.html"), "utf8");
// التعليقات تُنزَع قبل أي فحص: كلمةٌ ممنوعةٌ داخل شرحٍ يقول «لماذا لا نستعملها»
// كانت ستُسقط الاختبار.
const CODE = fs.readFileSync(SRC, "utf8").replace(/\/\/.*$/gm, "");
const BODY = PAGE.replace(/<!--[\s\S]*?-->/g, "");
let T;

test("load tallal.mjs", async () => { T = await import(MOD); });

// --- المرحلة ٢: سقوط «٤٠٤» ----------------------------------------------------

test("الأرقام الثلاثة تتتابع ولا تتزامن", () => {
    const d = [0, 1, 2].map(i => T.dropOf(i));
    for (let i = 1; i < 3; i++) {
        const gap = d[i].delay - d[i - 1].delay;
        // ١٢٠–١٦٠ms هو المجال الذي يُقرأ فيه التتابع تتابعًا: أقلّ منه يبدو
        // خطأً في التزامن، وأكثر منه يبدو انتظارًا.
        assert.ok(gap >= 120 && gap <= 160, `الفارق ${gap}ms خارج ١٢٠–١٦٠`);
    }
    assert.ok(d[0].delay > 0, "الرقم الأوّل يسبق دخول الخلفيّة");
});

test("السقوط ثقيلٌ لا مرح — والميل داخل ±٦°", () => {
    // ٠٫٦٥–٠٫٨٥s: أسرع يُقرأ ارتجافًا، وأبطأ يُقرأ طفوًا. والوزن كلّه هنا.
    assert.ok(T.DROP.ms >= 650 && T.DROP.ms <= 850, `زمن السقوط ${T.DROP.ms}ms`);
    for (const t of T.DROP.tilt) assert.ok(Math.abs(t) <= 6, `ميل ${t}° مبالغ`);
    // الاستقرار **نزولًا**: الرقم يضغط ما تحته ثمّ يستوي. ارتدادٌ صعودًا هو
    // بالضبط ما تمنعه §٣ («لا حركة مرحة مطّاطة»).
    assert.ok(T.DROP.settle > 0 && T.DROP.settle <= 10, "الارتداد يقفز أو يبالغ");
    assert.ok(T.DROP.from <= -120 && T.DROP.from >= -180, "مسافة السقوط خارج ١٢٠–١٨٠px");
});

test("ظلّ الارتطام يقع مع وصول آخر رقمٍ لا بعد انتهاء حركته", () => {
    const last = T.dropOf(2);
    // مفتاح الوصول في المسار هو ٠٫٦٠ من زمن السقوط.
    assert.ok(Math.abs(T.thudAt() - (last.delay + last.ms * 0.6)) < 1e-6,
        `الظلّ عند ${T.thudAt()} والوصول عند ${last.delay + last.ms * 0.6}`);
    assert.ok(T.thudAt() < T.dropEnd(), "الظلّ بعد أن استقرّ كلّ شيء");
});

// --- المراحل ٣–٥: النصّ --------------------------------------------------------

test("النصّ يتبع الأرقام ولا يسبقها، وبترتيبه", () => {
    const t = T.textAt();
    assert.ok(t.title >= T.dropEnd(), "العنوان يظهر والأرقام ما زالت تسقط");
    assert.ok(t.body > t.title && t.btn > t.body, "المراحل تتزامن أو تنقلب");
    for (const [a, b] of [["body", "title"], ["btn", "body"]])
        assert.ok(t[a] - t[b] <= 160, `فجوةٌ طويلةٌ بين ${b} و${a}`);
});

test("مراحل النصّ مشتقّةٌ من السقوط لا مكتوبةٌ بيد", () => {
    // لو كُتبت بأرقامٍ ثابتة لتراكبت مع أوّل تعديلٍ على `DROP.step`.
    const before = T.textAt().title, base = T.dropEnd();
    assert.equal(before - base, T.TEXT.afterDrop);
});

// --- parallax: النصف الثاني من §٢ ---------------------------------------------

test("الوسط = صفر إزاحة — فحالة الراحة هي اللوحة نفسها", () => {
    assert.equal(T.shift(0.5, T.PARALLAX.bg), 0);
    assert.equal(T.shift(0, 0.5), -T.shift(1, 0.5), "غير متناظرة حول الوسط");
    assert.equal(T.shift(-4, 0.5), T.shift(0, 0.5), "لا انفلات يسارًا");
    assert.equal(T.shift(9, 0.5), T.shift(1, 0.5), "لا انفلات يمينًا");
});

test("لا تنكشف حافّةٌ عند أقصى إزاحة", () => {
    assert.ok(T.overscanSafe(), "الإزاحة تتجاوز فائض التكبير");
    // وبهامشٍ لا بالكاد: رفعُ الإزاحة لاحقًا يجب أن يُسقط الاختبار قبل الشاشة.
    assert.ok(T.PARALLAX.bg * 2 <= T.PARALLAX.slack, "الفائض بالكاد يكفي");
    // والفائضُ المكتوب هنا هو نصفُ ما تعطيه CSS فعلًا (`scale: 1.03`).
    assert.match(PAGE, /scale:\s*1\.03/, "تكبير الفائض غاب عن الصفحة");
});

test("الإزاحة تحت عتبة الملاحظة — لا parallax صريح", () => {
    // الطلب كان «لا parallax واضح إلّا أن يكون خفيًّا جدًّا». نصفُ بالمئة.
    assert.ok(T.PARALLAX.bg <= 1, `إزاحة ${T.PARALLAX.bg}٪ تُرى`);
});

// --- الرباط بالأصول -----------------------------------------------------------

test("الخلفيّة مبنيّةٌ بمقاساتها الثلاثة وبطاقتها", () => {
    for (const f of ["alley-820.webp", "alley-1200.webp", "alley-1672.webp", "alley-og.webp"])
        assert.ok(fs.existsSync(path.join(ROOT, "public", "tallal", f)),
            `مفقود: ${f} — أعِد \`node scripts/assets/tallal_bg.js\``);
    // وكلّ ملفٍّ منها مذكورٌ في الصفحة: أصلٌ يُبنى ولا يُطلَب وزنٌ في النشر.
    for (const f of ["alley-820.webp", "alley-1200.webp", "alley-1672.webp"])
        assert.ok(PAGE.includes(f), `${f} مبنيّ ولا يستعمله أحد`);
});

test("العناصر التي يحرّكها المحرّك موجودةٌ في الصفحة", () => {
    for (const c of ["tallal-bg", "tallal-bg__img", "tallal-lamp", "tallal-num",
        "tallal-thud", "tallal-title", "tallal-body", "tallal-cta"])
        assert.ok(BODY.includes(`class="${c}`) || BODY.includes(` ${c}"`),
            `المحرّك يبحث عن .${c} ولا وجود له`);
    // ثلاثة أرقامٍ بالضبط: اثنان يكسران التتابع، وأربعةٌ تجعل `DROP.tilt` تنفد.
    const digits = [...BODY.matchAll(/class="tallal-digit"/g)].length;
    assert.equal(digits, 3, `عدد الأرقام ${digits}`);
    assert.equal(T.DROP.tilt.length, 3, "قائمة الميل لا تطابق عدد الأرقام");
    assert.match(PAGE, /id="tallal"/, "المحرّك لا يجد جذره");
});

test("مسارات الأصول جذريّة — الصفحة تُخدَم من أيّ عنوانٍ خاطئ", () => {
    // هذه ليست أناقة: صفحة ٤٠٤ تظهر على `/x/y/z`، ومسارٌ نسبيّ هناك يطلب
    // `/x/y/public/tallal/...` فيعود ٤٠٤ آخر — مشهدٌ فارغٌ تمامًا.
    const rel = [...PAGE.matchAll(/(?:src|href)="(?!https?:|\/|#|mailto:|data:)([^"]+)"/g)];
    assert.deepEqual(rel.map(m => m[1]), [], "مسارٌ نسبيّ في 404.html");
    for (const m of PAGE.matchAll(/(?:srcset|imagesrcset)="([^"]+)"/g))
        for (const one of m[1].split(","))
            assert.match(one.trim(), /^\//, `مسارٌ نسبيّ في srcset: ${one.trim()}`);
});

// --- ما تعِد به الصفحة نصًّا ----------------------------------------------------

test("النصّ والزرّ كما أُقرّا", () => {
    assert.ok(PAGE.includes("ضاع الطريق"), "العنوان تغيّر");
    assert.ok(PAGE.includes("يبدو أنك وصلت إلى ممر لا يقود إلى الصفحة التي تبحث عنها."),
        "سطر الشرح تغيّر");
    assert.ok(PAGE.includes("العودة إلى سُرى"), "الزرّ تغيّر");
    // «404» باللاتينيّة بقرار المالك — وحدها في موقعٍ أرقامُه هنديّة، لأنها
    // رمزُ حالةٍ لا عدد. ويُفحَص ما بعد `</style>` وحده: الأنماط مليئةٌ
    // بأرقامٍ لاتينيّة بطبيعتها.
    const copy = BODY.split("</style>").pop().replace(/<[^>]+>/g, "");
    assert.ok(copy.replace(/\s+/g, "").includes("404"), "الرقم اللاتينيّ مفقود");
    // ولا رقمَ لاتينيٍّ **آخر** يتسرّب إلى النصّ العربيّ.
    assert.ok(!/[0-9]/.test(copy.replace(/404/g, "")), "رقمٌ لاتينيٌّ آخر في نصّ الصفحة");
    assert.ok(!/[٠-٩]/.test(copy), "بقيَ رقمٌ هنديٌّ بعد التحويل إلى اللاتينيّة");
    assert.match(PAGE, /href="\/#home"/, "الزرّ لا يعود إلى سُرى");
    assert.match(PAGE, /<html[^>]*lang="ar"[^>]*dir="rtl"/, "الاتّجاه أو اللغة");
    // العنوان الدلاليّ هو الجملة لا الرقم، والرقم يُقرأ مرّةً لا ثلاثة أحرف.
    assert.match(BODY, /<h1 class="tallal-title">/, "لا عنوانَ دلاليًّا في الصفحة");
    assert.match(BODY, /role="img" aria-label="خطأ 404"/, "قارئ الشاشة يهجّي الأرقام");
    // و`direction: ltr` على الحاوية: بدونها تنقلب «404» في سياقٍ RTL.
    assert.match(PAGE, /\.tallal-num\s*\{[^}]*direction:\s*ltr/, "الأرقام بلا اتّجاهٍ صريح");
});

test("الصفحة قائمةٌ بذاتها — لا نداءَ خارجيًّا ولا اعتمادَ على حزمة الموقع", () => {
    // ٤٠٤ التي تحتاج `style.css` (٢٢٨ كيلوبايت) و`app.js` (٤٣١) لتُقرأ ليست
    // صفحة خطأ بل صفحةٌ ثانية. وأسوأ: كلاهما قد يكون هو نفسه سبب وصولك هنا.
    assert.ok(!/["'/]app\.js/.test(BODY), "404 تحمّل حزمة الموقع");
    assert.ok(!/["'/]style\.css/.test(BODY), "404 تحمّل ورقة الموقع كاملة");
    // ولا GSAP: موجودٌ في المشروع، و١١٧ كيلوبايت لصفحةٍ حزمتُها ٣.
    assert.ok(!/gsap/i.test(BODY), "GSAP في صفحة الخطأ");
    for (const m of BODY.matchAll(/<script[^>]*src="([^"]+)"/g))
        assert.ok(m[1].startsWith("/"), `سكربت خارجيّ: ${m[1]}`);
    for (const m of BODY.matchAll(/https?:\/\/([^/"']+)/g))
        assert.match(m[1], /^fonts\.(googleapis|gstatic)\.com$/, `نطاقٌ غريب: ${m[1]}`);
});

test("حزمة الصفحة تبقى صغيرة", () => {
    const js = path.join(ROOT, "tallal.js");
    if (!fs.existsSync(js)) return;   // قبل أوّل بناء
    const kb = fs.statSync(js).size / 1024;
    assert.ok(kb < 6, `tallal.js صار ${kb.toFixed(1)}ك — الاستقلال يُشترى بالصِّغَر`);
});

// --- حدود الاستثناء الثالث ----------------------------------------------------

test("سكون §٢: لا مؤقّتات، والدوران بـWAAPI وحدها", () => {
    // المؤقّتات ممنوعةٌ ولو مع الحركة الدائمة: حلقةُ `setInterval` تكتب في
    // خيط الصفحة الرئيس وتستمرّ في تبويبٍ مخفيّ، أمّا `iterations: Infinity`
    // فيديرها المتصفّح ويُخمدها وحده حين لا تُرى.
    for (const banned of ["setInterval", "setTimeout", "requestIdleCallback", "@keyframes"])
        assert.ok(!CODE.includes(banned), `${banned} في محرّك الصفحة`);
    assert.ok(!/@keyframes|animation\s*:/.test(BODY), "حركةٌ ذاتيّة في 404.html");
    // الاستجابة مربوطةٌ بالمؤشّر وحده.
    assert.match(CODE, /pointermove/);
});

// --- الحركات الدائمة الثلاث: معدودةٌ لا متكاثرة --------------------------------
//
// §٢ رُفعت لهذه الصفحة بأمر المالك، والحدّ الذي حلّ محلّ «ثمّ سكونٌ تامّ» هو
// أن تبقى الحركة الدائمة **ثلاثًا معروفةً بأسمائها**. هذه الكتلة هي ذلك الحدّ.

test("ثلاث حركاتٍ دائمة بالضبط، كلٌّ في ثابتٍ مُصدَّر", () => {
    for (const k of ["HOP", "GLOW", "DRIFT"])
        assert.equal(typeof T[k], "object", `${k} ليس ثابتًا مُصدَّرًا`);
    // كلّ دورةٍ تمرّ عبر `loop(` وحدها — أربعة نداءات: ثلاثة أرقامٍ في حلقةٍ
    // واحدة، والظلّ، والفانوس، واللوحة.
    const calls = [...CODE.matchAll(/\bloop\(/g)].length;
    assert.ok(calls <= 4, `${calls} نداءَ دورةٍ — الحركة الدائمة تتكاثر`);
    assert.ok(!/iterations/.test(CODE.split("const loop")[0]),
        "دورةٌ لا نهائيّة خارج `loop`");
});

test("المناقزة تقفز ثمّ تسكن — لا اهتزازٌ متّصل", () => {
    // أكثرُ من نصف الدورة سكونٌ تامّ (المفتاح ٠٫٥٢ يعود إلى الحياد وتنتهي
    // الدورة عنده). بدون ذلك تُقرأ صورةً متحرّكةً رخيصة لا وزنًا.
    assert.ok(T.HOP.ms >= 1200, `الدورة ${T.HOP.ms}ms — أقصر من أن تسكن`);
    assert.ok(T.HOP.rise > 0 && T.HOP.rise <= 24, `الارتفاع ${T.HOP.rise}px مبالغ`);
    assert.ok(T.HOP.squash > 0 && T.HOP.squash <= 0.08, "الانضغاط مطّاطيٌّ (§٣)");
    assert.match(CODE, /offset:\s*0\.52[\s\S]{0,90}scale\(1,1\)/,
        "الدورة لا تعود إلى الحياد قبل نهايتها");
});

test("الموجة تبدأ بعد أن يستقرّ آخر رقم، وبنفس تعاقب السقوط", () => {
    assert.equal(T.hopAt(0), T.dropEnd(), "المناقزة تبدأ والأرقام تسقط");
    for (let i = 1; i < 3; i++)
        assert.equal(T.hopAt(i) - T.hopAt(i - 1), T.HOP.step, "الموجة غير منتظمة");
    // ولا تتراكب مع ظلّ الارتطام الأوّل: ظلٌّ واحدٌ في الشاشة لا اثنان.
    assert.ok(T.hopAt(2) >= T.thudAt() + T.DROP.thudMs, "ظلّان في وقتٍ واحد");
});

test("النَّفَس والانسياق أبطأ من أن يُلاحَظا", () => {
    assert.ok(T.GLOW.ms >= 3000, `نَفَسُ الفانوس ${T.GLOW.ms}ms — وميضٌ لا اشتعال`);
    assert.ok(T.GLOW.dim >= 0.6 && T.GLOW.dim < 1, `الخفوت إلى ${T.GLOW.dim} مبالغ`);
    assert.ok(T.DRIFT.ms >= 15000, `الانسياق ${T.DRIFT.ms}ms — كاميرا تتحرّك`);
    assert.ok(T.DRIFT.to > 1 && T.DRIFT.to <= 1.03, "تكبير الانسياق يبتلع اللوحة");
    // والانسياق على الغلاف لا على الصورة: الصورة يملكها الـparallax.
    assert.ok(CODE.indexOf("DRIFT.to") > CODE.indexOf("loop(bg") - 400,
        "الانسياق انتقل إلى مالكٍ آخر");
});

test("كلّ دورةٍ تبدأ وتنتهي عند نفس الإطار — فلا يُرى قطع", () => {
    // دورةٌ تختلف أوّلُها عن آخرها تُحدث «قفزة» كلّ التفاف. تُفحص الثلاث
    // نصًّا لأن قياسها وقت التشغيل يحتاج متصفّحًا.
    for (const [open, close] of [
        [/offset:\s*0,\s*transform:\s*'translate3d\(0,0,0\) scale\(1,1\)'/, /offset:\s*1,\s*transform:\s*'translate3d\(0,0,0\) scale\(1,1\)'/],
        [/offset:\s*0,\s*opacity:\s*1\s*\}/, /offset:\s*1,\s*opacity:\s*1\s*\}/],
        [/offset:\s*0,\s*transform:\s*'translate3d\(0,0,0\) scale\(1\)'/, /offset:\s*1,\s*transform:\s*'translate3d\(0,0,0\) scale\(1\)'/],
    ]) {
        assert.match(CODE, open);
        assert.match(CODE, close);
    }
});

test("كلّ حركةٍ تتخلّى عن خاصّيّتها بعد انتهائها", () => {
    // `backwards` يملأ ما **قبل** البداية وحده، فتعود `transform` إلى الـ
    // parallax بلا تنازعٍ على المِلكيّة، وتبقى الصفحة صحيحةً لو لم يعمل
    // السكربت أصلًا. والممنوعان `forwards` و`both`.
    assert.match(CODE, /fill:\s*['"]backwards['"]/, "حركةٌ بلا ملءٍ معرَّف");
    assert.ok(!/fill:\s*['"](forwards|both)['"]/.test(CODE), "حركةٌ تحتفظ بخصائصها");
});

test("تحت «حركةٌ أقلّ» لا سقوطَ ولا مناقزةٌ ولا parallax", () => {
    const i = CODE.indexOf("prefers-reduced-motion");
    assert.ok(i > 0, "الصفحة لا تسأل عن تفضيل الحركة");
    // `playAmbient(` هنا هو الحدّ الذي لم يُرفَع: رفعُ سقف الحركة في §٢ لم
    // يمسّ من طلب حركةً أقلّ.
    for (const fn of ["playDrop(", "playAmbient(", "addEventListener('pointermove'"])
        assert.ok(CODE.lastIndexOf(fn) > i, `${fn} يعمل رغم prefers-reduced-motion`);
    // ولا ظهورٌ فوريّ تامّ: ذلك يُقرأ قفزة. تدرّجٌ واحدٌ قصير بديلًا.
    assert.ok(T.CALM.ms > 0 && T.CALM.ms <= 500, "بديل «الحركة الأقلّ» ليس قصيرًا");
    assert.deepEqual(Object.keys(T.CALM).sort(), ["ms", "step", "y"],
        "بديل «الحركة الأقلّ» اكتسب ميلًا أو تكبيرًا أو ارتدادًا");
});

test("سقف زمن الحركة ٢٤٠٠ms — وبهامش", () => {
    const total = T.revealTotal();
    assert.ok(total <= 2400, `الحركة ${total}ms > السقف المكتوب في identity.md §٢`);
    // ولا يُقاس بالكاد: كلّ مرحلةٍ داخل السقف وحدها أيضًا.
    assert.ok(T.BG.ms >= 1200 && T.BG.ms <= 1600, `دخول الخلفيّة ${T.BG.ms}ms`);
    assert.ok(total > T.dropEnd(), "شيءٌ ينتهي بعد آخر ما هو محسوب");
});

test("المحرّك لا ينهار خارج المتصفّح ولا على صفحةٍ بلا مشهد", () => {
    assert.equal(typeof T.createTallal({ querySelector: () => null }).destroy, "function");
    assert.equal(typeof T.createTallal(null).destroy, "function");
});
