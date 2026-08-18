// tests/dashboard — اللوحةُ تتكلّم بأسماء الألعاب نفسها التي يتكلّم بها الموقع.
//
// ‏`dashboard.js` ملفٌّ مستقلٌّ لا يمرّ بحزمة `src/`، فنسخةُ `TITLES` فيه تنجرف
// بصمت: أُضيفت «قرّبها» و«لمحة» إلى الألعاب الحيّة ولم تُضافا إلى اللوحة،
// فكانت تعرض `warmer` و`lamha` خامَّين. لا شيء ينكسر — وهذا بالضبط سببُ
// بقائه غيرَ مُكتشَف.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// ‏موضعُ `LIVE_GAMES`/`TITLES` يُسأل عنه مرّةً واحدةً في المشروع — انظر
// ‏`tests/helpers/live.js` ولماذا لم يعد كلُّ اختبارٍ يبحث عنهما بنفسه.
const LIVE = require('./helpers/live.js');

/** يقرأ كائن الأسماء الحرفيّ من ملفٍّ نصًّا — لا تنفيذَ لشيفرة المتصفّح. */
function titlesFrom(file, name = 'TITLES') {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const i = src.indexOf(`${name} = {`);
    assert.ok(i > 0, `لا كائنَ ${name} في ${file}`);
    const open = src.indexOf('{', i);
    const close = src.indexOf('};', open);
    const body = src.slice(open, close + 1);
    const out = {};
    // ‏`bot.js` يكتب بعلامتَي اقتباسٍ مزدوجتين والباقي بمفردة — كلتاهما تُقرأ.
    for (const m of body.matchAll(/(\w+)\s*:\s*(['"])(.*?)\2/g)) out[m[1]] = m[3];
    return out;
}

// النسخُ الثلاث: الموقع (المصدر)، اللوحة، البوت.
const COPIES = [['dashboard.js', 'TITLES'], ['bot.js', 'TITLES_AR']];

test('كلّ لعبةٍ حيّةٍ لها اسمٌ عربيٌّ في لوحة الإدارة', () => {
    const live = LIVE.LIVE_GAMES;
    assert.strictEqual(live.length, 6, 'الألعابُ الحيّة ستّ');

    for (const [file, name] of COPIES) {
        const copy = titlesFrom(file, name);
        for (const g of live) {
            assert.ok(copy[g], `«${g}» لعبةٌ حيّةٌ بلا اسمٍ في ${file} — ستظهر خامًّا`);
        }
    }
});

test('النسخُ لا تخالف أسماء الموقع', () => {
    const site = LIVE.TITLES;
    for (const [file, name] of COPIES) {
        const copy = titlesFrom(file, name);
        for (const [k, v] of Object.entries(copy)) {
            if (site[k]) assert.strictEqual(v, site[k], `«${k}» في ${file}: «${v}» بينما الموقع «${site[k]}»`);
        }
    }
});
