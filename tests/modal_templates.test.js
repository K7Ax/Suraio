// قوالب النوافذ — الحارس الذي يمنع أخطر انحرافٍ في هذه الجولة.
//
// ثمانِ نوافذَ لألعابٍ غير مُطلَقة صارت داخل `<template>`، فلا تُبنى عُقَدُها
// حتى تُطلَق اللعبة. والانحراف المخيف صامتٌ تمامًا: لعبةٌ حيّةٌ تُترك نافذتها
// في قالب، فيرجع `getElementById` عدمًا، فتنسحب `init` بهدوء — ولا خطأ في
// الطرفيّة ولا في الشاشة، فقط بطاقةٌ لا تفتح شيئًا. هذه الاختبارات تجعل ذلك
// يسقط هنا لا عند لاعب.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
// ‏`mountGame` ما زالت في `main.js`؛ أمّا `LIVE_GAMES` فانتقلت إلى
// ‏`src/ui/meta.js` — و`helpers/live.js` هو الموضع الوحيد الذي يعرف أين تسكن.
const main = fs.readFileSync(path.join(ROOT, "src/main.js"), "utf8");
const LIVE = require("./helpers/live.js");

// اللعبة ↔ بطاقتها ↔ نافذتها. الأسماء ليست منتظمة (‏bee/spelling_bee،
// missingword/missing_word) فتُكتب صراحةً بدل أن تُشتقّ باشتقاقٍ يكذب.
const GAMES = [
    ["wordle", "wordle-trigger-card", "wordle-modal"],
    ["connections", "connections-trigger-card", "connections-modal"],
    ["spelling_bee", "bee-trigger-card", "bee-modal"],
    ["amthal", "amthal-trigger-card", "amthal-modal"],
    ["warmer", "warmer-trigger-card", "warmer-modal"],
    ["lamha", "lamha-trigger-card", "lamha-modal"],
    ["sudoku", "sudoku-trigger-card", "sudoku-modal"],
    ["letterboxed", "letterboxed-trigger-card", "letterboxed-modal"],
    ["strands", "strands-trigger-card", "strands-modal"],
    ["missing_word", "missingword-trigger-card", "missingword-modal"],
    ["story_order", "storyorder-trigger-card", "storyorder-modal"],
    ["zayid", "zayid-trigger-card", "zayid-modal"],
    ["tiles", "tiles-trigger-card", "tiles-modal"],
    ["pips", "pips-trigger-card", "pips-modal"],
];

const cardHidden = id => {
    const m = html.match(new RegExp(`id="${id}"([^>]*)>`));
    assert.ok(m, "بطاقة مفقودة من index.html: " + id);
    return /style="[^"]*display:\s*none/.test(m[1]);
};
const inTemplate = id => html.includes(`<template id="tpl-${id}">`);
const liveGames = () => LIVE.LIVE_GAMES;

test("كلّ لعبةٍ حيّة نافذتها مبنيّةٌ لا قالب — وإلّا لم تفتح بطاقتها شيئًا", () => {
    const live = new Set(liveGames());
    for (const [game, , modal] of GAMES) {
        if (!live.has(game)) continue;
        assert.equal(inTemplate(modal), false,
            `«${game}» حيّةٌ ونافذتها ما زالت داخل <template> — ستفشل بصمت`);
        assert.ok(html.includes(`id="${modal}"`), `نافذة «${game}» مفقودة`);
    }
});

test("بطاقةُ اللعبة الحيّة ظاهرة، وبطاقةُ غير المُطلَقة مخفيّة — الإشارتان متّسقتان", () => {
    const live = new Set(liveGames());
    for (const [game, card] of GAMES) {
        assert.equal(cardHidden(card), !live.has(game),
            `«${game}»: حالةُ البطاقة تخالف LIVE_GAMES`);
    }
});

test("كلّ نافذةٍ في قالبٍ تخصّ لعبةً بطاقتُها مخفيّة — لا قالبَ يتيم", () => {
    const byModal = new Map(GAMES.map(([g, c, m]) => [m, [g, c]]));
    for (const m of html.matchAll(/<template id="tpl-([a-z]+-modal)">/g)) {
        const pair = byModal.get(m[1]);
        assert.ok(pair, "قالبٌ لنافذةٍ مجهولة: " + m[1]);
        assert.equal(cardHidden(pair[1]), true,
            `«${pair[0]}» بطاقتُها ظاهرة ونافذتُها في قالب — تناقض`);
    }
});

test("كلّ لعبةٍ غير مُطلَقة تمرّ عبر mountGame لا عبر init مباشرة", () => {
    // الشرطُ الحقيقيّ: من كانت نافذتُه قالبًا وجب أن يمرّ بالمُركِّب، وإلّا
    // استدعى `init` وبحث عن نافذةٍ غير موجودةٍ فانسحب.
    for (const m of html.matchAll(/<template id="tpl-([a-z]+-modal)">/g)) {
        assert.ok(main.includes(`'${m[1]}',`),
            `النافذة ${m[1]} قالبٌ ولا يُركّبها mountGame`);
    }
});

test("mountGame يبني القالب قبل init لا بعدها", () => {
    // ترتيبٌ لا تفصيل: لو استُدعيت `init` قبل الاستنساخ لبحثت في مستندٍ خالٍ.
    const body = main.slice(main.indexOf("function mountGame("));
    const clone = body.indexOf("cloneNode");
    const call = body.indexOf("init();");
    assert.ok(clone !== -1 && call !== -1, "بنية mountGame تغيّرت");
    assert.ok(clone < call, "mountGame تستدعي init قبل أن تستنسخ القالب");
});
