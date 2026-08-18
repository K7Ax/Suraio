// bot.js — the guards around /genmonth and friends.
//
// The commands themselves talk to Supabase and Telegram, so what is testable
// here is the part that decides WHETHER to write: month parsing, the past/future
// fence, and the Groq budget. Those are the rules that keep a mistyped command
// from rewriting a month players already played.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test";
const bot = require("../bot.js");

const TODAY = { y: 2026, m: 8, d: 14 };   // منتصف أغسطس ٢٠٢٦

test("الشهر الحالي والذي يليه فقط", () => {
    assert.equal(bot.parseMonth("2026-08", TODAY).label, "2026-08");
    assert.equal(bot.parseMonth("2026-09", TODAY).label, "2026-09");
    // الماضي سِجِلّ: لاعبون لعبوه وسلاسلهم معلَّقةٌ به
    assert.throws(() => bot.parseMonth("2026-07", TODAY), /الماضي/);
    assert.throws(() => bot.parseMonth("2025-12", TODAY), /الماضي/);
    // وأبعد من شهرٍ يثبّت قراراتٍ لا نملك الحكم عليها بعد
    assert.throws(() => bot.parseMonth("2026-10", TODAY), /الحالي أو الذي يليه/);
});

test("حدود السنة تُعبَر صحيحًا", () => {
    const dec = { y: 2026, m: 12, d: 3 };
    assert.equal(bot.parseMonth("2027-01", dec).label, "2027-01");
    assert.throws(() => bot.parseMonth("2027-02", dec), /الحالي أو الذي يليه/);
    assert.throws(() => bot.parseMonth("2026-11", dec), /الماضي/);
});

test("الصيغ الفاسدة تُرفَض ولا تُخمَّن", () => {
    // «» ليست فاسدة بل غائبة — انظر الاختبار التالي.
    for (const bad of ["أغسطس", "2026/08", "26-8", "2026-13", "2026-00", "2026-8-14"]) {
        assert.throws(() => bot.parseMonth(bad, TODAY), Error, `«${bad}» مرّ`);
    }
    // شهرٌ من رقمٍ واحد مقبول — كتابةٌ شائعة، وليست غموضًا
    assert.equal(bot.parseMonth("2026-9", TODAY).label, "2026-09");
});

test("عدد أيام الشهر من التقويم لا من جدول", () => {
    assert.equal(bot.parseMonth("2026-08", TODAY).days.length, 31);
    assert.equal(bot.parseMonth("2026-09", TODAY).days.length, 30);
    assert.equal(bot.parseMonth("2028-02", { y: 2028, m: 2, d: 1 }).days.length, 29, "٢٠٢٨ كبيسة");
    assert.equal(bot.parseMonth("2027-02", { y: 2027, m: 2, d: 1 }).days.length, 28);
});

test("«اليوم» بتوقيت الرياض لا بتوقيت الخادم", () => {
    const t = bot.riyadhToday();
    assert.ok(t.y >= 2026 && t.m >= 1 && t.m <= 12 && t.d >= 1 && t.d <= 31);
    // الحدّ الفاصل لليوم في كل المشروع هو Asia/Riyadh — خادمٌ بتوقيت UTC
    // يقرأ «أمس» بين منتصف الليل والثالثة صباحًا لو حُسِب محليًّا.
    const utc = new Date();
    const ksa = new Date(Date.now() + 3 * 3600 * 1000);
    assert.equal(t.d, ksa.getUTCDate());
    void utc;
});

test("ميزانية Groq مقيَّدةٌ بالبناء لا بالنيّة", () => {
    // التوليد برمجيّ بالكامل؛ Groq للحكم الدلاليّ وحده. اللعبتان دون غيرهما:
    // «تشابك» لالتباس الانتماء، و«كَلِمة» لأن تلميحها نصٌّ حرّ. الأربع الباقية
    // تنتقي من بنوكٍ روجِعت حين كُتبت — وإعادة مراجعتها شهريًّا هي عين إهدار
    // التوكنز الذي طُلب تجنّبه.
    assert.deepEqual(bot.REVIEWED_GAMES, ["connections", "wordle"]);
    assert.ok(bot.REVIEW_CAP <= 24, "سقف المراجعة ارتفع — راجع ميزانية التوكنز");
    // أسوأ حالة: كل صفوف اللعبتين في شهرٍ كامل، ولا تزال دون الميزانية.
    assert.ok(bot.REVIEW_CAP * 2 <= 60, "قد يتجاوز ٦٠ نداءً شهريًّا");
});

