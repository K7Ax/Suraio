// tests/helpers/ui.js — أين تسكن وحداتُ الواجهة، مسؤولٌ عنه ملفٌّ واحد.
//
// ‏لماذا وُجد. `src/main.js` كان ٧٢٤١ سطرًا داخل مُنصِتٍ واحد، فكلُّ اختبارٍ
// بنيويٍّ في المشروع كان يقرأه بمساره الحرفيّ. ومع تفكيكه إلى `src/ui/*`
// صارت كلُّ نقلةٍ تُسقط حزمةً من الاختبارات دفعةً واحدة — لا لأن عطبًا عاد،
// بل لأنّ عشرات النسخ من «أين يسكن هذا الرمز» انحرفت معًا. حدث ذلك مرّتين:
// ثمانيةُ اختباراتٍ عند نقل `initSuraMeta`، وستّةَ عشرَ عند نقل `initLevels`.
//
// ‏فالقاعدة هنا: الاختبار يقول **أيَّ وحدةٍ** يعني، لا **أيَّ مسار**. والنقلةُ
// التالية تُصلَح في هذا الجدول وحده.
//
// ‏ولا يُجمع المصدرُ كلُّه في نصٍّ واحد عمدًا: `assert.match` على كامل `src/`
// ينجح أينما وُجد النمط، فيُصبح الاختبار عاجزًا عن كشف رمزٍ هاجر إلى الموضع
// الخطأ — وهو نفسُ ثقب `A10`. المدى جزءٌ من الادّعاء.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

// الاسمُ المنطقيّ ← المسار. لا يُضاف اسمٌ إلّا ومعه ملفٌّ موجود.
const MODULES = {
    main: "src/main.js",
    // ‏منصّةُ البقاء والتلميحات: الخبرة والمستويات والشارات والعملات
    // والتوليفة والعدّاد، ومحرّكُ التلميحات، و`LIVE_GAMES`/`TITLES`.
    meta: "src/ui/meta.js",
    // ‏سُلّمُ الحملة: `complete`/`won`/`finish`، الوضعُ اليوميّ، `mountControls`
    // ‏وأيقوناتُ الشريط، و`window.__sura.levels`/`.ranks`/`.rush`.
    levels: "src/ui/levels.js",
    // ‏الدخول والتسجيل: بوّابةُ البريد الواحدة، والمعالجُ ثلاثيُّ الخطوات،
    // ‏وOTP، والاستعادة، وGoogle، ومطالبةُ اسم المستخدم.
    auth: "src/ui/auth.js",
    // ‏«كَلِمة»: اللوحُ ولوحةُ المفاتيح و`scoreRow` والتلميحُ والفوز.
    wordle: "src/games/wordle.js",
};

const cache = new Map();

/** يقرأ وحدةً بالاسم المنطقيّ. يرمي إن غاب الملفّ — لأنّ نصًّا فارغًا يجعل كلّ
 *  ‏`assert.match` عليه يفشل بسببٍ مضلّل، وكلّ `assert.ok(!…)` ينجح على لا شيء. */
function read(name) {
    if (cache.has(name)) return cache.get(name);
    const rel = MODULES[name];
    if (!rel) throw new Error(`وحدةٌ لا يعرفها tests/helpers/ui.js: «${name}»`);
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
        throw new Error(`«${name}» كانت في ${rel} ولم تعد — حدِّث الجدول في tests/helpers/ui.js`);
    }
    const src = fs.readFileSync(abs, "utf8");
    if (src.length < 200) throw new Error(`${rel} أقصرُ من أن يكون وحدةً — قُرئ ناقصًا؟`);
    cache.set(name, src);
    return src;
}

/** ‏يؤكّد أنّ `main.js` يستورد الوحدةَ **ويناديها**. وحدةٌ موجودةٌ لا تُنادى
 *  تُبقي كلَّ ادّعاءٍ عن محتواها أخضرَ بينما الموقعُ يعمل بدونها. */
function assertWired(assert, initName, rel) {
    const main = read("main");
    assert.match(main, new RegExp(`import \\{ ${initName} \\} from '\\./${rel}'`),
        `${initName}: الوحدة غير مستورَدة في main.js`);
    assert.match(main, new RegExp(`\\n {4}${initName}\\(`),
        `${initName}: مستورَدة ولا تُنادى`);
}

module.exports = { ROOT, MODULES, read, assertWired };
