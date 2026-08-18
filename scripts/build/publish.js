#!/usr/bin/env node
// ‏يبني شجرةَ المستودع العامّ في `.publish/` من هذه الشجرة.
//
// ‏لماذا سكربتٌ لا نسخةٌ يدويّة. المستودعُ الخاصّ لا يمكن أن يصير عامًّا أبدًا —
// ‏تاريخُه يحمل ما لا يُسحب، ووزنُه ١٫١٨ غيغا. فالنشرُ شجرةٌ جديدةٌ بتاريخٍ
// ‏نظيف؛ ونسخةٌ تُبنى مرّةً باليد تنحرف عن أصلها في أوّل أسبوع، وهذا يُعيد
// ‏بناءها متى شئت.
//
// ‏والقائمةُ **حجبٌ صريح** لا سماحٌ صريح، على عكس `dist.js`. الفرق مقصود:
// ‏`dist.js` يحرس ما يصل المتصفّح فالخطأ فيه تسريبُ ملفٍّ إلى شبكةِ توصيل،
// ‏وهنا الخطأ نشرُ سطرٍ لا يُسحب. لكنّ الحجبَ وحده لا يكفي حارسًا، فيلي
// ‏النسخَ مسحُ أسرارٍ على الناتج نفسِه: لو تسلّل ملفٌّ لم يخطر ببال أحد،
// ‏فالمسحُ آخرُ ما يمسكه قبل أن يصير التزامًا في تاريخٍ عامّ.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.publish');

// ‏ما لا يُنشر، ومعه سببُه. السببُ جزءٌ من الملفّ لا تعليقٌ عليه: قائمةٌ بلا
// ‏أسبابٍ تُراجَع بعد سنةٍ فلا يعرف أحدٌ أيَّ سطرٍ صار عتيقًا.
const WITHHOLD = [
    ['bot.js', 'الكاتبُ بصلاحية service role: شكلُ كلِّ كتابةٍ ممتازة ومصافحةُ SURA_ADMIN_SECRET'],
    ['docs/operations/SETUP_TELEGRAM_BOT.md', 'تجهيزُ البوت نفسِه'],
    ['docs/operations/botfather-setup.txt', 'تجهيزُ البوت نفسِه'],
    // ‏المراقبُ يخصّ المستودعَ الخاصّ وحده: جدولُه كلَّ عشر دقائق يحتاج أربعةَ
    // ‏أسرارٍ لا تُوضع في مستودعٍ عامّ، فيصير جدارَ إخفاقاتٍ حمراءَ في صفحة
    // ‏Actions. أمّا `ci.yml` فيبقى — بلا أسرارٍ وبلا تثبيت، فيعمل أخضرَ للقارئ.
    ['.github/workflows/monitor.yml', 'مراقبةُ الإنتاج — تسكن مستودعَ Sura الخاصّ'],
    ['dashboard.html', 'سطحُ الإدارة'],
    ['dashboard.js', 'يثبّت بريدَ المالك في الشيفرة، ويُعدّد دوالَّ dash_*'],
    ['bank/words_ar.json', 'مفرداتُ الحلول'],
    ['bank/lexicon_ar.json', 'مفرداتُ الحلول'],
    ['docs/security/open-findings.md', 'ما لم يُغلَق بعدُ على خدمةٍ حيّة'],
    ['docs/operations/incident-runbook.md', 'ترتيبُ العمليّات أثناء حادثة'],
    ['supabase/sql/migrations_pending.sql', 'SQL لم يُطبَّق'],
    // ‏٢٣١ كيلوبايت من مفتاحِ الإجابة لكلّ لغزٍ مبذور. كان يُوقَف بـ`.gitignore`
    // ‏وحدَه — أي أنّه يُنسَخ إلى الناتج ويعتمد على طبقةٍ واحدة. حجبٌ صريحٌ خيرٌ
    // ‏من حمايةٍ بالمصادفة.
    ['supabase/sql/seed.sql', 'مفتاحُ إجابةِ كلّ لغزٍ مبذور'],
    ['prompts', 'مكتبةُ التوجيهات'],
    ['docs/historical/final-audit', 'مراجعةٌ سداسيّةٌ تقرأ كخارطةِ مهاجم'],
    // ‏ثلاثُ وثائقَ تحمل المبدأَ نفسَه الذي حجب `open-findings.md` لكنّها عبرت
    // ‏بأسمائها. وهذه القائمةُ نفسُها تُنشَر، فالسببُ يُكتب عامًّا عمدًا: تسميةُ
    // ‏البندِ هنا تعيد نشرَ ما حُجب.
    ['docs/security/launch-security.md', 'ما لم يُغلَق بعدُ على خدمةٍ حيّة'],
    ['docs/historical/security-audit-2026-08.md', 'ما لم يُغلَق بعدُ على خدمةٍ حيّة'],
    ['docs/historical/security-fixes-2026-08.md', 'ما لم يُغلَق بعدُ على خدمةٍ حيّة'],
    // ‏أُضيفت بعد أن نسخت أوّلُ نسخةٍ `.env` فعلًا إلى الناتج بأسرارٍ حيّة.
    ['.env', 'الأسرارُ الحيّة نفسُها'],
    ['supabase/.temp', 'معرّفاتُ المشروع ورابطُ التجميع من CLI'],
    ['bank/.lexicon_vet_cache.json', 'ذاكرةُ عملٍ محلّيّة'],
];

