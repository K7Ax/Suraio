// scripts/monitor — يفحص سُرى من الخارج، ويُبقي Supabase مستيقظة.
//
// بلا اعتماديّات. Node 18+ (‏fetch مدمج). يُشغَّل من GitHub Actions كل عشر
// دقائق (‏.github/workflows/monitor.yml)، ويصلح للتشغيل اليدويّ كذلك.
//
// لماذا من الخارج لا من داخل المشروع: مراقبٌ يعمل على البنية التي يراقبها يسكت
// حين تسقط هي. وGitHub Actions شبكةٌ أخرى وحسابٌ آخر، فسقوطُ Cloudflare أو
// Supabase لا يُسكته.
//
// ولماذا لا يمرّ عبر bot.js: البوت عمليّةٌ يشغّلها المالك بيده (‏long-poll)، وقد
// لا تكون تعمل أصلًا. فالتنبيهُ يُرسَل إلى واجهة تلغرام مباشرةً بالرمز نفسه.
//
// ثلاثةُ فحوصٍ لأنّ للموقع ثلاثَ طبقاتٍ تسقط مستقلّةً:
//   1) الصفحةُ الساكنة على Cloudflare Pages — إن سقطت فلا شيء يعمل.
//   2) ‏PostgREST على Supabase — الحسابات والصدارة والتقدّم.
//   3) دالّةٌ طرفيّة — قد تسقط وحدها والقاعدةُ سليمة.
//
// والفحصُ الثاني **يُبقي المشروع مستيقظًا**: خطّةُ Supabase المجّانيّة توقف
// المشروع بعد سبعة أيّامٍ بلا نشاط، وطلبٌ كلّ عشر دقائق يجعل ذلك مستحيلًا.
// وهذا سببُ وجود المراقب بقدر ما هو كشفُ الأعطال.
//
// إعادةُ المحاولة قبل الصياح: عطبٌ عابرٌ لثانيتين ليس انقطاعًا، وتنبيهٌ كاذبٌ
// مرّتين يُعلّم المالكَ تجاهلَ التنبيهات — وهو أسوأ من غياب المراقبة.
'use strict';

// الجذرُ و`www` كلاهما مربوطٌ بمشروع Pages نفسه ويردُّ ٢٠٠ مباشرةً (لا تحويل).
// والمراقَبُ هو الجذر لأنّه المضيفُ المُعلَن في `canonical` و`og:url`.
const SITE = process.env.SURA_SITE_URL || 'https://suraio.com';
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_ANON_KEY || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

const ATTEMPTS = 3;
const GAP_MS = 15000;
const TIMEOUT_MS = 15000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function timed(fn) {
    const t0 = Date.now();
    try {
        const detail = await fn();
        return { ok: true, ms: Date.now() - t0, detail };
    } catch (e) {
        return { ok: false, ms: Date.now() - t0, detail: String((e && e.message) || e) };
    }
}

async function get(url, opts = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: ac.signal, redirect: 'follow' });
    } finally {
        clearTimeout(t);
    }
}

// ---- الفحوص ----------------------------------------------------------------

// لا يكفي 200: صفحةُ خطأٍ من الحافّة قد تعود 200 وهي فارغة. نطلب علامةً من
// المستند نفسه.
async function checkSite() {
    const r = await get(SITE, { headers: { 'user-agent': 'sura-monitor/1' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    if (!/SURA_CONFIG/.test(html) || !/<title/i.test(html)) {
        throw new Error(`200 لكنّ المستند لا يشبه سُرى (${html.length} بايت)`);
    }
    return `${r.status} · ${(html.length / 1024).toFixed(0)}kB`;
}

// طلبٌ رخيص: صفٌّ واحدٌ من إسقاطٍ علنيّ. المفتاحُ هنا هو المفتاح العلنيّ نفسه
// الذي يشحنه المتصفّح — لا سرَّ في هذا الملفّ ولا في أسرار المستودع.
async function checkDatabase() {
    if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL/ANON_KEY غير مضبوطين');
    const r = await get(`${SB_URL}/rest/v1/rpc/get_leaderboard_today`, {
        method: 'POST',
        headers: {
            apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`,
            'content-type': 'application/json', prefer: 'count=none',
        },
        body: JSON.stringify({ p_game_type: 'wordle', p_limit: 1 }),
    });
    // 401/403 يعني أنّ القاعدةَ حيّةٌ لكنّ الإعداد تغيّر — وهو عطبٌ يستحقّ الصياح.
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return `${r.status}`;
}

async function checkFunction() {
    if (!SB_URL) throw new Error('SUPABASE_URL غير مضبوط');
    const r = await get(`${SB_URL}/functions/v1/get-leaderboard?game=wordle&limit=1`, {
        headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return `${r.status}`;
}

const CHECKS = [
    ['الموقع (Cloudflare Pages)', checkSite, true],
    ['القاعدة (PostgREST) + الإبقاء مستيقظًا', checkDatabase, true],
    ['دالّة الصدارة', checkFunction, false],   // سقوطُها لا يمنع اللعب
];

// ---- التنبيه ---------------------------------------------------------------

async function alert(text) {
    if (!TG_TOKEN || !TG_CHAT) {
        console.error('! لا رمزَ تلغرام أو معرّفَ محادثة — لم يُرسَل تنبيه.');
        return;
    }
    try {
        const r = await get(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
        });
        console.log(r.ok ? 'تنبيهٌ أُرسل إلى تلغرام.' : `تعذّر إرسال التنبيه: HTTP ${r.status}`);
    } catch (e) {
        console.error('تعذّر إرسال التنبيه:', String((e && e.message) || e));
    }
}

// ---- التشغيل ---------------------------------------------------------------

async function main() {
    const results = [];
    for (const [name, fn, critical] of CHECKS) {
        let r;
        for (let i = 1; i <= ATTEMPTS; i++) {
            r = await timed(fn);
            if (r.ok) { r.tries = i; break; }
            if (i < ATTEMPTS) await sleep(GAP_MS);
        }
        r.tries = r.tries || ATTEMPTS;
        results.push({ name, critical, ...r });
        console.log(
            `${r.ok ? '✓' : '✗'} ${name.padEnd(42)} ${String(r.ms).padStart(6)}ms` +
            `${r.tries > 1 ? `  (محاولة ${r.tries}/${ATTEMPTS})` : ''}  ${r.detail}`);
    }

    const down = results.filter(r => !r.ok);
    if (!down.length) {
        console.log('\nMONITOR_OK');
        return 0;
    }

    const lines = down.map(r =>
        `• ${r.name}${r.critical ? '' : ' (غير حرج)'} — ${r.detail} بعد ${ATTEMPTS} محاولات`);
    await alert(
        `⚠️ سُرى — فحصُ المراقبة أخفق\n\n${lines.join('\n')}\n\n` +
        `الوقت (UTC): ${new Date().toISOString()}\n${SITE}`);

    // فشلُ ما ليس حرجًا يُبلَّغ عنه ولا يُلوّن التشغيلَ أحمر: اللعبُ ما زال يعمل.
    console.log('\nMONITOR_FAIL');
    return down.some(r => r.critical) ? 1 : 0;
}

main().then(c => process.exit(c), e => {
    console.error('المراقبُ نفسه تعطّل:', e);
    process.exit(1);
});
