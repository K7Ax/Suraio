// Cost guards — phase د.
//
// These are not tests of behaviour. They are tests of AGREEMENT between two
// files that a running browser can never compare for itself: the client cannot
// read the Deno source of an edge function, so if the two lists drift apart
// nothing breaks loudly — the client either starts firing guaranteed-400s again
// (cost creeps back) or silently stops asking for a game the server now serves
// (a feature disappears). Both failures are invisible in production and obvious
// here.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
// ‏القياسُ خرج من `main.js` إلى وحدةٍ خاصّةٍ به. الحارسُ يقرأ حيث يعيش الكودُ
// الآن — ولو بقي يقرأ `main.js` لصار أخضرَ إلى الأبد بلا شيءٍ يحرسه، وهو أسوأ
// من فشلٍ صريح.
const ANALYTICS = fs.readFileSync(path.join(ROOT, 'src', 'core', 'analytics.js'), 'utf8');
const FN = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'get-todays-puzzle', 'index.ts'), 'utf8');

function list(src, re, what) {
    const m = re.exec(src);
    assert.ok(m, `could not find ${what} — the guard is only useful if it can still read both sides`);
    return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
}

test('client __served matches the server ALLOWED list exactly', () => {
    const client = list(MAIN, /__served:\s*\[([^\]]+)\]/, "client's __served");
    const server = list(FN, /const ALLOWED\s*=\s*\[([^\]]+)\]/, "server's ALLOWED");
    assert.deepStrictEqual(client, server,
        'get-todays-puzzle serves a different set of games than the client asks for');
});

test('analytics batches rather than inserting one row per event', () => {
    // 21 of the 28 requests a visit made were single-row inserts into
    // game_events. Reverting to .insert(row) inside track() would restore that
    // bill without changing anything a player can see.
    assert.ok(/queue\.push\(/.test(ANALYTICS), 'track() should queue, not insert directly');
    assert.ok(/keepalive:\s*true/.test(ANALYTICS),
        'the flush must survive unload — rage-quits happen just before the tab closes');
});

test('the game_events flush sends an Authorization header', () => {
    // RLS on game_events is (user_id IS NULL OR user_id = auth.uid()). A flush
    // without the header runs as anon and every signed-in player's batch is
    // rejected — which is exactly why this is fetch(keepalive) and not
    // navigator.sendBeacon, which cannot set headers.
    assert.ok(!/sendBeacon\s*\(/.test(ANALYTICS),
        'sendBeacon cannot set Authorization; signed-in events would be silently dropped');
    // ‏الإغلاقُ عند أربع مسافاتٍ لا ثمانٍ بعد خروج الوحدة من داخل مُنصِت
    // ‏DOMContentLoaded — تعبيرٌ نمطيٌّ مربوطٌ بالمسافات البادئة يفشل بمجرّد نقلِ
    // كتلةٍ سليمة، وهو بالضبط ثمنُ اختبارٍ يقرأ النصّ بدل أن يُشغّل الكود.
    const flush = /function flush\(\)[\s\S]{0,1400}?\n {4}\}/.exec(ANALYTICS);
    assert.ok(flush, 'flush() not found');
    assert.ok(/Authorization/.test(flush[0]), 'flush() must send Authorization');
});

test('submitting busts the leaderboard cache', () => {
    // A 60s cache is only acceptable because the one moment staleness would be
    // wrong — the player looking for their own new row — is invalidated.
    const n = (MAIN.match(/__lbBust\(\)/g) || []).length;
    assert.ok(n >= 3, `expected __lbBust to be defined and called from both submit paths, saw ${n}`);
});
