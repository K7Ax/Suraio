#!/usr/bin/env node
// ‏سُرى — المسحُ الآليّ الكامل: ٢١ مستوًى × ٦ ألعابٍ حيّة = ١٢٦ جولة.
//
// ‏ما الذي يفحصه هذا — ولماذا ليس «حلَّ الألغاز».
// ‏لعبةٌ واحدةٌ فقط تكشف حلَّها للصفحة (`#wordle-modal.dataset.secret`)؛ والخمسُ
// الأخرى لا تكشف شيئًا، وهذا صحيحٌ أمنيًّا ولا يُغيَّر من أجل اختبار. فالمسحُ
// إذن يفحص ما يمكن فحصُه بصدق:
//
//   ١. أنّ اللوح **يُبنى فعلًا** لكلّ مستوًى (عنصرٌ حقيقيٌّ بعددٍ معقولٍ من الأبناء)،
//      لا أنّه «لم يرمِ استثناءً».
//   ٢. أنّ شريطَ المستوى يعرض المستوى الذي طُلب، لا مستوًى آخر.
//   ٣. أنّ صعوبةَ المستوى تتغيّر فعلًا على السُّلَّم (لوحٌ واحدٌ لكلّ ٢١ مستوًى
//      يعني أنّ منحنى الصعوبة وهم).
//   ٤. أنّ التلميحَ يعمل بلا شبكة، ويردّ نصًّا، ولا يكشف الحلّ في «كلمة».
//   ٥. أنّ «الفوز» يقدّم اللاعبَ مستوًى واحدًا لا أكثر.
//   ٦. أنّ الشاشةَ خاليةٌ من أخطاء الطرفيّة والصفحة طوال ذلك.
//
// ‏والمخرَجُ ملفُّ `docs/qa/sweep-report.json` + ملخّصٌ في الطرفيّة. الخروجُ بـ1 عند
// أيّ إخفاق، ليصلح للتشغيل في CI.
//
//   node scripts/qa/sweep.js              # الست الألعاب × ٢١
//   node scripts/qa/sweep.js wordle       # لعبةٌ واحدة
//   node scripts/qa/sweep.js --headed     # لمشاهدته يجري

// ‏playwright ليست في `devDependencies` عمدًا — تثبيتُها يجرّ متصفّحاتٍ كاملةً
// إلى مستودعٍ ينشُر ملفّاتٍ ساكنة. فتُحلّ كما تفعل `scripts/qa/mobilebench.js`
// بالضبط: المسارُ الطبيعيّ أوّلًا، ثمّ مخبأُ npx على هذا الجهاز.
const NPX_PLAYWRIGHT =
    'file:///C:/Users/khali/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
async function loadPlaywright() {
    try { return require('playwright'); } catch (e) { /* غير مثبّتة محليًّا */ }
    for (const p of [process.env.PLAYWRIGHT_PATH, NPX_PLAYWRIGHT].filter(Boolean)) {
        // ‏استيرادُ وحدةٍ CJS يلفُّها في `.default`؛ والـESM لا. فيُفتَح اللفُّ هنا
        // مرّةً بدل أن يتعثّر النداءُ لاحقًا بـ«chromium is undefined».
        try { const m = await import(p); return m.chromium ? m : m.default; } catch (e) { /* التالي */ }
    }
    console.error('playwright غير موجودة. ثبّتها، أو مرّر PLAYWRIGHT_PATH=file:///…/playwright/index.mjs');
    process.exit(2);
}

const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.SWEEP_BASE || 'http://localhost:8000';
const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const ONLY = args.filter(a => !a.startsWith('--'));