// ‏جذورٌ مسموحة. هذه هي الإصلاحُ البنيويّ لا سطرٌ في قائمة الحجب: التمشيةُ
// ‏كانت «كلُّ شيءٍ إلّا ما مُنع»، فأيُّ ملفٍّ جديدٍ في الجذر يركب معها صامتًا —
// ‏وهكذا ركب `.env`. صارت «هذه الجذورُ وحدها، ناقصًا المحجوب»، فالمجهولُ
// ‏يُستبعَد افتراضًا لا يُقبَل افتراضًا.
const ALLOW_ROOTS = new Set([
    'index.html', 'app.js', 'style.css', '404.html', 'tallal.js',
    'hub.html', 'privacy.html', '_headers', 'robots.txt', 'sitemap.xml',
    'package.json', 'package-lock.json', 'README.md', 'README.ar.md',
    'LICENSE', 'SECURITY.md', '.gitignore', '.gitattributes', '.env.example',
    'src', 'bank', 'public', 'supabase', 'scripts', 'tests', 'tools',
    'docs', '.github',
]);

// ‏لا يدخل النسخةَ أصلًا: ناتجُ بناءٍ، أو عملٌ محلّيّ، أو ثقيلٌ بلا قيمةٍ لقارئ.
const SKIP_DIRS = new Set([
    '.git', '.publish', 'node_modules', 'dist', 'archive', '_design-src',
    '.work', 'promo',
]);
// ‏وكلُّ مجلّدٍ نقطيٍّ غيرِ مأذونٍ في `ALLOW_ROOTS` — إعداداتُ أدواتٍ محلّيّة
// ‏وذاكرةُ عملٍ ومقاييس. قاعدةٌ لا قائمة: القائمةُ تُنسى يومَ تظهر أداةٌ جديدة،
// ‏والقاعدةُ تشملها يومَها. والملفّاتُ النقطيّة لا تدخل تحتها، فيبقى `.env`
// ‏ظاهرًا في تقرير المرفوضات حيث يجب أن يُرى.
const skipDotDir = (e) => e.isDirectory() && e.name.startsWith('.')
    && !ALLOW_ROOTS.has(e.name);

