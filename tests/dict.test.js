// المعجم المرصوص — الاختبارات تحرس الافتراض الذي يحمل البنية كلّها.
//
// البحث الثنائيّ صحيحٌ فقط إذا كان الترميز والترتيب والمقارنة تتّفق على ترتيبٍ
// واحد. وإن اختلّ أحدها فالعطب **صامت**: لا استثناء، لا سطر في الطرفيّة — فقط
// كلمةٌ صحيحة تُرفض على لاعبٍ لا يفهم لماذا. فهذه الاختبارات ليست عن السلوك،
// بل عن ذلك الاتّفاق.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = f => path.join(__dirname, "..", f);
let D = null;
const load = async () => (D ??= await import("../src/core/dict.mjs"));

test("الرحلة الكاملة: يُرمَّز ثمّ يُفكّ فيعود كما كان", async () => {
    const { encodeFrontCoded, Dict } = await load();
    const words = ["ابن", "ابنة", "ابناء", "بحر", "بحري", "شمس"].sort();
    const back = [...Dict.decode(encodeFrontCoded(words))];
    assert.deepEqual(back, words);
});

test("has يوافق Set على المعجم الحقيقيّ كلّه", async () => {
    const { Dict } = await load();
    const list = JSON.parse(fs.readFileSync(root("bank/words_ar.json"), "utf8"));
    const dict = Dict.decode(fs.readFileSync(root("bank/words_ar.txt"), "utf8"));
    const set = new Set(list);

    assert.equal(dict.size, set.size, "عدد المدخلات اختلف بين الملفّين");

    // عيّنةٌ موزّعة بخطوةٍ أوّليّة: تمرّ على الملفّ كلّه لا على أوّله.
    for (let i = 0; i < list.length; i += 7919)
        assert.ok(dict.has(list[i]), `كلمةٌ موجودة لم يجدها البحث: «${list[i]}»`);

    // وسلبيّاتٌ لا بدّ أن تُرفض — الطرفان والوسط.
    for (const bad of ["", "ززززززز", "xyz", "ابن ", " ابن"])
        assert.ok(!dict.has(bad), `قُبلت كلمةٌ ليست في المعجم: «${bad}»`);
});

test("الملفّ المُشتقّ مرتَّبٌ بترتيب UTF-16 نفسه الذي يفترضه البحث", async () => {
    // هذا هو الحدّ الحقيقيّ. لو رُتّب المصدر يومًا بـIntl.Collator لصار الترتيب
    // مختلفًا، ولبقي الترميز يعمل والبحث يُخطئ — بلا أيّ إشارة.
    const { Dict } = await load();
    const dict = Dict.decode(fs.readFileSync(root("bank/words_ar.txt"), "utf8"));
    let prev = "";
    for (let i = 0; i < dict.size; i++) {
        const w = dict.at(i);
        assert.ok(prev <= w, `انكسر الترتيب عند ${i}: «${prev}» ثمّ «${w}»`);
        prev = w;
    }
});

test("التعداد ما زال يعمل — تلميح «صندوق الحروف» يمرّ على المعجم", async () => {
    const { Dict } = await load();
    const dict = Dict.from(["بحر", "شمس", "قمر"]);
    let n = 0;
    for (const w of dict) { assert.equal(typeof w, "string"); n++; }
    assert.equal(n, 3, "الواجهة المتوافقة مع Set انكسرت — for..of لم يعد يعمل");
});

test("المعجم المُشتقّ محدَّثٌ من مصدره", () => {
    // ملفٌّ مُشتقٌّ أقدمُ من مصدره يعني معجمًا قديمًا في يد اللاعب.
    const src = fs.statSync(root("bank/words_ar.json")).mtimeMs;
    const out = fs.statSync(root("bank/words_ar.txt")).mtimeMs;
    assert.ok(out >= src, "bank/words_ar.txt أقدم من مصدره — شغّل: node scripts/bank/gen_dict.js");
});