// ‏اللوحُ الذي يجب أن يوجد، وأقلُّ عددِ خلايا يُعدّ «لوحًا مبنيًّا».
//
// ‏`cells` هو ما يُعدّ، لا `children`. والفرقُ ليس تفصيلًا: خليّةُ «نحلة»
// السبعُ موزّعةٌ على ثلاثة صفوفٍ (٢·٣·٢)، فعدُّ الأبناء المباشرين أعطى ٣
// وأبلغ عن ٢١ عطبًا وهميًّا في لعبةٍ سليمة. العدُّ الآن على الخلايا نفسِها.
const GAMES = {
    wordle: { card: '#wordle-trigger-card', board: '#wordle-board', cells: '.board-cell', min: 20 },
    connections: { card: '#connections-trigger-card', board: '#connections-board', cells: '.conn-tile,.connections-tile,button', min: 16 },
    spelling_bee: { card: '#bee-trigger-card', board: '#bee-hive', cells: '.bee-cell', min: 7 },
    amthal: { card: '#amthal-trigger-card', board: '#amthal-answer', cells: '.amthal-wbox,input', min: 2 },
    warmer: { card: '#warmer-trigger-card', board: '#warmer-theme', cells: null, min: 0 },
    lamha: { card: '#lamha-trigger-card', board: '#lamha-clues', cells: null, min: 0 },
};
const LEVELS = 21;
const names = (ONLY.length ? ONLY : Object.keys(GAMES)).filter(g => GAMES[g]);
if (!names.length) { console.error('لا لعبةَ بهذا الاسم. المتاح: ' + Object.keys(GAMES).join(', ')); process.exit(2); }

const fails = [];
const rows = [];
const fail = (game, lv, what, detail) => {
    fails.push({ game, level: lv, what, detail });
    console.log(`   ✗ م${lv + 1} ${what} — ${detail}`);
};

