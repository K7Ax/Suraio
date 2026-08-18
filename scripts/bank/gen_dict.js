// scripts/bank/gen_dict.js — يبني bank/words_ar.txt من bank/words_ar.json.
//
// المصدر يبقى JSON لأن سكربتات التوليد ونصوص Node تقرأه (gen_bee_bank.js،
// checks.mjs، audit_banks.js). المُشتقّ هو ما يذهب إلى المتصفّح وحده.
//
// الترتيب هنا **شرطُ صحّة لا تحسينًا**: ترميز البادئة المشتركة يفترض الجوار،
// والبحث الثنائيّ في src/core/dict.mjs يفترض الترتيب نفسه بالضبط — ترتيب
// وحدات UTF-16 الذي يعطيه Array.prototype.sort بلا مقارِن. أي مقارِنٍ آخر
// (Intl.Collator مثلًا) يعطي ترتيبًا مختلفًا فيكسر البحث بصمت.
//
//   node scripts/bank/gen_dict.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "bank/words_ar.json");
const OUT = path.join(ROOT, "bank/words_ar.txt");

const FC_BASE = 48;

function encodeFrontCoded(words) {
    const out = new Array(words.length);
    let prev = "";
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        let k = 0;
        const lim = Math.min(prev.length, w.length);
        while (k < lim && prev.charCodeAt(k) === w.charCodeAt(k)) k++;
        out[i] = String.fromCharCode(FC_BASE + k) + w.slice(k);
        prev = w;
    }
    return out.join("\n");
}

function main() {
    const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw.words || []);

    // تنقيةٌ قبل الترميز: فارغةٌ أو مكرّرة تُفسد الإزاحات وتُضيع بايتات.
    const words = [...new Set(list.filter(w => typeof w === "string" && w.length))].sort();

    // البادئة تُرمَّز بحرفٍ واحد. أطول كلمةٍ في المعجم ٦ أحرف، فالحدّ بعيد —
    // لكن الملفّ يُولَّد من مصدرٍ قد يتغيّر، فالفحص يبقى.
    let maxLen = 0;
    for (const w of words) if (w.length > maxLen) maxLen = w.length;
    if (maxLen > 74) {
        console.error(`✗ أطول كلمة ${maxLen} حرفًا — البادئة لا تُرمَّز بحرفٍ واحد بعد هذا الحدّ.`);
        process.exit(1);
    }

    const text = encodeFrontCoded(words);
    fs.writeFileSync(OUT, text, "utf8");

    // إثباتُ رحلةٍ كاملة: يُفكّ ما كُتب ويُقارَن بالمصدر. الملفّ لا يخرج من هنا
    // إلا وقد أثبت أنه يعود كما دخل — فالبحث الثنائيّ لا يُخطئ بصوت.
    const back = [];
    let prev = "";
    for (const line of text.split("\n")) {
        const w = prev.slice(0, line.charCodeAt(0) - FC_BASE) + line.slice(1);
        back.push(w); prev = w;
    }
    if (back.length !== words.length || back.some((w, i) => w !== words[i])) {
        console.error("✗ الرحلة الكاملة فشلت — المفكوك لا يطابق المصدر.");
        process.exit(1);
    }

    const srcSize = fs.statSync(SRC).size;
    const outSize = Buffer.byteLength(text);
    const g = b => zlib.gzipSync(Buffer.from(b), { level: 9 }).length;
    const srcGz = g(fs.readFileSync(SRC)), outGz = g(text);
    const pc = (a, b) => `−${(100 - b / a * 100).toFixed(0)}%`;

    console.log(`كلمات ${words.length}${list.length !== words.length ? ` (أُسقط ${list.length - words.length})` : ""}`);
    console.log(`خام    ${srcSize} → ${outSize}  ${pc(srcSize, outSize)}`);
    console.log(`مضغوط  ${srcGz} → ${outGz}  ${pc(srcGz, outGz)}`);
    console.log("DICT_OK");
}

main();
