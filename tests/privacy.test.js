// ‏صفحةُ الخصوصيّة وثيقةٌ قانونيّة، وهذه الاختباراتُ تحرس ما يجعلها كذلك:
// أن تُنشَر أصلًا، وأن تبقى مستقلّةً عن حزم اللعبة، وأن يكون الرابطُ المنسوب
// إلى صاحب الموقع رابطَه هو.
//
// ‏وما لا يُختبَر هنا — ولا يمكن — هو **صدقُ** ما فيها: أنّ ما تصفه من جمعٍ
// ومشاركةٍ هو ما تفعله الشيفرة فعلًا. ذاك يُراجَع بالعين عند كلّ تغييرٍ يمسّ
// `initAnalytics` أو `supabase/functions/`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LINKEDIN = 'https://www.linkedin.com/in/khalidabdullahalzahem';

test('privacy.html موجودةٌ وعربيّةٌ من اليمين', () => {
    const html = read('privacy.html');
    assert.match(html, /<html lang="ar" dir="rtl">/);
    assert.match(html, /<title>سياسة الخصوصيّة/);
});

test('privacy.html لا تجرّ حزم اللعبة', () => {
    const html = read('privacy.html');
    // ‏٦٥٠ كيلوبايت من لعبةٍ لمن يقرأ سياسة: هذا هو العطبُ المحروس ضدَّه.
    assert.ok(!/src="\/?app\.js/.test(html), 'privacy.html تحمّل app.js');
    assert.ok(!/href="\/?style\.css/.test(html), 'privacy.html تحمّل style.css');
});

test('privacy.html بلا سكربتٍ مضمَّن — فلا تُوسّع السياسةَ ببصمةٍ جديدة', () => {
    const html = read('privacy.html');
    // ‏كلُّ `<script>` مضمَّنٍ يضيف hash إلى script-src في `_headers`.
    assert.ok(!/<script/i.test(html), 'privacy.html فيها سكربت');
});

test('privacy.html تُنشَر وتُبصَم: مذكورةٌ في dist.js وcsp.js', () => {
    assert.match(read('scripts/build/dist.js'), /"privacy\.html"/);
    assert.match(read('scripts/build/csp.js'), /'privacy\.html'/);
});

test('نسبةُ الموقع تشير إلى حساب صاحبه نفسِه', () => {
    for (const f of ['privacy.html', 'index.html']) {
        assert.ok(read(f).includes(LINKEDIN), `${f} لا تحمل رابط LinkedIn الصحيح`);
    }
});

test('التذييل في index.html يقود إلى صفحة الخصوصيّة', () => {
    const html = read('index.html');
    assert.match(html, /class="sura-foot"/);
    assert.match(html, /href="\/privacy\.html"/);
});

test('روابطُ الخارج في التذييل محميّةٌ بـnoopener', () => {
    // ‏`target="_blank"` بلا `rel="noopener"` يعطي الصفحةَ المفتوحة يدًا على
    // `window.opener` — عادةٌ قديمةٌ لا تُترَك لأنّ المتصفّحات صحّحتها.
    for (const f of ['privacy.html', 'index.html']) {
        const html = read(f);
        const i = html.indexOf(LINKEDIN);
        const tag = html.slice(Math.max(0, i - 200), i + 300);
        assert.match(tag, /rel="noopener noreferrer"/);
    }
});
