// tests/helpers/live.js — مصدرٌ واحدٌ لقراءة `LIVE_GAMES` و`TITLES`.
//
// لماذا وُجد. القائمتان هما مصدرُ الحقيقة لعدد الألعاب الحيّة وأسمائها، وكان
// **ثمانيةُ اختباراتٍ في خمسة ملفّات** يقرأ كلٌّ منها `src/main.js` بنمطه
// الخاصّ. فحين خرجت المنصّة إلى `src/ui/meta.js` سقطت الثمانيةُ دفعةً واحدة —
// لا لأن عطبًا عاد، بل لأن ثمانيةَ نسخٍ من «أين تسكن هذه القائمة» انحرفت معًا.
// النسخةُ الواحدة هنا تجعل النقلةَ التالية سطرًا واحدًا لا ثمانية.
//
// ويفشل بصوتٍ عالٍ إن لم يجد: قائمةٌ فارغةٌ تُرجَع بصمتٍ تجعل كلَّ اختبارٍ
// يقرؤها ينجح على لا شيء — وهو أسوأ من فشله.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const META_REL = "src/ui/meta.js";
const META = fs.readFileSync(path.join(ROOT, META_REL), "utf8");

function must(re, what) {
    const m = re.exec(META);
    if (!m) throw new Error(`${what} غير موجودة في ${META_REL} — هل انتقلت المنصّة مرّةً أخرى؟`);
    return m[1];
}

const LIVE_GAMES = must(/const LIVE_GAMES = \[([^\]]*)\]/, "LIVE_GAMES")
    .split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);

const TITLES = {};
for (const pair of must(/const TITLES = \{([\s\S]*?)\};/, "TITLES").split(",")) {
    const m = /^\s*([\w$]+)\s*:\s*'([^']*)'/.exec(pair);
    if (m) TITLES[m[1]] = m[2];
}

if (LIVE_GAMES.length < 6) throw new Error(`LIVE_GAMES قُرئت ناقصةً (${LIVE_GAMES.length})`);
if (Object.keys(TITLES).length < 6) throw new Error("TITLES قُرئت ناقصةً");

module.exports = { ROOT, META_REL, META, LIVE_GAMES, TITLES };
