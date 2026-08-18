// core/banks — البنوك التي كانت داخل ثلاثة ملفّات ألعاب.
//
// نُقلت لأن البوت يولّد شهرًا من «تحدي اليوم» ويجب أن يفحص **اللوح نفسه** الذي
// سيراه اللاعب. ثلاثٌ من الألعاب الستّ كانت بنوكها داخل الشيفرة (main.js
// وbee.js وconnections.js)، فلا سبيل لـnode أن يراها.
//
// هذا الملف يحرس شيئين:
//   ١. أن النقل لم يغيّر شيئًا — الأعداد والعيّنات ونتيجة التجميع.
//   ٢. أن أحدًا لم يُعِد كتابة بنكٍ داخل ملفّ لعبة، فينفصل ما يفحصه البوت عمّا
//      يُلعَب — وهو عطلٌ صامت تمامًا: كل شيء يعمل، والفحص يخصّ لوحًا آخر.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test";
const { normalizeArabic: norm } = require("../bot.js");
const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

let B, P;
test("تحميل الوحدات", async () => {
    B = await import("../src/core/banks.mjs");
    P = await import("../src/core/progression.mjs");
});

test("الأعداد كما كانت قبل النقل", () => {
    assert.equal(B.WORDLE_PRACTICE.length, 36, "قائمة كَلِمة التدريبية");
    assert.equal(B.WORD_EXTRA6.length, 19, "كلمات الستّة أحرف");
    assert.equal(B.WORD_EXTRA5.length, 12, "كلمات الخمسة أحرف");
    assert.equal(B.BEE_BANK.length, 42, "ألواح نحلة");
    assert.equal(B.CONNECTIONS_BANK.length, 16, "ألواح تشابك العامّة");
    assert.equal(B.CONNECTIONS_SAUDI.length, 20, "المجموعات السعودية");
    assert.equal(B.CONNECTIONS_POOL.length, 84, "٢٠ سعودية + ٦٤ عامّة بعد إزالة التكرار");
});

test("عيّنات محدَّدة لم تتبدّل", () => {
    assert.deepEqual(B.WORDLE_PRACTICE[0], { word: "سلام", hint: "تحية" });
    // نحلة لم تعد ثابتةً بالترتيب — تُولَّد وتُرتَّب بالغنى. فالذي يُحرَس هو
    // الوعد لا الفهرس: حروفُ الألواح الثمانية التي اختارها إنسان باقيةٌ كلّها.
    const sets = new Set(B.BEE_BANK.map(b => [b.center, ...[...b.outer].sort()].join("")));
    for (const c of B.BEE_CURATED)
        assert.ok(sets.has([c.center, ...[...c.outer].sort()].join("")),
            `سقط لوحٌ يدويّ: ${c.center} | ${c.outer.join("")}`);
    assert.deepEqual(B.CONNECTIONS_SAUDI[0], { theme: "مدن سعودية", words: ["الرياض", "جدة", "الدمام", "أبها"] });
    // السعودية تتصدّر التجمّع دائمًا — وهي هويّة اللعبة لا ترتيبٌ عابر
    assert.equal(B.CONNECTIONS_POOL[0].saudi, true);
    assert.equal(B.CONNECTIONS_POOL.filter(g => g.saudi).length, 20);
});

test("نحلة: النطاق يعني الشيء نفسه على كل لوح", () => {
    // «صعوبة محسوسة حسب كل مستوى» — والصعوبة هنا هي الغنى: هدفُ المستوى كسرٌ من
    // اللوح، فاللوح النحيل يعني أن كل كلمةٍ باقية أصعبُ نبشًا. وقبل هذه الجولة
    // كانت الألواح اليدويّة مُدرَّجةً بعضُها ببعض، فصار «سهلُها» (١١–١٢ كلمة)
    // أنحلَ من كل «صعبٍ» مولَّد (٢٠–٢٧) — نطاقٌ يعني هنا غير ما يعنيه هناك.
    const band = d => B.BEE_BANK.filter(b => b.difficulty === d).map(b => b.words.length);
    for (const d of [0, 1, 2]) assert.equal(band(d).length, 14, `النطاق ${d}`);
    // ولا تداخل: أنحلُ لوحٍ في نطاقٍ أغنى من أغنى لوحٍ في النطاق الذي يليه
    assert.ok(Math.min(...band(0)) > Math.max(...band(1)), "٠ و١ متداخلان");
    assert.ok(Math.min(...band(1)) > Math.max(...band(2)), "١ و٢ متداخلان");
});

test("خلط كَلِمة حتميّ وبأطوالٍ صحيحة", () => {
    // ترتيبٌ ثابت لكل طول، فمستوى N هو الكلمة نفسها لكل لاعب إلى الأبد
    assert.deepEqual(Object.keys(B.WORDLE_POOLS).sort(), ["4", "5", "6"]);
    for (const len of [4, 5, 6]) {
        const pool = B.WORDLE_POOLS[len];
        assert.ok(pool.length > 0, `طول ${len}: تجمّعٌ فارغ`);
        for (const p of pool) {
            assert.equal([...p.word].length, Number(len), `«${p.word}» في تجمّع ${len}`);
            assert.ok(p.hint && p.hint.trim(), `«${p.word}» بلا تلميح`);
        }
    }
    // لا كلمة مكرّرة داخل طولٍ واحد — وإلّا تكرّر مستويان في النطاق نفسه
    for (const len of [4, 5, 6]) {
        const ws = B.WORDLE_POOLS[len].map(p => norm(p.word));
        assert.equal(new Set(ws).size, ws.length, `طول ${len}: كلمةٌ مكرّرة`);
    }
});