test("سقف الشهر موجودٌ وحقيقيّ", () => {
    // ٣١ يومًا × ٦ ألعاب = ١٨٦ بعد أن صارت كل لعبة تعمل كل يوم. أي رقمٍ أعلى
    // يعني أن الخطة أو قائمة الألعاب تغيّرت تحتنا، والإدراج على العمياء أسوأ من
    // الرفض. (كان ٥٦ حين كانت لعبةٌ واحدة تعمل يوميًّا — سقفٌ كان سيوقف كلّ
    // شهرٍ عند حادية عشره.)
    assert.equal(bot.MAX_MONTH_ROWS, 186);
});

test("الوحدة لا تشغّل البوت عند الاستيراد", () => {
    // كل ملفّ اختبارٍ يستورد bot.js. لو بدأ الاستطلاع الطويل عند require
    // لعلّقت الاختبارات إلى الأبد بدل أن تفشل.
    assert.equal(typeof bot.parseMonth, "function");
    assert.equal(typeof bot.normalizeArabic, "function");
});

// ── ما يصل فعلًا من لوحة مفاتيح عربيّة ────────────────────────────────────
// الوسائط تُكتب على جوّال، داخل فقاعة RTL، بلوحة مفاتيح عربيّة. ثلاثة أشياء
// تصل ولا يراها من كتبها: أرقامٌ عربيّة-هنديّة، علاماتُ اتجاهٍ صفريّة العرض
// يدسّها تيليقرام حول المقاطع اللاتينيّة، وشرطاتٌ طباعيّة. رفضُها يلوم
// المستخدم على شيءٍ كتبه صحيحًا.
test("الأرقام العربيّة-الهنديّة تُقبل كاللاتينيّة", () => {
    const T = { y: 2026, m: 8, d: 14 };
    assert.equal(bot.parseMonth("٢٠٢٦-٠٨", T).label, "2026-08");   // U+0660
    assert.equal(bot.parseMonth("۲۰۲۶-۰۸", T).label, "2026-08");   // U+06F0 الفارسيّة
    assert.equal(bot.parseMonth("٢٠٢٦-٩", T).label, "2026-09");
});

test("علامات الاتجاه والشرطات الطباعيّة لا تكسر التحليل", () => {
    const T = { y: 2026, m: 8, d: 14 };
    assert.equal(bot.parseMonth("‏2026-08‏", T).label, "2026-08");  // RLM
    assert.equal(bot.parseMonth("⁦ 2026-08 ⁩", T).label, "2026-08"); // isolates
    assert.equal(bot.parseMonth("2026‑08", T).label, "2026-08");          // non-breaking hyphen
    assert.equal(bot.parseMonth("2026–08", T).label, "2026-08");          // en dash
});

test("بلا وسيطٍ = الشهر الحاليّ، لا خطأ", () => {
    // البوت يعرف التاريخ. مطالبةُ المُشغِّل بإعادة كتابته عملٌ تفعله الآلة، وكان
    // أشيع أسباب فشل هذه الأوامر: نقرُ الأمر من قائمة تيليقرام يرسله بلا وسيط.
    // والافتراضيّ آمن: الماضي مرفوضٌ أصلًا، فأسوأ ما يفعله أمرٌ مجرّد أن يعمل
    // على شهرٍ جارٍ بالفعل.
    for (const empty of ["", "   ", null, undefined]) {
        assert.equal(bot.parseMonth(empty, TODAY).label, "2026-08", `«${empty}» لم تُفهم كالشهر الحاليّ`);
    }
    // وحدود الشهر تُحسب صحيحًا في الحالة الافتراضيّة كما في المكتوبة
    assert.equal(bot.parseMonth("", TODAY).days.length, 31);
    assert.equal(bot.parseMonth("", { y: 2026, m: 2, d: 9 }).days.length, 28);
    // وإن كتب شيئًا فعلًا وأخطأ، تُعاد إليه كتابته ليرى ما وصل
    assert.throws(() => bot.parseMonth("اغسطس"), /لم أفهم «اغسطس»/);
});

