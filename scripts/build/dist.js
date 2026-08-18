// scripts/build/dist.js — يبني مجلّد نشرٍ بقائمةٍ **بيضاء**.
//
// لماذا قائمةٌ بيضاء لا سوداء. جذر المشروع فيه `.env` وبداخله
// SUPABASE_SERVICE_KEY و BOT_TOKEN و SURA_ADMIN_SECRET، وفيه `bot.js` و
// `migrations/` و`prompts/` و`docs/` (ومنها التقرير الأمنيّ نفسه) و`.git`
// كاملًا. و`wrangler pages deploy .` **يرفع كلّ ذلك**؛ لا يقرأ `.gitignore`.
//
// القائمة السوداء تفشل بصمتٍ عند أوّل ملفٍّ جديد ينساه أحد. القائمة البيضاء
// تفشل بصمتٍ أيضًا — لكن بالاتّجاه الآمن: ملفٌّ منسيّ لا يُنشَر، فيُكتشَف
// بصفحةٍ ناقصة لا بمفتاحٍ مسرَّب. والفرق بين الفشلين هو كلّ شيء.
//
// وفوق القائمة **مسحٌ للمُخرَج** قبل تسليمه: أي شكلٍ لسرٍّ معروف يوقف البناء.
// حزامٌ وحمّالة، لأن ثمن الخطأ هنا ليس صفحةً مكسورة.
//
//   node scripts/build/dist.js          -> يبني dist/
//   npm run dist
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "dist");

// ---- ما يُنشَر، ولا شيء غيره ------------------------------------------------

// صفحات ونصوص وأنماط.
const FILES = [
    "index.html",
    "app.js",
    "style.css",
    "hub.html",
    // Cloudflare Pages يخدم `404.html` من الجذر تلقائيًّا لكل مسارٍ غير موجود،
    // ومعها حزمتها الصغيرة المستقلّة عن app.js.
    "404.html",
    "tallal.js",
    "dashboard.html",
    "dashboard.js",
    // صفحةُ الخصوصيّة قائمةٌ بذاتها كـ404: لا style.css ولا app.js.
    "privacy.html",
    // خريطةُ الموقع. تُنشَر من الجذر لأنّ ذلك المكانُ الوحيد الذي تبحث فيه
    // محرّكاتُ البحث. أمّا `robots.txt` فلا يُنشَر من هنا: Cloudflare تخدم
    // نسختَها المُدارة على `/robots.txt` وتسبق أيَّ ملفٍّ نرفعه.
    "sitemap.xml",
    // `media_1/2/3.jpg` كانت هنا لقسم الأرشيف — وقسم الأرشيف لم يعد يستعملها:
    // `grep -r "media_" dist/` يرجع **صفرًا**. ٧٤٢ كيلو تُرفع لتُقرأ من لا أحد.
    // (‏الملفّات باقيةٌ في المستودع؛ ما تغيّر هو أنّها لا تُنشَر.)
];

// بنوك المحتوى التي يجلبها العميل وقت التشغيل. تُذكَر بأسمائها لا بالمجلّد:
// `bank/` فيه أيضًا `words_ar.json` (٢٫٥ ميغا مصدرٌ لا يُجلَب أبدًا بعد جولة
// الأداء) و`lexicon_ar.json` وبنوكًا لا يفتحها زائر.
const BANK = [
    "bank/words_ar.txt",
    "bank/letterboxed.json",
    "bank/strands.json",
    "bank/saudi/amthal.json",
    "bank/saudi/lamha.json",
    "bank/saudi/warmer.json",
    "bank/saudi/missing_word.json",
    "bank/saudi/story_order.json",
    "bank/saudi/zayid.json",
    "bank/saudi/zayid_ghosts.json",
];