// ‏أنماطُ الأسرار. يُمسح **الناتج** لا المصدر: ما يهمّ هو ما سيُلتزَم فعلًا.
//
// ‏وكلُّها تطابق **قيمًا** لا أسماء. أوّلُ صياغةٍ وضعت `/service_role/i` فأخرجت
// ‏ثماني عشرة إصابةً ليس فيها سرٌّ واحد: «service_role» اسمُ دورٍ في Postgres
// ‏واسمُ متغيّرِ بيئة، يرد في كلّ دالّةٍ حَديّةٍ وكلّ ملفّ SQL بحكم وظيفته.
// ‏حارسٌ يصرخ في كلّ مرّةٍ لا يُقرأ بعد الثالثة، فيصير غيابُه أأمنَ من وجوده.
const SECRETS = [
    // ‏اسمُ المفتاح متبوعًا بقيمةٍ حرفيّةٍ طويلة — وهذا هو التسريبُ فعلًا.
    // ‏و`ANON_KEY` ليس منها عمدًا: مفتاحُ النشر `sb_publishable_…` عامٌّ بالتصميم
    // ‏ويسكن `index.html` بحقّ — الحمايةُ من RLS لا من إخفائه. ولو حلّ محلَّه
    // ‏سرٌّ يومًا فأنماطُ القيمة أدناه تمسكه في أيّ خانةٍ وُضع فيها.
    [/(SERVICE_ROLE_KEY|SERVICE_KEY|API_KEY|BOT_TOKEN|ADMIN_SECRET)\s*[:=]\s*['"][A-Za-z0-9._-]{24,}['"]/i, 'مفتاحٌ بقيمةٍ حرفيّة'],
    [/\bsbp_[0-9a-f]{20,}/, 'Supabase PAT'],
    [/\bgsk_[A-Za-z0-9]{20,}/, 'Groq key'],
    [/\bsb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
    [/eyJhbGciOi[A-Za-z0-9_-]{20,}/, 'JWT'],
    [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, 'Telegram bot token'],
    [/sk-[A-Za-z0-9]{32,}/, 'OpenAI key'],
];
// ‏نصوصٌ تذكر النمطَ لتشرحه لا لتحمله. تُستثنى بالمسار، ويُطبع ما استُثني.
const SECRET_TEXT_OK = new Set([
    'SECURITY.md', 'README.md', '.env.example',
    'docs/security/security.md', 'docs/security/launch-security.md',
    'docs/operations/deployment.md', 'docs/operations/git-hygiene.md',
    'docs/operations/ai-agent-rules.md', 'scripts/build/publish.js',
    'scripts/build/dist.js', 'tests/security.test.js', 'tests/dist.test.js',
]);

const withheld = new Set(WITHHOLD.map(w => w[0]));
const isWithheld = rel => {
    for (const w of withheld) if (rel === w || rel.startsWith(w + '/')) return true;
    return false;
};

const rejectedRoots = [];
function walk(dir, rel, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name) || skipDotDir(e)) continue;
        const r = rel ? rel + '/' + e.name : e.name;
        // ‏في الجذر وحده: ما ليس في `ALLOW_ROOTS` لا يُنسخ ويُبلَّغ عنه.
        if (!rel && !ALLOW_ROOTS.has(e.name)) { rejectedRoots.push(e.name); continue; }
        if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
        else if (!isWithheld(r)) out.push(r);
    }
    return out;
}

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

// ‏تُفرَّغ شجرةُ الناتج مع **إبقاء `.git`**. حذفُها كان يمحو الرابطَ بالمستودع
// ‏البعيد وتاريخَه، فتصير كلُّ إعادةِ نشرٍ دفعةً أولى من جديد — ويغري ذلك
// ‏بـ`push --force` على مستودعٍ عامّ. تُحذف المحتوياتُ لا المجلّد.
function emptyKeepingGit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir)) {
        if (e === '.git') continue;
        fs.rmSync(path.join(dir, e), { recursive: true, force: true });
    }
}

const files = walk(ROOT, '', []);
emptyKeepingGit(OUT);
let bytes = 0;
for (const rel of files) {
    const dst = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
    bytes += fs.statSync(dst).size;
}