test("منتقي الشهر زرّان لا تقويم — الحاليّ والذي يليه", () => {
    // الماضي سِجِلّ، وأبعد من شهرٍ يثبّت قراراتٍ لا نملك الحكم عليها. فالمنتقي
    // خياران، وكلاهما لا يمكن أن يُكتب خطأً.
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "bot.js"), "utf8");
    const fn = src.match(/function monthsAllowed\(\)[\s\S]*?\n}/)[0];
    assert.match(fn, /t\.m === 12 \? \{ y: t\.y \+ 1, m: 1 \}/, "حدّ السنة غير معالَج");
    // والشاشة تحمل الشهر في كل زرّ، فلا تعمل شاشةٌ على شهرٍ غير المعروض
    const screen = src.match(/async function dailyScreen[\s\S]*?\n}/)[0];
    for (const b of ["d:sched", "d:dry", "d:gen", "d:appr", "d:pub"]) {
        assert.ok(screen.includes(`${b}:\${month}`), `الزرّ ${b} لا يحمل الشهر`);
    }
    // والعدّ على نافذةٍ شهريّة: gte وحدها كانت تعدّ صفوف الشهر القادم مع الحاليّ
    assert.match(screen, /puzzle_date=lt\.\$\{end\}/);
});

test("normArg لا يمسّ ما لا يخصّه", () => {
    // ليست مطبِّعةً عربيّة — التطبيع اللغويّ لـnormalizeArabic وحده. هذه تفكّ
    // ترميز لوحة المفاتيح فقط، فلا تلمس حرفًا عربيًّا ولا تغيّر المسافات الداخليّة.
    assert.equal(bot.normArg("2026-08 --dry"), "2026-08 --dry");
    assert.equal(bot.normArg("2026-08-14 wordle التلميح يكشف"), "2026-08-14 wordle التلميح يكشف");
    assert.equal(bot.normArg(null), "");
});

// ── ردٌّ فارغٌ من PostgREST ليس فشلًا ──────────────────────────────────────
// حين لا تحمل ترويسة Prefer صيغة `return=`، يردّ PostgREST بجسمٍ فارغ.
// و«resolution=ignore-duplicates» وحدها كافيةٌ لذلك — وهي بالضبط ما يستعمله
// /genmonth. res.json() المجرّدة تموت على «Unexpected end of JSON input»
// **بعد** أن تُكتب الصفوف: أمرٌ يبدو فاشلًا وقد نجح. أسوأ فشلٍ ممكن لكتابة.
test("جسمٌ فارغ يُقرأ [] لا استثناءً", async () => {
    const fake = body => ({ text: async () => body });
    assert.deepEqual(await bot.jsonOrEmpty(fake("")), []);
    assert.deepEqual(await bot.jsonOrEmpty(fake("   \n")), []);
    assert.deepEqual(await bot.jsonOrEmpty(fake("[]")), []);
    assert.deepEqual(await bot.jsonOrEmpty(fake('[{"id":1}]')), [{ id: 1 }]);
});

// ── القائمة: واجهة الأزرار ───────────────────────────────────────────────────
// المشكلات الثلاث التي وقعت فعلًا في أوّل جلسة كانت كلّها مشكلات تذكُّر: أمرٌ
// نُقر بلا وسيط، وأرقامٌ عربيّة-هنديّة، و«ما أسماء الألعاب الصالحة؟». الزرّ
// لا يصنع أيًّا منها. وهذه الاختبارات تحرس ما لا تراه العين في الأزرار.
const botSrc = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "bot.js"), "utf8");

