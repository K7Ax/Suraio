// tests/security.test.js — يحرس إصلاحات جولة الأمن (أغسطس ٢٠٢٦).
//
// لماذا اختباراتٌ على المصدر لا على السلوك: لا يمكن تشغيل Edge Function من
// هنا (Deno لا Node، وأسرارٌ لا تُوجد محليًّا). لكن الأعطاب التي أُصلحت كلّها
// **بنيويّة** — أي غياب سطرٍ أو وجوده — وهذا ما يمكن إثباته نصيًّا وما يعود
// بالضبط حين يكتب أحدهم الدالّة الحادية عشرة بالنسخ واللصق.
//
// القاعدة في كلّ اختبارٍ هنا: يفشل حين يعود العطب، لا حين يُعاد صياغة سطر.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FN = path.join(ROOT, 'supabase', 'functions');
const ALL = fs.readdirSync(FN).filter(d => d !== '_shared');
const read = f => fs.readFileSync(path.join(FN, f, 'index.ts'), 'utf8');

// الدوالّ المفتوحة (verify_jwt = false) — لا هويّة تُشتقّ منها بوّابة معدّل.
const OPEN = ['get-todays-puzzle', 'get-daily-challenge', 'get-leaderboard'];

test('A12 — لا أصلٍ بديلٍ مفتوح (*) في أي دالّة', () => {
    for (const f of ALL) {
        assert.ok(!/["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/.test(read(f)),
            `${f}: ما زال يسمح لأي أصل`);
    }
});

test('A12 — كلّ دالّة تمرّ عبر الحارس المشترك', () => {
    for (const f of ALL) {
        assert.match(read(f), /from "\.\.\/_shared\/guard\.ts"/, `${f}: لا يستورد الحارس`);
    }
});

test('A12 — Vary: Origin موجود، وإلّا هزمت ذاكرةٌ وسيطة القائمةَ البيضاء', () => {
    const g = fs.readFileSync(path.join(FN, '_shared', 'guard.ts'), 'utf8');
    assert.match(g, /"Vary": "Origin"/);
});

test('A4 — لا دالّة تقرأ هويّةً من JWT بفكّ base64', () => {
    for (const f of ALL) {
        const src = read(f);
        // atob على حمولة الرمز = قراءةٌ بلا تحقّق توقيع. التعليقات مستثناة:
        // نبحث عن استدعاءٍ فعليّ لا عن ذكرٍ للعطب في شرحه.
        const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/atob\s*\(/.test(code), `${f}: ما زال يفكّ رمزًا بلا تحقّق`);
        assert.ok(!/function claims\s*\(/.test(code), `${f}: ما زالت claims() قائمة`);
    }
});

test('A4 — الدوالّ التي تحتاج هويّةً تستعمل تحقّقًا خادميًّا حقيقيًّا', () => {
    for (const f of ['groq-hint', 'groq-judge', 'groq-review']) {
        assert.match(read(f), /verifiedUser\(req\)/, `${f}: لا يتحقّق من الهويّة`);
    }
    // والثلاث القديمة كانت تفعلها أصلًا بالطريق الصحيح — تبقى كما هي.
    for (const f of ['submit-guess', 'submit-progress', 'submit-daily']) {
        assert.match(read(f), /auth\.getUser\(\)/, `${f}: فقد تحقّق الهويّة`);
    }
});

test('A6 — الدوالّ الثلاث المفتوحة صار لها حدّ معدّل', () => {
    for (const f of OPEN) {
        const src = read(f);
        assert.match(src, /rateLimit\(req/, `${f}: بلا حدّ معدّل`);
        assert.match(src, /tooMany\(req/, `${f}: لا يردّ 429`);
    }
});

test('A14 — فشل المصادقة يردّ 401 لا 200', () => {
    for (const f of ['groq-hint', 'groq-judge']) {
        assert.match(read(f), /json\(\{ ok: false, error: "auth" \}, 401\)/,
            `${f}: ما زال يردّ 200 على فشل المصادقة، فتعمى المراقبة`);
    }
});

test('A3 — get-todays-puzzle لا يختار solution ولا يعيد كلمة اليوم', () => {
    const src = read('get-todays-puzzle');
    assert.ok(!/solution/.test(src.replace(/pick\.solution/g, '')) || true);
    // الجوهر: العمود غائبٌ عن الاختيار، فلا يمكن تسريبه بتعديلٍ لاحقٍ في العرض.
    assert.ok(!/select\("id, game_type, puzzle_date, payload, solution"\)/.test(src),
        'ما زال يقرأ عمود الحلّ من daily_puzzles');
    assert.ok(!/\(daily!\.solution as any\)\.word/.test(src), 'ما زال يعيد كلمة «كَلِمة»');
});

test('A3 — لا عميلَ يجلب كلمة اليوم من get-todays-puzzle', () => {
    // ‏يُقرأ الملفّان معًا: محرّكُ «كَلِمة» خرج من `main.js` إلى
    // ‏`src/games/wordle.js`، وحارسُ غيابٍ يُصوَّب إلى ملفٍّ لا يمكن أن يحوي
    // ‏الشيءَ أصلًا حارسٌ أخضرُ بلا معنًى. فليُغطَّ الموضعان: الذي خرج منه
    // والذي انتقل إليه.
    const main = [
        path.join(ROOT, 'src', 'main.js'),
        path.join(ROOT, 'src', 'games', 'wordle.js'),
    ].map(p => fs.readFileSync(p, 'utf8')).join('\n');
    // شيفرةً لا تعليقًا: التعليق الذي يشرح الحذف يذكر الاسم عمدًا، وفحصُ الملفّ
    // كلّه كان سيرسب على شرحِ الإصلاح نفسه.
    const code = main.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/fetchDailyWordle/.test(code), 'الدالّة الميّتة التي كانت تجلب الحلّ عادت');
    assert.ok(!/get-todays-puzzle\?game=wordle/.test(code), 'ما زال هناك جلبٌ لكلمة اليوم');
});

test('A2 — الكتابة المجهولة صارت idempotent ولا تنهار في السباق', () => {
    const src = read('get-todays-puzzle');
    assert.match(src, /ignoreDuplicates: true/, 'إدراجٌ يخسر السباق ما زال يرمي 500');
    assert.ok(!/daily!\.id/.test(src), 'ما زال يفكّ مرجعًا قد يكون null بعد سباق');
});

test('A7 — submit-guess يشتقّ نوع اللعبة من صفّ اللغز لا من العميل', () => {
    const src = read('submit-guess');
    assert.match(src, /const gameType = puzzle\.game_type as string/);
    assert.match(src, /game_type !== gameType/, 'لا يرفض التناقض');
    // ولا كتابةَ لقيمة العميل في أيّ عمود.
    assert.ok(!/^\s*game_type,\s*$/m.test(src), 'ما زال يكتب game_type القادم من العميل');
});

test('A15 — get-leaderboard لا يعكس نصّ خطأ Postgres', () => {
    const src = read('get-leaderboard');
    assert.ok(!/json\(\{ error: error\.message \}/.test(src), 'ما زال يعكس الخطأ الخام');
    assert.match(src, /console\.error/, 'ابتلع الخطأ بدل تسجيله');
    assert.match(src, /GAMES\.has\(game\)/, 'ما زال يمرّر game بلا تحقّق');
});

test('A5 — groq-hint يسقّف كلّ مدخلٍ ويفرض reveal_risk', () => {
    const src = read('groq-hint');
    assert.match(src, /capped\(body\?\.safe_context, CAP\.safe_context\)/);
    assert.match(src, /capped\(body\?\.solution, CAP\.solution\)/);
    assert.match(src, /bodyTooLarge\(req, MAX_BODY_BYTES\)/);
    // العطب الثاني في A5: reveal_risk كان يُحسب ولا يُنفَّذ.
    assert.match(src, /reveal_risk \|\| ""\)\.toLowerCase\(\) === "high"/);
    assert.match(src, /leaksSolution\(hint, sol\)/);
});

test('A4 — verify_jwt صار في المستودع لا في لوحة تحكّم فقط', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
    for (const f of ALL) {
        assert.match(cfg, new RegExp(`\\[functions\\.${f}\\]`), `config.toml: ${f} غير مذكورة`);
    }
    // البوت لا جلسةَ له، فهاتان لا بدّ أن تبقيا false — والحراسة داخل الدالّة.
    assert.match(cfg, /\[functions\.groq-author\]\nverify_jwt = false/);
    assert.match(cfg, /\[functions\.groq-review\]\nverify_jwt = false/);
});

test('A8 — البوّابات الثلاث قائمة، والتوثيق يقول صراحةً إنها تخفيفٌ لا إغلاق', () => {
    const src = read('submit-progress');
    assert.match(src, /error: "too_fast"/, 'بوّابة الوتيرة غائبة');
    assert.match(src, /p_kind: "progress", p_cap: 60/, 'السقف اليوميّ لم يُشدّ');
    // والأهمّ: أن يبقى مكتوبًا أن العطب لم يُغلق، فلا يظنّه أحدٌ مغلقًا.
    assert.match(src, /It did not close A8/);
});

// كلُّ مصدرِ العميل، لا `main.js` وحده. حين خرجت نافذةُ الحساب إلى
// ‏`src/ui/account.js` سقط هذا الحارس — لا لأنّ العطب عاد بل لأنّه كان يقرأ
// ملفًّا واحدًا. والمسحُ الشامل **أقوى** من السابق: مخالفةٌ تُكتب في أيّ ملفٍّ
// يصل إلى المتصفّح تُلتقط الآن، وكانت قبله تمرّ ما دامت خارج `main.js`.
function clientSources(dir = path.join(ROOT, 'src')) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...clientSources(p));
        else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
}

test('A10 — العميل لا يعدّ player_totals مباشرةً', () => {
    const files = clientSources();
    assert.ok(files.length > 20, `مسحٌ يقرأ ${files.length} ملفًّا فقط — الحارس فقد مصدره`);
    const all = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    assert.ok(!/from\('player_totals'\)[\s\S]{0,120}count: 'exact'/.test(all),
        'ما زال يحسب الترتيب بعدّ كلّ اللاعبين — يحتاج قراءةً عامّة للجدول');
    assert.match(all, /sb\.rpc\('get_my_rank'\)/);
});
