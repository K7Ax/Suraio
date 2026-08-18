// ‏أيقوناتُ شريطِ اللعب أربعةُ رسومٍ مكتوبةٌ بخطوطِها في المصدر، لا
// أربعةَ ملفّاتِ صور. وهذا الاختيارُ ليس ذوقًا: `currentColor` هو ما يجعل
// الأيقونةَ تتلوّنُ بلونِ زرِّها — ذهبيّةً عند التمرير، كهرمانيّةً حين يُشعَل
// «التحدّي»، خافتةً حين يُطفأ الصوت. صورةٌ نقطيّةٌ لا تفعلُ شيئًا من ذلك،
// وتكلّفُ أربعةَ طلباتٍ ومئاتِ الكيلوبايت في شريطٍ عرضُه ١٢٠ بكسل.
//
// ‏فهذه الاختباراتُ تحرسُ ذلك القرار، لا شكلَ الرسم. الشكلُ يُحكَم بالعين في
// المتصفّح — وقد حُكم، وأُعيدَ رسمُ «التحدّي» و«الشرح» مرّتين بعدَ رؤيتِهما
// بحجمِهما الحقيقيّ ١٧ بكسل.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ‏الرسومُ و`mountControls` خرجت مع `initLevels` إلى `src/ui/levels.js`؛
// ‏`helpers/ui.js` هو الموضع الوحيد الذي يعرف أين تسكن وحداتُ الواجهة.
const SRC = require('./helpers/ui.js').read('levels');
const APP = read('app.js');
const CSS = read('style.css');

// الأزرار الأربعة، ومفتاحُ كلٍّ منها في `ICONS`
const BTNS = [
    ['demo-btn', 'demo'],
    ['rules-btn', 'rules'],
    ['rush-btn', 'rush'],
];

test('لكلّ زرٍّ في الشريط رسمُه الخاصّ', () => {
    for (const [cls, key] of BTNS) {
        const re = new RegExp(`class="${cls}"[^>]*>' \\+ ICONS\\.${key}`);
        assert.ok(re.test(SRC), `${cls} لا يركّب ICONS.${key}`);
    }
    // الصوتُ حالتان، فيُركَّب في `paintMute` لا في القالب
    assert.match(SRC, /ICONS\.muted\s*:\s*ICONS\.sound/, 'زرّ الصوت لا يبدّل بين الحالتين');
});

test('الرسومُ خمسةٌ متمايزة — لا شكلٌ واحدٌ مكرّر', () => {
    const paths = [...SRC.matchAll(/ICON\('([\s\S]*?)'\)/g)].map(m => m[1]);
    // demo · rules · sound · muted · rush
    assert.strictEqual(paths.length, 5, 'عددُ الرسوم تغيّر');
    assert.strictEqual(new Set(paths).size, 5, 'رسمان متطابقان — أحدُ الأزرار فقد فكرتَه');
});

test('لا إيموجي ولا <img> في أزرار الشريط', () => {
    const from = SRC.indexOf('bar.innerHTML =');
    const to = SRC.indexOf('lvl-picker hidden', from);
    assert.ok(from > 0 && to > from, 'تعذّر عزلُ قالبِ الشريط — عُدَّت العلامتان');
    const bar = SRC.slice(from, to);
    for (const glyph of ['▶', 'ⓘ', '🔊', '🔇', '⏱']) {
        assert.ok(!bar.includes(glyph), `عادَ الإيموجي ${glyph} إلى الشريط`);
    }
    assert.ok(!/ICON\('[^']*<image|ICON\('[^']*xlink/.test(SRC), 'رسمٌ يشير إلى ملفٍّ خارجيّ');
});

test('التلوينُ بـcurrentColor لا بلونٍ مخبوز', () => {
    // ‏لا `stroke="#..."` ولا `fill="#..."` داخل الرسوم؛ الحشوُ الوحيد المسموح
    // `fill="currentColor"` للنقاط المصمتة.
    const icons = SRC.slice(SRC.indexOf('const ICONS = {'), SRC.indexOf('function mountControls'));
    assert.ok(!/(?:stroke|fill)="#/.test(icons), 'لونٌ مخبوزٌ في أحد الرسوم');
    assert.match(CSS, /\.hud-ico\s*\{[^}]*stroke:\s*currentColor/, 'CSS لا يلوّن بـcurrentColor');
});

test('الهندسةُ داخل المنطقة الآمنة ٢×٢٢', () => {
    const icons = SRC.slice(SRC.indexOf('const ICONS = {'), SRC.indexOf('function mountControls'));
    // كلُّ عددٍ في مسارٍ أو دائرة إحداثيٌّ داخل الصندوق ٢٤×٢٤
    for (const n of icons.match(/\d+(?:\.\d+)?/g) || []) {
        const v = Number(n);
        if (v > 24) assert.fail(`إحداثيٌّ خارج الصندوق: ${v}`);
    }
    // الدوائرُ لا تتجاوز الحافّة: cy ± r
    for (const m of icons.matchAll(/cy="([\d.]+)" r="([\d.]+)"/g)) {
        const cy = Number(m[1]), r = Number(m[2]);
        assert.ok(cy - r >= 1.5 && cy + r <= 22.5, `دائرةٌ تُقصّ عند الحافّة: cy=${cy} r=${r}`);
    }
});

test('viewBox واحدٌ لكلّ الرسوم — وإلّا اختلفت الأوزان البصريّة', () => {
    const boxes = [...SRC.matchAll(/viewBox="([^"]+)"/g)]
        .map(m => m[1]).filter(v => v === '0 0 24 24');
    assert.ok(boxes.length >= 1, 'لا viewBox موحّد');
    assert.match(SRC, /const ICON = \(d\) =>[\s\S]{0,160}viewBox="0 0 24 24"/,
        'الـviewBox لم يعد مصدرًا واحدًا');
});

test('الحزمةُ المبنيّة تحمل الرسوم', () => {
    assert.ok(APP.includes('hud-ico'), 'app.js لا يحوي الأيقونات — أعِد `npm run build`');
    assert.ok(APP.includes('viewBox="0 0 24 24"'), 'الحزمة بلا viewBox');
});

test('حالةُ الصوت المطفأ تُقرأ، لا تُخمَّن', () => {
    assert.match(SRC, /setAttribute\('aria-label'/, 'زرّ الصوت بلا تسمية تتغيّر');
    assert.match(CSS, /\.mute-btn\.off\s*\{/, 'لا فرق بصريّ بين الصوت المشتغل والمطفأ');
});