test("حمولة الأزرار تحت سقف تيليقرام (٦٤ بايت)", () => {
    // تيليقرام يقصّ callback_data عند ٦٤ بايت، والعربيّة حرفان لكل حرف — فحمولةٌ
    // عربيّةٌ واحدة تكفي لكسر كل زرّ بصمت. لا تُقاس بالطول بل بالبايتات.
    const datas = [...botSrc.matchAll(/btn\(\s*(?:`[^`]*`|"[^"]*")\s*,\s*(`[^`]*`|"[^"]*")\s*\)/g)]
        .map(m => m[1].slice(1, -1))
        // القوالب تحمل ${g} و${id} — أطول لعبة وأطول معرّف
        .map(s => s.replace(/\$\{[^}]*\}/g, "connections"));
    assert.ok(datas.length >= 12, `عدد الأزرار ${datas.length} — الفحص لم يمسك شيئًا`);
    for (const d of datas) {
        assert.ok(Buffer.byteLength(d, "utf8") <= 64, `الحمولة «${d}» ${Buffer.byteLength(d, "utf8")} بايت`);
        assert.ok(!/[\u0600-\u06FF]/.test(d), `حمولةٌ عربيّة: «${d}»`);
    }
});

test("زرّ التاب يمرّ بنفس حارس الهويّة", () => {
    // الـcallback يحمل from-id الخاصّ به، فزرٌّ أُعيد توجيهه إلى شخصٍ آخر لا يصير زرَّه.
    const fn = botSrc.match(/async function onCallback[\s\S]*?\n}/)[0];
    assert.match(fn, /if \(!isAdmin\(userId\)\)/);
    assert.match(fn, /denied_cb/);
    // ويُجاب النداء دائمًا وإلّا ظلّ الزرّ يدور وكأنّه معطوب
    assert.match(fn, /await answerCb\(cb\.id\)/);
});

test("callback_query مطلوبةٌ صراحةً من getUpdates", () => {
    // بدونها لا يصل ضغطُ زرٍّ واحد، والبوت يبدو حيًّا وكل أزراره ميّتة.
    assert.match(botSrc, /allowed_updates: \["message", "callback_query"\]/);
    assert.match(botSrc, /u\.callback_query.*onCallback/s);
});

test("الساقط في الفحص لا يُعرَض له زرُّ اعتماد أصلًا", () => {
    // إتاحة الفعل الخاطئ ثم رفضه أسوأ من عدم إتاحته.
    const fn = botSrc.match(/async function pushProposals[\s\S]*?\n}/)[0];
    assert.match(fn, /r\.gate_ok\s*\n?\s*\?\s*\[\[btn\("✅ اعتمد"/);
    assert.ok(fn.split("btn(\"✅ اعتمد\"").length === 2, "زرّ الاعتماد يظهر في أكثر من فرع");
});

test("الرسالة الطويلة تُقسَّم على حدود الأسطر لا تُبتَر", async () => {
    // /schedule لشهرٍ من ٥١ صفًّا يتجاوز سقف ٤٠٩٦، وتيليقرام يرفض الرسالة كلّها —
    // فيبدو الأمر وكأنّه لم يُرجِع شيئًا. يُختبَر السلوك لا المصدر.
    const sent = [];
    const realFetch = global.fetch;
    global.fetch = async (_url, opts) => {
        sent.push(JSON.parse(opts.body).text);
        return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    };
    try {
        const NL = String.fromCharCode(10);
        const table = Array.from({ length: 400 }, (_, i) => `2026-08-${i} سطرٌ طويلٌ في جدول الشهر`).join(NL);
        assert.ok(table.length > 4096, "العيّنة أقصر من أن تختبر شيئًا");
        await bot.send(1, table);
        assert.ok(sent.length > 1, "لم تُقسَّم");
        assert.ok(sent.every(p => p.length <= 4096), "جزءٌ تجاوز السقف");
        // لا سطر يُبتَر: إعادة الوصل تعطي الأصل حرفًا بحرف
        assert.equal(sent.join(NL), table);
        // ورسالةٌ قصيرة تُرسَل مرّةً واحدة
        sent.length = 0;
        await bot.send(1, "قصيرة");
        assert.deepEqual(sent, ["قصيرة"]);
        // والفارغ لا يُرسَل نصًّا فارغًا (تيليقرام يرفضه)
        sent.length = 0;
        await bot.send(1, "");
        assert.deepEqual(sent, ["—"]);
    } finally { global.fetch = realFetch; }
});

test("كل شاشةٍ تُغلِّف نفس الدالّة التي يناديها الأمر المكتوب", () => {
    // وإلّا انحرفت الواجهتان في السلوك، وصار «جرّبها بالأمر» نصيحةً كاذبة.
    const fn = botSrc.match(/async function onCallback[\s\S]*?\n}/)[0];
    for (const f of ["authorItems", "adoptProposals", "rejectProposals",
                     "scheduleOf", "genMonth", "approveRows", "publishRows", "counts"]) {
        assert.ok(fn.includes(f), `الشاشة لا تنادي ${f}`);
    }
    // والأوامر المكتوبة كلّها باقية — لا نحذف ميزةً لأننا أضفنا أخرى
    for (const c of ["genmonth", "schedule", "approve", "publish", "author", "adopt"]) {
        assert.ok(botSrc.includes(`${c}:`), `الأمر /${c} اختفى`);
    }
});

test("زرّ التوليد الحقيقيّ موجود، ووحده يستأذن", () => {
    // القائمة كان فيها «بلا كتابة» فقط، فلم يكن للتوليد الفعليّ طريقٌ إلا الكتابة.
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "bot.js"), "utf8");
    const fn = src.match(/async function onCallback[\s\S]*?\n}/)[0];
    // d:gen يعرض تأكيدًا ولا يكتب؛ d:genx وحده يكتب
    const gen = fn.slice(fn.indexOf('rest[0] === "gen"'), fn.indexOf('rest[0] === "genx"'));
    assert.ok(!/genMonth\(/.test(gen), "زرّ التوليد يكتب قبل التأكيد");
    assert.match(fn, /rest\[0\] === "genx".*genMonth\(actor, mo, \{\}\)/s);
    // والتجربة تبقى جافّةً
    assert.match(fn, /rest\[0\] === "dry".*dry: true/s);
});