// أصولٌ ثابتة. مجلّداتٌ كاملة حيث كلّ ما فيها يُخدَم، وملفّاتٌ مفردة حيث لا.
const DIRS = [
    "public/brand",
    "public/navbar",
    "public/story",
    "public/vendor",
];
// `public/tallal/` كان مجلّدًا كاملًا: ٤٣ ملفًّا، ٢٫٦٨ ميغا. و`404.html` لا
// يشير إلّا إلى أربعة منها. الباقي — ground/ milkyway/ stars/ hearth/ trace/
// stone-near/ ridge/ shade/ ember/ flat ومعها بيانا المولِّد — فنُّ صفحةِ
// الخطأ **قبل** أن يتجاوزه المالك، محفوظٌ في المستودع ولا يُطلبه متصفّح.
// فيُذكَر المستعمَل بأسمائه؛ وإعادة أيّ لوحةٍ إلى الخدمة سطرٌ واحدٌ هنا.
const EXTRA = [
    "public/tallal/alley-820.webp",
    "public/tallal/alley-1200.webp",
    "public/tallal/alley-1672.webp",
    "public/tallal/alley-og.webp",
];

// امتدادات لا تُنشَر مهما وقعت داخل مجلّدٍ مسموح. `.html` هنا يمنع صفحات
// المرجع المحفوظة داخل public/ من الخروج إلى الإنترنت باسم الموقع — وكان
// التعليق يقول ذلك بينما القائمة لا تحمله، فكان `public/story/_markup.html`
// يُنشَر فعلًا. صفحاتُ الموقع الحقيقيّة كلّها في `FILES` بأسمائها، فلا شيء
// يخسره هذا السطر.
const DENY_EXT = new Set([".bak", ".map", ".psd", ".ai", ".sql", ".md", ".txt", ".py", ".html"]);

// وملفّات العمل: كلّ ما يبدأ بـ`_` داخل `public/` مُخرَجُ مولِّدٍ للمراجعة لا
// للنشر (`_preview.png` وحدها ٤٫٢ ميغا في المجلّدين). الاصطلاح واحدٌ في
// `story_assets.js` و`tallal_assets.js`، فيكفي سطرٌ يحترمه.
const isWork = base => base.startsWith("_");

// وملفّاتٌ بعينها داخل مجلّدٍ مسموح، لا يشير إليها شيء. تُذكَر بمسارها الكامل
// كي يبقى الاستثناء مقروءًا: `index.html` يشير إلى `sura-logo-320/640` بصيغتَي
// png وwebp، والأصل الكامل (٧٨٦ كيلو) ليس في أيّ `<picture>` ولا `<img>`.
const DENY_FILES = new Set([
    "public/brand/sura-logo.png",
    "public/brand/sura-logo.webp",
]);

// ---- المسح الأخير ------------------------------------------------------------
// أشكالٌ لا يجوز أن تظهر في أيّ بايت يُنشَر. `sb_publishable_` **ليس** منها —
// المفتاح العلنيّ علنيٌّ بالتصميم ويجب أن يُشحن.
const SECRETS = [
    [/\bsb_secret_[A-Za-z0-9_-]{10,}/, "مفتاح Supabase سرّيّ"],
    [/\bsbp_[0-9a-f]{40,}/, "رمز Supabase شخصيّ (يملك الحساب كلّه)"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT (قد يكون مفتاح الخدمة)"],
    [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, "رمز بوت تلغرام"],
    [/\bgsk_[A-Za-z0-9]{40,}/, "مفتاح Groq"],
    [/\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/, "رمز GitHub"],
    [/SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY\s*=/, "اسم متغيّر مفتاح الخدمة"],
];

const TEXT_EXT = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".webmanifest"]);

let copied = 0, bytes = 0;
const problems = [];
// كلّ ما نُسخ فعلًا، ليقارَن بما في المُخرَج في الحارس الأخير.
const allowed = new Set();

