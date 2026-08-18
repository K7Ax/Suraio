// core/util — pure, dependency-free helpers shared across the app.
// These are bundled (esbuild) into the single app.js, so importing them costs
// nothing at runtime. NOTE: normalizeArabic must stay byte-identical to the Deno
// (submit-guess) and Postgres (normalize_arabic) copies — see tests/normalize.test.js.

export function normalizeArabic(s) {
    if (!s) return '';
    let r = String(s).normalize('NFC');
    r = r.replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, '');
    r = r.replace(/[أإآٱ]/g, 'ا');
    r = r.replace(/ى/g, 'ي');
    r = r.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
    return r.replace(/\s+/g, ' ').trim();
}

// Display formatter for numbers. Sura shows Western digits (0-9), which is what
// Saudi readers expect, not Arabic-Indic (٠-٩). Kept as the single seam every
// game funnels through, so the numeral system stays switchable in one place.
export const arNum = n => String(n);

// المهرب الوحيد في المشروع. كان معه ثلاث نسخٍ يدويّة في `src/main.js`،
// إحداها تعامل `null` بأنّها فراغ والأخرى تطبعها حرفًا حرفًا «null» —
// فوُحِّدت هنا على الأسلم: العدم فراغٌ لا كلمة.
export const escapeHtmlShared = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// KSA "today" as a YYYYMMDD integer — the daily seed every player shares.
export function suraDailySeed() {
    const now = new Date();
    const ksa = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 3 * 3600000);
    return ksa.getFullYear() * 10000 + (ksa.getMonth() + 1) * 100 + ksa.getDate();
}

// mulberry32 / seededShuffle now live in core/rng.mjs so node (the Telegram
// bot, the tests) can import them too — this file is .js+ESM, which node cannot
// load. Re-exported here so every existing `from '../core/util.js'` keeps
// working unchanged; there is still exactly one copy of each function.
export { mulberry32, seededShuffle } from './rng.mjs';

// تحميل بنكٍ من القرص — والفشلُ يُسمَع.
//
// كانت ثماني ألعابٍ تكتب `try { … } catch (e) { }` ثمّ تسقط إلى بنكٍ احتياطيّ
// من عنصرٍ **واحد**. فإذا تعذّر الجلب لأيّ سبب، قدّمت اللعبة اللغز نفسه في كلّ
// المستويات — بلا كلمةٍ في الطرفيّة ولا في الشاشة. وهذا ما ظهر للمالك حين فتح
// `index.html` مباشرةً (١٢ أغسطس ٢٠٢٦): بروتوكول `file:` يمنع `fetch` فتنهار
// «أمثال» و«قرّبها» و«لمحة» إلى لغزٍ واحد، فبدا الأمر تكرارًا في «كل الألعاب».
// وهو في الإنتاج أخطر: نشرةٌ تُسقط مجلّد `bank/` تعطي كلّ لاعبٍ لغزًا واحدًا
// إلى الأبد، ولا يعلم أحد.
//
// التدهور الآمن يبقى — اللعبة تشتغل بالاحتياطيّ ولا تتعطّل — لكنّه يُعلن عن
// نفسه: خطأٌ صريح في الطرفيّة، وأثرٌ في `window.__sura.bankFailures` يقرؤه
// الفحص الآليّ. عدمُ التعطّل شيء، والصمتُ شيءٌ آخر.
// وللانتظار حدّ. `fetch` بلا مهلةٍ ينتظر ما شاء الخادم: خادمٌ **ميّت** يرفض
// بسرعةٍ فيعمل الاحتياطيّ أعلاه، أمّا خادمٌ **معلَّق** — بوّابةٌ مقيّدة، شبكةٌ
// متذبذبة، وسيطٌ يمسك الوصلة — فلا يرفض ولا يجيب. وقد قيس ذلك: بعد ثلاث ثوانٍ
// من التعليق تبقى نافذة اللعبة مفتوحةً بكامل زينتها (شريط، ساعة، تلميح) وفيها
// لوحٌ فارغ، بلا دوّار ولا رسالة، بلا نهاية. ستّ ثوانٍ هي المهلة نفسها التي
// يستعملها الكود مع Groq، فلا رقم جديدًا يُخترَع.
const BANK_TIMEOUT_MS = 6000;

export async function loadBankJSON(url, fallback, label) {
    const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), BANK_TIMEOUT_MS) : 0;
    try {
        const r = await fetch(url, ac ? { signal: ac.signal } : undefined);
        if (r.ok) {
            const data = await r.json();
            if (data && data.length) return data;
            throw new Error('البنك فارغ');
        }
        throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        const why = (typeof location !== 'undefined' && location.protocol === 'file:')
            ? 'الصفحة مفتوحة ببروتوكول file: — شغّل خادمًا (python tools/serve_nocache.py) '
              + 'وافتح http://localhost:8000/'
            : (e && e.name === 'AbortError')
                ? `تأخّر ${url} أكثر من ${BANK_TIMEOUT_MS / 1000} ثوانٍ — الشبكة معلّقة`
                : `تعذّر جلب ${url}: ${e && e.message}`;
        console.error(`[سُرى] ${label}: سقط إلى البنك الاحتياطيّ `
            + `(${(fallback && fallback.length) || 0} عنصرًا) — كلّ المستويات ستعرض اللغز نفسه. ${why}`);
        try {
            const w = window.__sura || (window.__sura = {});
            (w.bankFailures || (w.bankFailures = [])).push({ url, label, reason: String(e && e.message) });
        } catch (_) { /* لا نافذة (اختبارٌ في node) — الطرفيّة تكفي */ }
        return fallback;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
