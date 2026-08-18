// قانونٌ واحد لكل تلميحات سُرى: التلميح يضيف معلومة أو يُرفَض — ولا يتكرّر.
//
// خرج هذا الملف من عطل «كلمة» (tests/wordle_hint.test.js). الفحص بعده كشف أن
// أكثر المزوِّدات تختار عشوائيًّا من المتبقّي بلا ذاكرة، فتعيد الاقتراح نفسه
// وتخصم مرّتين؛ واثنتان («قرّبها» و«لمحة») كانتا تعيدان «أول حرف من الكلمة»
// إلى الأبد. العلاج المشترك: `window.__sura.hints.memo(game)`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const MAIN = read("src/main.js");
// ‏المحرّك نفسه خرج من `main.js` إلى `src/ui/meta.js` مع منصّة البقاء؛
// ‏`helpers/live.js` هو الموضع الوحيد الذي يعرف أين تسكن تلك الوحدة.
const ENGINE = require("./helpers/live.js").META;

// اللعبة ← ملفها ← المفتاح الذي تُنادى به الذاكرة
const MEMO_USERS = [
    ["connections", "src/games/connections.js"],
    ["spelling_bee", "src/games/bee.js"],
    ["strands", "src/games/strands.js"],
    ["letterboxed", "src/games/letterboxed.js"],
    ["tiles", "src/games/tiles.js"],
    ["zayid", "src/games/zayid.js"],
];

test("المحرّك يوفّر ذاكرة تلميحاتٍ مشتركة", () => {
    assert.match(ENGINE, /function memo\(game\)/, "memo() غير معرَّفة في وحدة التلميحات");
    assert.match(ENGINE, /deliverHint, mountChrome, memo,/, "memo غير مُصدَّرة على window.__sura.hints");
    // العقد الذي يجعل الرفض مجّانيًّا — بدونه يصير كل «لا جديد» خصمًا
    assert.match(ENGINE, /if \(res && res\.ok !== false\) consume\(gameType, 'local'\)/,
        "المحرّك يخصم على الرفض، فبطل معنى رفض التلميح");
    // ‏ووحدةٌ لا تُنادى تُبقي ما فوقها أخضرَ بينما لا تلميحَ في الموقع.
    assert.match(MAIN, /import \{ initSuraMeta \} from '\.\/ui\/meta\.js';/,
        "وحدة المنصّة غير مستورَدة في main.js");
    assert.match(MAIN, /\n {4}initSuraMeta\(\);/, "الوحدة مستورَدة ولا تُنادى");
});

for (const [game, file] of MEMO_USERS) {
    test(`«${game}» لا يعيد التلميح نفسه`, () => {
        const src = read(file);
        const uses = src.match(new RegExp(`memo\\('${game}'\\)`, "g")) || [];
        assert.ok(uses.length >= 2,
            `يستعمل الذاكرة ${uses.length} مرّة — المطلوب اثنتان: قراءةٌ في المزوِّد وتصفيرٌ عند لوحٍ جديد`);
        assert.match(src, new RegExp(`memo\\('${game}'\\)\\.reset\\(\\)`),
            "لا تصفيرَ عند لوحٍ جديد — فتُحسَب تلميحات اللوح السابق مُقدَّمةً");
        assert.ok(/H\.has\(|H\.take\(/.test(src), "لا استعلام عن الذاكرة داخل المزوِّد");
    });
}

test("«قرّبها» تصعد بسُلَّمٍ ولا تعيد أول حرف إلى الأبد", () => {
    const src = read("src/games/warmer.js");
    assert.match(src, /function warmerLadder\(\)/, "لا سُلَّم كشف");
    assert.match(src, /if \(i >= ladder\.length\) return \{ ok: false/,
        "لا رفضَ عند نفاد السُّلَّم — يخصم 0.18 من النتيجة مقابل جملةٍ مكرّرة");
    // السُّلَّم يقرّب ولا يحلّ: يقف قبل الحرف قبل الأخير
    assert.match(src, /for \(let i = 1; i < ch\.length - 2; i\+\+\)/,
        "السُّلَّم قد يكشف الكلمة كاملة");
    // عدد الحروف معروضٌ أصلًا في شريط الموضوع، فلا يُباع تلميحًا
    assert.doesNotMatch(src, /warmerLadder[\s\S]{0,400}عدد الحروف/,
        "يبيع معلومةً معروضةً على الشاشة أصلًا");
});

test("«لمحة» تعطي أرضية الحرف الأول مرّةً واحدة", () => {
    const src = read("src/games/lamha.js");
    assert.match(src, /if \(floorGiven\) return \{ ok: false/,
        "تعيد «أول حرف من الكلمة» كلّما ضُغط الزرّ");
});

test("المزوِّدات التي تعدّل الحالة لا تحتاج ذاكرة", () => {
    // هذه تكشف بتغيير اللوح نفسه (تملأ خانة/تضع بلاطة/تحلّ كلمة)، فاستحالة
    // التكرار بنيويّة. الاختبار يحرس تلك البنية لا الصياغة.
    const musts = [
        ["src/games/sudoku.js", /grid\[i\] = solution\[i\]/],
        ["src/games/pips.js", /hand\[sd\.domId\]\.placed = true/],
        ["src/games/amthal.js", /solved\[i\] = true/],
        ["src/games/missing_word.js", /b\.disabled = true/],
        ["src/games/story_order.js", /order = answerOrder\.slice\(0, pos \+ 1\)/],
    ];
    for (const [f, re] of musts) {
        assert.match(read(f), re, `${f}: التلميح لم يعد يغيّر الحالة، فصار قابلًا للتكرار`);
    }
});

test("كل تلميح يسمّي ما فعله", () => {
    // جملةٌ ثابتة («كشفنا لك خانة صحيحة») تُقرأ تكرارًا ولو تغيّر اللوح فعلًا —
    // وهي شكوى المالك نفسها: «مافادني بشي». الرسالة تحمل قيمةً مميِّزة.
    const named = [
        ["src/games/sudoku.js", /message: `كشفنا الخانة \(صفّ \$\{/],
        ["src/games/pips.js", /message: `وضعنا البلاطة \(\$\{/],
        ["src/games/tiles.js", /message: `بلاطتا النقش \$\{FACES\[entry\[0\]\]\.g\}/],
        ["src/games/missing_word.js", /message: `استبعدنا «\$\{b\.textContent\}»/],
        ["src/games/strands.js", /message: `ابدأ من الحرف «\$\{w\[0\]\}»/],
        ["src/games/connections.js", /message: `«\$\{pick\.join/],
    ];
    for (const [f, re] of named) {
        assert.match(read(f), re, `${f}: رسالة التلميح لا تميّز نفسها عن سابقتها`);
    }
});

test("الحزمة المبنيّة تحمل الذاكرة", () => {
    assert.match(read("app.js"), /take\(\w+\)\{/,
        "app.js لم يُبنَ بعد التعديل — الموقع ما زال على العطل");
});
