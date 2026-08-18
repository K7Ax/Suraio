// المُشيك — البوّابة البرمجيّة التي يعبرها كل لغزٍ يوميّ قبل أن يراه بشرٌ أو Groq.
//
// كل اختبارٍ هنا يقدّم لوحًا سليمًا ولوحًا معطوبًا بعطلٍ **بعينه**، لأن بوّابةً
// تقبل كل شيء تمرّ في الاختبار كما تمرّ بوّابةٌ صحيحة. والأعطال المختارة ليست
// افتراضيّة: كلٌّ منها إمّا مخالفةٌ صريحة في دستور سُرى (حلٌّ بديل، معرفةٌ
// خارجيّة) أو عطلٌ وقع فعلًا في هذا المستودع (كلمةٌ مخترعة، تلميحٌ يحوي الجواب).
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test";
const { normalizeArabic: norm } = require("../bot.js");   // النسخة المرجعيّة
const load = () => import("../src/core/checks.mjs");

const dict = new Set(["سلام", "كبسة", "كتاب", "كلام", "كامل", "مالك", "كلمات", "هاون", "نور"]);
const base = { norm, dict };
const ok = r => assert.ok(r.ok, "رُفض لوحٌ سليم: " + r.errors.join(" · "));
const bad = (r, needle) => {
    assert.equal(r.ok, false, "قُبل لوحٌ معطوب");
    assert.ok(r.errors.some(x => x.includes(needle)),
        `العطل المرصود غير مذكور («${needle}»). الأخطاء: ${r.errors.join(" · ")}`);
};

test("لعبةٌ بلا بوّابة تُرفَض — لا تمرّ بصمت", async () => {
    const { check } = await load();
    bad(check("sudoku", {}, base), "لا بوّابة فحص");
});

test("ctx.norm إلزاميّة — لا نسخةَ احتياطيّة تنحرف", async () => {
    const { check } = await load();
    assert.throws(() => check("wordle", { word: "سلام" }, { dict }), /ctx\.norm/);
});

test("كَلِمة: المعجم والطول والتكرار", async () => {
    const { check } = await load();
    ok(check("wordle", { word: "سلام", hint: "تحية" }, { ...base, want: { len: 4 } }));
    bad(check("wordle", { word: "نابستر", hint: "شيء" }, base), "ليست في المعجم");
    bad(check("wordle", { word: "سلام", hint: "تحية" }, { ...base, want: { len: 5 } }), "الطول");
    bad(check("wordle", { word: "ككك", hint: "شيء" }, base), "يتكرّر");
});

test("كَلِمة: التلميح لا يحوي الجواب — وهو «مافادني بشي» في صورة تأليف", async () => {
    const { check } = await load();
    bad(check("wordle", { word: "سلام", hint: "يقال سلام" }, base), "يحوي الكلمة");
    bad(check("wordle", { word: "كلمات", hint: "جمع كلم وفيه كلم" }, base), "مقطعًا من الكلمة");
    bad(check("wordle", { word: "سلام", hint: "" }, base), "لا تلميح");
    bad(check("wordle", { word: "سلام", hint: "ت".repeat(61) }, base), "الحدّ ٦٠");
});

const G = (t, ws) => ({ theme: t, words: ws });
const CONN = {
    groups: [
        G("مدن", ["الرياض", "جدة", "الدمام", "أبها"]),
        G("ألوان", ["أحمر", "أزرق", "أخضر", "أصفر"]),
        G("فواكه", ["تفاح", "موز", "عنب", "رمان"]),
        G("أيام", ["أحد", "اثنين", "ثلاثاء", "أربعاء"])
    ],
    decoys: []
};