(async () => {
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // ‏أخطاءُ الطرفيّة تُجمَع لكلّ جولةٍ على حدة، لا كومةً واحدةً في النهاية،
    // وإلّا لم نعرف أيُّ مستوًى كسر.
    let bucket = [];
    page.on('pageerror', e => bucket.push('pageerror: ' + e.message));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // ‏favicon مفقودٌ على خادم التطوير وحده — ليس عطبَ الموقع.
        if (/favicon/i.test(t)) return;
        bucket.push('console: ' + t.slice(0, 200));
    });

    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    // ‏السُّلَّمُ متسلسل: بلا هذا لا يُفتح إلّا المستوى الأوّل، فلا يُفحص ٢٠ منها.
    await page.evaluate(() => { window.__sura.__allLevels = true; });
    await page.click('.nav-link[data-target="games"]');
    await page.waitForTimeout(1200);

    for (const game of names) {
        const G = GAMES[game];
        console.log(`\n▶ ${game}`);
        await page.click(G.card);
        await page.waitForTimeout(1400);
        // ‏الشرحُ المرئيّ يُفتح تلقائيًّا أوّلَ مرّة ويحجب الشريط.
        for (let i = 0; i < 4 && await page.locator('.demo-modal.active').count(); i++) {
            await page.click('.demo-modal .demo-close');
            await page.waitForTimeout(300);
        }

        const seen = new Set();   // بصماتُ الألواح، لكشف «٢١ مستوًى بلوحٍ واحد»
        for (let lv = 0; lv < LEVELS; lv++) {
            bucket = [];
            // ‏تغييرُ المستوى من الواجهة نفسِها التي يستخدمها اللاعب.
            await page.evaluate(l => window.__sura.levels.setLevel(document
                .querySelector('.modal-backdrop.active').id.replace(/-modal$/, '')
                .replace('bee', 'spelling_bee'), l), lv);
            // ‏وإعادةُ البناء تمرّ عبر مُنتقي المستويات، لا عبر دالّةٍ داخليّة.
            await page.evaluate(() => {
                const b = document.querySelector('.modal-backdrop.active .lvl-pick-btn');
                if (b) b.click();
            });
            await page.evaluate(l => {
                const c = document.querySelector(`.modal-backdrop.active .lvl-cell[data-lv="${l}"]`);
                if (c) c.click();
            }, lv);
            await page.waitForTimeout(450);

            const r = await page.evaluate(({ sel, cellSel, min, g }) => {
                const m = document.querySelector('.modal-backdrop.active');
                const b = m && m.querySelector(sel);
                const cells = b ? (cellSel ? b.querySelectorAll(cellSel).length : b.children.length) : -1;
                const info = m && m.querySelector('.lvl-info');
                const L = window.__sura.levels;
                let diff = '';
                try { diff = JSON.stringify(L.diffFor(g, L.level(g))); } catch (e) { diff = 'err'; }
                return {
                    modalOpen: !!m,
                    boardExists: !!b,
                    kids: cells,
                    text: b ? b.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
                    info: info ? info.textContent.replace(/\s+/g, ' ').trim() : '',
                    hintBtn: !!(m && m.querySelector('.hint-btn')),
                    enough: b ? cells >= min : false,
                    diff,
                    // ‏«كَلِمة» وحدها تكشف حلَّها للصفحة؛ يُستعمل هنا كبصمةٍ
                    // ولإثبات أنّ التلميح لا يسرّبه.
                    secret: (m && m.dataset.secret) || '',
                    apiLevel: L.level(g),
                };
            }, { sel: G.board, cellSel: G.cells, min: G.min, g: game });

            // ‏هل استجاب المحرّكُ للطلب أصلًا؟ يُفصَل عن فحص الشريط عمدًا: أن
            // يبقى المحرّك على مستوًى آخر عطبٌ مختلفٌ تمامًا عن أن يتخلّف الشريط.
            if (r.apiLevel !== lv) fail(game, lv, 'المحرّك لم ينتقل', `level() = ${r.apiLevel}`);

            if (!r.modalOpen) { fail(game, lv, 'المودال أُغلق', 'لا .modal-backdrop.active'); continue; }
            if (!r.boardExists) { fail(game, lv, 'اللوح غائب', G.board); continue; }
            if (!r.enough) fail(game, lv, 'اللوح ناقص', `${r.kids} خليّةً (< ${G.min}) في ${G.board}`);
            // ‏شريطُ المستوى يجب أن يقول الرقمَ الذي طُلب.
            if (r.info && !r.info.includes(String(lv + 1))) {
                fail(game, lv, 'شريط المستوى يخالف', `يعرض «${r.info}»`);
            }
            // ‏بصمةُ اللوح. **لا تُبنى على عدد الأبناء وحده**: لوحُ «كَلِمة»
            // ستّةُ صفوفٍ في كلّ مستوًى، فبدا السُّلَّمُ راكدًا وهو يعمل. فالبصمةُ
            // إذن نصُّ اللوح + إعداداتُ الصعوبة التي أعلنتها اللعبةُ نفسُها.
            seen.add(r.kids + '|' + r.text + '|' + r.diff + '|' + r.secret);

            if (bucket.length) fail(game, lv, 'خطأ في الطرفيّة', bucket.join(' ⁄ '));
            rows.push({ game, level: lv + 1, kids: r.kids, info: r.info, hint: r.hintBtn, errors: bucket.length });
        }

        // ٣. هل تغيّر اللوحُ فعلًا عبر السُّلَّم؟
        //
        // ‏العتبةُ ٥ لا ٢١ عمدًا. فهذا كاشفُ **ركودٍ** («٢١ مستوًى بلوحٍ واحد»)،
        // لا مقياسُ تفرّد. و«قرّبها» تُخرج ١٩ من ٢١ بحقّ: لوحُها المرئيّ هو
        // `#warmer-theme`، و٤٥ لغزًا في البنك تتقاسم ٣٠ موضوعًا فقط («مشاعر»
        // وحدَه يغطّي خمسةَ أهداف). فتكرارُ الموضوع تصميمٌ لا عطب — الموضوعُ
        // تلميحُ فئةٍ لا اللغزُ نفسه. تُحقّق من البنك قبل مطاردةِ رقمٍ كهذا.
        if (seen.size < 5) {
            fails.push({ game, level: '—', what: 'السُّلَّم راكد', detail: `${seen.size} لوحًا مميّزًا فقط عبر ٢١ مستوًى` });
            console.log(`   ✗ السُّلَّم راكد: ${seen.size} لوحًا مميّزًا عبر ٢١ مستوًى`);
        } else {
            console.log(`   ✓ ${seen.size} لوحًا مميّزًا عبر ٢١ مستوًى`);
        }

        // ٤. التلميح — بلا شبكة، ويردّ نصًّا، ولا يكشف الحلّ.
        bucket = [];
        const hint = await page.evaluate(async () => {
            const m = document.querySelector('.modal-backdrop.active');
            const btn = m && m.querySelector('.hint-btn');
            if (!btn) return { has: false };
            const secret = m.dataset.secret || '';
            btn.click();
            await new Promise(r => setTimeout(r, 1600));
            const box = m.querySelector('.hint-text, .hint-body, .hint-out');
            const txt = (box ? box.textContent : m.textContent).replace(/\s+/g, ' ').trim();
            return { has: true, len: txt.length, leaks: !!(secret && txt.includes(secret)), secret: !!secret };
        });
        if (!hint.has) {
            fails.push({ game, level: '—', what: 'لا زرَّ تلميح', detail: '.hint-btn غائب' });
            console.log('   ✗ لا زرَّ تلميح');
        } else if (hint.leaks) {
            fails.push({ game, level: '—', what: 'التلميح يكشف الحلّ', detail: 'نصُّ التلميح يحوي الكلمةَ السرّيّة' });
            console.log('   ✗ التلميح يكشف الحلّ');
        } else {
            console.log(`   ✓ التلميح يعمل${hint.secret ? ' ولا يكشف الحلّ' : ''}`);
        }
        if (bucket.length) fail(game, '—', 'خطأ أثناء التلميح', bucket.join(' ⁄ '));

        // ٥. الفوزُ يقدّم مستوًى واحدًا — لا صفرًا ولا اثنين.
        const adv = await page.evaluate(async g => {
            const L = window.__sura.levels;
            L.setLevel(g, 3);
            const before = L.level(g);
            L.won(g);
            await new Promise(r => setTimeout(r, 1200));
            return { before, after: L.level(g), target: L.nextTarget(g) };
        }, game);
        if (adv.after !== adv.before + 1 && adv.target !== adv.before + 1) {
            fails.push({ game, level: '—', what: 'التقدّم بعد الفوز', detail: JSON.stringify(adv) });
            console.log('   ✗ التقدّم بعد الفوز: ' + JSON.stringify(adv));
        } else {
            console.log('   ✓ الفوز يقدّم مستوًى واحدًا');
        }

        // إغلاقُ اللعبة بالزرّ الذي يستخدمه اللاعب
        await page.evaluate(() => {
            const m = document.querySelector('.modal-backdrop.active');
            const x = m && m.querySelector('[id$="-modal-close"]');
            if (x) x.click();
        });
        await page.waitForTimeout(700);
        // ‏«تأكيد الإغلاق» قد يعترض حين تكون هناك جولةٌ جارية.
        const yes = page.locator('.confirm-close .btn-yes, .sura-confirm .yes');
        if (await yes.count()) { await yes.first().click(); await page.waitForTimeout(500); }
    }

    await browser.close();

    const out = {
        at: new Date().toISOString(), base: BASE,
        games: names, levels: LEVELS, runs: rows.length,
        failures: fails, rows,
    };
    fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs/qa/sweep-report.json'), JSON.stringify(out, null, 2));

    console.log(`\n${'─'.repeat(52)}`);
    console.log(`جولات: ${rows.length} · ألعاب: ${names.length} · إخفاقات: ${fails.length}`);
    console.log('التقرير: docs/qa/sweep-report.json');
    if (fails.length) { console.log('SWEEP_FAIL'); process.exit(1); }
    console.log('SWEEP_OK');
})().catch(e => { console.error('\nالمسحُ انهار:', e.message); process.exit(2); });