test("تجميع تشابك حتميّ ولا يُنتج حلًّا بديلًا", () => {
    for (let lv = 0; lv <= P.MAX; lv++) {
        const seed = P.levelSeed("connections", lv);
        const nd = P.curves.connections.decoys(lv);
        const a = B.assembleConnections(seed, nd, norm);
        const b = B.assembleConnections(seed, nd, norm);
        assert.deepEqual(a, b, `المستوى ${lv}: لوحان مختلفان للبذرة نفسها`);
        assert.equal(a.groups.length, 4, `المستوى ${lv}: عدد المجموعات`);
        assert.equal(a.decoys.length, nd, `المستوى ${lv}: عدد المموّهات`);
        // ١٦ كلمة فريدة + مموّهاتٌ لا تنتمي لأي مجموعة على اللوح
        const words = a.groups.flatMap(g => g.words.map(norm));
        assert.equal(new Set(words).size, 16, `المستوى ${lv}: كلمةٌ في مجموعتين — حلٌّ بديل`);
        for (const d of a.decoys.map(norm)) {
            assert.ok(!words.includes(d), `المستوى ${lv}: المموّه «${d}» عضوٌ في مجموعة`);
        }
    }
});

test("كل كلمةٍ في تجمّعات كَلِمة تعبر المُشيك", async () => {
    // الحملة تخدم الفهارس ٠–٥ من كل تجمّع فقط، فبقيّة القائمة لم يرها لاعبٌ قطّ.
    // «تحدي اليوم» يمشي على التجمّع كلّه، وأوّل مرورٍ كشف أربعة عيوب — منها
    // «أهازيج» وهي خارج المعجم، والإرسال في كَلِمة صارمُ العضويّة، فالمستوى
    // كان غير قابلٍ للفوز أصلًا. هذا الاختبار يمنع الخامس.
    const C = await import("../src/core/checks.mjs");
    const dict = new Set(JSON.parse(read("bank/words_ar.json")).map(norm));
    const bad = [];
    for (const len of [4, 5, 6]) {
        B.WORDLE_POOLS[len].forEach((p, i) => {
            const v = C.check("wordle", { word: p.word, hint: p.hint },
                { norm, dict, want: { len: Number(len) } });
            if (!v.ok) bad.push(`${len}[${i}] «${p.word}»: ${v.errors.join(" · ")}`);
        });
    }
    assert.equal(bad.length, 0, "\n" + bad.join("\n"));
});

test("لم يُعَد إدراج بنكٍ داخل ملفّ لعبة", () => {
    // لو عاد أحدهم فكتب المصفوفة داخل اللعبة، لبقي كل شيء يعمل في المتصفّح
    // بينما يفحص البوت لوحًا لا يراه أحد. لا يُكتشف إلا بمثل هذا الاختبار.
    const inlined = [
        ["src/games/bee.js", /const BANK = \[/, "BEE_BANK"],
        ["src/games/connections.js", /const SAUDI_GROUPS = \[/, "CONNECTIONS_SAUDI"],
        ["src/games/connections.js", /const BANK = \[/, "CONNECTIONS_BANK"],
        ["src/games/wordle.js", /const WORDLE_PRACTICE = \[/, "WORDLE_PRACTICE"]
    ];
    for (const [file, re, name] of inlined) {
        assert.doesNotMatch(read(file), re,
            `${file}: أُعيد إدراج ${name} محليًّا — البوت سيفحص لوحًا غير الذي يُلعَب`);
    }
    // وكلٌّ منها يُستورَد فعلًا من الوحدة المشتركة
    assert.match(read("src/games/bee.js"), /from '\.\.\/core\/banks\.mjs'/);
    assert.match(read("src/games/connections.js"), /from '\.\.\/core\/banks\.mjs'/);
    assert.match(read("src/games/wordle.js"), /from '\.\.\/core\/banks\.mjs'/);
});

test("نسخةٌ واحدة من mulberry32/seededShuffle", () => {
    // نُقلتا إلى rng.mjs كي يستوردهما node؛ util.js يعيد تصديرهما فلا يتغيّر
    // أي مستورِد قائم. النسخة الثانية هي بالضبط ما أنتج tests/normalize.test.js.
    assert.match(read("src/core/util.js"), /export \{ mulberry32, seededShuffle \} from '\.\/rng\.mjs';/);
    assert.doesNotMatch(read("src/core/util.js"), /function mulberry32/);
    assert.match(read("src/core/rng.mjs"), /export function mulberry32/);
});

test("الحزمة المبنيّة تحمل البنوك", () => {
    // صورة النصّ العربيّ في الحزمة تتبع علم `--charset`: بـascii يُهرَّب إلى
    // \uXXXX، وبـutf8 يبقى حرفيًّا. والمقصود هنا **وجود المحتوى** لا صورته،
    // فيُقبَل الشكلان. (تثبيت الاختبار على شكلٍ واحد جعله يسقط يوم بُدِّل العلم
    // في جولة الأداء، وهو سقوطٌ لا يدلّ على شيء.)
    const esc = s => [...s].map(c => c.charCodeAt(0) < 128 ? c
        : "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");
    const app = read("app.js");
    const carries = s => app.includes(s) || app.includes(esc(s));
    assert.ok(carries("مدن سعودية"), "app.js لم يُبنَ بعد النقل");
    assert.ok(carries("سلام"), "قائمة كَلِمة غائبة عن الحزمة");
});