// ── متصفّح المسوّدات: قراءة الشهر من الجوّال ────────────────────────────────
// صفحة review_*.html تعرض الـ١٨٦ لوحًا كاملةً وتحتاج لابتوب، فتُفتَح مرّةً ولا
// تُفتح ثانية. الوحدة التي تسع الشاشة والانتباه معًا هي **اليوم**: ستّة ألواح،
// دون سقف تيليقرام بمسافة، وزرٌّ يعتمد ما قرأتَه للتوّ. الاعتماد على يومٍ قرأتَه
// هو الاعتماد البشريّ الذي يشترطه الدستور §٨؛ والاعتماد على شهرٍ لم تقرأه ختم.
test("boardText يعرض كل لعبةٍ يوميّة بشكلها، ولا يسقط إلى JSON", () => {
    const S = {
        wordle: { word: "قهوة", hint: "تُشرب صباحًا" },
        connections: { groups: [{ theme: "ألوان", words: ["أحمر", "أزرق", "أخضر", "أصفر"] }] },
        spelling_bee: { letters: ["ك", "ت", "ا", "ب", "ل", "م", "ر"], center: "ا", words: ["كتاب", "مالك"] },
        amthal: { proverb: "الجار قبل الدار", meaning: "اختر جارك أوّلًا" },
        lamha: { answer: "العلا", clues: ["مدينة", "نقوش"] },
        warmer: { target: "تمر", theme: "طعام", tiers: { 0: ["نخلة"], 1: ["رطب"], 2: ["عجوة"] }, hints: [] },
    };
    for (const [game, p] of Object.entries(S)) {
        const t = bot.boardText(game, p);
        assert.ok(t && !t.startsWith("{"), `${game}: سقط إلى JSON — شكلٌ غير معالَج`);
        assert.ok(!/undefined/.test(t), `${game}: «undefined» في نصّ اللوح`);
    }
    // والألعاب اليوميّة الستّ كلّها لها تسميةٌ في القائمة
    assert.deepEqual(Object.keys(bot.DAILY_LABEL).sort(), Object.keys(S).sort());
    // ونحلة ليست في GAME_LABEL: ذلك المعجم يقود قائمة /author وهي لا تُؤلَّف.
    // يُفحَص **الكائنُ نفسه** لا نصُّ الملفّ: الصيغةُ الحرفيّة تبدّلت مرّةً
    // (صارت تُشتقّ من خريطة الأسماء) فانكسر الفحصُ النصّيّ بينما الحقيقةُ التي
    // يحرسها لم تتغيّر. القيمةُ هي المقصودة، لا كيف كُتبت.
    assert.ok(!("spelling_bee" in bot.GAME_LABEL),
        "نحلة دخلت قائمة التأليف — وألواحها مُبرهَنةٌ بالبناء لا مُؤلَّفة");
    // ولا يرجع نصًّا فارغًا للوحٍ مفقود
    assert.ok(bot.boardText("wordle", null).length > 0);
});

