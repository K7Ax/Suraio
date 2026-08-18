// tests/feedback.test.js — «أبلغ وقيّم» (المرحلة هـ).
//
// لماذا اختباراتٌ على المصدر: النظام موزَّعٌ على خمس طبقاتٍ لا تشترك في مُصرِّف
// واحد — SQL و Deno و JS المتصفّح و HTML و bot.js — وكلّ عطبٍ يخصّه هو **انحراف
// نسخةٍ عن أخرى**: قيمةٌ في القائمة المنسدلة لا يقبلها الخادم، حدثٌ يرسله
// العميل ويرفضه الـCHECK، حالةٌ يكتبها البوت ولا تعرفها اللوحة. لا يظهر أيٌّ من
// هذه في تشغيلٍ محلّيّ، ويظهر كلّها على أوّل لاعبٍ حقيقيّ.
//
// القاعدة: يفشل حين تنحرف نسخةٌ عن أختها، لا حين يُعاد صياغة سطر.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const FN = rd('supabase', 'functions', 'submit-feedback', 'index.ts');
const SQL = rd('supabase', 'sql', 'feedback_and_ratings.sql');
const MAIN = rd('src', 'main.js');
// ‏«أبلغ وقيّم» خرجت من `main.js` إلى وحدتها؛ `MAIN` يبقى لأجل الوصل وحده.
const FB = rd('src', 'ui', 'feedback.js');
// ‏وللحارس السالب أدناه — «لا يرسل العميل حدثًا يرفضه CHECK» — المدى الصحيح
// ‏هو شيفرةُ العميل كلُّها لا ملفٌّ واحد. حصرُه في `main.js` كان يعني أنّ حدثًا
// ‏مخترَعًا في أيّ وحدةٍ أخرى يمرّ صامتًا؛ وهو عينُ ثقب `A10`.
const CLIENT = (function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|mjs)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'));
    }
    return out;
})(path.join(ROOT, 'src'), []);
// «الشرح المرئيّ» خرج من `main.js` إلى ملفّه، ومعه لوحُ `DEMOS.report`.
const DEMO = rd('src', 'ui', 'demo.js');
// ‏و`LIVE_GAMES`/`TITLES` خرجتا إلى `src/ui/meta.js` — يُسأل عنهما هنا:
import LIVE from './helpers/live.js';
const HTML = rd('index.html');
const CSS = rd('style.css');
const BOT = rd('bot.js');
const DASH = rd('dashboard.js');

// ---------------------------------------------------------------------------
// ١. الأحكام الثلاثة — أربع نسخٍ منها في أربع لغات
// ---------------------------------------------------------------------------
const VERDICTS = ['too_hard', 'just_right', 'too_easy'];

// بطاقة التقييم في القسم حُذفت بأمر المالك — «التقييم ما ابيه كذا مخصص ابي
// اقتراحات» — فلم تعد الأحكام في index.html أصلًا. لكنّها لم تُلغَ: سؤال ما بعد
// الفوز بنقرةٍ واحدة هو مكانها الصحيح، وهو يبنيها في `src/ui/feedback.js`.
// فالتطابق يبقى مطلوبًا بين SQL و Deno والوحدة، ويسقط الطرف الرابع لأنّه لم
// يعد موجودًا.
test('الأحكام الثلاثة متطابقة في SQL و Deno وسؤال ما بعد الفوز', () => {
    for (const v of VERDICTS) {
        assert.ok(SQL.includes(`'${v}'`), `SQL: ${v} مفقود`);
        assert.ok(FN.includes(`"${v}"`), `submit-feedback: ${v} مفقود`);
        assert.ok(FB.includes(`data-verdict="${v}"`), `وحدة البلاغ: لوح ما بعد الفوز يفتقد ${v}`);
    }
    // والعكس: لا حكمَ رابعٌ تسلّل إلى الواجهة بلا مقابلٍ في الخادم.
    const inUi = [...FB.matchAll(/data-verdict="([a-z_]+)"/g)].map(m => m[1]);
    for (const v of new Set(inUi)) {
        assert.ok(VERDICTS.includes(v), `الواجهة: حكمٌ لا يعرفه الخادم: ${v}`);
    }
    assert.ok(!HTML.includes('id="rate-form"'), 'بطاقة التقييم المحذوفة ما زالت في الصفحة');
});