// ‏`.gitignore` في الناتج يُنقّى من قواعدَ تخصّ مجلّداتٍ لا وجودَ لها فيه أصلًا
// ‏(إعداداتُ أدواتٍ محلّيّة). قاعدةُ تجاهلٍ لشيءٍ غيرِ موجودٍ ليست حراسةً، وهي
// ‏في مستودعٍ عامٍّ سطرٌ يصف عُدّةَ صاحبه لا مشروعَه.
{
    const gp = path.join(OUT, '.gitignore');
    const lines = fs.readFileSync(gp, 'utf8').split(/\r?\n/);
    // ‏يُحذَف من قسم «العُدّة المحلّيّة» كلُّ قاعدةِ مجلّدٍ نقطيّ، ولا شيءَ سواه:
    // ‏تلك مجلّداتٌ لا وجودَ لها في الناتج، وقاعدةُ تجاهلٍ لغيرِ موجودٍ ليست
    // ‏حراسةً بل وصفًا لعُدّةِ صاحب المستودع. أمّا `.DS_Store` و`.venv/` وأمثالُهما
    // ‏فتنفع قارئًا يستنسخ، فتبقى. والقسمُ يُعرَف بترويسته لا بأسماءِ ما فيه.
    const isHeader = (l) => /^#\s*[─—-]*\s*\S/.test(l);
    let inTooling = false;
    const kept = lines.filter((l) => {
        if (isHeader(l)) inTooling = /Local tooling/i.test(l);
        return !(inTooling && /^\.[^/]+\/$/.test(l.trim()));
    });
    fs.writeFileSync(gp, kept.join('\n'));
}

// ---- سيرُ العمل في الناتج يُكتَب هنا، ولا يُنسَخ. ----------------------------
// ‏`ci.yml` الخاصُّ مكتوبٌ للشجرة الخاصّة: يمرّ على `promo/`، ويطلب `preflight`
// ‏الذي يشترط وجودَ لوحة الإدارة، ويشغّل ٣٥ ملفَّ اختبارٍ تقرأ تسعةٌ منها
// ‏`bot.js`. نسخُه كما هو يعني صفحةَ Actions حمراءَ في كلّ دفعة — وهو ما حدث
// ‏فعلًا في أوّل خمس دفعات. فالناتجُ يأخذ سير عملٍ يشغّل ما يستطيع، ويقول
// ‏صراحةً ما لا يستطيع ولماذا. البواباتُ الأربعُ الباقيةُ حقيقيّة، لا زينة.
const EXPORT_SKIP = [
    ['tests/authoring.test.js', 'bot.js'],
    ['tests/bank.test.js', 'bot.js'],
    ['tests/banks.test.js', 'bot.js'],
    ['tests/bot-admin.test.js', 'bot.js'],
    ['tests/bot_daily.test.js', 'bot.js'],
    ['tests/checks.test.js', 'bot.js'],
    ['tests/feedback.test.js', 'bot.js'],
    ['tests/normalize.test.js', 'bot.js'],
    ['tests/resolve.test.js', 'bot.js'],
    ['tests/dashboard.test.js', 'dashboard.js'],
    ['tests/dict.test.js', 'bank/words_ar.json'],
    ['tests/promo.test.js', 'promo'],
];

// ‏القائمةُ التي تعمل تُحسَب من الناتج، ولا تُكتب بيدٍ: ملفُّ اختبارٍ جديدٌ
// ‏يدخلها من تلقائه. قائمةُ استثناءٍ مكتوبةٌ بيدٍ تتعفّن؛ قائمةُ تشغيلٍ محسوبةٌ
// لا تتعفّن.
const skipSet = new Set(EXPORT_SKIP.map(([t]) => t));
const exportTests = fs.readdirSync(path.join(OUT, 'tests'))
    .filter(f => f.endsWith('.test.js')).map(f => 'tests/' + f)
    .filter(t => !skipSet.has(t)).sort();

const skipTable = EXPORT_SKIP
    .map(([t, need]) => `#   ${t.padEnd(30)} needs ${need}`).join('\n');