test("تشابك: أربع مجموعات، وكلمةٌ لا تنتمي لاثنتين", async () => {
    const { check } = await load();
    ok(check("connections", CONN, base));
    const three = { groups: CONN.groups.slice(0, 3) };
    bad(check("connections", three, base), "والمطلوب ٤");
    const dup = JSON.parse(JSON.stringify(CONN));
    dup.groups[3].words[0] = "تفاح";              // موجودة في «فواكه» أيضًا
    bad(check("connections", dup, base), "حلٌّ بديل");
});

test("تشابك: بوّابة التباس المموّهات — المخالفة رقم ١ في الدستور", async () => {
    const { check } = await load();
    // «برتقال» يشترك مع «تفاح» في مجموعةٍ أخرى من البنك، فيصير تجميعًا بديلًا
    // مُدافَعًا عنه لا مجرّد تشويش.
    const pool = [G("فواكه صيفية", ["تفاح", "برتقال", "خوخ", "مشمش"])];
    bad(check("connections", { ...CONN, decoys: ["برتقال"] }, { ...base, groupPool: pool }), "التباس");
    // ومموّهٌ لا يمسّ أي مجموعةٍ على اللوح يمرّ
    const far = [G("سيارات", ["نور", "مركبة", "عجلة", "محرك"])];
    ok(check("connections", { ...CONN, decoys: ["مركبة"] }, { ...base, groupPool: far }));
    // ومموّهٌ هو نفسه عضوٌ على اللوح مرفوضٌ فورًا
    bad(check("connections", { ...CONN, decoys: ["موز"] }, base), "عضوٌ في مجموعة");
});

// البنك الذي تلعبه «نحلة» فعلًا هو BEE_BANK في core/banks.mjs — و`serverMode`
// مثبَّتٌ على false (bee.js:296)، فملفّات bank/**/spelling_bee.json لا تصل
// لاعبًا أبدًا. نستورد البنك الحيّ كي يقيس الاختبار ما يراه الناس.
let LIVE_BEE = [], BEE = null;
test("تحميل البنك الحيّ", async () => {
    const { BEE_BANK } = await import("../src/core/banks.mjs");
    LIVE_BEE = BEE_BANK.map(b => ({ center: b.center, letters: [b.center, ...b.outer], words: b.words }));
    BEE = LIVE_BEE[0];
    assert.ok(BEE, "بنك «نحلة» فارغ");
});

test("نحلة: الحروف والمركز والحدّ الأدنى", async () => {
    const { check, BEE_MIN_WORDS } = await load();
    ok(check("spelling_bee", BEE, { norm }));      // بلا معجمٍ مُمرَّر
    bad(check("spelling_bee", { ...BEE, letters: BEE.letters.slice(0, 6) }, { norm }), "والمطلوب ٧");
    bad(check("spelling_bee", { ...BEE, center: "ز" }, { norm }), "ليس ضمن السبعة");
    bad(check("spelling_bee", { ...BEE, words: BEE.words.slice(0, 3) }, { norm }),
        `الحدّ الأدنى ${BEE_MIN_WORDS}`);
});

test("نحلة: البنك الحيّ كلّه معجميّ ويعبر البوّابة", async () => {
    // العتبة الأولى (١٥ كلمة) قِيست على ملفّات JSON لا تصل اللاعب، وكانت ترفض
    // ألواح اللعبة الثمانية كلّها — أي أن «نحلة» ما كانت لتُجدوَل يومًا أبدًا.
    // هذا الاختبار يربط العتبة بالبنك الحيّ فلا تنفصل عنه ثانيةً.
    const { check } = await load();
    const dictAll = new Set(require("../bank/words_ar.json").map(norm));
    LIVE_BEE.forEach((b, i) => {
        const r = check("spelling_bee", b, { norm, dict: dictAll });
        assert.ok(r.ok, `اللوح ${i} من bee.js مرفوض: ${r.errors.join(" · ")}`);
    });
});