// ---------------------------------------------------------------------------
// ٢. الحالات الأربع — البوت واللوحة و CHECK
// ---------------------------------------------------------------------------
test('حالات البلاغ متطابقة في SQL والبوت واللوحة', () => {
    const states = ['new', 'triaged', 'fixed', 'wontfix'];
    const check = /status .*check \(status in \(([^)]*)\)/s.exec(SQL);
    assert.ok(check, 'SQL: قيد الحالة غير موجود');
    for (const s of states) {
        assert.ok(check[1].includes(`'${s}'`), `SQL: الحالة ${s} مفقودة من CHECK`);
        assert.match(BOT, new RegExp(`STATUS_LABEL[\\s\\S]{0,200}\\b${s}:`), `bot.js: الحالة ${s} بلا تسمية`);
        assert.match(DASH, new RegExp(`R_STATUS[\\s\\S]{0,200}\\b${s}:`), `dashboard.js: الحالة ${s} بلا تسمية`);
    }
});

// ---------------------------------------------------------------------------
// ٣. الأحداث الثلاثة الجديدة — العميل يرسلها، و CHECK يقبلها
// ---------------------------------------------------------------------------
test('كل حدثٍ يرسله نظام البلاغ موجودٌ في CHECK على game_events', () => {
    const allowed = /game_events_event_type_check[\s\S]*?check \(event_type in \(([\s\S]*?)\)\)/.exec(SQL);
    assert.ok(allowed, 'SQL: توسيع CHECK غير موجود');
    const set = new Set([...allowed[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
    for (const e of ['report_opened', 'report_sent', 'rating_given']) {
        assert.ok(set.has(e), `CHECK لا يقبل ${e} — الحدث سيُرفض في الإنتاج`);
        assert.ok(FB.includes(`track('${e}'`), `وحدة البلاغ لا ترسل ${e}`);
    }
    // ولا يرسل العميل حدثًا خارج القائمة أصلًا — في أيّ وحدةٍ كانت.
    assert.ok(CLIENT.length > 20, 'مسحُ src/ رجع ناقصًا — الحارس يفحص لا شيء');
    for (const src of CLIENT) {
        for (const m of src.matchAll(/track\('([a-z_]+)'/g)) {
            assert.ok(set.has(m[1]), `العميل يرسل حدثًا يرفضه CHECK: ${m[1]}`);
        }
    }
});

// ---------------------------------------------------------------------------
// ٤. الألعاب — لا لعبةَ في القائمة المنسدلة يرفضها الخادم
// ---------------------------------------------------------------------------
test('LIVE في submit-feedback يشمل كل LIVE_GAMES ولا يخترع لعبة', () => {
    const live = new Set([...(/const LIVE = new Set\(\[([\s\S]*?)\]\)/.exec(FN)[1])
        .matchAll(/"([a-z_]+)"/g)].map(m => m[1]));
    for (const g of LIVE.LIVE_GAMES) {
        assert.ok(live.has(g), `submit-feedback يرفض «${g}» وهي معروضةٌ للتقييم`);
    }
    const titles = new Set(Object.keys(LIVE.TITLES));
    for (const g of live) {
        assert.ok(titles.has(g), `submit-feedback يقبل «${g}» ولا اسم لها في TITLES`);
    }
});

// ---------------------------------------------------------------------------
// ٥. السقوف الخادميّة — النسخة التي تعمل على جهازٍ لا يملكه المهاجم
// ---------------------------------------------------------------------------
test('submit-feedback يحمل سقوفه كلّها', () => {
    assert.match(FN, /MAX_BODY = 400_000/);
    assert.match(FN, /MAX_IMAGE_BYTES = 260_000/);
    assert.match(FN, /bodyTooLarge\(req, MAX_BODY\)/);
    assert.match(FN, /capped\(/);
    // الصورة تُقاس قبل فكّها لا بعده: سقفٌ يُطبَّق بعد التخصيص ليس سقفًا.
    assert.match(FN, /m\[2\]\.length \* 3 \/ 4\) > MAX_IMAGE_BYTES/);
    // وصورةٌ فقط — لا `data:text/html`.
    assert.match(FN, /\^data:\(image\\\/\(\?:jpeg\|png\|webp\)\)/);
});

test('حدّ المعدّل يُحسب في الجدول لا في ذاكرة العزلة، وبمفتاحين', () => {
    // A6: الحدّ داخل العزلة مقيسٌ بلا أثر. الجديد يعدّ في feedback_reports.
    assert.match(FN, /from\("feedback_reports"\)[\s\S]{0,200}count: "exact"/);
    assert.match(FN, /\.eq\("device_id", deviceId\)/);
    assert.match(FN, /\.eq\("context->>ip", ip\)/);
    assert.match(FN, /PER_DEVICE_HOUR/);
    assert.match(FN, /PER_IP_HOUR/);
});

test('هويّة المقيّم تُقرَّر في الخادم — وإلّا صار اللاعب مئة صوت', () => {
    assert.match(FN, /const rater = caller\?\.id \?\? `dev:\$\{deviceId\}`/);
    assert.ok(!/body\.rater/.test(FN), 'submit-feedback يقرأ rater من العميل');
    assert.match(SQL, /create unique index[^\n]*game_ratings_identity[\s\S]{0,80}\(rater, game_type\)/);
});

test('الجدولان محميّان: RLS مفعّلة بلا سياسة (الكاتب الوحيد هو مفتاح الخدمة)', () => {
    for (const t of ['feedback_reports', 'game_ratings']) {
        assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security`), `${t}: RLS غير مفعّلة`);
        assert.ok(!new RegExp(`create policy[^;]*on public\\.${t}`).test(SQL), `${t}: سياسةٌ تفتح الجدول للمتصفّح`);
    }
});

test('الدوالّ الثلاث الجديدة SECURITY DEFINER ومحجوبةٌ عن anon', () => {
    for (const f of ['dash_reports', 'dash_ratings', 'report_month']) {
        assert.match(SQL, new RegExp(`function public\\.${f}[\\s\\S]{0,400}security definer`), `${f}: ليست SECURITY DEFINER`);
        assert.match(SQL, new RegExp(`function public\\.${f}[\\s\\S]{0,600}is_sura_admin\\(\\)`), `${f}: بلا بوّابة`);
    }
    assert.match(SQL, /revoke execute on function public\.dash_reports\(int\), public\.dash_ratings\(\) from public, anon/);
    assert.match(SQL, /revoke execute on function public\.report_month\(text\) from public, anon/);
    // report_month وحدها تقبل مفتاح الخدمة، ولسببٍ مكتوب: البوت لا بريد له.
    assert.match(SQL, /auth\.jwt\(\) ->> 'role', ''\) = 'service_role'/);
});

// ---------------------------------------------------------------------------
// ٦. الواجهة — العرض التوضيحيّ والميكروفون والحركة
// ---------------------------------------------------------------------------
test('DEMOS.report موجودٌ بأربع خطوات، ويُسمّى بلا تسجيل لعبةٍ وهميّة', () => {
    // `\s*` لا `\n`: النمط لا يفترض شكلَ نهاية السطر أصلًا.
    const demo = /report: \[([\s\S]*?)\s*\]\s*\};/.exec(DEMO);
    assert.ok(demo, 'DEMOS.report غير موجود');
    assert.equal((demo[1].match(/\{ cap:/g) || []).length, 4, 'عدد خطوات العرض تغيّر');
    assert.match(DEMO, /const DEMO_TITLES = \{ report:/);
    assert.match(DEMO, /DEMO_TITLES\[game\] \|\| titleOf\(game\)/);
    // ووحدةٌ لا تُنادى تُبقي ما فوقها أخضرَ بينما لا شرحَ في الموقع.
    assert.match(MAIN, /import \{ initDemo \} from '\.\/ui\/demo\.js';/);
    assert.match(MAIN, /\n {4}initDemo\(\);/);
    // ‏والنظامُ نفسُه كذلك: وحدةٌ لا تُنادى تترك النموذجَ حيًّا في `index.html`
    // ‏وصامتًا، فيبدو سليمًا لكلّ اختبارٍ يقرأ محتواها.
    assert.match(MAIN, /import \{ initFeedback \} from '\.\/ui\/feedback\.js';/);
    assert.match(MAIN, /\n {4}initFeedback\(\);/);
    // «البلاغ» ليست لعبة: لا تدخل TITLES ولا LIVE_GAMES.
    assert.ok(!LIVE.LIVE_GAMES.includes('report'), 'report تسلّلت إلى LIVE_GAMES');
    assert.ok(!('report' in LIVE.TITLES), 'report تسلّلت إلى TITLES');
});

test('زرّ الميكروفون مخفيٌّ في الترميز، ولا يظهر إلّا بوجود الواجهة', () => {
    // صندوقان يُكتب فيهما نصّ: «ما المشكلة؟» و«ما اقتراحك؟» — ولكلٍّ زرّ إملاء.
    const mics = [...HTML.matchAll(/<button[^>]*class="fb-mic"[^>]*>/g)].map(m => m[0]);
    assert.ok(mics.length >= 2, 'أزرار الإملاء ناقصة');
    for (const m of mics) assert.ok(/\bhidden\b/.test(m), `زرّ إملاءٍ ظاهرٌ افتراضيًّا: ${m}`);
    // فايرفوكس لا يملك الواجهة — والإظهار مشروطٌ بوجودها لا بمحاولة الاستعمال.
    assert.match(FB, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
    assert.match(FB, /if \(SR\) \{[\s\S]{0,200}btn\.hidden = false/);
    assert.match(FB, /rec\.lang = 'ar-SA'/);
});

test('لا حركة opacity على أحفاد .scroll-section — القاعدة التي تجمّد iOS', () => {
    // البطاقتان داخل <section class="second-page scroll-section" id="games">.
    const block = /@keyframes fbRise \{([\s\S]*?)\}\s*\}/.exec(CSS);
    assert.ok(block, 'fbRise غير موجود');
    assert.ok(!/opacity/.test(block[1]), 'fbRise يحرّك opacity — تتجمّد على iOS Safari');
    const card = /\.fb-card \{([\s\S]*?)\}/.exec(CSS);
    assert.ok(card && !/opacity:\s*0/.test(card[1]), '.fb-card يبدأ بشفافيّة صفر');
});

test('القسم الجديد حلّ محلّ الأرشيف فعلًا', () => {
    assert.ok(HTML.includes('class="feedback-section"'), 'قسم البلاغ غير موجود');
    assert.ok(!HTML.includes('archives-section'), 'كتلة الأرشيف ما زالت في الصفحة');
    // صندوقٌ واحدٌ للبلاغ وآخر للاقتراح. الحقول الموجَّهة الثلاثة حُذفت بأمر
    // المالك، وهذا الاختبار يحرس بقاءها محذوفة: «اوصف المشكله وارفق صوره يكفي».
    for (const id of ['fb-happened', 'idea-text', 'idea-game']) {
        assert.ok(HTML.includes(`id="${id}"`), `${id} مفقود`);
    }
    for (const id of ['fb-doing', 'fb-expected', 'fb-count']) {
        assert.ok(!HTML.includes(`id="${id}"`), `${id} عاد إلى النموذج — التعقيد المحذوف`);
    }
});

test('لا حدَّ أدنى تعجيزيًّا: صندوقٌ واحد، وصورةٌ تكفي عن الكلام', () => {
    // ٤٠ حرفًا كانت الشكوى الأولى. لا تعود لا في العميل ولا في الخادم.
    assert.ok(!/MIN_CHARS/.test(FB), 'وحدة البلاغ أعادت الحدّ الأدنى ٤٠');
    assert.ok(!/MIN_HAPPENED/.test(FN), 'submit-feedback ما زال يحمل الحدّ القديم');
    assert.ok(!/اكتب وصفًا أوضح قليلًا/.test(FN) && !/اكتب وصفًا أوضح قليلًا/.test(FB),
        'رسالة «اكتب وصفًا أوضح» ما زالت موجودة');
    assert.match(FN, /MIN_TEXT = 8/);
    assert.match(FN, /MIN_TEXT_WITH_PHOTO = 3/);
    // والعميل يطبّق العتبتين نفسيهما كي لا يرفض الخادمُ ما قبله العميل.
    assert.match(FB, /text\.length < \(imageData \? 3 : 8\)/);
    // و`doing` تُبنى في الخادم: العمود NOT NULL والنموذج لم يعد يسأل عنها.
    assert.match(FN, /const doing = \[/);
    assert.ok(!/body\.doing/.test(FN), 'submit-feedback ما زال يقرأ doing من العميل');
});

test('الاقتراح بلاغٌ بوجهٍ آخر — جدولٌ واحد يفرّقه context.kind', () => {
    assert.match(FN, /const isIdea = kind === "idea"/);
    assert.match(FN, /context\.kind = "idea"/);
    // «بشكل عام» هو الخيار الأوّل والافتراضيّ: الفكرة عن الموقع كلّه هي الشائع.
    assert.match(FB, /<option value="">بشكل عام<\/option>/);
    // والبوت يميّزها في الطابور وفي وسم الـIssue.
    assert.match(BOT, /const isIdea = r =>/);
    assert.match(BOT, /idea \? "enhancement" : "bug"/);
    for (const q of ['feedback_reports?select=id,created_at,status,game_type,level_number,doing,happened,github_issue,photo_file_id,context',
        'feedback_reports?select=id,created_at,status,game_type,level_number,doing,expected,happened,github_issue,context']) {
        assert.ok(BOT.includes(q), 'استعلام البوت لا يجلب context فلا يستطيع تمييز الاقتراح');
    }
});

test('خلفيّة البطاقة شفّافة — بأمر المالك «خل الخلفيه شفافه»', () => {
    const card = /\.fb-card \{([\s\S]*?)\}/.exec(CSS);
    assert.ok(card, '.fb-card غير موجودة');
    assert.match(card[1], /background:\s*transparent/);
    assert.ok(!/backdrop-filter/.test(card[1]), '.fb-card ما زالت تحمل ضبابًا خلفيًّا');
});

// ---------------------------------------------------------------------------
// ٧. الأسرار والتدهور الآمن
// ---------------------------------------------------------------------------
test('لا رمز GitHub في المستودع، والغياب يتدهور ولا يتعطّل', () => {
    assert.match(BOT, /process\.env\.GITHUB_TOKEN/);
    assert.ok(!/gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}(?!x)/.test(BOT), 'bot.js يحمل رمزًا حقيقيًّا');
    assert.match(BOT, /غير مُهيَّأ/, 'الزرّ لا يقول شيئًا حين يغيب الرمز');
    assert.match(BOT, /function ghConfigured/);
    // ولا يُطبَع الرمز ولا جسم ردّ GitHub في محادثة.
    assert.ok(!/console\.log\([^)]*GITHUB_TOKEN/.test(BOT));
});

test('التقرير الشهريّ صفر توكنز — ونداءٌ واحدٌ اختياريّ للسرد فقط', () => {
    assert.match(BOT, /async function monthReport/);
    assert.match(BOT, /sbRpc\("report_month"/);
    // نداء Groq الوحيد، وهو آخر ما يحدث، ويسقط بلا أثر.
    assert.equal((BOT.match(/functions\/v1\/groq-review/g) || []).length, 2,
        'عدد نداءات groq-review تغيّر (المراجعة + السرد)');
    assert.match(BOT, /const prose = await narrate\(mo, d\)\.catch\(\(\) => null\)/);
    // ولا يرى النموذج نصّ بلاغٍ كتبه لاعب — لا مدخل لحقن الموجّهات.
    const nar = /async function narrate\([\s\S]*?\n\}/.exec(BOT)[0];
    assert.ok(!/recent|happened|doing/.test(nar), 'narrate يمرّر نصًّا كتبه لاعب إلى النموذج');
});

test('البلاغ يُخزَّن ولو سقط تلغرام — الصفّ هو السجلّ لا التنبيه', () => {
    assert.match(FN, /notifyTelegram\([\s\S]{0,400}\} catch \{ \/\* the row still gets written/);
    assert.match(FN, /if \(!token \|\| !chat\) return \{ sent: false, fileId: null \}/);
    // و`notified` يقول الصدق: كان `!!fileId` فلا يصير true إلّا مع صورة، فيبدو
    // البلاغ النصّيّ الواصل كأنّه لم يصل.
    assert.ok(!/notified: !!fileId/.test(FN), 'notified ما زال يقيس الصورة لا الإرسال');
    assert.match(FN, /return \{ sent: res\.ok, fileId \}/);
    // والصورة لا تلمس Storage: لا يُخزَّن إلّا file_id.
    assert.ok(!/storage\.from\(/.test(FN), 'submit-feedback يكتب في Storage');
    assert.match(FN, /photo_file_id: fileId/);
});

test('النجمة تركب مع الاقتراح — اختياريّة، ولا تلوّث جدول الصعوبة', () => {
    // البطاقة: خمس نجوم في مجموعة أزرارٍ حقيقيّة، والاختياريّة مكتوبةٌ لا مفترضة.
    assert.match(HTML, /id="idea-stars"[^>]*role="radiogroup"/);
    assert.equal((HTML.match(/class="fb-star"/g) || []).length, 5);
    assert.match(HTML, /fb-optional">\(اختياري\)/);

    // العميل: صفرٌ يعني «لم يُجب»، ولا تُقرأ النجمة بعد تصفيرها.
    assert.match(FB, /stars: ideaStarValue \|\| null/);
    assert.match(FB, /const sentStars = ideaStarValue \|\| null;[\s\S]{0,400}ideaStarValue = 0;/);
    // وإعادة الضغط على النجمة نفسها تمحوها — لا بابَ ذا اتّجاهٍ واحد.
    assert.match(FB, /\(n === ideaStarValue\) \? 0 : n/);

    // الخادم: خارج ١..٥ يعني غائبة، والاقتراح وحده يحملها.
    assert.match(FN, /starsRaw >= 1 && starsRaw <= 5 \? starsRaw : null/);
    assert.match(FN, /if \(isIdea && stars != null\) context\.stars = String\(stars\)/);
    // ولا تُكتب في game_ratings: ذاك جدول الصعوبة، ومحوره غير محور الجودة.
    const rate = /async function handleRating\(\)[\s\S]*?\n  \}/.exec(FN)[0];
    assert.ok(!/context\.stars/.test(rate), 'نجمة الاقتراح تسرّبت إلى جدول الصعوبة');

    // تلغرام والبوت: سطرٌ يظهر عند وجودها ويغيب عند غيابها — لا «—».
    assert.match(FN, /st >= 1 && st <= 5 \? `التقييم: /);
    assert.match(BOT, /function starsOf/);
    assert.ok(!/starsOf\(r\) \|\| "—"/.test(BOT));
});