fs.writeFileSync(path.join(OUT, '.github', 'workflows', 'ci.yml'), `\
# CI for the PUBLIC EXPORT of Sura. This is not the private repository's
# workflow, and the difference is deliberate rather than a reduction in rigour.
#
# The export withholds four inputs — the service-role writer (bot.js), the
# solution lexicon, the admin dashboard, and the film sources. Every gate that
# reads one of them is therefore unrunnable here, and a workflow that runs it
# anyway is a red X that means nothing. What runs below is real:
#
#   * every first-party .js/.mjs file is parsed by node --check
#   * both bundles are rebuilt from src/ and proven identical to the committed
#     ones — the claim "the bundle is a build artefact, do not edit it" is
#     enforced, not asserted
#   * ${String(exportTests.length).padStart(2)} of the ${fs.readdirSync(path.join(OUT, 'tests')).filter(f => f.endsWith('.test.js')).length} test files run, with the live-Supabase ones skipped
#
# Not run here, and why:
${skipTable}
#   npm run build (preflight + CSP) requires dashboard.html/js, withheld above.
#
# All of it runs in the private repo, where those inputs exist.
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    env:
      SURA_SKIP_INTEGRATION: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install deps (esbuild)
        run: npm ci
      - name: Lint (syntax)
        run: npm run lint
      - name: Bundle src/ with esbuild
        run: npm run bundle && npm run bundle:404
      - name: The committed bundles match src/ (no drift)
        run: git diff --exit-code app.js tallal.js
      - name: Test
        run: node --test ${exportTests.join(' ')}
`);

// ---- الحرّاس. أيُّ إخفاقٍ هنا يمسح الناتجَ ويخرج بـ1: شجرةٌ نصفُ سليمةٍ
// ‏أخطرُ من لا شجرة، لأنّ أحدًا قد يدفعها.
const problems = [];

// ٠) قائمةُ الاستثناء في سير العمل تُفحَص، وإلّا صارت بعد شهرين اختباراتٍ
// ‏مُسقَطةً بلا سبب. الشرطان: الملفُّ المُستثنى موجودٌ فعلًا في الناتج (وإلّا
// ‏فالمدخلُ ميّت)، والمدخلُ الذي يحتاجه غائبٌ فعلًا عنه (وإلّا فالاستثناءُ كذب).
for (const [t, need] of EXPORT_SKIP) {
    if (!fs.existsSync(path.join(OUT, t)))
        problems.push(`استثناءُ اختبارٍ يسمّي ملفًّا ليس في الناتج: ${t}`);
    if (fs.existsSync(path.join(OUT, need)))
        problems.push(`استثناءُ ${t} يدّعي غيابَ ${need} وهو موجودٌ في الناتج`);
}

// ١) هل بقي محجوبٌ؟ الحجبُ يُتحقَّق منه على الناتج لا على النيّة.
for (const [w] of WITHHOLD) {
    if (fs.existsSync(path.join(OUT, w))) problems.push(`محجوبٌ ظهر في الناتج: ${w}`);
    // ‏ومدخلٌ يسمّي مسارًا لا وجودَ له في المصدر حارسٌ ميّت. غيابُ الملفّ من
    // ‏الناتج ليس دليلَ حجبٍ إن لم يكن في المصدر أصلًا: `migrations_pending.sql`
    // ‏انتقل إلى `supabase/sql/` فظلّ المدخلُ يبدو عاملًا والملفُّ يُنشَر منذئذٍ.
    if (!fs.existsSync(path.join(ROOT, w))) problems.push(`مدخلُ حجبٍ يسمّي مسارًا غيرَ موجود (انتقل؟): ${w}`);
}

// ٢) أيُّ ملفٍّ اسمُه `.env` شيءٌ ما. يُفحص بالاسم قبل المحتوى، لأنّ ملفًّا
// ‏كهذا لا يُنشر ولو بدا فارغًا: الفراغُ اليومَ ليس فراغًا غدًا.
for (const rel of files) {
    const base = path.posix.basename(rel);
    if (/^\.env(\..*)?$/.test(base) && base !== '.env.example') {
        problems.push(`ملفُّ بيئةٍ في الناتج: ${rel}`);
    }
}

