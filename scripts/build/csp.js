// scripts/csp — يولّد `_headers` من `index.html` نفسه، لا من الذاكرة.
//
// لماذا يُولَّد ولا يُكتَب بيد:
//
// في `index.html` ستّةُ سكربتاتٍ مضمَّنة (‏inline). وسياسةُ محتوًى تسمح
// `script-src 'unsafe-inline'` تُلغي عمليًّا أهمَّ ما تشتريه السياسة أصلًا —
// منعَ حَقْنِ سكربت. والبديلُ الصحيح بصمةُ SHA-256 لكلّ سكربتٍ مضمَّن.
//
// لكنّ البصمات المكتوبة بيدٍ فخٌّ: أيُّ تعديلٍ في سطرٍ واحدٍ من سكربتٍ مضمَّن
// يُبطل بصمته، فيرفض المتصفّح تشغيله — والموقع ينكسر **في الإنتاج وحده**،
// صامتًا في التطوير لأنّ `_headers` لا تُطبَّق على الخادم المحلّيّ. فتوليدُها
// من الملفّ في كلّ بناءٍ يجعل الانحراف مستحيلًا بدل أن يجعله مُكتشَفًا.
//
// أمّا الأنماطُ المضمَّنة (‏39 خاصّيّة `style="…"`) فتبقى `'unsafe-inline'`:
// البصماتُ لا تغطّي خاصّيّات النمط، و`'unsafe-hashes'` تفتح بابًا أوسع ممّا
// تسدّ. وخطرُ نمطٍ محقونٍ أدنى بكثيرٍ من خطر سكربتٍ محقون، فهذه مقايضةٌ
// مقصودة ومكتوبة لا سهو.
//
// المنشأُ الخارجيّ مأخوذٌ من مسحِ الملفّات لا من التخمين:
//   res.cloudinary.com      الفيديو والصور
//   fonts.googleapis.com    ورقةُ الخطوط
//   fonts.gstatic.com       ملفّاتُ الخطوط
//   cdn.jsdelivr.net        supabase-js@2
//   *.supabase.co           الواجهةُ الخلفيّة (‏REST + Realtime عبر wss)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

/**
 * بصماتُ كلّ سكربتٍ مضمَّنٍ في ملفّ HTML.
 *
 * مسحٌ بحالةٍ لا تعبيرٌ نمطيّ. جُرِّب النمطُ `/<script…>([\s\S]*?)<\/script>/g`
 * أوّلًا وكسر الصفحةَ، لأنّه يرى ما لا يراه المتصفّح:
 *
 *   • `<script>` داخل تعليقةِ HTML ليس سكربتًا. وفي `index.html` تعليقةٌ فيها
 *     الكلمة، فبُصمت كتلةٌ وهميّةٌ طولها ١٤٬٦٤٨ حرفًا وسقط السكربتُ الحقيقيّ
 *     الذي يليها. النتيجةُ المقيسة: خمسُ مخالفاتٍ ثمّ واحدة.
 *   • ونهاياتُ الأسطر: الملفّ محفوظٌ بـCRLF، ومُحلّل HTML يطبّعها إلى LF قبل
 *     أن يبني نصّ السكربت — فالمتصفّح يبصم LF. بصمُ البايتات كما هي على القرص
 *     يعطي قيمةً لا تطابق شيئًا.
 *
 * فالمسحُ هنا يتقدّم في المستند مرّةً واحدة، ويقفز فوق التعليقات، ولا يبصم
 * إلّا ما يصل إليه المحلّل فعلًا.
 */