test("نحلة: ملفّات البنك نظيفة معجميًّا بعد التنظيف", async () => {
    // أُزيلت ٤٠ سلسلةً غير-كلمة («اممم»، «لااا»، «واااو») من البنك السعوديّ.
    // لا يقرؤها اللاعب اليوم، لكنها تُبذَر في puzzle_bank عبر /seedall.
    const { check } = await load();
    const dictAll = new Set(require("../bank/words_ar.json").map(norm));
    for (const f of ["../bank/spelling_bee.json", "../bank/saudi/spelling_bee.json"]) {
        require(f).forEach((b, i) => {
            const r = check("spelling_bee", { center: b.center, letters: b.letters, words: b.words },
                { norm, dict: dictAll });
            assert.ok(r.ok, `${f}[${i}]: ${r.errors.join(" · ")}`);
        });
    }
});

test("نحلة: لا بوّابة بانجرام — لأن المعجم لا يحوي كلمةً بسبعة حروف مختلفة", async () => {
    // bee.js:46-49 يوثّق هذا ويُعطّل الشرط ذاتيًّا. لو جعلناه بوّابةً لصار كلُّ
    // لغزٍ يوميّ في النطاق الصعب غيرَ قابلٍ للجدولة، بسببِ شرطٍ تتنازل عنه
    // اللعبة نفسها. الاختبار يحرس هذا القرار كي لا يُضاف «تحسينًا».
    const { check } = await load();
    const distinct = Math.max(...BEE.words.map(w => new Set([...norm(w)]).size));
    assert.ok(distinct < 7, "ظهر بانجرام حقيقيّ في البنك — أعِد النظر في القرار");
    ok(check("spelling_bee", BEE, { norm }));
});

test("نحلة: الكلمة المخترعة تُرفَض بالمعجم — العطل الذي وقع فعلًا", async () => {
    const { check } = await load();
    // كلمةٌ تعبر كل البوّابات البنيويّة (فيها الحرف الأوسط، وحروفها كلّها على
    // اللوح، وطولها كافٍ) ولا وجود لها في العربية — وهو بالضبط ما يخترعه نموذجٌ
    // لغويّ. المعجم وحده يوقفها.
    // Built FROM the fixture's own centre rather than hard-coded: a literal
    // «كتاكت» stopped testing anything the day the bank was regenerated and the
    // centre letter changed — it then failed the «no centre letter» gate first
    // and never reached the dictionary at all.
    const invented = { ...BEE, words: BEE.words.concat(BEE.center.repeat(5)) };
    bad(check("spelling_bee", invented, { norm, dict: new Set(BEE.words.map(norm)) }), "ليست في المعجم");
});

const LB = {
    sides: [["ه", "ن", "ر"], ["ا", "ك", "ت"], ["و", "م", "ب"], ["س", "ل", "ي"]],
    solution: ["هاون"]
};

test("صندوق الحروف: لا حرفان متتاليان من ضلعٍ واحد", async () => {
    const { check } = await load();
    // «هاون»: ه(0) ا(1) و(2) ن(0) — كل انتقالٍ يعبر ضلعًا. تبقى حروفٌ غير مستعملة.
    const r = check("letterboxed", LB, { norm });
    bad(r, "لا يستعمل");
    // عطلُ الضلع الواحد نفسه:
    const same = { ...LB, solution: ["هنر"] };
    bad(check("letterboxed", same, { norm }), "من ضلعٍ واحد");
});

test("صندوق الحروف: سلسلة الكلمات وحدود اللوح", async () => {
    const { check } = await load();
    bad(check("letterboxed", { ...LB, solution: ["هاون", "كتاب"] }, { norm }), "لا تبدأ بآخر حرف");
    bad(check("letterboxed", { ...LB, solution: ["هاوز"] }, { norm }), "ليس على اللوح");
    bad(check("letterboxed", { sides: [["ا", "ب"]], solution: [] }, { norm }), "٤ جهات");
});