function scan(rel, abs) {
    if (!TEXT_EXT.has(path.extname(abs).toLowerCase())) return;
    const src = fs.readFileSync(abs, "utf8");
    for (const [re, what] of SECRETS)
        if (re.test(src)) problems.push(`${rel}: ${what}`);
}

function copyFile(rel) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) { problems.push(`مفقود: ${rel}`); return; }
    const to = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    scan(rel, from);
    allowed.add(rel);
    copied++; bytes += fs.statSync(from).size;
}

// DENY_EXT يُطبَّق هنا وحده. الملفّات المفردة تُذكَر بأسمائها فهي قرارٌ صريح
// (ولهذا يمرّ `bank/words_ar.txt` رغم أن `.txt` ممنوعٌ داخل المجلّدات).
function copyDir(rel) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) { problems.push(`مفقود: ${rel}/`); return; }
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const child = `${rel}/${e.name}`;
        // اصطلاح `_` كان يُطبَّق على الملفّات وحدها لا على المجلّدات، فكان
        // `public/navbar/_orig/` و`_pre-logo/` — ٢٫٤٣ ميغا من هويّةٍ بصريّةٍ
        // متجاوَزة — يُنشَران على روابط يسهل تخمينها. الحارس نفسه، مطبَّقًا
        // على ما ينبغي أن يُطبَّق عليه.
        if (e.isDirectory()) { if (!isWork(e.name)) copyDir(child); continue; }
        if (DENY_EXT.has(path.extname(e.name).toLowerCase()) || isWork(e.name)) continue;
        if (DENY_FILES.has(child)) continue;
        copyFile(child);
    }
}

function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });

    for (const f of [...FILES, ...BANK, ...EXTRA]) copyFile(f);
    for (const d of DIRS) copyDir(d);

    // ترويسات الأمان. Cloudflare Pages يقرأ `_headers` من جذر المُخرَج.
    //
    // كانت تُكتَب هنا حرفيًّا، وكانت CSP فيها متساهلة: `script-src 'unsafe-inline'`.
    // وحين صار `scripts/build/csp.js` يولّد سياسةً مبصومة (‏sha256 لكلّ سكربتٍ مضمَّن)
    // في `_headers` بالجذر، صار الملفّان يكتبان الشيء نفسه — وتغلب هذه النسخة
    // لأنّها تُكتَب في المُخرَج مباشرةً. أي أنّ التشديد كلّه كان سيذهب هباءً.
    //
    // فالمولّدُ الآن هو المصدر الوحيد، وهذا الطور ينسخ لا يؤلّف. ونُعيد توليده
    // قبل النسخ كي لا يُنشَر ملفٌّ بُصِم على `index.html` أقدم من الحاليّ.
    execFileSync(process.execPath, [path.join(__dirname, "csp.js")], { stdio: "inherit" });
    const SRC_HEADERS = path.join(ROOT, "_headers");
    if (!fs.existsSync(SRC_HEADERS)) {
        problems.push("`_headers` لم تُولَّد — راجع scripts/build/csp.js");
    } else {
        fs.copyFileSync(SRC_HEADERS, path.join(OUT, "_headers"));
    }

    // حارسٌ أخير: لا يخرج من هنا شيءٌ لم يُذكَر بالاسم.
    const stray = [];
    (function walk(dir, rel) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(p, r);
            else if (r !== "_headers" && !allowed.has(r)) stray.push(r);
        }
    })(OUT, "");
    if (stray.length) problems.push(...stray.map(s => `غير مُصرَّحٍ به في المُخرَج: ${s}`));

    if (problems.length) {
        console.error("✗ فشل بناء النشر:");
        for (const p of problems) console.error("   " + p);
        process.exit(1);
    }

    console.log(`dist/  ${copied} ملفًّا · ${(bytes / 1048576).toFixed(1)} ميغا`);
    console.log("_headers مكتوبة (CSP · HSTS · X-Frame-Options · nosniff)");
    console.log("DIST_OK");
}

main();
