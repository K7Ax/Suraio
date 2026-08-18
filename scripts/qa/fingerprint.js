#!/usr/bin/env node
// ‏سُرى — بصمةٌ سلوكيّةٌ لـ`src/main.js`.
//
// ‏لماذا وُجدت. ٢٧ من ٣٤ ملفَّ اختبارٍ تقرأ المصدرَ **نصًّا** (`assert.match`)،
// و١١ تستورد `src/core/*.mjs` وتُشغّل منطقًا حقيقيًّا — و**لا واحد** يُشغّل
// ‏`src/main.js`. وهي ٧٢٤١ سطرًا كلُّها داخل مُنصِتٍ واحدٍ لـDOMContentLoaded،
// فلا سطحَ لها يُستورَد أصلًا. فبقيت أكبرُ رقعةٍ في المشروع بلا اختبارٍ تنفيذيّ
// لأنّها غيرُ مفكَّكة، وبقيت غيرَ مفكَّكةٍ لأنّ تفكيكها بلا اختبارٍ مقامرة.
//
// ‏هذه الأداةُ تكسر الحلقة. لا تدّعي تغطيةً: تلتقط **سلوكًا مرصودًا في متصفّحٍ
// حقيقيّ** قبل التفكيك، ثمّ تُعيد التقاطَه بعده وتقارن. أيُّ فرقٍ = انحدار.
//
//   node scripts/qa/fingerprint.js --out .fingerprint/before.json
//   …               ← التفكيك يجري هنا
//   node scripts/qa/fingerprint.js --against .fingerprint/before.json
//
// ‏والخروجُ بـ1 عند أوّل اختلاف، فيصلح لبوّابةٍ في CI أو قبل الدمج.
//
// ‏ما تقيسه محصورٌ عمدًا فيما لا يعتمد على المحتوى: أصنافٌ وسماتٌ وموضعُ
// التركيز وقفلُ التمرير. لا نصَّ لغزٍ ولا نتيجةَ لاعبٍ ولا شيءَ يتبدّل بتبدُّل
// البنوك — وإلّا صارت البصمةُ إنذارًا كاذبًا يُطفَأ بعد أسبوع.

// ‏playwright ليست في `devDependencies` عمدًا — تُحلّ كما في `sweep.js` تمامًا.
const NPX_PLAYWRIGHT =
    'file:///C:/Users/khali/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
async function loadPlaywright() {
    try { return require('playwright'); } catch (e) { /* غير مثبّتة محليًّا */ }
    for (const p of [process.env.PLAYWRIGHT_PATH, NPX_PLAYWRIGHT].filter(Boolean)) {
        try { const m = await import(p); return m.chromium ? m : m.default; } catch (e) { /* التالي */ }
    }
    console.error('playwright غير موجودة. ثبّتها، أو مرّر PLAYWRIGHT_PATH=file:///…/playwright/index.mjs');
    process.exit(2);
}

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BASE = process.env.FINGERPRINT_BASE || 'http://localhost:8000';
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const OUT = argOf('--out');
const AGAINST = argOf('--against');
const HEADED = args.includes('--headed');

// ‏ضجيجٌ معروفٌ لا يُعدّ خطأً: بيكونُ Cloudflare يحجبه CSP الخاصّ بنا عمدًا
// ‏(انظر docs/decisions/0004)، فيظهر في كلّ التقاطٍ ولا علاقةَ له بالمصدر.
const NOISE = [/beacon\.min\.js/i, /cloudflareinsights/i, /favicon/i];
const isNoise = (s) => NOISE.some(r => r.test(s));