// شبكة ٢×٢ صغيرة يمكن التحقّق منها بالعين: «ابج» جامعة و«د» لا تكفي كلمة،
// فنستعمل كلمتين تغطّيان الأربع خانات.
const STR = {
    theme: "تجربة", spangram: "ابج", words: ["د"],
    rows: 2, cols: 2, grid: ["اب", "دج"],
    placements: { "ابج": [[0, 0], [0, 1], [1, 1]], "د": [[1, 0]] }
};

test("خيوط: التغطية والتجاور والحروف المطابقة", async () => {
    const { check } = await load();
    ok(check("strands", STR, { norm }));
    const gap = { ...STR, placements: { "ابج": [[0, 0], [0, 1], [1, 1]] } };
    bad(check("strands", gap, { norm }), "بلا موضع");
    const jump = { ...STR, rows: 3, cols: 2, grid: ["اب", "دج", "هو"],
        placements: { "ابج": [[0, 0], [0, 1], [2, 1]], "د": [[1, 0]] } };
    bad(check("strands", jump, { norm }), "قفزةٌ غير مجاورة");
    const wrong = { ...STR, grid: ["از", "دج"] };
    bad(check("strands", wrong, { norm }), "الشبكة تحمل");
});

test("خيوط: عدم عبور الجامعة يُرصَد — تحذيرًا لا رفضًا", async () => {
    const { check } = await load();
    // ٣×٣ كي يكون «لا يعبر» ممكنًا أصلًا: «ابج» تحتلّ الصفّ الأول (تعبر أفقيًّا)
    // بينما «ابد» عمودها الأوسط ناقصٌ صفًّا، فلا تلمس ضلعين متقابلين.
    const short = {
        theme: "ت", spangram: "اب", words: ["جد", "هو", "زحط"],
        rows: 3, cols: 3, grid: ["اجه", "بدو", "زحط"],
        placements: {
            "اب": [[0, 0], [1, 0]],
            "جد": [[0, 1], [1, 1]],
            "هو": [[0, 2], [1, 2]],
            "زحط": [[2, 0], [2, 1], [2, 2]]
        }
    };
    const r = check("strands", short, { norm });
    assert.ok(r.ok, "صار عدم العبور مانعًا للنشر: " + r.errors.join(" · "));
    assert.ok(r.warnings.some(w => w.includes("لا تصل بين ضلعين")),
        "عدم العبور لم يُرصَد أصلًا. التحذيرات: " + r.warnings.join(" · "));
});

test("أمثال/لمحة/قرّبها: سلامة الاختيار لا تأليف المحتوى", async () => {
    const { check } = await load();
    const bank = [{ proverb: "في الحركة بركة", meaning: "م", difficulty: 0 }];
    ok(check("amthal", bank[0], { norm, bank, band: 0 }));
    bad(check("amthal", { proverb: "مثلٌ مخترع", meaning: "م" }, { norm, bank }), "ليست في البنك");
    bad(check("amthal", bank[0], { norm, bank, band: 2 }), "ونطاق اليوم");
    bad(check("amthal", { proverb: "في الحركة بركة", meaning: "" }, { norm, bank, band: 0 }), "لا معنى");
    // العطل الذي يجعل مستوًى غير قابلٍ للفوز
    bad(check("lamha", { answer: "المطر", accepted: ["الغيث"], clues: ["أ", "ب"] }, { norm }),
        "غير قابل للفوز");
    bad(check("warmer", { target: "قهوة", accepted: ["قهوة"] }, { norm }), "لا سُلَّم حرارة");
});

