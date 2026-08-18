// core/authoring — the AI proposal layer.
//
// What is worth testing here is NOT «does the model write good proverbs» (no
// unit test decides that; checks.mjs and a human /adopt do). It is the part that
// runs whether the model is good or bad: what we ask, what we believe of the
// answer, and what we refuse to hand to a model at all.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
let A;
test.before(async () => { A = await import("../src/core/authoring.mjs"); });

// The same folding the rest of the app uses. Injected, never re-implemented —
// see the header of core/checks.mjs for why that rule exists.
const norm = s => String(s || "").normalize("NFC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim();

test("الألعاب الحسابيّة لا تُؤلَّف — والرفض يشرح لماذا", () => {
    // These five are correct BY CONSTRUCTION. Handing them to a model trades a
    // proof for a plausible-looking guess, which is the Round 4 bug exactly.
    for (const g of ["spelling_bee", "letterboxed", "strands", "sudoku", "pips"]) {
        assert.ok(A.NOT_AUTHORABLE[g], `${g} يجب أن يكون في قائمة المستثنى`);
        assert.throws(() => A.buildPrompt(g, { n: 3 }), /لا يُؤلَّف/);
        assert.ok(!A.AUTHORABLE_GAMES.includes(g));
    }
    assert.deepEqual(A.AUTHORABLE_GAMES.sort(),
        ["amthal", "connections", "lamha", "warmer", "wordle"]);
});

test("شكل كل لعبة مأخوذٌ من بنكها الحقيقيّ لا مكتوبًا باليد", () => {
    // A prompt that drifts from the bank shape yields proposals that parse and
    // then break at play time. So every field named in `shape` must exist in a
    // real row of the file that row is destined for.
    for (const [game, spec] of Object.entries(A.AUTHORABLE)) {
        const rows = JSON.parse(fs.readFileSync(path.join(ROOT, spec.file), "utf8"));
        assert.ok(rows.length, `${spec.file} فارغ`);
        const fields = [...spec.shape.matchAll(/"([a-z_]+)":/g)].map(m => m[1]);
        const top = new Set(Object.keys(rows[0]));
        const nested = new Set(
            Object.values(rows[0]).flatMap(v =>
                Array.isArray(v) && v[0] && typeof v[0] === "object" ? Object.keys(v[0]) : [])
        );
        for (const f of fields) {
            if (f === "id" || f === "cultural_tags") continue;   // اختياريّان في بعض الصفوف
            assert.ok(top.has(f) || nested.has(f),
                `${game}: الحقل «${f}» في البرومبت ولا وجود له في ${spec.file}`);
        }
        // And the key function must actually find something in a real row.
        assert.ok(spec.key(rows[0]), `${game}: key() لا تقرأ صفًّا حقيقيًّا`);
    }
});

test("البرومبت يحمل القاعدة الحرجة لكل لعبة", () => {
    // تشابك's #1 constitutional violation is cross-category ambiguity, and it is
    // the one thing no gate can decide. If it ever falls out of the prompt, the
    // model has no way to know it matters.
    const c = A.buildPrompt("connections", { n: 4, band: 1 });
    assert.match(c.user, /مجموعتين/);
    assert.match(c.user, /الصقر/);
    // كَلِمة's clue must not contain the word — the leak we already fixed by hand
    // in four wordle pool entries.
    assert.match(A.buildPrompt("wordle", { n: 3 }).user, /لا يذكر الكلمة/);
    // And every prompt forbids inventing words, in the system message.
    assert.match(c.system, /لا تخترع كلمة/);
});

test("العدد والنطاق محدودان مهما طُلب", () => {
    // n is a cost multiplier and band indexes three-element arrays everywhere in
    // the app; neither may be whatever arrived from a chat message.
    assert.equal(A.buildPrompt("amthal", { n: 999 }).n, 12);
    assert.equal(A.buildPrompt("amthal", { n: 0 }).n, 5);
    assert.equal(A.buildPrompt("amthal", { n: -3 }).n, 5);
    assert.equal(A.buildPrompt("amthal", { band: 7 }).band, 2);
    assert.equal(A.buildPrompt("amthal", { band: -1 }).band, 0);
});

test("التحليل ينجو من ردٍّ مغلّفٍ بنثر ولا يرمي أبدًا", () => {
    const good = '{"items":[{"proverb":"في الحركة بركة","meaning":"العمل يجلب الرزق"}]}';
    assert.equal(A.parseProposals("amthal", good).items.length, 1);
    // نموذجٌ يلفّ JSON بنصّ أو بسياج — محاولة إنقاذٍ واحدة، لا أكثر
    assert.equal(A.parseProposals("amthal", "تفضّل:\n```json\n" + good + "\n```").items.length, 1);
    // وردودٌ لا تُنقَذ: خطأٌ مُبلَّغ، لا استثناء
    for (const bad of ["", "لا شيء", "{", "[1,2,3]", '{"x":1}', null, 42]) {
        const r = A.parseProposals("amthal", bad);
        assert.ok(Array.isArray(r.items), `${JSON.stringify(bad)} كسر التحليل`);
    }
});

test("دفعةٌ نصفها سليم تُنتج نصفها السليم", () => {
    // A model returning one bad item must not cost us the other four. Everything
    // dropped is reported, so a recurring failure shows as a pattern.
    const raw = JSON.stringify({
        items: [
            { proverb: "في الحركة بركة", meaning: "أ" },
            { meaning: "بلا مثل" },                        // ناقص الحقل الأساسيّ
            "نصّ",                                          // ليس كائنًا
            { proverb: "في الحركة بركة", meaning: "مكرّر" },  // مكرّرٌ داخل الدفعة
            { proverb: "الجار قبل الدار", meaning: "ب" }
        ]
    });
    const r = A.parseProposals("amthal", raw, { band: 1 });
    assert.equal(r.items.length, 2);
    assert.equal(r.errors.length, 3);
    assert.match(r.errors.join(" "), /مكرّر/);
    // النطاق المطلوب هو الحُكم — لا ما يعلنه النموذج عن نفسه
    assert.ok(r.items.every(i => i.difficulty === 1));
});

test("التكرار يُقاس على الصيغة المطبَّعة لا على النصّ الخام", () => {
    // «القهوة» يجب ألّا تمرّ بينما «قهوة» في البنك، وإلّا صار البنك أكبر ولم
    // تصر الدورة أغنى — وهو الغرض كلّه.
    const existing = [{ target: "قهوة" }, { target: "المطر" }];
    const items = [{ target: "القهوة" }, { target: "مطر" }, { target: "نخلة" }];
    const { fresh, dropped } = A.dedupeAgainst("warmer", items, existing, norm);
    assert.deepEqual(fresh.map(f => f.target), ["نخلة"]);
    assert.equal(dropped.length, 2);
});

test("النطاق الجائع يُرتَّب أوّلًا — على بنكٍ حقيقيّ", () => {
    // التأليف في دلوٍ فيه ٣٠ عنصرًا بينما جاره فيه ٨ لا يحسّن الدورة إطلاقًا.
    const lamha = JSON.parse(fs.readFileSync(path.join(ROOT, "bank/saudi/lamha.json"), "utf8"));
    const needs = A.bandNeeds(lamha, 20);
    assert.equal(needs.length, 3);
    assert.ok(needs[0].need >= needs[2].need);
    assert.equal(needs.reduce((s, n) => s + n.have, 0), lamha.length);
    // والدلاء الثلاثة كلّها دون العشرين اليوم — وهي المشكلة التي بُني لها هذا الملف
    assert.ok(needs.every(n => n.need > 0));
});

test("BM25: صفٌّ قصيرٌ في الصميم يغلب وثيقةً طويلةً تذكر الكلمة عرضًا", () => {
    // This is the whole reason BM25 rather than raw TF-IDF: length normalisation.
    const docs = [
        { id: "short", text: "القهوة السعودية تُقدَّم في الدلّة مع التمر" },
        { id: "long", text: ("نصٌّ طويلٌ عن أشياء كثيرة ".repeat(40)) + " القهوة " + ("وكلامٌ آخر ".repeat(40)) }
    ];
    const idx = A.buildIndex(docs, norm);
    const hits = A.retrieve(idx, "القهوة والدلّة", 2, norm);
    assert.equal(hits[0].doc.id, "short");
    // وكل الدرجات موجبة — idf سالبة كانت ستدفع الأوثق إلى الأسفل
    assert.ok(hits.every(h => h.score > 0));
});

test("الاسترجاع يطوي أل التعريف — وإلّا فقد نصف المطابقات", () => {
    const idx = A.buildIndex([{ id: "a", text: "قهوة وتمر" }], norm);
    assert.equal(A.retrieve(idx, "القهوة", 3, norm).length, 1);
    assert.equal(A.retrieve(idx, "قهوة", 3, norm).length, 1);
    // ولا يطوي «ال» من كلمةٍ قصيرةٍ تصير حرفين («الف» ليست «ف»)
    assert.ok(A.tokenize("الف", norm).includes("الف"));
});

test("الاسترجاع حتميّ وآمنٌ على الفارغ", () => {
    // Determinism is a real property here: the same question must retrieve the
    // same context, so a bad proposal is reproducible instead of a one-off.
    const docs = [{ id: "a", text: "المطر والوادي" }, { id: "b", text: "المطر" }];
    const idx = A.buildIndex(docs, norm);
    const once = A.retrieve(idx, "المطر", 5, norm).map(h => h.doc.id + ":" + h.score.toFixed(6));
    const twice = A.retrieve(idx, "المطر", 5, norm).map(h => h.doc.id + ":" + h.score.toFixed(6));
    assert.deepEqual(once, twice);
    assert.deepEqual(A.retrieve(A.buildIndex([], norm), "أي شيء", 3, norm), []);
    assert.deepEqual(A.retrieve(idx, "كلمةٌ غائبةٌ تمامًا", 3, norm), []);
});

test("قائمة «لا تكرّره» تصل إلى البرومبت فعلًا", () => {
    // The instruction most often dropped as a prompt grows is the last one, so
    // its presence is asserted rather than assumed.
    const p = A.buildPrompt("amthal", {
        n: 3, band: 0,
        avoid: ["في الحركة بركة", "الجار قبل الدار"],
        fewShot: [{ proverb: "مثل", meaning: "شرح" }],
        retrieved: [{ doc: { id: "docs/architecture/identity.md", text: "الهويّة" }, score: 1 }]
    });
    assert.match(p.user, /في الحركة بركة/);
    assert.match(p.user, /docs\/architecture\/identity\.md/);
    assert.match(p.user, /أمثلةٌ معتمدة/);
});

// ── الدالّة والجدول: تأكيداتٌ على المصدر ─────────────────────────────────────
// لا يمكن نشر Edge Function من اختبار، لكن الخصائص التي تهمّ هنا نصّيّةٌ في
// المصدر: أي بابٍ يدخل منه النداء، وماذا يحدث حين لا يُضبط شيء.
test("groq-author يفشل مُغلقًا ولا يملك مسار جلسة", () => {
    const src = fs.readFileSync(path.join(ROOT, "supabase/functions/groq-author/index.ts"), "utf8");
    // بابٌ واحد فقط: السرّ. ولا أثر لمسار البريد/الجلسة الذي في groq-review.
    // (`await` هنا لأن المقارنة صارت تجزئةً غير متزامنة — انظر A13 أدناه.)
    assert.match(src, /if \(!await secretOk\(req\)\) return json\(\{ error: "not authorized" \}, 403\)/);
    assert.ok(!/emailFromJwt/.test(src), "لا يجوز أن يكون للتأليف مسار جلسة مستخدم");
});

// A13 — المقارنة انتقلت إلى _shared/guard.ts، فانتقل الاختبار معها. وهو الآن
// يختبر **الخاصّية** لا نصّ السطر: كان الاختبار السابق يثبّت الشيفرة حرفيًّا،
// فمرّ على النسخة المعطوبة ورسب على المُصلَحة — وهذا أسوأ ما يفعله اختبار.
test("مقارنة السرّ ثابتة الزمن ولا تقصر عند اختلاف الطول (A13)", () => {
    const src = fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/guard.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function secretEquals"));
    const body = fn.slice(0, fn.indexOf("\n}"));

    // سرٌّ غير مضبوط ⇒ لا أحد مخوّل. النشر غير المُهيَّأ يجب أن يكون مُغلقًا.
    assert.match(body, /if \(!want\) return false/);

    // الجوهر: تُجزَّأ القيمتان أوّلًا، فتصير المقارنة على ٣٢ بايتًا ثابتة مهما
    // اختلف طول المُدخَل — ولا يبقى فرقٌ زمنيّ يكشف طول السرّ.
    assert.match(body, /crypto\.subtle\.digest\("SHA-256"/);
    assert.match(body, /diff \|= x\[i\] \^ y\[i\]/);

    // ولا عودةَ مبكّرة على الطول. هذا هو العطب نفسه، منصوصًا عليه كي لا يعود.
    assert.ok(!/want\.length !== got\.length/.test(body),
        "A13: العودة المبكّرة على اختلاف الطول تسرّب طول السرّ زمنيًّا");
});

test("الدالّة تسيّج الكلفة ونطاق الضرر", () => {
    const src = fs.readFileSync(path.join(ROOT, "supabase/functions/groq-author/index.ts"), "utf8");
    for (const cap of ["MAX_SYSTEM", "MAX_USER", "MAX_N", "MAX_OUT_TOKENS"]) {
        // سقفٌ معرَّفٌ ولا يُستعمل أسوأ من غيابه: يقرأ كأنّ الحدّ قائم. فيُشترَط
        // ظهوره مرّتين على الأقلّ — تعريفًا واستعمالًا.
        const uses = (src.match(new RegExp(cap, "g")) || []).length;
        assert.ok(uses >= 2, `السقف ${cap} ظهر ${uses} مرّة — معرَّفٌ ولا يُستعمل`);
    }
    // النموذج المُهمَل لا يعود أبدًا (عيب المرحلة ٠: ثلاث دوالّ ظلّت تسمّيه بعد
    // إهماله، فمات مسار التلميح بصمت). يُفحص المُعرَّف نفسه لا مجرّد ذكرِ الاسم —
    // فالتعليق الذي يشرح سبب تركه يذكره حتمًا.
    const model = src.match(/const GROQ_MODEL = "([^"]+)"/);
    assert.ok(model, "GROQ_MODEL غير معرَّف");
    assert.ok(!/^llama-3\.3-70b/.test(model[1]), `النموذج المُهمَل عاد: ${model[1]}`);
    // الردّ يُعاد خامًا: parseProposals وحدها تقرّر ما يعنيه ردّ نموذج
    assert.match(src, /raw: data\?\.choices/);
    assert.ok(!/JSON\.parse\(data/.test(src), "لا تحليل ثانٍ داخل الدالّة");
});

test("سياج الألعاب مكرّرٌ في الدالّة عمدًا ويطابق الوحدة", () => {
    const src = fs.readFileSync(path.join(ROOT, "supabase/functions/groq-author/index.ts"), "utf8");
    const listed = [...src.match(/const AUTHORABLE = new Set\(\[([^\]]+)\]\)/)[1]
        .matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort();
    assert.deepEqual(listed, A.AUTHORABLE_GAMES.slice().sort(),
        "قائمة الدالّة انحرفت عن AUTHORABLE_GAMES");
});

test("authored_items: RLS مفعّلة وبلا سياسات عميل، وهويّةٌ فريدة", () => {
    const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260801_01_authored_items.sql"), "utf8");
    assert.match(sql, /alter table public\.authored_items enable row level security/);
    // كنسق puzzle_bank: صفر سياسات. مقترحٌ غير مراجَعٍ يتسرّب لا يميّزه اللاعب عن محتوًى منشور.
    assert.ok(!/create policy/i.test(sql), "لا يجوز أن يكون للجدول سياسة عميل");
    // إعادة تشغيل /author بعد دفعةٍ سيّئة لا-عمليّة، لا كومةٌ مكرّرة
    assert.match(sql, /create unique index if not exists authored_items_identity[\s\S]*game_type, fold_key/);
    // النطاق لا يساوي ٣ أبدًا — نفس قيد daily_challenge
    assert.match(sql, /band\s+smallint not null check \(band between 0 and 2\)/);
    // صفٌّ سقط في البوّابات يبقى قابلًا للفحص: تكرار الفشل هو إشارة أن البرومبت خطأ
    assert.match(sql, /gate_ok\s+boolean/);
    assert.ok(!/drop table/i.test(sql) && !/delete from/i.test(sql), "الهجرة إضافيّةٌ فقط");
});

// ── البوت: الكتابة في ملفّات البنك ────────────────────────────────────────────
const bot = require("../bot.js");

test("الإلحاق لا يعيد تنسيق الملف — الأسطر القائمة تبقى بايتًا ببايت", () => {
    // الملفّات الثلاثة بثلاثة تنسيقات (أمثال سطرٌ لكل عنصر، لمحة بمسافتين،
    // تشابك بمسافة). إعادة تسلسل المصفوفة تكتب الثلاثين صفًّا من جديد وتدفن
    // التغيير الحقيقيّ في الفرق.
    const tmp = path.join(require("node:os").tmpdir(), "sura_bank_test");
    fs.mkdirSync(tmp, { recursive: true });
    for (const src of ["bank/saudi/amthal.json", "bank/saudi/lamha.json", "bank/saudi/connections.json"]) {
        const before = fs.readFileSync(path.join(ROOT, src), "utf8");
        const dst = path.join(tmp, path.basename(src));
        fs.writeFileSync(dst, before, "utf8");

        const n0 = JSON.parse(before).length;
        bot.appendToBank(dst, [{ __probe: true, difficulty: 0 }]);

        const after = fs.readFileSync(dst, "utf8");
        assert.equal(JSON.parse(after).length, n0 + 1, `${src}: لم يُضَف العنصر`);
        assert.deepEqual(JSON.parse(after)[n0], { __probe: true, difficulty: 0 });
        // كل سطرٍ قائمٍ باقٍ كما هو: الفرق أسطرٌ مضافةٌ فقط
        const oldLines = before.split(/\r?\n/).filter(l => l.trim() && l.trim() !== "]");
        const newLines = after.split(/\r?\n/);
        for (const l of oldLines) {
            assert.ok(newLines.includes(l) || newLines.includes(l.replace(/,$/, "") + ","),
                `${src}: أُعيد تنسيق سطرٍ قائم`);
        }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
});

test("الإلحاق يصمد على مصفوفةٍ فارغة ويرفض ما ليس مصفوفة", () => {
    const tmp = path.join(require("node:os").tmpdir(), "sura_bank_test2");
    fs.mkdirSync(tmp, { recursive: true });
    const rel = d => path.join(tmp, d);
    fs.writeFileSync(path.join(tmp, "empty.json"), "[\n]\n", "utf8");
    bot.appendToBank(rel("empty.json"), [{ a: 1 }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, "empty.json"), "utf8")), [{ a: 1 }]);
    fs.writeFileSync(path.join(tmp, "obj.json"), "{}", "utf8");
    assert.throws(() => bot.appendToBank(rel("obj.json"), [{ a: 1 }]), /ليس مصفوفة/);
    fs.rmSync(tmp, { recursive: true, force: true });
});

test("جسم الاسترجاع يُقطَّع بالعناوين لا كملفٍّ واحد", () => {
    // وثيقةٌ من ٤٠٠ سطرٍ ككتلةٍ واحدة تغرق تطبيع الطول في BM25 وتُسترجَع كضربةٍ
    // عمياء. القسم هو الوحدة التي كان إنسانٌ سيقتبسها.
    const md = "# عنوان\nمقدّمةٌ فيها كلامٌ كافٍ ليتجاوز الحدّ الأدنى للطول المطلوب هنا.\n\n"
        + "## القسم الأوّل\nنصٌّ طويلٌ بما يكفي ليُحسَب قسمًا مستقلًّا في الفهرس.\n\n"
        + "## القسم الثاني\nنصٌّ آخر طويلٌ بما يكفي أيضًا ليُحسَب قسمًا مستقلًّا.\n\n"
        + "## \n";                                   // عنوانٌ بلا متن يُطرَح
    const chunks = bot.chunkMarkdown("docs/x.md", md);
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every(c => c.id.startsWith("docs/x.md › ")));
    assert.match(chunks[1].id, /القسم الأوّل/);
});