// ٣) مسحُ الأسرار — على **كلّ** ملفٍّ نصّيّ، لا على امتداداتٍ معروفة.
//
// ‏أوّلُ صياغةٍ حصرت المسحَ في قائمة امتدادات، فنُسخ `.env` — وهو بلا امتداد —
// ‏ولم يُمسح قطّ: أسرارٌ حيّةٌ جلست في الناتج وراء حارسٍ لا يراها. القاعدة:
// ‏الحارسُ الذي يختار ما يفحصه بامتدادٍ يفحص ما يتذكّره كاتبُه، لا ما يوجد.
// ‏فيُفحص الآن كلُّ ما ليس ثنائيًّا، ويُكشف الثنائيُّ بأوّل بايتاته لا باسمه.
const BINARY = /\.(png|jpe?g|webp|gif|svg|ico|mp4|webm|mp3|wav|woff2?|ttf|otf|zip|pdf|exe)$/i;
const skippedScan = [];
let scanned = 0;
for (const rel of files) {
    if (BINARY.test(rel)) continue;
    if (SECRET_TEXT_OK.has(rel)) { skippedScan.push(rel); continue; }
    const buf = fs.readFileSync(path.join(OUT, rel));
    if (buf.includes(0)) continue;          // ثنائيٌّ لم يُعلن عن نفسه بامتداده
    scanned++;
    const src = buf.toString('utf8');
    for (const [re, name] of SECRETS) {
        const m = src.match(re);
        if (m) problems.push(`سِرٌّ محتمل (${name}) في ${rel}: ${m[0].slice(0, 12)}…`);
    }
}

// ٣) روابطُ markdown الداخليّة. رابطٌ مكسورٌ في الصفحة الأولى يقرأ كإهمال.
const broken = [];
for (const rel of files.filter(f => f.endsWith('.md'))) {
    const src = fs.readFileSync(path.join(OUT, rel), 'utf8');
    for (const m of src.matchAll(/\[[^\]]*\]\(([^)#:]+\.(?:md|sql|js|mjs|json|html|txt|yml))\)/g)) {
        const t = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
        if (!fs.existsSync(path.join(OUT, t))) broken.push(`${rel} → ${m[1]}`);
    }
}
for (const b of broken) problems.push(`رابطٌ مكسور: ${b}`);

// ٤) ما يجب أن يوجد. غيابُ الرخصة أو سياسةِ الأمن ليس تفصيلًا في مستودعٍ عامّ.
for (const must of ['README.md', 'LICENSE', 'SECURITY.md', 'index.html', 'app.js', 'package.json']) {
    if (!fs.existsSync(path.join(OUT, must))) problems.push(`ناقصٌ من الناتج: ${must}`);
}

const mb = (bytes / 1024 / 1024).toFixed(1);
if (problems.length) {
    rmrf(OUT);   // ‏عند الفشل يُمحى كلُّ شيءٍ ومعه `.git` عمدًا: شجرةٌ نصفُ سليمةٍ مربوطةٌ بمستودعٍ بعيدٍ أخطرُ من لا شيء.
    console.error('PUBLISH_FAIL — ' + problems.length + ' مشكلة (وحُذف الناتج):');
    for (const p of problems) console.error('  · ' + p);
    process.exit(1);
}

console.log(`.publish/ ${files.length} ملفًّا · ${mb} ميغا`);
console.log(`محجوب: ${WITHHOLD.length} مسارًا · مُسح: ${scanned} ملفًّا نصّيًّا · تُخطّي ${skippedScan.length} نصًّا يشرح الأنماط`);
// ‏يُطبع ما رُفض في الجذر لا ليُهمَل: هذه القائمةُ هي ما كان سيركب صامتًا.
if (rejectedRoots.length) {
    console.log(`رُفض في الجذر (خارج ALLOW_ROOTS): ${rejectedRoots.sort().join(' · ')}`);
}
console.log('PUBLISH_OK');
console.log('\nالخطوة التالية يدويّة عمدًا — لا يُنشئ هذا السكربت مستودعًا ولا يدفع:');
console.log('  cd .publish && git init && git add . && git commit -m "…" ');
console.log('  ثمّ أنشئ المستودعَ على GitHub وادفع إليه.');