// ---------------------------------------------------------------------------
// البنوك المشحونة تعبر بوّاباتها فعلًا
// ---------------------------------------------------------------------------
// كتبتُ بوّابتي «خيوط» و«صندوق الحروف» أوّل مرّة من قواعد NYT، فرفضتا ١٠٨ ألواحٍ
// مشحونة — أي أن المُشيك كان معطوبًا لا المحتوى. هذان الاختباران يمنعان تكرار
// ذلك: أي قاعدةٍ جديدة تُضاف يجب أن يعبرها ما نشحنه اليوم، أو تُصحَّح القاعدة.
test("البنوك المشحونة تعبر المُشيك", async () => {
    const { check } = await load();
    const dictAll = new Set(require("../bank/words_ar.json").map(norm));
    const run = (label, items, fn) => {
        const fails = items.map(fn).map((r, i) => r.ok ? null : `${i}: ${r.errors[0]}`).filter(Boolean);
        assert.equal(fails.length, 0, `${label}: ${fails.length} لوحًا مرفوضًا — ${fails.slice(0, 3).join(" · ")}`);
    };
    run("wordle", require("../bank/saudi/wordle.json"), it => check("wordle", it, { norm, dict: dictAll }));
    run("letterboxed", require("../bank/letterboxed.json"), b => check("letterboxed", b, { norm, dict: dictAll }));
    run("strands", require("../bank/strands.json"), b => check("strands", b, { norm }));
    for (const g of ["amthal", "lamha", "warmer"]) {
        const bank = require(`../bank/saudi/${g}.json`);
        run(g, bank, it => check(g, it, { norm, bank, band: it.difficulty }));
    }
});

test("خيوط: التغطية والعبور تحذيرٌ لا رفض — لأن المولّد يحشو عمدًا", async () => {
    // gen_strands.js:3 يملأ الخانات الباقية بحروف حشو، ولا يُلزِم الجامعة بعبور
    // اللوح. جعلُهما بوّابتين يرفض ٣٠ لوحًا من ٣٠. القرار محروسٌ هنا كي لا يُعاد.
    const { check } = await load();
    const boards = require("../bank/strands.json");
    const r = check("strands", boards[0], { norm });
    assert.ok(r.ok, "لوحٌ مشحون رُفض: " + r.errors.join(" · "));
    assert.ok(r.warnings.length > 0, "اختفى التحذير — صار النقص غير مرئيّ بدل أن يكون غير مانع");
});

test("عدم التكرار: تحذيرٌ لا رفض — لأن السبب حجم البنك لا صحّة اللوح", async () => {
    const { check, signature, REUSE_WINDOW_DAYS, CHECKABLE } = await load();
    const p = { word: "سلام", hint: "تحية" };
    const sig = signature("wordle", p, norm);
    // كان هذا خطأً مانعًا حتى قِسْتُ الدوران الحقيقيّ على سنة: يرفض معظم
    // التقويم لسببٍ لا يصلحه مُشيك. الانتقاء يفعل أقصى الممكن (يمشي على
    // البنك بالترتيب)، والقصور عن الهدف يُبلَّغ بالرقم ليعرف المالك أيّ بنكٍ
    // يكبّره. راجع REUSE_WINDOW_DAYS.
    const r = check("wordle", p, { ...base, want: { len: 4 }, recentSigs: new Set([sig]) });
    assert.equal(r.ok, true, "لوحٌ صحيحٌ سقط بسبب تكرار: " + r.errors.join(" · "));
    assert.ok(r.warnings.some(w => w.includes("تكرار")), "اختفى تحذير التكرار");
    // ونطاقٌ لا يكفي للدوران يُبلَّغ أيضًا
    const thin = check("wordle", p, { ...base, want: { len: 4 }, bucketSize: 1 });
    assert.ok(thin.warnings.some(w => w.includes("عنصر فقط")), "غاب تحذير النطاق النحيل");
    // التطبيع جزءٌ من الهويّة: «سَلام» و«سلام» لوحٌ واحد للاعب
    assert.equal(signature("wordle", { word: "سَلام" }, norm), sig);
    for (const g of CHECKABLE) {
        assert.ok(REUSE_WINDOW_DAYS[g] > 0, `${g}: بلا نافذة راحة`);
    }
});
