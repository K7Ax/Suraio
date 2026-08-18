// tests/csp — المولّدُ يبصم ما يبصمه المتصفّح، لا ما يبدو في الملفّ.
//
// كلا الحالتين هنا كسرت الصفحةَ فعلًا في التحقّق (مخالفاتُ `script-src-elem`
// على `dist/` مخدومًا بترويساته الحقيقيّة). وهما صامتتان في التطوير لأنّ
// الخادم المحلّيّ لا يطبّق `_headers` — فالاختبار هو ما يمنع عودتَهما.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { hashesFor } = require('../scripts/build/csp.js');

const sha = s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

/** يكتب HTML مؤقّتًا ويعيد بصماته. */
function hashesOf(html) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csp-')), 'p.html');
    fs.writeFileSync(f, html, 'utf8');
    try { return hashesFor(f); } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
}

test('CRLF يُطبَّع إلى LF قبل البصم — المتصفّح يرى LF', () => {
    const body = '\n  var a = 1;\n  var b = 2;\n';
    const got = hashesOf(`<html><body><script>${body.replace(/\n/g, '\r\n')}</script></body></html>`);
    assert.deepStrictEqual(got, [sha(body)]);
});

test('«script» داخل تعليقةِ HTML ليس سكربتًا ولا يُبصَم', () => {
    const real = 'var real = 1;';
    const html = `<html><body>
<!-- كان هنا <script>var ghost = 1;</script> ثمّ أُزيل -->
<script>${real}</script>
</body></html>`;
    const got = hashesOf(html);
    assert.strictEqual(got.length, 1, 'بصمةٌ واحدة: الشبحُ في التعليقة لا يُعدّ');
    assert.deepStrictEqual(got, [sha(real)]);
});

test('السكربتُ الخارجيّ (src) لا يُبصَم', () => {
    const got = hashesOf('<script src="app.js"></script><script>var x=1;</script>');
    assert.deepStrictEqual(got, [sha('var x=1;')]);
});

test('_headers المولَّدة تُغطّي كلّ سكربتٍ مضمَّنٍ في index.html', () => {
    const ROOT = path.join(__dirname, '..');
    const headers = path.join(ROOT, '_headers');
    if (!fs.existsSync(headers)) return;   // لم يُبنَ بعد
    const csp = fs.readFileSync(headers, 'utf8');
    for (const h of hashesFor(path.join(ROOT, 'index.html'))) {
        assert.ok(csp.includes(h), `بصمةٌ غائبةٌ عن _headers: ${h} — أعد \`npm run build\``);
    }
});