(async () => {
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: !HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    const consoleErrors = [], pageErrors = [];
    page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', e => { if (!isNoise(String(e))) pageErrors.push(String(e && e.message || e)); });

    const fp = {};
    const probe = async (name, fn) => {
        try { fp[name] = await fn(); }
        catch (e) { fp[name] = { ERROR: String(e && e.message || e) }; }
    };

    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(4000);   // ‏الافتتاحيّةُ السينمائيّة + إخفاءُ اللودر

    // ---- ١. الإقلاع -------------------------------------------------------
    await probe('boot', () => page.evaluate(() => ({
        loaderGone: !document.querySelector('#app-loader.active'),
        // ‏السطحُ العامّ الذي تعتمد عليه الصفحاتُ والاختباراتُ الأخرى.
        suraApi: Object.keys(window.__sura || {}).sort(),
        levelsApi: Object.keys((window.__sura && window.__sura.levels) || {}).sort(),
        // ‏عددُ بطاقاتِ الألعاب في المستند. لا يُقاس ظهورُها هنا عمدًا: الشبكةُ
        // تحت الطيّة وقتَ الالتقاط، فمقياسُ الظهور يرجع صفرًا دائمًا — وفحصٌ
        // يرجع صفرًا دائمًا لا يكشف انحدارًا أبدًا.
        triggerCards: document.querySelectorAll('[id$="-trigger-card"]').length,
        navLabels: [...document.querySelectorAll('.nav-link.nav-label')].map(a => a.textContent.trim()),
    })));

    // ---- ٢. initScrollBlur ------------------------------------------------
    await probe('scrollBlur', async () => {
        const during = await page.evaluate(() => {
            window.dispatchEvent(new Event('scroll'));
            return document.documentElement.classList.contains('sura-scrolling');
        });
        await page.waitForTimeout(400);
        const after = await page.evaluate(() =>
            document.documentElement.classList.contains('sura-scrolling'));
        return { classAddedOnScroll: during, classRemovedAtRest: !after };
    });

    // ---- ٣+٤+٥. initScrollLock · initFocusTrap · initCloseBead ------------
    // ‏الثلاثةُ تُقاس على نافذةٍ واحدةٍ مفتوحة، لأنّ ذلك هو وضعُها الحقيقيّ.
    await probe('modal', async () => {
        await page.evaluate(() => { try { window.__sura.meta.write('demoSeen.wordle', 1); } catch (e) { } });
        await page.evaluate(() => document.getElementById('wordle-trigger-card').click());
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            const m = document.getElementById('demo-modal');
            if (m) m.classList.remove('active');
        });
        await page.waitForTimeout(600);

        const open = await page.evaluate(() => {
            const m = document.querySelector('.modal-backdrop.active');
            return {
                // initScrollLock
                bodyModalOpen: document.body.classList.contains('sura-modal-open'),
                bodyGameOpen: document.body.classList.contains('sura-game-open'),
                // ‏القيمةُ الخامُ لا حُكمٌ عليها: `-0px` عند فتحٍ من أعلى الصفحة
                // سلوكٌ صحيح، وحُكمٌ منطقيٌّ هنا يخفيه بدل أن يُظهره.
                bodyTop: document.body.style.top || '',
                // initFocusTrap — دلالةُ الحوار تُضاف وقتَ الفتح لا في HTML
                role: m && m.getAttribute('role'),
                ariaModal: m && m.getAttribute('aria-modal'),
                tabindex: m && m.getAttribute('tabindex'),
                hasAccessibleName: !!(m && (m.getAttribute('aria-labelledby') || m.getAttribute('aria-label'))),
                focusInsideModal: !!(m && m.contains(document.activeElement)),
            };
        });

        // ‏حبسُ Tab: أربع عشرة ضغطةً — العددُ الذي كشف العطبَ أصلًا.
        let escaped = 0;
        for (let i = 0; i < 14; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => {
                const m = document.querySelector('.modal-backdrop.active');
                return !!(m && m.contains(document.activeElement));
            });
            if (!inside) escaped++;
        }

        // initCloseBead — الصنفُ يُركَّب على pointerdown قبل بدء التلاشي
        const bead = await page.evaluate(() => {
            const btn = document.querySelector('.modal-backdrop.active .modal-close');
            if (!btn) return null;
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return btn.classList.contains('pushed');
        });

        const closed = await page.evaluate(() => {
            document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
            return true;
        });
        await page.waitForTimeout(500);
        const afterClose = await page.evaluate(() => ({
            bodyModalOpen: document.body.classList.contains('sura-modal-open'),
            bodyGameOpen: document.body.classList.contains('sura-game-open'),
            bodyTopCleared: (document.body.style.top || '') === '',
            // ‏التركيزُ يعود إلى فاتحِ النافذة، لا إلى رأس الصفحة.
            focusReturned: document.activeElement !== document.body,
        }));
        return { open, tabEscapes: escaped, beadPushed: bead, closed, afterClose };
    });

    // ---- ٦. مُغلِقُ ESC ----------------------------------------------------
    // ‏يُسأل عن الصفحة لا عن قائمةٍ محفوظة: النوافذُ المفتوحةُ تُغلق، و
    // ‏`[data-modal-solo]` تُستثنى لأنّ لها مُغلِقاتها الخاصّة.
    await probe('escape', async () => {
        await page.evaluate(() => document.getElementById('wordle-trigger-card').click());
        await page.waitForTimeout(1200);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        return {
            anyOpen: await page.evaluate(() =>
                document.querySelectorAll('.modal-backdrop.active:not([data-modal-solo])').length),
            soloUntouchedByDesign: await page.evaluate(() =>
                document.querySelectorAll('[data-modal-solo]').length > 0),
        };
    });

    // ---- ٧. initRules ------------------------------------------------------
    await probe('rules', async () => {
        const api = await page.evaluate(() => typeof (window.__sura.rules || {}).open);
        const opened = await page.evaluate(() => {
            window.__sura.rules.open('wordle');
            const m = document.getElementById('rules-modal');
            return {
                active: !!(m && m.classList.contains('active')),
                titleHasEmoji: !!(document.getElementById('rules-title') || {}).textContent,
                bodyFilled: ((document.getElementById('rules-body') || {}).textContent || '').length > 10,
            };
        });
        await page.evaluate(() => window.__sura.rules.close());
        await page.waitForTimeout(300);
        const closed = await page.evaluate(() =>
            !document.getElementById('rules-modal').classList.contains('active'));
        return { api, ...opened, closesAgain: closed };
    });

    // ---- ٨. initSettings ---------------------------------------------------
    // ‏الفحصُ المهمّ هنا ليس «تفتح النافذة» بل أنّ `PREFS` المقروءةَ داخلها هي
    // ‏**عينُ** المخزن الحيّ: لو استوردت الوحدةُ نسختَها لبقيت النافذةُ تفتح
    // بينما لا يُحفظ إعدادٌ واحد — عطبٌ صامتٌ تمامًا.
    await probe('settings', async () => {
        const api = await page.evaluate(() => typeof window.__sura.openSettings);
        return {
            api, ...await page.evaluate(() => {
                window.__sura.openSettings();
                const m = document.getElementById('settings-modal');
                const live = window.__sura.prefs && window.__sura.prefs.get();
                const active = [...m.querySelectorAll('.seg-control button.active')].length;
                const zoom = (document.getElementById('settings-zoom-label') || {}).textContent || '';
                m.classList.remove('active');
                return {
                    opens: !!m, segsReflectStore: active > 0,
                    zoomMatchesStore: live ? zoom === Math.round(live.fontScale * 100) + '%' : null,
                };
            })
        };
    });

    // ---- ٨ب. initAccount ---------------------------------------------------
    // ‏يُفحَص وهو **خارجُ الجلسة**، وهذه ليست تنازلًا بل الحالةُ الوحيدةُ التي
    // يمكن قياسُها بصدقٍ بلا حسابٍ حقيقيّ — ومع ذلك تُشغّل منطقًا حقيقيًّا:
    // تحويلَ «افتح حسابي» إلى نافذة دخول، ومُلمِّحاتِ كلمة المرور واسم المستخدم
    // المركَّبةَ وقتَ التركيب. أمّا الإحصاءاتُ والسجلُّ فتحتاج جلسةً، ولا تُفحَص.
    await probe('account', async () => {
        const api = await page.evaluate(() => ({
            openAccount: typeof window.__sura.openAccount,
            refreshAccountStats: typeof window.__sura.refreshAccountStats,
            refreshStanding: typeof window.__sura.refreshStanding,
        }));
        // موقَّعًا خارجًا: «افتح حسابي» يجب أن تفتح نافذةَ الدخول لا نافذةَ الحساب.
        await page.evaluate(() => window.__sura.openAccount());
        await page.waitForTimeout(1200);
        const routed = await page.evaluate(() => {
            const acc = document.getElementById('account-modal');
            const auth = document.getElementById('auth-modal');
            const r = {
                accountModalActive: !!(acc && acc.classList.contains('active')),
                authModalActive: !!(auth && auth.classList.contains('active')),
            };
            document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
            return r;
        });
        // مُلمِّحاتُ كلمة المرور — منطقٌ متزامنٌ لا يحتاج شبكةً ولا جلسة.
        const pw = await page.evaluate(() => {
            const a = document.getElementById('account-new-password');
            const b = document.getElementById('account-new-password-confirm');
            const req = document.getElementById('account-pw-req-hint');
            const match = document.getElementById('account-pw-match-hint');
            if (!a || !b) return null;
            const fire = el => el.dispatchEvent(new Event('input', { bubbles: true }));
            a.value = 'abc'; fire(a);
            const tooShort = req && req.classList.contains('bad');
            a.value = 'abcdefgh'; fire(a);
            const longEnough = req && req.classList.contains('ok');
            b.value = 'different'; fire(b);
            const mismatch = match && match.classList.contains('bad');
            b.value = 'abcdefgh'; fire(b);
            const matches = match && match.classList.contains('ok');
            a.value = ''; b.value = ''; fire(a); fire(b);
            return { tooShort, longEnough, mismatch, matches };
        });
        // اسمُ المستخدم: القيمةُ غير الصالحة تُرفض **متزامنًا** بلا طلبِ شبكة.
        const uname = await page.evaluate(() => {
            const i = document.getElementById('account-username');
            const h = document.getElementById('account-username-hint');
            if (!i || !h) return null;
            i.value = 'AB'; i.dispatchEvent(new Event('input', { bubbles: true }));
            const rejected = h.classList.contains('bad');
            i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
            return { rejectsInvalidSynchronously: rejected };
        });
        return { api, routed, pw, uname };
    });

    // ---- ٨ج. initFeaturedDaily --------------------------------------------
    // ‏لا تُبصَم القِيَم: رقمُ العدد واسمُ اليوم والصعوبةُ واللعبةُ المختارة كلُّها
    // تتبدّل يوميًّا، وبصمةٌ تحفظها تصير إنذارًا كاذبًا غدًا. يُبصَم **الاتّساق**:
    // أن كلّ جزءٍ من البطاقة يتحدّث عن لعبةِ اليوم نفسِها. هذا هو الشرطُ الذي
    // وُجدت الوحدةُ لأجله أصلًا — كانت البطاقة تكذب في ستّةِ أيامٍ من سبعة.
    await probe('featuredDaily', () => page.evaluate(() => {
        const card = document.querySelector('.featured-issue-section');
        if (!card) return { cardPresent: false };
        // ‏مرآةٌ لخريطةِ الوحدة. لو انحرفت، رجع `srcBoardFound: false` في
        // الالتقاط — قيمةٌ مرصودةٌ تُقرأ، لا فحصٌ ينجح صامتًا.
        const SLUG = { spelling_bee: 'bee', missing_word: 'missingword', story_order: 'storyorder' };
        const slug = g => SLUG[g] || g;
        const featured = ((window.__sura.levels.daily.state() || {}).featured) || '';
        const txt = sel => ((card.querySelector(sel) || {}).textContent || '').trim();
        const playBtn = document.getElementById('featured-play-wordle-btn');
        const chips = [...card.querySelectorAll('.dr-chip')];
        const feat = chips.find(c => c.classList.contains('feat'));
        const src = document.querySelector(`#${slug(featured)}-trigger-card .board-container`);
        const board = card.querySelector('.featured-preview-card .board-container');
        const weeks = [...document.querySelectorAll('#week-rows tr')];
        return {
            cardPresent: true,
            // ‏شكلٌ لا مضمون: «العدد ١٢ · الأربعاء · متوسط» ثلاثةُ أجزاء أبدًا.
            tagParts: txt('.issue-tag').split('·').length,
            titleFilled: txt('.featured-wordle-title').length > 0,
            lineFilled: txt('.featured-wordle-tagline').length > 0,
            descFilled: txt('.featured-wordle-desc').length > 10,
            // «11 . 08» — يومٌ وشهرٌ مصفَّران، لا «15 . PL». وبأرقامٍ لاتينيّة:
            // ‏`arNum` هي `String(n)`، ورقمٌ هنديٌّ في النمط جعل الفحصَ يرسب
            // على السلوك الصحيح — أوّلُ التقاطٍ كشفه، ولذلك يُقرأ الخطُّ الأساس
            // قبل الوثوق به.
            serialShape: /^\d{2} \. \d{2}$/.test(txt('.card-serial')),
            badgeIsCountdown: /^(يتبدّل بعد |ينزل الآن$)/.test(txt('.live-badge')),
            // ---- الاتّساق: كلُّ جزءٍ يتحدّث عن لعبةِ اليوم نفسِها ----
            playBtnLabelKnown: !!playBtn && /^(أنجزتَ تحدي اليوم ✓|ابدأ تحدي اليوم ←)$/.test(playBtn.textContent.trim()),
            playBtnGameIsFeatured: !!playBtn && playBtn.dataset.game === featured,
            featChipIsFeatured: !!feat && feat.dataset.game === featured,
            titleMatchesFeatChip: !!feat && txt('.featured-wordle-title')
                === (feat.querySelector('.dr-name') || {}).textContent,
            // ---- شريطُ ألعاب اليوم ----
            rosterChips: chips.length,
            everyChipComplete: chips.length > 0 && chips.every(c =>
                c.querySelector('.dr-tick') && c.querySelector('.dr-name') && c.querySelector('.dr-tier')),
            // ---- اللوحُ مستنسَخٌ من بطاقةِ اللعبة نفسِها ----
            srcBoardFound: !!src,
            boardIsClone: !!board && board.classList.contains('featured-board'),
            boardHidden: !!board && board.getAttribute('aria-hidden') === 'true',
            // ‏نسيجُ اللوح يتبع اللعبةَ: `texture-sadu` تحت نصِّ «تشابك» لا غيره.
            boardTextureMatches: !!(src && board)
                && [...src.classList].filter(c => c.startsWith('texture-')).join()
                === [...board.classList].filter(c => c.startsWith('texture-')).join(),
            // ‏معرّفاتُ SVG المستنسَخة تُلاحَق بلاحقة `-nl`، وإلّا تعلّق `url(#id)`
            // بأوّلِ مطابقةٍ في المستند — أي بلوحِ البطاقةِ الأصليّة. ولوحُ بعضِ
            // الألعاب بلا معرّفاتٍ أصلًا، و`every` على مصفوفةٍ فارغةٍ تعود `true`
            // — نجاحٌ بلا فحص. تُردّ `null` حينئذٍ كي يُقرأ الفراغُ فراغًا.
            clonedIdCount: board ? board.querySelectorAll('[id]').length : -1,
            clonedIdsSuffixed: !board || !board.querySelectorAll('[id]').length ? null
                : [...board.querySelectorAll('[id]')].every(el => /-nl$/.test(el.id)),
            // ---- رزنامةُ الأسبوع: ثلاثةٌ مضت، واليومُ، وثلاثةٌ قادمة ----
            weekRows: weeks.length,
            weekTodayRows: weeks.filter(r => r.classList.contains('today')).length,
            weekPastRows: weeks.filter(r => r.classList.contains('past')).length,
            weekNextRows: weeks.filter(r => r.classList.contains('next')).length,
        };
    }));

    // ---- ٨د. initDemo ------------------------------------------------------
    // ‏تُقاس بالتشغيل لا بالوجود: تُفتح، يُوقَف تشغيلها التلقائيّ في اللحظة
    // نفسِها (وإلّا تقدّم المؤقّتُ الخطوةَ تحت الفحص فتذبذب النتيجة)، ثمّ
    // يُتنقّل بين الخطوات ويُقرأ ما تغيّر. ولا يُبصَم نصُّ التسمية التوضيحيّة:
    // شرحٌ يُعاد صياغته ليس انحدارًا.
    await probe('demo', async () => {
        const api = await page.evaluate(() => Object.keys(window.__sura.demo || {}).sort());
        const opened = await page.evaluate(() => {
            window.__sura.demo.open('wordle');
            const m = document.querySelector('.demo-modal');
            m.querySelector('.demo-play').click();          // ‏إيقافُ المؤقّت قبل القياس
            return {
                active: m.classList.contains('active'),
                dots: m.querySelectorAll('.demo-dots button').length,
                onDot: [...m.querySelectorAll('.demo-dots button')].findIndex(b => b.classList.contains('on')),
                capFilled: (m.querySelector('.demo-cap').textContent || '').length > 10,
                stageFilled: m.querySelector('.demo-stage').children.length > 0,
                prevDisabledAtStart: m.querySelector('.demo-prev').disabled,
                headHasTitle: !!m.querySelector('.demo-title'),
                playPaused: m.querySelector('.demo-play').textContent.trim() === '▶ تشغيل',
            };
        });
        // ‏التنقّل: الخطوةُ تتقدّم، وآخرُ خطوةٍ تبدّل نصَّ «التالي» إلى «أعد».
        const stepped = await page.evaluate(() => {
            const m = document.querySelector('.demo-modal');
            const next = m.querySelector('.demo-next');
            next.click();
            const afterOne = [...m.querySelectorAll('.demo-dots button')].findIndex(b => b.classList.contains('on'));
            const prevEnabled = !m.querySelector('.demo-prev').disabled;
            while (!/أعد/.test(next.textContent)) next.click();
            const atEnd = [...m.querySelectorAll('.demo-dots button')].findIndex(b => b.classList.contains('on'));
            next.click();                                    // «أعد ↺» يعود إلى الأولى
            const looped = [...m.querySelectorAll('.demo-dots button')].findIndex(b => b.classList.contains('on'));
            return { afterOne, prevEnabled, atEndIsLast: atEnd === m.querySelectorAll('.demo-dots button').length - 1, looped };
        });
        // ‏لعبةٌ بلا شرحٍ مرسوم تسقط إلى نافذة القواعد، لا إلى نافذةٍ فارغة.
        const fallback = await page.evaluate(() => {
            window.__sura.demo.close();
            window.__sura.demo.open('__no_such_game__');
            const r = {
                demoStayedClosed: !document.querySelector('.demo-modal.active'),
                rulesOpened: !!document.getElementById('rules-modal').classList.contains('active'),
            };
            window.__sura.rules.close();
            return r;
        });
        await page.waitForTimeout(300);
        const closed = await page.evaluate(() => !document.querySelector('.demo-modal.active'));
        return { api, opened, stepped, fallback, closesAgain: closed };
    });

    // ---- ٨هـ. initDict -----------------------------------------------------
    // ‏تُشغَّل حقًّا: يُحمَّل المعجم ويُسأل عن كلمةٍ **مأخوذةٍ منه** وعن أخرى
    // مستحيلة. ولا تُكتب كلمةٌ بعينها في الفحص: بنك الكلمات يتغيّر، وفحصٌ
    // يسأل عن «كتاب» يرسب يوم يُنقّى المعجم لا يوم ينكسر الكود.
    await probe('dict', async () => {
        const before = await page.evaluate(() => ({
            api: Object.keys(window.__sura.dict || {}).sort(),
            // ‏ليست «قبل التحميل»: الفحصُ يجري بعد أن استقرّت الصفحة وفُتحت
            // نافذةُ لعبة، فالمعجم محمَّلٌ سلفًا. القيمةُ تُسجَّل باسمها الصادق.
            readyAfterPageSettles: window.__sura.dict.ready,
        }));
        const after = await page.evaluate(async () => {
            const ok = await window.__sura.dict.load();
            const D = window.__sura.dict;
            const some = [...window.__sura.games._dict][0];
            return {
                loadReturnedTrue: ok,
                ready: D.ready,
                sizeOverAThousand: D.size() > 1000,
                acceptsAWordFromItsOwnSet: D.has(some),
                // ‏سبعُ زاياتٍ ليست كلمةً عربيّة في أيّ معجم — الرفضُ يجب أن
                // يبقى رفضًا: هذا هو «لا اختراع صرفيّ» مقيسًا لا موصوفًا.
                rejectsImpossible: !D.has('ززززززز'),
                // ‏تشكيلٌ زائد لا يغيّر الحكم — `normalizeArabic` تطويه.
                normalizesTashkeel: D.has(some + 'َ'),
            };
        });
        return { ...before, ...after };
    });

    // ---- ٨و. initLeaderboard ----------------------------------------------
    // ‏لا يُبصَم صفٌّ واحد: اللوحة تقرأ خادمًا حيًّا وتتبدّل صفوفُها كلَّ يوم.
    // يُبصَم ما تملكه الوحدةُ وحدها — تبديلُ الوضع، وإظهارُ منتقي اللعبة معه،
    // وأنّ الجدول لا يُترك فارغًا أبدًا (صفوفٌ حقيقيّةٌ أو سطرٌ يقول لماذا لا).
    await probe('leaderboard', async () => {
        const api = await page.evaluate(() => ({
            refreshLeaderboard: typeof window.__sura.refreshLeaderboard,
            lbSearch: typeof window.__sura.__lbSearch,
        }));
        const modes = await page.evaluate(() => {
            const el = document.getElementById('leaderboard-modes');
            const sel = document.getElementById('lb-game-select');
            const btn = m => el.querySelector(`.lb-mode-btn[data-mode="${m}"]`);
            const read = () => ({
                active: [...el.querySelectorAll('.lb-mode-btn')].filter(b => b.classList.contains('active')).length,
                gameSelHidden: sel.hidden,
            });
            btn('daily').click();
            const daily = read();
            btn('global').click();
            const global = read();
            return { daily, global, modeButtons: el.querySelectorAll('.lb-mode-btn').length };
        });
        await page.waitForTimeout(1500);
        const body = await page.evaluate(() => {
            const t = document.getElementById('leaderboard-rows');
            return {
                // ‏إمّا صفوفٌ حقيقيّة (٥ كحدٍّ أقصى) وإمّا سطرُ «لا فرسان بعد».
                // ‏العددُ خامًا لا حُكمًا عليه، على نمط `bodyTop` أعلاه: «٥ أو
                // أقلّ» يخفي انتقال ٥ إلى ١، و`TOP_N = 5` بأمر المالك.
                rows: t.rows.length,
                emptyRows: t.querySelectorAll('.lb-empty').length,
                headersLabelled: !!document.getElementById('lb-th-3').textContent.trim(),
            };
        });
        return { api, modes, body };
    });

    // ---- ٨ز. initDailyStrip ------------------------------------------------
    // ‏`dailyGoal.mark()` لا تُنادى هنا عمدًا: تكتب في المخزن وتمنح خبرة، وفحصٌ
    // يغيّر حالةَ اللاعب ليقيسها ليس فحصًا بل أثرًا جانبيًّا.
    await probe('dailyStrip', async () => {
        const api = await page.evaluate(() => ({
            dailyGoal: Object.keys(window.__sura.dailyGoal || {}).sort(),
            refreshDailyStrip: typeof window.__sura.refreshDailyStrip,
        }));
        return {
            api, ...await page.evaluate(() => {
                window.__sura.refreshDailyStrip();
                const t = id => (document.getElementById(id) || {}).textContent || '';
                const q = s => ((document.querySelector(s) || {}).textContent || '').trim();
                return {
                    countdownMounted: /\d/.test(t('grid-countdown')),
                    comboFilled: /^\d+$/.test(q('#grid-combo b')),
                    totalFilled: /^\d+$/.test(t('grid-combo-total')),
                    levelFilled: /^\d+$/.test(q('#grid-level b')),
                    goalTextKnown: /^(هدف اليوم: أكمل مستوى|✓ هدف اليوم مكتمل)$/.test(t('grid-daily-goal').trim()),
                    goalClassMatchesState: document.getElementById('grid-daily-goal')
                        .classList.contains('done') === window.__sura.dailyGoal.done(),
                };
            })
        };
    });

    // ---- ٨ح. initSuraMeta --------------------------------------------------
    // ‏أكبرُ سطحٍ في المشروع: التخزينُ المُسمّى بالمستخدم، والخبرةُ والمستوى،
    // والنقاطُ والشارات، وتتابعُ اليوم، والعدّاد، والنخب. يُقاس بالتشغيل: يُكتب
    // ويُقرأ ويُضاف ويُنفَق، ثمّ يُقارَن الفرق — لا مجرّدُ وجود دالّة.
    //
    // ‏آمنٌ أن يُعدَّل هنا: كلُّ التقاطٍ يفتح سياقَ متصفّحٍ جديدًا بـ
    // ‏`localStorage` فارغ، فالحالةُ الابتدائيّة واحدةٌ في كلّ تشغيل.
    await probe('meta', () => page.evaluate(() => {
        const m = window.__sura.meta;
        const uid = window.__sura.__uid || 'anon';
        // ‏التسمية بالمستخدم: مفتاحٌ يُكتب عبر `write` يجب أن يظهر في
        // ‏`localStorage` تحت `sura.<uid>.<suffix>` بالضبط — وهي البنيةُ التي
        // يعتمد عليها دمجُ المجهول بالحساب (`migrateAnon`).
        m.write('__fpProbe', 7);
        const rawKey = `sura.${uid}.__fpProbe`;
        const namespaced = localStorage.getItem(rawKey);

        const xpBefore = m.xp.info();
        m.xp.add(10);
        const xpAfter = m.xp.info();

        const coins0 = m.coins.get();
        m.coins.add(5);
        const afterAdd = m.coins.get();
        const spentOk = m.coins.spend(3);
        const afterSpend = m.coins.get();
        const spentTooMuch = m.coins.spend(999999);

        m.toast('<b>fingerprint</b>');
        const toastNode = !!document.getElementById('sura-toast');

        const out = {
            api: Object.keys(m).sort(),
            // ‏القائمةُ الحيّة نفسُها تُبصَم: هي مصدرُ الحقيقة لعدد الألعاب،
            // ويقرؤها `combo.total` وبطاقةُ النشرة وكشّافُ الجولات.
            liveGames: m.LIVE_GAMES.slice(),
            titleOfKnown: m.titleOf('wordle'),
            titleOfUnknownFallsBackToKey: m.titleOf('__nope__') === '__nope__',
            namespacedUnderUid: namespaced === '7',
            readsBackWhatItWrote: m.read('__fpProbe', 0) === 7,
            readReturnsDefaultWhenAbsent: m.read('__fpAbsent', 'dflt') === 'dflt',
            xpInfoKeys: Object.keys(xpBefore).sort(),
            xpAddedExactly: xpAfter.xp - xpBefore.xp,
            levelNeverDrops: xpAfter.level >= xpBefore.level,
            coinsAdded: afterAdd - coins0,
            coinsSpent: afterAdd - afterSpend,
            spendReturnsTrueWhenAffordable: spentOk,
            overspendRefused: spentTooMuch === false,
            balanceUnchangedAfterRefusedSpend: m.coins.get() === afterSpend,
            comboTotalMatchesLiveGames: m.combo.total === m.LIVE_GAMES.length,
            comboCountIsNumber: typeof m.combo.count() === 'number',
            badgesDefined: m.badges.all().length,
            unlockedIsArray: Array.isArray(m.badges.unlocked()),
            saverLeftIsNumber: typeof m.saver.left() === 'number',
            // ‏العدّاد: صيغةُ الساعة ثابتة، والثواني إلى منتصف الليل داخل اليوم.
            clockShape: /^\d{2}:\d{2}:\d{2}$/.test(m.countdown.fmt(3661)),
            secsToMidnightInRange: (() => { const s = m.countdown.secsToMidnight(); return s > 0 && s <= 86400; })(),
            toastMounted: toastNode,
        };
        localStorage.removeItem(rawKey);
        return out;
    }));

    // ---- ٨ط. محرّك التلميحات (`window.__sura.hints`) -----------------------
    // ‏لا يُستهلك تلميحٌ حقيقيّ هنا: `trigger`/`deliverHint` تحتاجان مزوِّدًا
    // ولوحًا حيًّا، وفحصٌ يحرق رصيدَ اللاعب ليقيسه أثرٌ جانبيّ لا قياس. تُقاس
    // ذاكرةُ الاقتراحات — وهي منطقٌ نقيّ، وهي بالضبط ما مُنع به تكرارُ التلميح
    // نفسِه مرّتين والخصمُ مرّتين.
    await probe('hints', () => page.evaluate(() => {
        const h = window.__sura.hints;
        const memo = h.memo('__fpGame');
        const first = memo.take('a');
        const again = memo.take('a');
        const other = memo.take('b');
        memo.reset();
        const afterReset = memo.take('a');
        return {
            api: Object.keys(h).sort(),
            MAX: h.MAX,
            leftIsNumber: typeof h.left('wordle') === 'number',
            usedIsNumber: typeof h.used('wordle') === 'number',
            sessionHintsStartsAtZero: h.sessionHints('__fpGame') === 0,
            memoTakesOnce: first === true,
            memoRefusesRepeat: again === false,
            memoAllowsDifferentKey: other === true,
            memoResetClearsIt: afterReset === true,
        };
    }));

    // ---- ٨ي. initLevels — سُلّمُ الحملة ------------------------------------
    // ‏٢١ مستوًى لكلّ لعبة (٦ سهل · ٩ متوسط · ٦ صعب — الكتلةُ في الوسط حيث
    // ‏يتجاوز التحدّي المهارةَ بقليل)، ومعها `ranks` و`rush`.
    // ‏الحسابُ نقيٌّ فيُبصَم بقيمِه لا بأحكامٍ عنه: تُسجَّل **سلسلةُ النطاقات
    // ‏الحادية والعشرون كاملةً**، وبذرةُ كلّ مستوًى، وميزانيّةُ التخمين — فلو
    // انزاح منحنًى واحدٌ لظهر الفرقُ في موضعه بالضبط لا في نعمٍ/لا.
    await probe('levels', () => page.evaluate(() => {
        const l = window.__sura.levels;
        const r = window.__sura.ranks;
        const seed = lv => l.levelSeed('wordle', lv);
        return {
            api: Object.keys(l).sort(),
            dailyApi: Object.keys(l.daily).sort(),
            ranksApi: Object.keys(r).sort(),
            rushApi: Object.keys(window.__sura.rush).sort(),
            LEVELS: l.LEVELS,
            // ‏سلّمُ النطاقات كاملًا — القيمةُ لا الحكم.
            bandIndexLadder: [...Array(l.LEVELS)].map((_, i) => l.bandIndex(i)),
            bandLabels: [...new Set([...Array(l.LEVELS)].map((_, i) => l.bandLabel(i)))],
            levelInBandLadder: [...Array(l.LEVELS)].map((_, i) => l.levelInBand(i)),
            // ‏القصُّ عند الطرفين: قيمتان، لا `true`.
            clampBelow: l.clampLevel(-5),
            clampAbove: l.clampLevel(9999),
            clampNaN: l.clampLevel('لا رقم'),
            // ‏البذرةُ دالّةٌ نقيّةٌ من (اللعبة، المستوى): تُبصَم قيمُها، فتنكشف
            // أيُّ إعادةِ ترتيبٍ للألواح فورًا.
            seeds: [0, 1, 2, 10, 20].map(seed),
            seedIsStable: seed(7) === seed(7),
            seedDiffersByLevel: seed(7) !== seed(8),
            seedDiffersByGame: l.levelSeed('wordle', 7) !== l.levelSeed('connections', 7),
            // ‏ميزانيّةُ التخمين تضيق كلّما صعِد السلّم — وتُقاس على لعبةٍ لها
            // ميزانيّةٌ أصلًا. أوّلُ محاولةٍ هنا قاست «كَلِمة»، فرجعت `null`
            // إحدى وعشرين مرّة: صحيحةٌ (لها ستّةُ صفوفٍ لا ميزانيّة) وخاليةٌ من
            // أيّ معنًى. فبقيت الآن الغيابُ مُسجَّلًا صراحةً بجانب الحضور.
            budgetLadderBee: [...Array(l.LEVELS)].map((_, i) => (l.budgetFor('spelling_bee', i) || {}).n),
            budgetLadderLamha: [...Array(l.LEVELS)].map((_, i) => (l.budgetFor('lamha', i) || {}).n),
            budgetShapeAtZero: l.budgetFor('spelling_bee', 0),
            budgetAbsentForWordle: l.budgetFor('wordle', 0),
            decoysLadder: [...Array(l.LEVELS)].map((_, i) => l.decoysFor('connections', i)),
            // ‏حالةُ البدء في سياقٍ نظيف: لا لوحَ مُنجَزًا، والجبهةُ عند الأوّل.
            startMask: l.mask('wordle'),
            startCleared: l.cleared('wordle'),
            startFrontier: l.frontier('wordle'),
            startLevel: l.level('wordle'),
            // ‏قيمةٌ لا حكم: `playable` يرجع `MAX` (=٢٠، أعلى فهرس) لا `LEVELS`
            // ‏(=٢١، العدد). أوّلُ صياغةٍ قارنته بـ`LEVELS` فالتقطت `false` عن
            // سلوكٍ سليم — وهو بالضبط ما يجعل الحكمَ أسوأ من الرقم.
            playableValue: l.playable('wordle'),
            // ‏النخب: `best` يرجع −١ لا صفرًا حين لا رتبةَ بعد — والفرقُ يعني
            // «لم يُلعب» مقابل «لُعب فخسِر».
            tiersCount: r.TIERS.length,
            tierAtZero: r.tierFor(0).idx,
            tierAtOne: r.tierFor(1).idx,
            bestWhenNeverPlayed: r.best('wordle', 0),
            summaryKeys: Object.keys(r.summary()).sort(),
            summaryAtStart: r.summary(),
        };
    }));

    // ---- ٨ك. `finish()` — المَخرَجُ الوحيد لكلّ جولة -----------------------
    // ‏هذا المجسُّ يشتري ما لا يشتريه غيرُه: `finish` هو السطرُ الذي ينادي
    // ‏`LOOM.weaveRow()`، و`LOOM` كائنٌ حيٌّ يُبنى في `main.js` ويُمرَّر وسيطًا.
    // ‏فلو مُرِّر خطأً لانفجر هنا وحدَه — ولذلك يُنفَّذ فوزٌ حقيقيّ، ويُسجَّل
    // ‏نصُّ أيّ استثناءٍ **قيمةً** بدل أن يتسرّب إلى سجلّ الأخطاء بلا موضع.
    //
    // ‏يُترك بعد بقيّة المجسّات عمدًا: يكتب في التقدّم، فترتيبُه جزءٌ من معناه.
    await probe('finishRound', () => page.evaluate(() => {
        const l = window.__sura.levels;
        const loom = window.__sura.loom;
        const before = {
            mask: l.mask('wordle'), cleared: l.cleared('wordle'), level: l.level('wordle'),
            wins: loom ? loom.wins : null,
        };
        let res = null, threw = null;
        try { res = l.finish('wordle', { won: true, score01: 0.9 }); }
        catch (e) { threw = String(e && e.message || e); }
        return {
            threw,
            returnedKeys: res ? Object.keys(res).sort() : null,
            advanced: res ? res.advanced : null,
            rank: res ? res.rank : null,
            rankImproved: res ? res.rankImproved : null,
            levelBefore: before.level,
            levelAfter: l.level('wordle'),
            clearedBefore: before.cleared,
            clearedAfter: l.cleared('wordle'),
            maskBefore: before.mask,
            maskAfter: l.mask('wordle'),
            // ‏الرتبةُ سُجّلت فعلًا: `best` كان −١ قبلها.
            bestAfter: window.__sura.ranks.best('wordle', before.level),
            // ‏وخيطُ النَّول نُسج فعلًا: `LOOM.wins` عدّادٌ يُقرأ من الخارج،
            // ‏وهو الدليلُ الوحيد أنّ `LOOM` وصل الوحدةَ سليمًا. تُسجَّل القيمتان
            // لا الفرقُ وحدَه، لأنّ `weaveRow` يصمت إذا لم يُبنَ المحرّك أصلًا
            // (عتادٌ ضعيف)، وذلك صمتٌ مشروعٌ يجب أن يُرى لا أن يُخفى في `false`.
            loomWinsBefore: before.wins,
            loomWinsAfter: loom ? loom.wins : null,
        };
    }));

    // ---- ٨ل. initFeedback — «أبلغ وقيّم» -----------------------------------
    // ‏لا يُرسَل بلاغٌ حقيقيّ: الإرسالُ يكتب في جدولٍ إنتاجيّ، وفحصٌ يترك أثرًا
    // في قاعدةِ بياناتِ المالك أثرٌ جانبيّ لا قياس. يُقاس ما هو منطقٌ محض:
    // مقياسُ قوّة الوصف، وذاكرةُ «قُيِّمَت هذه اللعبة»، وحدُّ الطول الذي حلّ
    // محلَّ الأربعين حرفًا، والنجومُ التي تُطفأ بإعادة النقر.
    await probe('feedback', () => page.evaluate(() => {
        const f = window.__sura.feedback;
        const $ = id => document.getElementById(id);
        const before = f.rated('wordle');
        f.askRating('wordle');
        const afterAsk = f.rated('wordle');
        return {
            api: Object.keys(f).sort(),
            // ‏العُقَدُ التي تملكها الوحدة موجودةٌ في المستند — وحدةٌ لم تُنادَ
            // تترك النموذجَ حيًّا في `index.html` وصامتًا، فيبدو سليمًا.
            formPresent: !!$('fb-form'),
            ideaFormPresent: !!$('idea-form'),
            statusPresent: !!$('fb-status'),
            strengthPresent: !!$('fb-strength'),
            starsCount: ($('idea-stars') ? $('idea-stars').querySelectorAll('button, .star').length : -1),
            // ‏قائمةُ الألعاب في «اقترح» تُبنى من `LIVE_GAMES` لا تُكتب يدويًّا.
            ideaGameOptions: $('idea-game')
                ? [...$('idea-game').options].map(o => o.value) : null,
            // ‏«قُيِّمَت» ذاكرةٌ لا حكم: تُقرأ قبل وبعد `askRating` وتُسجَّل قيمتان.
            ratedBefore: before,
            ratedAfterAsk: afterAsk,
            ratedUnknownGame: f.rated('__fpGame__'),
            // ‏زرُّ الميكروفون يظهر فقط حيث يوجد `SpeechRecognition` — القيمةُ
            // ‏تُسجَّل كما هي، فهي خاصّيّةُ متصفّحٍ لا ادّعاءُ صحّة.
            speechSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
            micHidden: $('fb-form') && $('fb-form').querySelector('.fb-mic')
                ? $('fb-form').querySelector('.fb-mic').hidden : null,
        };
    }));

    // ---- ٨م. `weaveIn` — الكشفُ المنسوج ------------------------------------
    // ‏مُلّاكُ `clip-path` على النصّ واحدٌ عمدًا (انظر الترويسةَ فوق الدالّة في
    // ‏المصدر). وهو يخرج إلى وحدةٍ مشتركة، فيُقاس عقدُه الحقيقيّ: يُضاف الصنفُ
    // ‏لحظةَ الكشف ويُنزع عند انتهائه — فحالةُ الراحة **دائمًا بلا** `clip-path`،
    // ولا يعلق نصٌّ مخفيًّا. تُقاس الحالتان بفاصلٍ زمنيّ لا بواحدةٍ منهما.
    // ‏أوّلُ صياغةٍ نادت `loom.reweave('home')` والصفحةُ على `home` أصلًا،
    // ‏فرجعت `applyRoute` مبكّرةً ولم يُكشَف شيء: `weaving:false` و`dur:null`
    // على سلوكٍ سليم، ثمّ `after` صحيحةٌ بلا معنى لأنّ حركةً لم تجرِ قطّ.
    // فصار المجسُّ يسلك الطريقَ نفسَه الذي يسلكه الزائر: نقرةٌ على «الألعاب».
    await probe('weave', async () => {
        await page.click('a.nav-link[href="#games"]');
        const during = await page.evaluate(() => {
            const el = document.querySelector('#games .games-title');
            if (!el) return { node: false };
            return {
                node: true,
                dur: el.style.getPropertyValue('--weave-dur') || null,
                delay: el.style.getPropertyValue('--weave-delay') || null,
                weaving: el.classList.contains('is-weaving'),
            };
        });
        await page.waitForTimeout(1800);
        const after = await page.evaluate(() => {
            const el = document.querySelector('#games .games-title');
            const cs = el ? getComputedStyle(el) : null;
            return {
                stillWeaving: !!(el && el.classList.contains('is-weaving')),
                // ‏الادّعاءُ الذي يهمّ: لا `clip-path` عالقٌ بعد الحركة.
                clipAtRest: cs ? cs.clipPath : null,
                inlineDurCleared: el ? !el.style.getPropertyValue('--weave-dur') : null,
                visible: el ? el.getBoundingClientRect().height > 0 : null,
            };
        });
        await page.click('a.nav-link[href="#home"]');
        await page.waitForTimeout(600);
        return { during, after };
    });

    // ---- ٨ن. initAuth — البوّابة ------------------------------------------
    // ‏هذه أخطرُ كتلةٍ في المشروع لأنّ انحدارَها الصامت يكلّف اللاعبَ حسابَه لا
    // ‏إعادةَ رسم: بوّابةُ البريد الواحدة التي توجّه إلى «دخول» أو «إنشاء»،
    // ‏والمعالج ثلاثيُّ الخطوات، ومفاتيحُ الاستعادة، وGoogle.
    //
    // ‏ولا يُنشَأ حسابٌ ولا تُدخَل كلمةُ مرورٍ ولا يُرسَل بريدٌ هنا — لا لأنّ
    // ‏ذلك أدقّ، بل لأنّه ممنوع. فيُقاس ما هو منطقٌ محضٌ في المتصفّح: مقياسُ
    // ‏قوّة كلمة المرور، وتعقيمُ الاسم، وقواعدُ الفتح والتبديل والإغلاق.
    await probe('auth', async () => {
        await page.evaluate(() => window.__sura.openAuth());
        // ‏قفلُ التمرير يجري في `MutationObserver`، ونداءُ مراقبٍ لا يقع في
        // ‏الدَّورة التي غيّرت الصنف. أوّلُ صياغةٍ قرأت `body` في نفس
        // ‏`evaluate` الذي فتح النافذة، فقاست ما قبل المراقب لا ما بعده.
        await page.waitForTimeout(120);
        const opened = await page.evaluate(() => {
            const $ = id => document.getElementById(id);
            const s = window.__sura;
            const m = $('auth-modal');
            const vis = f => { const el = $(f); return el ? !el.hidden && el.offsetParent !== null : null; };
            return {
                api: ['openAuth', 'openVerifyOtp', 'refreshNav'].map(k => typeof s[k]),
                modalOpen: !!(m && m.classList.contains('active')),
                // ‏الصنفُ `sura-modal-open` على `body` — لا `modal-open`.
                // ‏أوّلُ صياغةٍ قاست الاسمَ الخطأ، فالتقطت `false` على قفلٍ يعمل
                // ‏ثمّ `true` على فكٍّ لم يجرِ: كذبتان تتعادلان في المقارنة.
                bodyModalOpen: document.body.classList.contains('sura-modal-open'),
                // ‏البوّابةُ الواحدة: يُعرض حقلُ البريد أوّلًا، لا لوحان.
                gateVisible: vis('auth-gate-form'),
                signinVisible: vis('auth-signin-form'),
                signupVisible: vis('auth-signup-form'),
                // ‏العناصرُ التي يملكها الوضعُ موجودةٌ في المستند.
                nodes: ['auth-gate-form', 'auth-signin-form', 'auth-signup-form',
                    'auth-otp-form', 'auth-reset-form', 'auth-newpw-form',
                    'auth-oauth', 'pw-strength-bar', 'claim-username']
                    .map(id => !!$(id)),
                // ‏التركيزُ **لا** يُنقل عند الفتح: `initFocusTrap` يتدخّل عند
                // ‏`Tab` لا عند الظهور. تُسجَّل القيمةُ كما هي، ويُقاس العقدُ
                // الحقيقيّ بعد ضغط `Tab` أدناه.
                focusInsideModalAtOpen: !!(m && m.contains(document.activeElement)),
            };
        });
        // ‏عقدُ الحبس: بعد `Tab` يصير التركيزُ داخل النافذة ولا يتسرّب خلفَها.
        await page.keyboard.press('Tab');
        const trapped = await page.evaluate(() => {
            const m = document.getElementById('auth-modal');
            return {
                focusInsideAfterTab: !!(m && m.contains(document.activeElement)),
                focusedTag: document.activeElement ? document.activeElement.tagName : null,
            };
        });

        // ‏الإغلاق بـEscape جزءٌ من العقد، ويُقاس بالمفتاح لا باستدعاء دالّة.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        const closed = await page.evaluate(() => {
            const m = document.getElementById('auth-modal');
            return {
                modalClosed: !!(m && !m.classList.contains('active')),
                bodyModalOpen: document.body.classList.contains('sura-modal-open'),
            };
        });
        // ‏مقياسُ القوّة منطقٌ محضٌ مربوطٌ بالحقل نفسِه لا بظهور اللوح، فيُقاس
        // ‏بلا معالجٍ ولا شبكة: تُكتب أربعُ كلماتٍ متدرّجةٍ ويُقرأ عرضُ الشريط.
        // ‏تُسجَّل النِّسَب لا حكمُ «تصاعديّة»: منحنًى انزاح يظهر في موضعه.
        const meter = await page.evaluate(() => {
            const pw = document.getElementById('signup-password');
            const bar = document.getElementById('pw-strength-bar');
            if (!pw || !bar) return { nodes: false };
            const widths = [];
            for (const v of ['a', 'abcdefgh', 'Abcdefg1', 'Abcdefg1!xyz']) {
                pw.value = v;
                pw.dispatchEvent(new Event('input', { bubbles: true }));
                widths.push(bar.style.width);
            }
            pw.value = '';
            pw.dispatchEvent(new Event('input', { bubbles: true }));
            return { nodes: true, widths, clearedWidth: bar.style.width };
        });
        return { opened, trapped, closed, meter };
    });

    // ---- ٩. initAnalytics · initPhaseCopy · initSoloModals ------------------
    await probe('wiring', () => page.evaluate(() => ({
        trackIsFunction: typeof window.__sura.track === 'function',
        deviceIdPersisted: !!localStorage.getItem('sura.device_id'),
        sessionIdPersisted: !!sessionStorage.getItem('sura.session_id'),
        phaseLineFilled: ((document.getElementById('hero-phase-line') || {}).textContent || '').trim().length > 0,
        soloModalsInDom: document.querySelectorAll('[data-modal-solo]').length,
    })));

    // ---- ١٠. announcementStrip --------------------------------------------
    // ‏القيمةُ لا تُبصَم (يكتبها المالكُ في صفٍّ ويتبدّل)؛ يُبصَم أنّ الطلبَ جرى
    // مرّةً واحدةً وخُبِّئ في الجلسة.
    await probe('announcement', () => page.evaluate(() => {
        let cached = null;
        try { cached = sessionStorage.getItem('__sura_note'); } catch (e) { }
        return { sessionCacheWritten: cached !== null };
    }));

    // ---- ١١. محرّكُ «كَلِمة» ------------------------------------------------
    // ‏آخرُ رقعةٍ في `main.js` بلا مجسّ، وهي التي ستُنقل. تُقاس هنا **البنيةُ
    // والاشتقاق** لا محتوى البنك: عددُ الصفوف والخانات، تخطيطُ لوحة المفاتيح
    // ‏(مسمّرٌ في المصدر)، سلّمُ أطوال الكلمة عبر المستويات الأحدَ والعشرين —
    // ‏وهو الدليلُ الوحيد أنّ `register('wordle')` جرى وأنّ `curves.wordle`
    // وصلت — ثمّ المسارات الأربعة التي تخرج من `handleEnter`.
    //
    // ‏الكلمةُ السرّيّة لا تُسجَّل قطّ: يُسجَّل طولُها، وتُشتقّ منها المدخلاتُ.
    // ‏فلو بُدِّل البنكُ غدًا لبقيت كلُّ القيم كما هي — وهذا هو الفرق بين بصمةٍ
    // ‏تُقرأ بعد سنةٍ وإنذارٍ كاذبٍ يُطفَأ بعد أسبوع.
    //
    // ‏يُترك أخيرًا عمدًا: يلعب جولةً رابحةً حقيقيّة، فيكتب في التقدّم.
    await probe('wordle', async () => {
        await page.evaluate(() => {
            document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
            try { window.__sura.meta.write('demoSeen.wordle', 1); } catch (e) { }
        });
        await page.waitForTimeout(400);
        await page.evaluate(() => document.getElementById('play-wordle-btn').click());
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
            const d = document.getElementById('demo-modal');
            if (d) d.classList.remove('active');
        });
        // ‏الإدخالُ محجوبٌ حتّى يجهز المعجم (`handleEnter` يرفض قبله)، فينتظَر
        // صراحةً بدل توقيتٍ يُرجى.
        try {
            await page.waitForFunction(() => window.__sura.dict && window.__sura.dict.ready, null, { timeout: 20000 });
        } catch (e) { /* يُسجَّل أدناه في `dictReady` */ }

        const shape = await page.evaluate(() => {
            const l = window.__sura.levels;
            const board = document.getElementById('wordle-board');
            const kb = document.getElementById('wordle-keyboard');
            const sub = document.getElementById('wordle-subtitle');
            const secret = document.getElementById('wordle-modal').dataset.secret || '';
            return {
                modalActive: document.getElementById('wordle-modal').classList.contains('active'),
                dictReady: !!(window.__sura.dict && window.__sura.dict.ready),
                rows: board.children.length,
                rowIds: [...board.children].map(r => r.id),
                cellsPerRow: [...board.children].map(r => r.children.length),
                firstRowCellIds: [...(board.children[0] || { children: [] }).children].map(c => c.id),
                kbRows: kb.children.length,
                kbLayout: [...kb.children].map(r => [...r.children].map(b => b.dataset.key)),
                kbWideKeys: [...kb.querySelectorAll('.kbd-key.wide')].map(b => b.dataset.key),
                // ‏الطولُ لا الكلمة — واتّساقُ اللوح معه.
                secretLen: [...secret].length,
                boardWidthMatchesSecret: (board.children[0] || { children: [] }).children.length === [...secret].length,
                // ‏سلّمُ الأطوال كاملًا: ٤ ← ٥ ← ٦ عبر النطاقات الثلاثة.
                lenLadder: [...Array(l.LEVELS)].map((_, i) => l.diffFor('wordle', i).len),
                rulesLen: l.rulesOf('wordle').length,
                // ‏التلميحُ لا يُطبع إلّا في المحاولة الأخيرة (قرارُ المالك).
                subtitleHasHintEarly: /تلميح/.test(sub.textContent),
                subtitleNonEmpty: sub.textContent.trim().length > 0,
            };
        });

        // ‏١) صفٌّ ناقص: `showMessage` و`shakeRow` كلاهما متزامنٌ داخل المُعالِج،
        // ‏فيُنقَر ويُقرأ في نفسِ الـevaluate — لا انتظارَ يخفي النتيجة.
        const incomplete = await page.evaluate(() => {
            const click = k => document.querySelector(`.kbd-key[data-key="${k}"]`).click();
            click('ض');
            click('إدخال');
            return {
                message: document.getElementById('wordle-message').textContent,
                messageVisible: document.getElementById('wordle-message').classList.contains('visible'),
                rowShaking: document.getElementById('row-0').classList.contains('shake'),
                firstCellFilled: document.getElementById('cell-0-0').textContent.length === 1,
            };
        });

        // ‏٢) الحذف يمسح الخانة ويرجع المؤشّر.
        const backspace = await page.evaluate(() => {
            document.querySelector('.kbd-key[data-key="حذف"]').click();
            return { firstCellEmpty: document.getElementById('cell-0-0').textContent === '' };
        });

        // ‏٣) كلمةٌ غيرُ موجودةٍ في المعجم تُرفض، والحروفُ تبقى ليعدّلها اللاعب
        // ‏(قرارٌ مقصود في المصدر) والصفُّ لا يتقدّم ولا يُلوَّن.
        const rejected = await page.evaluate((n) => {
            const click = k => document.querySelector(`.kbd-key[data-key="${k}"]`).click();
            for (let i = 0; i < n; i++) click('ض');
            click('إدخال');
            const cells = [...document.getElementById('row-0').children];
            return {
                message: document.getElementById('wordle-message').textContent,
                lettersKept: cells.every(c => c.textContent === 'ض'),
                noStatusPainted: cells.every(c =>
                    !c.classList.contains('correct') && !c.classList.contains('present') && !c.classList.contains('absent')),
                stillOnFirstRow: !document.getElementById('cell-1-0').textContent,
            };
        }, shape.secretLen);

        // ‏٤) الفوز. تُدقّ الحروفُ عبر `keydown` لا عبر أزرار اللوحة: السرُّ قد
        // ‏يحمل «أ» أو «إ» ولا مفتاحَ لهما، و`normalizeArabic` تطويهما عند
        // المقارنة — فالنقرُ وحده كان سيفشل على كلماتٍ صحيحةٍ تمامًا.
        const win = await page.evaluate(async (n) => {
            const click = k => document.querySelector(`.kbd-key[data-key="${k}"]`).click();
            for (let i = 0; i < n; i++) click('حذف');
            const l = window.__sura.levels;
            const levelBefore = l.level('wordle');
            const secret = [...(document.getElementById('wordle-modal').dataset.secret || '')];
            for (const ch of secret) document.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
            const typed = [...document.getElementById('row-0').children].every(c => c.textContent.length === 1);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            // ‏الكشفُ متدرّجٌ ٢٠٠ms لكلّ خانة، ثمّ `checkGameState` عند الأخيرة.
            await new Promise(r => setTimeout(r, n * 200 + 900));
            const cells = [...document.getElementById('row-0').children];
            return {
                allTyped: typed,
                allCorrect: cells.every(c => c.classList.contains('correct')),
                statuses: cells.map(c => c.classList.contains('correct') ? 'correct'
                    : c.classList.contains('present') ? 'present'
                        : c.classList.contains('absent') ? 'absent' : ''),
                actionsShown: !document.getElementById('wordle-actions').classList.contains('hidden'),
                restartLabel: document.getElementById('wordle-restart-btn').textContent,
                message: document.getElementById('wordle-message').textContent,
                keysPaintedCorrect: document.querySelectorAll('.kbd-key.correct').length > 0,
                levelBefore,
                levelAfter: l.level('wordle'),
                // ‏بعد الانتهاء لا يُقبل إدخال: `isGameOver` يحرس المُعالِج.
                inputDeadAfterWin: (() => {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ض' }));
                    return document.getElementById('cell-1-0').textContent === '';
                })(),
            };
        }, shape.secretLen);

        await page.evaluate(() => {
            document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
        });
        await page.waitForTimeout(300);
        return { shape, incomplete, backspace, rejected, win };
    });

    fp.errors = { console: consoleErrors.sort(), page: pageErrors.sort() };

    await browser.close();

    // ---- المخرَج ----------------------------------------------------------
    const json = JSON.stringify(fp, null, 2);

    if (AGAINST) {
        const prev = JSON.parse(fs.readFileSync(path.resolve(ROOT, AGAINST), 'utf8'));
        const diffs = [];
        const walk = (a, b, p) => {
            const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
            for (const k of keys) {
                const av = a ? a[k] : undefined, bv = b ? b[k] : undefined;
                const both = av && bv && typeof av === 'object' && typeof bv === 'object'
                    && !Array.isArray(av) && !Array.isArray(bv);
                if (both) walk(av, bv, p ? `${p}.${k}` : k);
                else if (JSON.stringify(av) !== JSON.stringify(bv))
                    diffs.push(`${p ? p + '.' : ''}${k}: ${JSON.stringify(av)} → ${JSON.stringify(bv)}`);
            }
        };
        walk(prev, fp, '');
        if (diffs.length) {
            console.log('FINGERPRINT_DRIFT (' + diffs.length + ')');
            diffs.forEach(d => console.log('   ✗ ' + d));
            process.exit(1);
        }
        console.log('FINGERPRINT_OK — مطابقةٌ لـ' + AGAINST);
        return;
    }

    if (OUT) {
        const abs = path.resolve(ROOT, OUT);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, json + '\n');
        console.log('كُتبت البصمة → ' + OUT);
    } else {
        console.log(json);
    }
    const bad = consoleErrors.length + pageErrors.length;
    console.log(bad ? `FINGERPRINT_CAPTURED (مع ${bad} خطأ)` : 'FINGERPRINT_CAPTURED (بلا أخطاء)');
})();