function hashesFor(file) {
    const html = fs.readFileSync(file, 'utf8');
    const out = [];
    let i = 0;
    while (i < html.length) {
        const c = html.indexOf('<!--', i);
        const s = html.search.call(html.slice(i), /<script\b/i);
        const sAbs = s < 0 ? -1 : i + s;

        // التعليقةُ أسبق ⇒ تُتخطّى كاملةً، وما فيها ليس شيفرة.
        if (c >= 0 && (sAbs < 0 || c < sAbs)) {
            const end = html.indexOf('-->', c + 4);
            i = end < 0 ? html.length : end + 3;
            continue;
        }
        if (sAbs < 0) break;

        const gt = html.indexOf('>', sAbs);
        if (gt < 0) break;
        const tag = html.slice(sAbs, gt + 1);
        // نهايةُ نصّ السكربت هي أوّل `</script>` — هكذا يفعل المحلّل.
        const close = html.toLowerCase().indexOf('</script', gt + 1);
        const bodyEnd = close < 0 ? html.length : close;

        // السكربتُ ذو `src` خارجيٌّ ولا يُبصَم.
        if (!/\ssrc\s*=/i.test(tag)) {
            const body = html.slice(gt + 1, bodyEnd).replace(/\r\n/g, '\n');
            const d = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
            out.push(`'sha256-${d}'`);
        }
        i = close < 0 ? html.length : html.indexOf('>', close) + 1;
    }
    return out;
}

// يُصدَّر كي تختبره `tests/csp.test.js` على الحالتين اللتين كسرتا الصفحة.
module.exports = { hashesFor };

// الصفحاتُ المنشورة وحدها — وهي نفسُها قائمةُ `FILES` في scripts/build/dist.js.
// لا تُدرَج صفحاتُ العرض التجريبيّة في الجذر: بصمُها يوسّع السياسةَ بلا داعٍ.
// و`hub.html` نُسيت هنا أوّلًا فكسرت تحت السياسة — أُضيفت بعد قياسٍ لا حدسًا.
const PAGES = ['index.html', '404.html', 'dashboard.html', 'hub.html', 'privacy.html']
    .filter(p => fs.existsSync(path.join(ROOT, p)));

// اتّحادُ بصمات كلّ الصفحات: `_headers` تُطبَّق بالمسار، ونحن نعطي الجميع
// السياسةَ نفسها، فلا بدّ أن تسع بصماتِ كلٍّ منها.
const hashes = [...new Set(PAGES.flatMap(p => hashesFor(path.join(ROOT, p))))];

const CSP = [
    "default-src 'self'",
    `script-src 'self' https://cdn.jsdelivr.net ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "media-src 'self' blob: https://res.cloudinary.com",
    // ‏blob: لازمةٌ لعامل الترميز (Worker) في مسار صورة البلاغ.
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
].join('; ');

// قواعدُ التخزين منقولةٌ حرفيًّا عمّا كانت `scripts/build/dist.js` تكتبه، فمساراتُها
// مطابقةٌ لما يخرج فعلًا في `dist/`. وقد نُقلت إلى هنا لأنّ ملفًّا واحدًا فقط
// يجوز أن يكتب `_headers`: كان الملفّان يكتبانها، فتغلب نسخةُ النشر — وهي
// النسخةُ المتساهلة — على هذه، وتذهب البصماتُ كلّها هباءً.
const HEADERS = `# مُولَّدٌ بـscripts/build/csp.js — لا يُحرَّر بيد. أعد البناء بدلًا من ذلك.
/*
  Content-Security-Policy: ${CSP}
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), camera=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

# الحزم مبصومةٌ بـ?v= من preflight، فالتخزين الطويل آمنٌ عليها.
/app.js
  Cache-Control: public, max-age=31536000, immutable
/style.css
  Cache-Control: public, max-age=31536000, immutable
/tallal.js
  Cache-Control: public, max-age=31536000, immutable
/bank/*
  Cache-Control: public, max-age=86400
/public/*
  Cache-Control: public, max-age=604800

# المستندُ نفسه لا يُخزَّن: هو الذي يحمل ?v= الجديدة. وصفحةُ الخطأ أولى بذلك.
/index.html
  Cache-Control: public, max-age=0, must-revalidate
/404.html
  Cache-Control: public, max-age=0, must-revalidate

# وثيقةٌ قانونيّة: تُقرأ نادرًا وتتغيّر نادرًا، لكنّ نسخةً قديمةً منها في ذاكرة
# متصفّحٍ تعني وعدًا لم يعد قائمًا. ساعةٌ سقفٌ للتخزين، لا أكثر.
/privacy.html
  Cache-Control: public, max-age=3600, must-revalidate
`;

fs.writeFileSync(path.join(ROOT, '_headers'), HEADERS, 'utf8');
console.log(`CSP_OK (${hashes.length} inline-script hashes over ${PAGES.length} pages)`);