test("اللوح يُشتقّ في المتصفّح، ولا يُقرأ من الصفّ المخزَّن", () => {
    // لو رسمناه من daily_challenge.recipe لصار عندنا راسمٌ ثالث، وثلاثة رواسم
    // تتباعد حتمًا — فتراجع شيئًا والّلاعب يرى غيره.
    const fn = botSrc.match(/async function dayScreen[\s\S]*?\n}/)[0];
    assert.match(fn, /resolveDaily/, "الشاشة لا تشتقّ اللوح بنفسها");
    assert.match(fn, /checks\.check/, "الشاشة لا تُعيد الفحص");
    assert.match(fn, /select=game_type,status,checks/, "الحالة يجب أن تأتي من قاعدة البيانات");
    // والسقف: رسالة تيليقرام تُرفَض كاملةً فوق ٤٠٩٦ حرفًا، وستّة ألواحٍ تقترب
    assert.ok(fn.includes('clip(out.join(' + String.fromCharCode(34, 92, 110, 34) + '), 3900)'),
        "لا سقف على طول الرسالة");
});

test("التنقّل يلتفّ داخل الشهر ولا يخرج منه", () => {
    const fn = botSrc.match(/async function dayScreen[\s\S]*?\n}/)[0];
    // آخر يومٍ في الشهر محسوبٌ لا مفترَض ٣١
    assert.match(fn, /Date\.UTC\(yy, mm, 0\)\)\.getUTCDate\(\)/);
    assert.match(fn, /d > 1 \? d - 1 : last/, "«السابق» من اليوم الأوّل لا يلتفّ");
    assert.match(fn, /d < last \? d \+ 1 : 1/, "«التالي» من آخر يومٍ لا يلتفّ");
    // وزرّ الاعتماد يعتمد اليوم المعروض وحده، لا الشهر
    assert.match(botSrc, /d:okd:\$\{month\}:\$\{d\}/);
    const cb = botSrc.match(/async function onCallback[\s\S]*?\n}/)[0];
    assert.match(cb, /approveRows\(iso\)/, "زرّ اليوم يعتمد شيئًا غير اليوم المعروض");
});

test("المتصفّح مدخلٌ من شاشة الشهر، ويفتح على اليوم المناسب", () => {
    const screen = botSrc.match(/async function dailyScreen[\s\S]*?\n}/)[0];
    assert.ok(screen.includes("d:day:${month}:${startDay(month)}"),
        "لا زرَّ يفتح المتصفّح من شاشة الشهر");
    // الشهر الحاليّ يفتح على اليوم، والقادم على أوّله
    const t = bot.riyadhToday();
    assert.equal(bot.startDay(`${t.y}-${String(t.m).padStart(2, "0")}`), t.d);
    assert.equal(bot.startDay("2099-01"), 1);
});