test("أوامر التأليف موصولةٌ فعلًا وفي المساعدة", () => {
    // أمرٌ مبنيٌّ وغير موصولٍ بالمُوزِّع يبدو موجودًا ولا يعمل.
    const src = fs.readFileSync(path.join(ROOT, "bot.js"), "utf8");
    const dispatch = src.match(/const DAILY_CMDS = \{[\s\S]*?\n {4}\};/)[0];
    for (const cmd of ["author", "proposals", "adopt", "reject"]) {
        assert.ok(dispatch.includes(`${cmd}:`), `/${cmd} غير موصول`);
        assert.ok(src.includes(`"/${cmd} `), `/${cmd} ليس في HELP`);
    }
});

test("الاعتماد وحده يكتب ملفًّا — والفحص الساقط لا يُعتمد ولو بـall", () => {
    const src = fs.readFileSync(path.join(ROOT, "bot.js"), "utf8");
    const adopt = src.match(/async function adoptProposals[\s\S]*?\n}/)[0];
    // «all» تعني «كل الصالح». تسليم لوحٍ رفضه المُشيك إلى لاعبٍ يجب ألّا يكون
    // نقرةً سريعة.
    assert.match(adopt, /const good = picked\.filter\(r => r\.gate_ok\)/);
    assert.match(adopt, /appendToBank\([\s\S]*?good\.map/);
    // ولا تكتب في bank/ دالّةٌ أخرى
    const writers = [...src.matchAll(/async function (\w+)[\s\S]*?\n}/g)]
        .filter(m => /appendToBank\(/.test(m[0])).map(m => m[1]);
    assert.deepEqual(writers, ["adoptProposals"]);
    // والبناء مذكورٌ صراحةً: الملفّ على القرص ليس ما يحمّله اللاعب بعد
    assert.match(adopt, /npm run build/);
});

test("المقترح لا يُفحَص بـctx.bank — وإلّا سقط كلُّ جديدٍ لأنه جديد", () => {
    // gateBankItem يؤكّد «هذا العنصر موجودٌ في البنك المُجمَّع»: صحيحٌ لصفٍّ
    // مجدول، وخطأٌ تامٌّ لمقترح. تمريره يُفشل كل عنصرٍ للسبب الوحيد الذي ليس عيبًا.
    const src = fs.readFileSync(path.join(ROOT, "bot.js"), "utf8");
    const fn = src.match(/function checkAuthored[\s\S]*?\n}/)[0];
    assert.ok(!/\bbank:/.test(fn), "checkAuthored يمرّر ctx.bank");
    assert.match(fn, /groupPool: game === "connections"/);
    assert.match(fn, /want: game === "wordle"/);
});