// --- المراجعة تُعرَض عليها الإجابة، لا `null` -------------------------------
//
// السبب من واقعة: `solution: null` كان يُطبع في برومبت groq-review حرفيًّا
// «الحل: null»، فرفض النموذج لوح ٢٠٢٦-٠٨-٠٢ «كَلِمة» بحجّة أن الحل ناقص —
// رفضٌ كاذب على لوحٍ سليم. والرفض الكاذب أسوأ من غياب المراجعة: يصل إلى قائمة
// «تحتاج عينك» فيستهلك الانتباه الذي وُجد /audit ليوفّره.
test("كل لعبةٍ يوميّة تُخرج إجابتها للمراجع", () => {
    const cases = {
        wordle: [{ word: "سُرى", hint: "ت" }, "سُرى"],
        amthal: [{ proverb: "من جدّ وجد", meaning: "م" }, "من جدّ وجد"],
        warmer: [{ target: "مطر" }, "مطر"],
        lamha: [{ answer: "نخلة" }, "نخلة"],
    };
    for (const [game, [puzzle, want]] of Object.entries(cases)) {
        assert.equal(bot.solutionOf(game, puzzle), want, `«${game}» لم تُخرج إجابتها`);
    }
    // والمركّبتان تُخرجان البنية كاملةً لا حقلًا واحدًا
    assert.deepEqual(bot.solutionOf("spelling_bee", { words: ["سرى"] }), ["سرى"]);
    assert.deepEqual(bot.solutionOf("connections", { groups: [1, 2] }), [1, 2]);
});

test("لا لعبةَ حيّةً تُرسَل بلا إجابة", () => {
    // الحارس الحقيقي: إضافة لعبةٍ إلى الدوران دون إضافتها إلى `solutionOf`
    // تُعيد العطل نفسه بصمت. هذا الاختبار يمنعها.
    const LIVE = ["wordle", "connections", "spelling_bee", "amthal", "warmer", "lamha"];
    const sample = {
        wordle: { word: "و" }, connections: { groups: [] }, spelling_bee: { words: [] },
        amthal: { proverb: "م" }, warmer: { target: "ت" }, lamha: { answer: "ج" },
    };
    for (const g of LIVE) {
        assert.notEqual(bot.solutionOf(g, sample[g]), null,
            `«${g}» في الدوران وليست في solutionOf — ستُرفَض كاذبًا`);
    }
});

// --- المراجع يرى ما يراه اللاعب، لا اللوح كاملًا ---------------------------
//
// أُرسل اللوح الخام أوّلًا، فناقض المراجع نفسه على الصفّ الواحد: رفضه بـ«الحل
// ناقص» حين كان `solution: null`، ثم رفض اللوح نفسه بـ«الحل مُعطى مباشرةً ولا
// يتطلب تفكيرًا» بعد إرسال الحل — لأن الكلمة كانت في اللوح أيضًا. الشكويان
// كلتاهما عن حمولتنا لا عن اللوح.
test("عرضُ اللاعب لا يحوي الجواب", () => {
    const cases = [
        ["wordle", { word: "قطارات", hint: "تسير على سكك" }],
        ["lamha", { answer: "نخلة", clues: ["أ", "ب", "ج"] }],
        ["warmer", { target: "حكمة", theme: "قيمة", hints: ["أ"], tiers: { 0: ["قوة"] } }],
        ["amthal", { proverb: "من جدّ وجد", meaning: "الاجتهاد يثمر" }],
    ];
    for (const [game, puzzle] of cases) {
        const seen = JSON.stringify(bot.playerView(game, puzzle));
        const answer = bot.solutionOf(game, puzzle);
        assert.ok(!seen.includes(answer), `«${game}»: الجواب «${answer}» ظاهرٌ في عرض اللاعب`);
    }
});

test("عرضُ اللاعب يبقى قابلًا للحكم عليه", () => {
    // إخفاءُ الجواب سهل؛ الصعب ألّا يصير العرض فارغًا فيحكم المراجع على لا شيء.
    const wv = bot.playerView("wordle", { word: "قطارات", hint: "تسير على سكك" });
    assert.equal(wv.letters, 6, "طول الكلمة هو نصف اللغز — لا يُحذَف");
    assert.ok(wv.hint, "التلميح هو المعطى الوحيد");
    const cv = bot.playerView("connections", {
        groups: [{ words: ["أ", "ب"] }, { words: ["ج"] }], decoys: ["د"],
    });
    assert.deepEqual(cv.tiles.sort(), ["أ", "ب", "ج", "د"], "البلاطات كلّها تُعرض مخلوطة");
    assert.equal(cv.groups, undefined, "التجميع هو اللغز نفسه — لا يُعطى");
});
