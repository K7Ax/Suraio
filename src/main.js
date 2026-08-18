// app.js - Unified Sura Single-Page Scrolling Engine (60fps Preloaded Video Pool)
// Built from src/ ES modules via esbuild (`npm run build`) into a single app.js.
import { normalizeArabic, arNum, escapeHtmlShared, suraDailySeed, mulberry32, seededShuffle } from './core/util.js';
import { sb, SURA, SURA_URL_HASH } from './core/supabaseClient.js';
import * as D from './core/daily.mjs';
import { advanceStreak, streakAsOf } from './core/streak.mjs';
import { Dict } from './core/dict.mjs';
import * as FX from './core/fx.js';
import { initWordleGame } from './games/wordle.js';
import { initConnectionsGame } from './games/connections.js';
import { initSudokuGame } from './games/sudoku.js';
import { initBeeGame } from './games/bee.js';
import { initLetterBoxedGame } from './games/letterboxed.js';
import { initStrandsGame } from './games/strands.js';
import { initAmthalGame } from './games/amthal.js';
import { initTilesGame } from './games/tiles.js';
import { initPipsGame } from './games/pips.js';
import { initMissingWordGame } from './games/missing_word.js';
import { initStoryOrderGame } from './games/story_order.js';
import { initWarmerGame } from './games/warmer.js';
import { initLamhaGame } from './games/lamha.js';
import { initZayidGame } from './games/zayid.js';
import { applyTier, budget as deviceBudget, env as deviceEnv } from './core/tier.mjs';
import { createLoom, PHASES } from './core/loom.mjs';
import { createCards, scrollTriggerAwake } from './core/cards.mjs';
import { createStory } from './core/story.mjs';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
// ‏سلوكيّاتٌ عامّةٌ لا تخصّ لعبةً بعينها. كلُّ واحدةٍ تُصدّر `init()` واحدة،
// وتُنادى أدناه **بترتيبها الأصليّ نفسِه** — الترتيبُ جزءٌ من العقد لا تفصيلُ
// تنسيق: `initScrollLock` و`initFocusTrap` كلاهما يركّب مراقبًا على `body`
// ويُنادي `sync()` فورًا، فتبديلُ ترتيبهما يبدّل أيَّهما يرى النافذةَ أوّلًا.
import { initScrollBlur } from './ui/scrollBlur.js';
import { initScrollLock } from './ui/scrollLock.js';
import { initFocusTrap } from './ui/focusTrap.js';
import { initCloseBead } from './ui/closeBead.js';
import { initAnnouncementStrip } from './ui/announcementStrip.js';
import { initSoloModals } from './ui/soloModals.js';
import { initRules } from './ui/rules.js';
import { initAccount } from './ui/account.js';
import { initFeaturedDaily } from './ui/featuredDaily.js';
import { initDemo } from './ui/demo.js';
import { initLeaderboard } from './ui/leaderboard.js';
import { initDailyStrip } from './ui/dailyStrip.js';
import { initDict } from './core/dictApi.js';
import { initSuraMeta } from './ui/meta.js';
// ‏`initLevels` تأخذ `LOOM` وسيطًا للسبب نفسه، وتُنادى بعد `initSuraMeta()`.
import { initLevels } from './ui/levels.js';
// ‏سلوكٌ لا حالة، فيُستورَد: يقرؤه الهيرو وقسمُ الألعاب هنا، ولوحا «أبلغ»
// ‏و«اقترح» في `ui/feedback.js`.
import { weaveIn } from './ui/weave.js';
import { initFeedback } from './ui/feedback.js';
// ‏تُنادى مبكّرًا — قبل هذه كلِّها — لأنّها تقرأ جلسةَ الـURL عند الإقلاع.
import { initAuth } from './ui/auth.js';
// ‏تأخذان اعتماديهما وسيطًا لا استيرادًا: `PREFS` و`LOOM` كائنان حيّان يُبنيان
// مرّةً واحدةً هنا، ووحدةٌ تستوردهما تُنشئ نسخةً ثانيةً لا ترى الأولى.
import { initSettings } from './ui/settings.js';
import { initPhaseCopy } from './ui/phaseCopy.js';
import { initAnalytics } from './core/analytics.js';

// التسجيل هنا كان النسخة الثانية منه (والأخرى في cards.mjs)، وكلتاهما تُوقظان
// الإضافة عند التحميل. صار الإيقاظ كسولًا في cards.mjs عند أوّل بطاقةٍ تحت
// الطيّة — انظر التعليق هناك. ‏`ScrollTrigger` تبقى مستوردةً لأجل `refresh()`.

// الصورة الثابتة تتنفّس.
// A single frame held perfectly still reads as a broken video; the same frame
// drifting very slowly reads as a photograph of a place. This is the cheapest
// possible version of "use an image and move it with GSAP" — and it is what the
// hero falls back to whenever the film is too expensive for the connection.
//
// The numbers are deliberately tiny: a 1.06 scale over 24 seconds, alternating.
// Anything faster becomes a Ken Burns slideshow effect, which is the single most
// generic motion on the internet and would undo the point of using it at all.
// `scale` never goes below 1 or the frame's edges would pull inside the viewport.
function gsapDrift(el) {
    return gsap.fromTo(el,
        { scale: 1, xPercent: 0, yPercent: 0 },
        {
            scale: 1.06, xPercent: -1.2, yPercent: -0.8,
            duration: 24, ease: 'sine.inOut',
            yoyo: true, repeat: -1,
        });
}
function gsapClear(el) { gsap.set(el, { clearProps: 'transform' }); }


// كشفُ قسمٍ كامل: العنوانان يمينًا→يسارًا والوصف عكسَهما، كما كان في CSS.
function weaveSection(sectionId) {
    const sec = document.getElementById(sectionId);
    if (!sec) return;
    const q = sel => Array.from(sec.querySelectorAll(sel));
    if (sectionId === 'games') {
        weaveIn(q('.games-subtitle, .games-title'), { delay: 0.08, stagger: 0.06 });
        weaveIn(q('.games-desc'), { delay: 0.30, dir: 'ltr' });
    } else if (sectionId === 'newsletter') {
        weaveIn(q('.issue-tag, .featured-wordle-title'), { delay: 0.08, stagger: 0.06 });
        weaveIn(q('.featured-wordle-tagline, .featured-wordle-desc'), { delay: 0.30, dir: 'ltr' });
    } else if (sectionId === 'home') {
        weaveHeroWhenVisible();
    }
}

// التوقيت يبقى مشتقًّا من `--sweep` التي تكتبها loom.mjs — مدّة مرور المكوك
// تتغيّر بساعة الليل، ولو ثُبّتت هنا لانفصل النصّ عن الضوء.
function sweepSeconds() {
    let raw = '1150ms';
    try { raw = getComputedStyle(document.documentElement).getPropertyValue('--sweep').trim() || raw; }
    catch (e) { }
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return 1.15;
    return /ms\s*$/.test(raw) ? n / 1000 : n;
}

function weaveHero() {
    const home = document.getElementById('home');
    if (!home || !home.classList.contains('active')) return;
    const s = sweepSeconds();
    weaveIn([document.getElementById('main-heading')], { dur: s * 0.30, delay: s * 0.16 });
    weaveIn([document.getElementById('hero-subtext')], { dur: s * 0.30, delay: s * 0.38 });
    weaveIn([home.querySelector('.hero-buttons')], { dur: s * 0.30, delay: s * 0.60 });
}

// النصّ لا يُكشف قبل أن يكون مرئيًّا. `data-story="playing"` يحجب
// `.hero-inner-content` حجبًا تامًّا (style.css:753)، ويرفعه `rest()` في
// story.mjs عند بلوغ الراحة مهما كان السبب — فهذه هي لحظة الكشف الوحيدة
// الصحيحة. المهلة شبكة أمان: لو لم تصل الراحة أبدًا يُكشف النصّ على أي حال.
function weaveHeroWhenVisible() {
    const root = document.documentElement;
    if (root.getAttribute('data-story') !== 'playing') { weaveHero(); return; }
    let done = false;
    const fire = () => {
        if (done) return;
        done = true;
        obs.disconnect();
        clearTimeout(t);
        weaveHero();
    };
    const obs = new MutationObserver(() => {
        if (root.getAttribute('data-story') !== 'playing') fire();
    });
    obs.observe(root, { attributes: true, attributeFilter: ['data-story'] });
    const t = setTimeout(fire, 12000);
}

document.addEventListener('DOMContentLoaded', () => {
    // sb + SURA are imported from core/supabaseClient (created at module load).
    // normalizeArabic is imported from core/util (kept in sync with the server copies).
    window.__sura = { sb, normalizeArabic, fx: FX };

    // أوّل ما يُفعل: تصنيفُ الجهاز وكتابتُه على `<html data-tier>`. قبل النَّول
    // وقبل البطاقات وقبل المقطع، لأنّ ثلاثتها تسأل الميزانيّة عند البناء —
    // ومتأخّرًا يعني أن تُبنى على `full` ثمّ تُقلَّم، وهو أسوأ من ألّا تُقلَّم.
    // ‏CSS تقرأ السمة، و`window.__sura.tier` للتشخيص ولتجربة `?tier=lite`.
    try {
        window.__sura.tier = applyTier(window);
        window.__sura.deviceBudget = deviceBudget();
        window.__sura.deviceEnv = deviceEnv();
    } catch (e) { }

    // ============================================================
    // Reliability — structured, secret-free error reporting. Centralizes the
    // "no silent failures" rule: every swallowed backend/UI error is logged with
    // its feature name + a safe message + optional small context, so problems are
    // observable in the console without ever interrupting gameplay. NEVER logs
    // tokens/keys/payloads and NEVER throws.
    // ============================================================
    window.__sura.reportError = function (feature, err, ctx) {
        try {
            var msg = (err && (err.message || err.error_description || err.reason)) || String(err == null ? 'unknown' : err);
            var line = '[sura:' + (feature || 'app') + '] ' + msg;
            if (ctx) { try { line += ' ' + JSON.stringify(ctx); } catch (e) { } }
            console.warn(line);
        } catch (e) { /* reporting must never break anything */ }
    };
    // Global safety nets: surface otherwise-uncaught script errors and rejected
    // promises through the same reporter. Log-only (we never preventDefault), so
    // default browser behavior is unchanged and the page can't be crashed by this.
    window.addEventListener('error', function (e) {
        if (e && e.error) window.__sura.reportError('window', e.error, e.filename ? { at: e.filename + ':' + e.lineno } : null);
    });
    window.addEventListener('unhandledrejection', function (e) {
        window.__sura.reportError('promise', e && e.reason);
    });

    // ============================================================
    // Analytics — fire-and-forget event logging into public.game_events.
    // Captures REAL behavior (visits, opens, starts, completes, fails, hints,
    // quits, shares, daily returns) so we can MEASURE retention / completion /
    // rage-quit instead of guessing. It NEVER blocks the UI and swallows every
    // error, so a logging hiccup or an offline player can't break gameplay.
    // Wired centrally into the shared hooks below. See supabase/sql/game_events.sql.
    // ============================================================
    initAnalytics();

    // Optional AI hint via the groq-hint Edge Function. Returns { hint,
    // reveal_risk } or null on ANY failure/timeout — callers MUST fall back to
    // the local deterministic hint (the game never depends on AI). Only works
    // for signed-in players (the function enforces it server-side).
    window.__sura.aiHint = async function (game, payload) {
        try {
            if (!sb) return null;
            const invoke = sb.functions.invoke('groq-hint', { body: Object.assign({ game }, payload || {}) });
            const timeout = new Promise(r => setTimeout(() => r({ data: null }), 6000));
            const { data, error } = await Promise.race([invoke, timeout]);
            if (error || !data || !data.ok || !data.hint) return null;
            return { hint: String(data.hint), reveal_risk: data.reveal_risk || 'low' };
        } catch (e) { window.__sura.reportError('aiHint', e, { game: game }); return null; }
    };

    // Optional AI JUDGE via the groq-judge Edge Function — validates whether a
    // typed answer is a real member of a category (used by «زايد» for open
    // categories like places, so a real-but-unlisted village still counts).
    // Returns { valid, canonical } or null on ANY failure/timeout — callers MUST
    // fall back to list-only judging (the game never depends on AI). Signed-in
    // players only (enforced server-side).
    window.__sura.aiJudge = async function (category, answer) {
        try {
            if (!sb) return null;
            const invoke = sb.functions.invoke('groq-judge', { body: { category, answer } });
            const timeout = new Promise(r => setTimeout(() => r({ data: null }), 6000));
            const { data, error } = await Promise.race([invoke, timeout]);
            if (error || !data || !data.ok) return null;
            return { valid: !!data.valid, canonical: data.canonical || answer };
        } catch (e) { window.__sura.reportError('aiJudge', e, { category: category }); return null; }
    };

    // «زايد» ghost pool — recorded PAST-PLAYER attempts that stand in for a live
    // opponent. The bundled bank (bank/saudi/zayid_ghosts.json) seeds it so the
    // game always has a believable human opponent offline; once the owner applies
    // supabase/sql/zayid_ghosts.sql these calls fetch & record REAL players'
    // attempts, so the ghost becomes a genuine replay of another human. Every
    // call fails soft (null / no-op) → the game falls back to the bundled bank.
    window.__sura.zayidGhosts = {
        async fetch(category) {
            try {
                if (!sb || !category) return null;
                const q = sb.from('zayid_ghosts').select('name,claimed,delivered,items').eq('category', category).limit(60);
                const timeout = new Promise(r => setTimeout(() => r({ data: null }), 6000));
                const { data, error } = await Promise.race([q, timeout]);
                if (error || !Array.isArray(data)) return null;
                return data.filter(g => g && Array.isArray(g.items) && g.items.length);
            } catch (e) { return null; }
        },
        async record(rec) {
            try {
                if (!sb || !rec || !rec.category || !Array.isArray(rec.items) || rec.items.length < 2) return;
                await sb.from('zayid_ghosts').insert({
                    category: rec.category, name: rec.name || 'لاعب',
                    claimed: rec.claimed | 0, delivered: rec.delivered | 0, items: rec.items
                });
            } catch (e) { /* pool write is best-effort */ }
        }
    };

    // ============================================================
    // Accessibility preferences — font size, font family, color theme.
    // Stored GLOBALLY (not per-uid, so it survives logout) and applied to
    // <html> as data-* attrs + a --font-scale var. A tiny inline <head>
    // script applies the same on first paint to avoid a flash; this module
    // owns runtime changes. Pure client-side, zero backend.
    // ============================================================
    const PREFS = (function initPrefs() {
        const KEY = 'sura.pref';
        const FONT_SCALES = [1, 1.15, 1.3, 1.5];
        const FONTS = ['reem', 'tajawal', 'naskh'];
        const THEMES = ['dark']; // light/contrast disabled for now → all reset to dark
        const def = { fontScale: 1, fontFamily: 'reem', theme: 'dark' };
        function readAll() {
            try { return Object.assign({}, def, JSON.parse(localStorage.getItem(KEY) || '{}')); }
            catch (e) { return Object.assign({}, def); }
        }
        function writeAll(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { } }
        let state = readAll();
        if (FONT_SCALES.indexOf(state.fontScale) < 0) state.fontScale = 1;
        if (FONTS.indexOf(state.fontFamily) < 0) state.fontFamily = 'reem';
        if (THEMES.indexOf(state.theme) < 0) state.theme = 'dark';
        // Tajawal / Naskh are a user PREFERENCE, not the default. Shipping all three
        // families in <head> put 6 unused font faces on the render-blocking path for
        // every visitor who never opens the settings panel, so the head now carries
        // Reem Kufi alone and the alternates are fetched the moment one is chosen.
        // index.html's pre-paint script does the same for a returning visitor, so the
        // swap happens before first paint rather than after this bundle parses.
        const FONT_HREF = {
            tajawal: 'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap',
            naskh: 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;700&display=swap'
        };
        function ensureFont(fam) {
            const href = FONT_HREF[fam];
            if (!href || document.querySelector('link[data-font-lazy="' + fam + '"]')) return;
            const l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            l.setAttribute('data-font-lazy', fam);
            document.head.appendChild(l);
        }
        function apply() {
            const root = document.documentElement;
            root.style.setProperty('--font-scale', String(state.fontScale));
            root.setAttribute('data-font', state.fontFamily);
            root.setAttribute('data-theme', state.theme);
            ensureFont(state.fontFamily);
        }
        function set(key, val) {
            state[key] = val; writeAll(state); apply();
            document.dispatchEvent(new CustomEvent('sura:prefs', { detail: Object.assign({}, state) }));
        }
        function get() { return Object.assign({}, state); }
        function stepZoom(dir) {
            let i = FONT_SCALES.indexOf(state.fontScale); if (i < 0) i = 0;
            const ni = Math.max(0, Math.min(FONT_SCALES.length - 1, i + dir));
            set('fontScale', FONT_SCALES[ni]);
            return FONT_SCALES[ni];
        }
        apply();
        return { get, set, stepZoom, FONT_SCALES, FONTS, THEMES };
    })();
    window.__sura.prefs = PREFS;

    // ============================================================
    // Shared multi-game infrastructure (Connections, Sudoku, Spelling Bee).
    // Wordle predates this module and keeps its own inline copy untouched.
    // Everything here is generalized from the original wordle code so all
    // games gate, fetch, submit, and render the leaderboard identically.
    // ============================================================
    // arNum + escapeHtmlShared are imported from core/util.

    window.__sura.games = {
        arNum,
        escapeHtml: escapeHtmlShared,

        // GET get-todays-puzzle?game=GAMETYPE — returns the puzzle row or null.
        //
        // The function serves exactly four game types; thirteen games call this.
        // The other eleven were each making a request that could only ever come
        // back 400 — measured at 3 of the 7 edge invocations on a visit. They
        // already handle null (the board is local either way; the response only
        // supplies serverId for the daily leaderboard), so not asking changes
        // nothing except the bill.
        //
        // A mirrored literal can drift from the server's. A browser cannot read
        // the Deno source at runtime, so the guard is a test:
        // tests/cost.test.js fails if these two lists stop matching.
        __served: ['wordle', 'connections', 'crossword', 'spelling_bee'],
        async fetchPuzzle(gameType) {
            if (!sb) return null;
            if (this.__served.indexOf(gameType) === -1) return null;
            // Same puzzle all day, so a second open — or a reload — costs nothing.
            const ck = `sura.puzzle.${gameType}.${suraDailySeed()}`;
            try {
                const hit = sessionStorage.getItem(ck);
                if (hit) return JSON.parse(hit);
            } catch (e) { /* private mode / quota — fall through and fetch */ }
            try {
                const url = `${SURA.SUPABASE_URL}/functions/v1/get-todays-puzzle?game=${encodeURIComponent(gameType)}`;
                const res = await fetch(url, { headers: { apikey: SURA.SUPABASE_ANON_KEY } });
                const json = await res.json();
                const puzzle = json.puzzle || null;
                if (puzzle) { try { sessionStorage.setItem(ck, JSON.stringify(puzzle)); } catch (e) { } }
                return puzzle;
            } catch (e) { window.__sura.reportError('fetchPuzzle', e, { game: gameType }); return null; }
        },

        // GET get-daily-challenge — «تحدي اليوم» for the ONE live day.
        //
        // Deliberately takes no date: the window is 24 hours and the server owns
        // the boundary (00:00 Asia/Riyadh). And deliberately optional: the plan
        // is a pure function of the date, so a failure here costs provenance, not
        // playability. Fetched once per day and cached — a second open of the
        // same modal makes no request.
        //
        // The cache is in sessionStorage, not just in memory: the plan is fixed
        // for the whole day, so a reload has nothing new to learn. Keyed by date
        // so it expires itself at the Riyadh boundary rather than by a timer.
        // This is also the endpoint the load test found at p95 2.5s under a
        // hundred simultaneous opens — every request it does not make is one
        // fewer in that burst.
        __dailyCache: null,
        async fetchDaily() {
            const today = suraDailySeed();
            if (this.__dailyCache && this.__dailyCache.date === today) return this.__dailyCache.res;
            const ck = `sura.daily.${today}`;
            try {
                const hit = sessionStorage.getItem(ck);
                if (hit) {
                    const res0 = JSON.parse(hit);
                    this.__dailyCache = { date: today, res: res0 };
                    if (res0 && window.__sura.levels && window.__sura.levels.daily) window.__sura.levels.daily.absorb(res0);
                    return res0;
                }
            } catch (e) { /* private mode / quota — fall through and fetch */ }
            let res = null;
            try {
                const url = `${SURA.SUPABASE_URL}/functions/v1/get-daily-challenge`;
                const r = await fetch(url, { headers: { apikey: SURA.SUPABASE_ANON_KEY }, cache: 'no-store' });
                res = r.ok ? await r.json() : null;
            } catch (e) { res = null; }
            this.__dailyCache = { date: today, res };
            // Only a real answer is worth remembering — caching a null would
            // turn one bad minute of network into a whole day without provenance.
            if (res) { try { sessionStorage.setItem(ck, JSON.stringify(res)); } catch (e) { } }
            if (res && window.__sura.levels && window.__sura.levels.daily) window.__sura.levels.daily.absorb(res);
            return res;
        },

        // POST submit-daily — credit today's daily challenge to «السلسلة اليوميّة».
        //
        // Signed-in only, and that is not a gate on PLAY: an anonymous player gets
        // the same board and a local streak, they just don't get a server record.
        // Fire-and-forget from finishDaily — a failed request never costs the
        // player the streak they can already see on screen, and the server is
        // idempotent per day, so a retry tomorrow's-worth of times is harmless.
        async submitDaily(game) {
            if (!sb || !game) return null;
            const { data: { session } } = await sb.auth.getSession();
            if (!session) return null;
            try {
                const res = await fetch(`${SURA.SUPABASE_URL}/functions/v1/submit-daily`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: SURA.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({ game })
                });
                return await res.json().catch(() => null);
            } catch (e) { return null; }
        },

        // Read the server streak (public SELECT under RLS, scoped to this user).
        // Called on session resolve so a returning player sees their real flame
        // before they play, not after.
        async loadDailyStreak() {
            if (!sb) return null;
            try {
                const { data: { session } } = await sb.auth.getSession();
                if (!session || !session.user) return null;
                const { data } = await sb.from('daily_streaks')
                    .select('current_streak,max_streak,last_day')
                    .eq('user_id', session.user.id).maybeSingle();
                if (!data) return null;
                // A stored streak whose last day is older than yesterday has
                // already lapsed — the server does not tick it down, so the
                // freshness call is made here, once, in one place.
                const day = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
                const today = Math.floor((Date.now() + 3 * 3600000) / 86400000);
                const alive = data.last_day && (today - day(data.last_day)) <= 1;
                const out = { current: alive ? (data.current_streak | 0) : 0, max: data.max_streak | 0 };
                if (window.__sura.levels && window.__sura.levels.daily) window.__sura.levels.daily.adoptServerStreak(out);
                return out;
            } catch (e) { return null; }
        },

        // Auth gate: must be signed in AND email-verified. Returns the session,
        // or null after opening the appropriate auth UI. (Mirrors openWordle.)
        async requireVerifiedSession() {
            if (!sb) return null;
            // Mail confirmation removed: any signed-in session may play (no
            // email-verification gate). Just require a session.
            const { data: { session } } = await sb.auth.getSession();
            if (!session) {
                if (window.__sura.openAuth) window.__sura.openAuth('signin');
                return null;
            }
            window.__sura.__uid = session.user ? session.user.id : 'anon';
            return session;
        },

        // Non-blocking counterpart: resolves the session if there is one and
        // NEVER opens the auth UI. Games open through this so a first-time
        // visitor plays immediately; the signup ask moves to after a win, where
        // it can point at progress the player already cares about.
        async resolveSession() {
            if (!sb) return null;
            try {
                const { data: { session } } = await sb.auth.getSession();
                if (session && session.user) window.__sura.__uid = session.user.id;
                return session || null;
            } catch (e) { return null; }
        },

        // POST a result to submit-guess. Returns parsed JSON or null. Anonymous
        // players don't post; onAnonWin fires instead (e.g. open signup on a win).
        async submitResult({ puzzle_id, game_type, guess, time_seconds }, onAnonWin) {
            if (!sb || !puzzle_id) return null;
            const { data: { session } } = await sb.auth.getSession();
            if (!session) { if (onAnonWin) onAnonWin(); return null; }
            try {
                const body = { puzzle_id, game_type, guess };
                if (time_seconds != null) body.time_seconds = time_seconds;
                const res = await fetch(`${SURA.SUPABASE_URL}/functions/v1/submit-guess`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: SURA.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify(body)
                });
                this.__lbBust();   // the player's own new row must not wait for a TTL
                return await res.json().catch(() => null);
            } catch (e) { window.__sura.reportError('submitResult', e, { game: game_type }); return null; }
        },

        // POST a campaign clear to submit-progress (server-authoritative XP/rank).
        // Signed-in only; anon players keep their local XP but don't populate the
        // global board. Fire-and-forget from complete() — never blocks the win.
        // The server owns XP (band-based) and rank; `proof`/`time_seconds` are
        // optional (proof only matters once a level_keys row exists for the level).
        async submitProgress({ game_type, level, proof, time_seconds }) {
            if (!sb || !game_type || level == null) return null;
            const { data: { session } } = await sb.auth.getSession();
            if (!session) return null;
            try {
                const body = { game_type, level };
                if (proof != null) body.proof = proof;
                if (time_seconds != null) body.time_seconds = time_seconds;
                const res = await fetch(`${SURA.SUPABASE_URL}/functions/v1/submit-progress`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: SURA.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify(body)
                });
                this.__lbBust();   // XP just changed — the global board is now stale
                return await res.json().catch(() => null);
            } catch (e) { window.__sura.reportError('submitProgress', e, { game: game_type }); return null; }
        },

        // Shared 60-second cache for get-leaderboard.
        //
        // What it actually saves is the «عام»/«يومي» toggle and the per-game
        // dropdown: flicking between boards used to fire a request per flick.
        // Sixty seconds is chosen against how fast the board really changes, not
        // against how fast a finger moves.
        //
        // The one moment staleness would be wrong is the moment a player wins,
        // because the row they want to see is their own — so submitting busts
        // the cache (__lbBust) rather than the TTL being shortened for everyone.
        __lb: Object.create(null),
        __lbBust() { this.__lb = Object.create(null); },
        async __lbRows(qs) {
            const now = Date.now();
            const hit = this.__lb[qs];
            if (hit && now - hit.t < 60000) return hit.rows;
            try {
                const res = await fetch(`${SURA.SUPABASE_URL}/functions/v1/get-leaderboard?${qs}`, {
                    headers: { apikey: SURA.SUPABASE_ANON_KEY }
                });
                if (!res.ok) return null;
                const { rows } = await res.json();
                const out = Array.isArray(rows) ? rows : [];
                this.__lb[qs] = { t: now, rows: out };
                return out;
            } catch (e) { return null; }
        },

        // GET get-leaderboard?board=global — the unified XP/rank board across all
        // games. Returns the rows array (name, total_xp, rank_tier, games_cleared,
        // rank) or [] on any failure. Public (no auth needed).
        async fetchGlobalLeaderboard(limit = 10) {
            if (!sb) return [];
            const rows = await this.__lbRows(`board=global&limit=${limit}`);
            return rows || [];
        },

        // Generalized leaderboard hydration (was a wordle-only IIFE).
        async hydrateLeaderboard(gameType, tbodyId, limit = 6) {
            if (!sb) return;
            try {
                const rows = await this.__lbRows(`game=${encodeURIComponent(gameType)}&limit=${limit}`);
                if (!rows || !rows.length) return;
                const tbody = document.getElementById(tbodyId);
                if (!tbody) return;
                const formatTime = s => s ? `${arNum(Math.floor(s/60))}:${arNum(String(s%60).padStart(2,'0'))}` : '—';
                tbody.innerHTML = rows.map((r, i) => {
                    const rank = i + 1;
                    if (rank <= 3) {
                        const medal = ['gold','silver','bronze'][rank-1];
                        const txt = ['gold-txt','silver-txt','bronze-txt'][rank-1];
                        return `<tr class="top-rank rank-${rank}-row"><td class="rank-col"><span class="rank-badge ${medal}">${arNum(rank)}</span></td><td class="name-col bold-name">${escapeHtmlShared(r.display_name||'لاعب')}</td><td class="time-col">${formatTime(r.time_seconds)}</td><td class="score-col ${txt}">${arNum(r.score)}</td></tr>`;
                    }
                    return `<tr class="normal-rank"><td class="rank-col">${arNum(rank)}</td><td class="name-col">${escapeHtmlShared(r.display_name||'لاعب')}</td><td class="time-col">${formatTime(r.time_seconds)}</td><td class="score-col">${arNum(r.score)}</td></tr>`;
                }).join('');
            } catch (e) { window.__sura.reportError('leaderboard', e, { game: gameType }); /* keep placeholder rows */ }
        },

        // Render the standard Sura Arabic keyboard (same layout as wordle's).
        renderArabicKeyboard(container, onKey) {
            if (!container) return;
            container.innerHTML = '';
            const keyRows = [
                ['ض','ص','ث','ق','ف','غ','ع','ه','خ','ح','ج','د'],
                ['ش','س','ي','ب','ل','ا','ت','ن','م','ك','ط'],
                ['حذف','ئ','ء','ؤ','ر','ى','ة','و','ز','ظ','إدخال']
            ];
            keyRows.forEach(rowKeys => {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'kbd-row';
                rowKeys.forEach(key => {
                    const btn = document.createElement('button');
                    btn.className = 'kbd-key';
                    btn.textContent = key;
                    btn.setAttribute('data-key', key);
                    if (key === 'حذف' || key === 'إدخال') btn.classList.add('wide');
                    btn.addEventListener('click', () => onKey(key));
                    rowDiv.appendChild(btn);
                });
                container.appendChild(rowDiv);
            });
        },

        // المعجم العربيّ المشترك (١٧٥٬٦٢٧ كلمة) لألعاب الكلمات — «كَلِمة» و«نحلة»
        // و«صندوق الحروف». يُحمَّل مرّةً ويُخزَّن.
        //
        // كان يُجلَب مصفوفةَ JSON (٢٫٥٣ ميغا / ٤٧١ك مضغوطة) ويُبنى منها `Set`.
        // صار يُجلَب مرمَّزًا بالبادئة المشتركة (٨١٢ك / **٢٠٦ك**) ويُفكّ إلى
        // سلسلةٍ مرصوصة + إزاحات (src/core/dict.mjs). العائد المقيس: ٥٦٪ من
        // البايتات، و٤١٪ من زمن البناء، وكومةٌ ~٢٫٥ ميغا بدل ~٢٠.
        //
        // الراجع يبقى متوافقًا مع `Set` — `has`/`size`/`for..of` — فلا مُنادي
        // يتغيّر.
        // **الفشل لا يُخزَّن.** كان `catch` يضع معجمًا فارغًا في `_dict`، وكان
        // `!r.ok` يمرّ نصًّا فارغًا إلى `decode` بلا اعتراض. وبما أن أوّل سطرٍ
        // هنا يُرجع `_dict` المخزَّن فورًا، فإن جلبةً واحدة فاشلة كانت تُقعِد
        // «كَلِمة» **إلى الأبد**: `dict.ready` تبقى false، فكلّ تخمينٍ يُردّ
        // بـ«جارٍ تحميل قائمة الكلمات…»، وإعادةُ المحاولة في `handleEnter`
        // تُرجع المعجمَ الفارغ المخزَّن ولا تُرسل طلبًا أصلًا — قِيس: طلبٌ
        // واحد لا غير (بلاغ المالك، ١٢ أغسطس ٢٠٢٦). واللعبة تصير غير قابلةٍ
        // للعب بلا رسالةٍ تشرح، ودون أن يفلت حرفٌ إلى الشبكة ثانيةً.
        // فالآن: الخطأ يُرمى، ولا شيء يُخزَّن، والنداء التالي يُعيد الجلب فعلًا.
        _dict: null, _dictP: null,
        async loadDict() {
            if (this._dict && this._dict.size) return this._dict;
            if (this._dictP) return this._dictP;
            this._dictP = fetch('bank/words_ar.txt')
                .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
                .then(t => {
                    const d = Dict.decode(t);
                    if (!d.size) throw new Error('المعجم فارغ');
                    this._dict = d; this._dictP = null;
                    return d;
                })
                .catch(e => {
                    this._dict = null; this._dictP = null;   // فشلٌ لا يُخزَّن ⇒ النداء التالي يُعيد المحاولة
                    const why = (typeof location !== 'undefined' && location.protocol === 'file:')
                        ? 'الصفحة مفتوحة ببروتوكول file: — شغّل خادمًا (python tools/serve_nocache.py) '
                        + 'وافتح http://localhost:8000/'
                        : `تعذّر جلب bank/words_ar.txt: ${e && e.message}`;
                    console.error(`[سُرى] المعجم العربيّ: فشل التحميل — «كَلِمة» و«نحلة» `
                        + `و«صندوق الحروف» لن تقبل تخمينًا حتى ينجح الجلب. ${why}`);
                    try {
                        const w = window.__sura || (window.__sura = {});
                        (w.bankFailures || (w.bankFailures = [])).push({
                            url: 'bank/words_ar.txt', label: 'المعجم العربيّ', reason: String(e && e.message)
                        });
                    } catch (_) { /* لا نافذة */ }
                    return new Dict();   // فارغٌ لهذه المرّة، وغيرُ مخزَّن
                });
            return this._dictP;
        },

        // Copy a localized share line to the clipboard. Returns a promise<boolean>.
        async share(gameType, summary) {
            try { if (window.__sura.track) window.__sura.track('share_clicked', { game: gameType }); } catch (e) { }
            const titles = { connections: 'تشابك', sudoku: 'سودوكو', spelling_bee: 'نحلة الإملاء', wordle: 'كَلِمة', letterboxed: 'صندوق الحروف', strands: 'خيوط', tiles: 'زليج', pips: 'نقاط', amthal: 'أمثال' };
            const title = titles[gameType] || gameType;
            // -u-nu-latn pins Western digits; bare 'ar' yields Arabic-Indic in browsers.
            const date = new Date().toLocaleDateString('ar-u-nu-latn');
            // The URL is the point of the share. Without it the line read «العب
            // على سُرى» and named no destination, so every result a player posted
            // was a dead end — the one defect on this page that costs reach
            // directly (found August 2026).
            // It goes in `text` rather than navigator.share's separate `url`
            // field because several Android targets render both and the link
            // then appears twice; one copy, at the end, where every messenger
            // turns it into a tappable preview.
            const text = `سُرى · ${title} · ${date}\n${summary || ''}\nالعب على https://suraio.com`;
            try {
                if (navigator.share) { await navigator.share({ text }); return true; }
                await navigator.clipboard.writeText(text); return true;
            } catch (e) { return false; }
        }
    };

    // ‏سطحُ المعجم العامّ (`window.__sura.dict`) — بعد تسجيل `__sura.games`.
    initDict();

    // ‏الدّخول والتّسجيل — تُسجّل `__sura.openAuth` و`openVerifyOtp` و`refreshNav`،
    // ‏وتقرأ جلسةَ الـURL عند الإقلاع، فتبقى في موضعها المبكّر هذا.
    initAuth();

    // ============================================================
    // Sura Account — settings panel (username, password, stats, history)
    // ============================================================
    initAccount();

    // ============================================================
    // Settings modal — drives __sura.prefs (font size / family / theme)
    // + a Zoom A−/A+ control. Reuses the account-modal markup pattern.
    // ============================================================
    initSettings(PREFS);

    // --- Elements ---
    const videoOverlay = document.getElementById('video-overlay');
    
    // Pre-loaded Video Pool — one <video> per section, already in DOM with src set
    // Only the home clip survives. `games` and `newsletter` used to have their
    // own 14MB and 11MB local files; those routes are Sadu now, and the files
    // are gone from assets/ entirely.
    const videoLayers = {
        'home': document.getElementById('video-home'),
    };

    // Cloudinary delivery optimizer: inject f_auto,q_auto,w_1920 into any
    // res.cloudinary.com /upload/ URL that lacks it → smaller, smoother files
    // with no visible quality loss. Used for default + user-saved URLs.
    function optimizeVideoUrl(url) {
        if (!url || url.indexOf('res.cloudinary.com') < 0) return url;
        if (url.indexOf('/upload/f_') >= 0 || url.indexOf('q_auto') >= 0) return url;
        return url.replace('/upload/', '/upload/f_auto,q_auto,w_1920/');
    }

    // ============================================================
    // الخلفية — الفيديو للواجهة، والسدو لما بعدها.
    //
    // The backdrop is no longer a mode the visitor picks; it is a property of
    // the ROUTE, which is what the owner actually wanted:
    //
    //   home  → the Diriyah clip. It is the first ten seconds of the site and
    //           the only place a real film earns its bandwidth.
    //   else  → النَّول. Painted from today's seed, costs zero assets, and it
    //           is what the rest of the site is dressed in.
    //
    // The loom engine is built ONCE and never torn down, for three reasons that
    // are easy to forget and expensive to rediscover:
    //   1. it publishes `--sweep`, which CSS derives the hero's text reveal from;
    //   2. it publishes `data-phase` + the `sura:phase` event, which the hero's
    //      first line is written by;
    //   3. it is the INSTANT first paint on home. The clip is layered on top and
    //      fades in whenever it is ready, so nobody ever waits on black. This is
    //      why the old 2.8s boot screen could be deleted rather than restored.
    // A canvas at rest costs zero frames, so keeping it alive under the clip is
    // cheaper than rebuilding it on every route change.
    // ============================================================
    const VIDEO_ROUTES = { home: 1 };

    const LOOM = (function initBackdrop() {
        const stage = document.getElementById('loom');
        const root = document.documentElement;
        let engine = null;
        let mode = 'loom';

        // أيّ هيرو؟ المفتاح على <html> في index.html، وتقرؤه النصّية المضمّنة
        // أيضًا — مصدرٌ واحد لا مكانان يمكن أن يختلفا. و`film` يعيد المقطع
        // كما كان بالضبط: مسارُه أدناه لم يُمسّ حرفًا.
        const LAYERED = root.getAttribute('data-hero') === 'story';
        const HERO = LAYERED
            ? createStory(document.getElementById('film'),
                document.getElementById('home'), gsap)
            : null;
        let flatTween = null;

        // المشهد المفصول: المصادر أُسندت في الترميز والنَّول يتنحّى عند وصولها،
        // فلا شيء هنا إلا تشغيل الحركة. والمسار الضعيف يستعمل نفس `gsapDrift`
        // التي بُنيت للـposter — صورةٌ واحدة تنجرف ببطء، وهي أرخص صيغة لفكرة
        // «صورة تُحرَّك بدل مقطع».
        // «المشهد رُسم» — البوّابة الثانية للكشف (style.css: `.film-layer__img`).
        // تُكتب مرّةً ولا تُنزع: نزعُها عند مغادرة المسار كان سيُعيد إخفاء
        // المشهد عند كل رجوع، والقصّة قد عُرضت أصلًا.
        let sceneMarked = false;
        function markScene() {
            if (sceneMarked) return;
            sceneMarked = true;
            root.setAttribute('data-scene', 'on');
        }
        // شبكة أمان: مهما تعطّل ما فوق، لا يمكن للواجهة أن تبقى خاليةً.
        setTimeout(markScene, 9000);

        function startLayers() {
            // القصّة لا تبدأ قبل أن تصل بكسلاتها. بدون هذا الانتظار كان الخطّ
            // الزمني (9.2s) يعمل على طبقاتٍ غير مرئيّة، فتصل الصور في منتصفه
            // ويظهر المشهد مبتورًا من وسطه. السكربت السطري في index.html يبثّ
            // `sura:film` عند اكتمال الطبقات — ونفحص الخاصيّة أيضًا لأنّ أيّهما
            // قد يسبق الآخر. والمهلة هنا حارسٌ لا مسار: `up()` تحسب الخطأ
            // وصولًا، فالحدث يصل ولو فشلت الصور كلّها.
            // `!sceneMarked` تحصر الانتظار في الإقلاع وحده: عند العودة إلى
            // الواجهة تكون `data-film` قد نُزعت عند المغادرة، والحدث لن يتكرّر —
            // فبدون هذا القيد كانت كل عودةٍ تنتظر المهلة كاملةً بلا سبب.
            if (LAYERED && !sceneMarked && !root.hasAttribute('data-film')) {
                let fired = false;
                const go = () => {
                    if (fired) return;
                    fired = true;
                    document.removeEventListener('sura:film', go);
                    startLayers();
                };
                document.addEventListener('sura:film', go);
                setTimeout(go, 8000);
                return;
            }
            const flat = document.getElementById('film-flat');
            // العودة إلى الواجهة: `data-film` نُزعت عند المغادرة ليعود القماش،
            // فتُعاد هنا متى كانت الصور محمّلة أصلًا — وإلا بقي النَّول ظاهرًا
            // تحت الطبقات إلى الأبد. (`complete` صادقة أيضًا لصورةٍ فشلت،
            // وهذا مقصود: القماش تحتها هو ما يظهر حينئذ.)
            if (!root.hasAttribute('data-film')) {
                const sky = document.querySelector('#film .film-layer__img');
                if (flat && flat.currentSrc && flat.complete) root.setAttribute('data-film', 'still');
                else if (sky && sky.complete) root.setAttribute('data-film', 'up');
            }
            if (root.getAttribute('data-film') === 'still') {
                // المسار الضعيف: لا قصّة ولا طبقات — صورةٌ واحدة تنجرف.
                HERO.leave();
                if (flat && !flatTween) {
                    try { flatTween = gsapDrift(flat); } catch (e) { }
                }
                markScene();
                return;
            }
            // `enter()` ترسم الإطار صفر تزامنيًّا (أو تستقرّ على المشهد الأخير
            // عند «حركة أقلّ» أو عند العودة) — فالكشف بعدها مباشرةً يقع في نفس
            // الإطار الذي رُسم فيه المشهد، ولا يمرّ إطارٌ واحد على الحالة
            // النهائية قبل بدايتها.
            HERO.enter();
            markScene();
            // ScrollTrigger تقرأ مقاييس التمرير عند الإنشاء، و`#home` قد يكون
            // خرج لتوّه من display:none فتكون ارتفاعاته صفرًا. تحديثةٌ بعد
            // إطارين تلتقط المقاييس الحقيقية — ورخيصة لأنها لا تتكرّر.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                // ولا معنى لتحديثةٍ قبل أن توجد محفّزات: الإضافة نائمةٌ حتى
                // يُفتح قسم الألعاب، وإيقاظها هنا يُعيد الـ٢٣٠ms إلى التحميل.
                try { if (scrollTriggerAwake()) ScrollTrigger.refresh(); } catch (e) { }
            }));
        }
        function stopLayers() {
            HERO.leave();
            if (flatTween) { flatTween.kill(); flatTween = null; gsapClear(document.getElementById('film-flat')); }
        }

        // هل نتجنّب المقطع أصلًا؟
        // A visitor on a metered or slow connection should never be made to wait
        // for ~1MB of film that is decoration. They get the POSTER instead — the
        // same scene, one frame of it, 124KB — with a slow GSAP drift over it so
        // it is a backdrop rather than a screenshot. Nobody sees a black hole and
        // nobody pays for a video they did not ask for.
        //
        // `navigator.connection` is Chromium-only, so it can only ever be an
        // optimisation, never the guarantee. The guarantee is the TIMEOUT in
        // watchFilm(): if the clip has not become playable in time, we stop
        // waiting on it whatever the browser claims about the network.
        //
        // كان هذا الفحص يقرأ `navigator.connection` بنفسه — وكان الموضع الوحيد
        // في المشروع كلّه الذي يسأل عن قدرة الجهاز. صار يسأل `tier.mjs`، فيرث
        // معها ما لم يكن يعرفه: الذاكرة وعددَ الأنوية. هاتفٌ بذاكرة جيغين على
        // شبكةٍ ممتازة كان يُحمَّل المقطعَ كاملًا لأنّ السلك وحده كان يُسأل.
        function lightBackdrop() {
            try { return !deviceBudget().video; } catch (e) { return false; }
        }

        // The still, drifting. This is the owner's own suggestion in its cheapest
        // form: an IMAGE moved by GSAP instead of a video. It needs no new asset
        // because the frame is cut from his own clip by Cloudinary, and it needs
        // no new element because a <video> displays its poster without loading
        // any video at all — so we animate the <video> itself.
        let stillTween = null;
        function driftStill(v) {
            if (stillTween || !v) return;
            try {
                stillTween = gsapDrift(v);
            } catch (e) { /* motion is optional; the still alone is still correct */ }
        }

        function startVideo() {
            const v = videoLayers.home;
            if (!v) return;

            // الملصق يُركَّب هنا لا في الترميز — وإلا حُمّل حتى تحت الهيرو
            // المفصول حيث المقطع مخفيّ ولا يُشغَّل أبدًا.
            if (v.dataset.poster && !v.getAttribute('poster')) {
                v.setAttribute('poster', v.dataset.poster);
            }

            if (lightBackdrop()) {
                // Poster only. `.active` makes it visible; `load()` is never
                // called, so not one byte of video is fetched.
                v.classList.add('active');
                root.setAttribute('data-film', 'still');
                driftStill(v);
                return;
            }

            // preload="auto" only once we know home is the route being shown —
            // a deep link to #games must not drag the clip onto the wire.
            v.preload = 'auto';
            v.setAttribute('autoplay', '');
            if (!v.dataset.loaded) { v.load(); v.dataset.loaded = '1'; }
            // `.active` is what fades it in over the loom. Set here rather than
            // only in activateVideoLayer() so the OPENING route lights the clip
            // too — that path never goes through the observer.
            v.classList.add('active');
            v.play().catch(() => { });
            watchFilm(v);
        }

        // The guarantee that does not depend on any browser API.
        //
        // `lightBackdrop()` above is Chromium-only and can be wrong; this cannot.
        // If the film has not actually STARTED playing within six seconds, the
        // connection is too weak for it to be a backdrop, so we present the still
        // and drift it. The download is not aborted — if the film does arrive
        // later, `up()` upgrades to it and stops the drift. Nobody is ever left
        // looking at a hole, and nobody is locked out of the film either.
        function watchFilm(v) {
            if (v.dataset.watched) return;
            v.dataset.watched = '1';

            const up = () => {
                clearTimeout(timer);
                root.setAttribute('data-film', 'up');
                if (stillTween) { stillTween.kill(); stillTween = null; gsapClear(v); }
            };
            v.addEventListener('playing', up);
            v.addEventListener('canplaythrough', up);

            const timer = setTimeout(() => {
                if (v.readyState >= 3 && !v.paused) return;
                root.setAttribute('data-film', 'still');
                driftStill(v);
            }, 6000);
        }

        function stopVideo() {
            Object.values(videoLayers).forEach(v => {
                if (!v) return;
                v.classList.remove('active');
                v.pause();
                v.removeAttribute('autoplay');
            });
            // The cloth comes back the moment the film is off screen.
            root.removeAttribute('data-film');
        }

        // «اختبار الليلة الثلاثين» (docs/architecture/identity.md §6): لو رأى الزائرُ الأول
        // والزائرُ الثلاثون الشيءَ نفسه تمامًا، فقدنا أهمّ مبدأ في الدستور.
        // فكثافة القماش تتبع ما حللته — بلا رقم ولا شارة ولا مخطّط (ذاك كان
        // خطأ «اللوح»: حالة مقروءة بدل حالة مُحسّة). لا تُقرأ، تُلمَح فقط.
        //
        // `__sura.levels` يُبنى في وحدة لاحقة، فالمحاولة تُعاد مرّة بعد ثانية
        // ثم تُترك: قماش أخفّ قليلًا لا يستحقّ استطلاعًا دائمًا.
        function seedWins(retry) {
            let L = null;
            try { L = window.__sura && window.__sura.levels; } catch (e) { }
            if (!L || !L.mask) {
                if (!retry) setTimeout(() => seedWins(1), 1200);
                return;
            }
            const bits = m => { let n = 0, v = m >>> 0; while (v) { n += v & 1; v >>>= 1; } return n; };
            let cleared = 0;
            try {
                ['wordle', 'connections', 'spelling_bee', 'amthal', 'warmer', 'lamha']
                    .forEach(g => { cleared += bits(L.mask(g)); });
            } catch (e) { return; }
            engine && engine.setWins(Math.min(9, Math.round(cleared / 7)));
        }

        // Built once, on the first paint, whatever the route is.
        if (stage) {
            // `?phase=deep` pins an hour you are not currently in, so a look can
            // be reviewed (or shown to someone) at 3pm without touching the
            // system clock. It only overrides the opening paint — the minute
            // timer still moves the site into the real hour, which is the
            // behaviour worth testing.
            let pinned = null;
            try { pinned = new URLSearchParams(location.search).get('phase'); } catch (e) { }
            engine = createLoom(stage, pinned ? { phase: pinned } : undefined);
            engine.start();
            seedWins();
        }

        // Called on every route change. `data-backdrop` is what CSS keys the
        // clip's visibility off; the loom underneath is never hidden, so a
        // route change is a crossfade rather than a teardown.
        function applyRoute(route) {
            const wantsVideo = !!VIDEO_ROUTES[route] && (LAYERED || !!videoLayers[route]);
            mode = wantsVideo ? 'video' : 'loom';
            root.setAttribute('data-backdrop', mode);
            // النسيج خلف الفيلم على الواجهة، فيده تُرفع هناك. القماش نفسه لا
            // يُهدَم — التبديل يبقى مزجًا لا تفكيكًا — لكن الفكّ بالمؤشّر
            // (قراءةُ تخطيطٍ + مسحُ آلاف الخلايا لكلّ حركة) يتوقّف.
            if (engine && engine.setInteractive) engine.setInteractive(!wantsVideo);
            if (LAYERED) {
                // `data-film` تكتبها النصّية المضمّنة عند وصول الصور، وتُنزع
                // هنا عند المغادرة ليعود القماش — فتُعاد على العودة.
                if (wantsVideo) startLayers();
                else { stopLayers(); root.removeAttribute('data-film'); }
                if (!wantsVideo && engine) engine.reweave(route);
                return;
            }
            if (wantsVideo) startVideo(); else stopVideo();
            // The cloth re-warps for the route it is actually showing. On home
            // it is behind the clip, so there is nothing to re-warp for.
            if (!wantsVideo && engine) engine.reweave(route);
        }

        // The opening route has to be applied explicitly. The IntersectionObserver
        // that drives every LATER route change deliberately skips the section that
        // is already `.active`, and `home` ships marked active in the markup — so
        // without this line the first route is the one route that never gets a
        // backdrop, and the clip never starts. (It didn't, until it did.)
        applyRoute((document.querySelector('.scroll-section.active') || {}).id || 'home');

        // A theme or brand re-tint must reach the canvas too — it reads the
        // same tokens as the stylesheet, but only when told to look again.
        document.addEventListener('sura:prefs', () => { engine && engine.retint(); });

        return {
            get mode() { return mode; },
            applyRoute,
            reweave(route) { applyRoute(route); },
            weaveRow() { engine && engine.weaveRow(); },
            setWins(n) { engine && engine.setWins(n); },
            get wins() { return engine ? engine.wins : 0; },
            setPhase(p) { engine && engine.setPhase(p); },
            get phase() { return engine ? engine.phase : null; },
            get seed() { return engine ? engine.seed : null; },
            get plan() { return engine ? engine.plan : null; },
            get frames() { return engine ? engine.frames : 0; },
            get weaving() { return engine ? engine.weaving : false; },
            // «اليد مرفوعة على الواجهة» ادّعاءٌ يجب أن يُقاس من الخارج، كـ
            // `clothLive` تمامًا — وإلا صار وعدًا في تعليق.
            setInteractive(on) { engine && engine.setInteractive(on); },
            get interactive() { return engine ? engine.interactive : false; },
            get clothLive() { return engine ? engine.clothLive : false; },
            get clothCells() { return engine ? engine.clothCells : 0; },
        };
    })();
    window.__sura.loom = LOOM;

    // بطاقات الألعاب — GSAP يملك الحركة، وCSS يملك اللون. تفصيل التقسيم في
    // src/core/cards.mjs. يُنشأ هنا كي يسبق أول نداء لـmanuallyMorphBackdrop().
    const CARDS = createCards({ sectionId: 'games' });
    window.__sura.cards = CARDS;

    // ساعة السُّرى — the hero's first line is written by the hour the player is
    // actually in. The loom announces the phase; the page decides what to say
    // about it. Re-woven with clip-path, never opacity: this line lives inside
    // a .scroll-section and opacity there re-opens the iOS blank-hero bug
    // (style.css:118).
    initPhaseCopy(LOOM);

    // THE SPLASH IS GONE (owner's call, 8 Aug 2026). It never waited for the
    // clip — the loom paints in the first frame and the video dissolves in on
    // top whenever the network delivers it — so the screen was a 320ms curtain
    // over a page that was already ready. Removing it removes the curtain, not
    // a guarantee.
    //
    // `data-booted` كانت تُطلق كشفَ الهيرو من CSS، ولم تعد: الكشف صار مُستدعى
    // من `weaveHeroWhenVisible()` أسفله كي لا يُنفَق على نصٍّ محجوب. تبقى
    // السمة علامةَ «أقلعت الحزمة» لا أكثر — ورخيصةٌ ومفيدة في التشخيص.
    document.documentElement.setAttribute('data-booted', '');
    // …ويُكشف الهيرو حين يصير مرئيًّا فعلًا، لا لحظة الإقلاع. انظر `weaveIn`.
    weaveHeroWhenVisible();

    // Customizer Elements
    const customizerToggle = document.getElementById('customizer-toggle');
    const customizerPanel = document.getElementById('customizer-panel');
    const panelClose = document.getElementById('panel-close');
    const videoUrlInput = document.getElementById('video-url-input');
    const applyVideoUrlBtn = document.getElementById('apply-video-url');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const overlayRange = document.getElementById('overlay-range');
    const overlayValue = document.getElementById('overlay-value');
    
    // Navigation Elements
    const mobileToggle = document.getElementById('mobile-toggle');
    const navLinks = document.getElementById('nav-links');
    const navLinkItems = document.querySelectorAll('.nav-link');
    const navIndicator = document.getElementById('nav-indicator-pill');
    const bodyEl = document.body;

    // The hero's second button. It used to open a YouTube lightbox; it now
    // scrolls to the newsletter, so the modal, its iframe and its close button
    // were dead markup that still cost a third-party frame on every visit.
    const watchDemoBtn = document.getElementById('watch-demo-btn');

    // Video container reference
    const videoContainer = document.querySelector('.video-container');

    // Section Scroll Anchors & Customizer Caches Mapping
    const sections = document.querySelectorAll('.scroll-section');
    
    const sectionBackdrops = {
        'home': {
            url: 'https://res.cloudinary.com/dcgalovye/video/upload/f_auto,q_auto,w_1920/v1779870414/output_hboakw.mp4',
            bodyClass: '',
            storageVideoKey: 'sura_bg_video_url',
            storageOverlayKey: 'sura_bg_overlay_strength'
        },
        'games': {
            url: 'https://res.cloudinary.com/dcgalovye/video/upload/f_auto,q_auto,w_1920/v1779896727/LhSySGVbasPLm5IzPdrG-_eb2f8daab8684662ba46fc9dd2f7aae2_zvcdpq.mp4',
            bodyClass: 'second-page-body',
            storageVideoKey: 'sura_bg_video_url_second',
            storageOverlayKey: 'sura_bg_overlay_strength_second'
        },
        'newsletter': {
            url: 'https://res.cloudinary.com/dcgalovye/video/upload/f_auto,q_auto,w_1920/v1779901402/output_1_qkiu7x.mp4',
            bodyClass: 'third-page-body',
            storageVideoKey: 'sura_bg_video_url_third',
            storageOverlayKey: 'sura_bg_overlay_strength_third'
        }
    };

    // One-time migration of legacy "haven_*" background-prefs keys → "sura_*".
    // Copies any saved value into the new key (only if the new key is empty),
    // so users who customized their background video/overlay don't lose it.
    (function migrateLegacyBgPrefs() {
        try {
            Object.values(sectionBackdrops).forEach((bd) => {
                [
                    [bd.storageVideoKey, bd.storageVideoKey.replace('sura_', 'haven_')],
                    [bd.storageOverlayKey, bd.storageOverlayKey.replace('sura_', 'haven_')]
                ].forEach(([newKey, oldKey]) => {
                    if (localStorage.getItem(newKey) === null) {
                        const legacy = localStorage.getItem(oldKey);
                        if (legacy !== null) localStorage.setItem(newKey, legacy);
                    }
                });
            });
        } catch (e) { /* storage unavailable — ignore, defaults apply */ }
    })();

    let currentActiveSectionId = 'home';

    // --- Instant Video Layer Crossfade (GPU-composited opacity only) ---
    function activateVideoLayer(sectionId) {
        // Only `home` has a clip now. Every other route is Sadu, so the layer is
        // deactivated and PAUSED — a paused <video> stops decoding, which is the
        // whole reason the games section runs smoothly while the clip still
        // exists in the document.
        // تحت الهيرو المفصول لا يوجد مقطع البتّة. وبدون هذا الحارس يظلّ
        // `play()` أدناه يُستدعى على عنصر <video> مخفيّ بـdisplay:none —
        // و`play()` يبدأ التحميل حتى مع preload="none"، فينزل ميغابايتٌ كامل
        // لمقطعٍ لا يراه أحد. الحارس هو الفرق بين «مخفيّ» و«غير مُحمَّل».
        if (document.documentElement.getAttribute('data-hero') === 'story') {
            currentActiveSectionId = sectionId;
            return;
        }
        Object.entries(videoLayers).forEach(([id, video]) => {
            if (!video) return;
            if (id === sectionId && VIDEO_ROUTES[id]) {
                video.classList.add('active');
                video.play().catch(() => {}); // resume only the visible clip
            } else {
                video.classList.remove('active');
                video.pause();
            }
        });
        currentActiveSectionId = sectionId;
    }

    // --- The "Seamless Loop Engine" is GONE, deliberately -------------------
    // It used to fade the clip to opacity 0 over the last 0.7s of every loop and
    // back in over the first 0.7s, to hide the restart cut. Three things were
    // wrong with it, and the owner reported the symptom directly ("when the clip
    // repeats it disappears"):
    //
    //   1. It was the disappearance. A 1.4-second dip to nothing, every loop.
    //      Whatever sat behind the clip showed through for that whole window —
    //      first the flat fallback colour, and once the loom moved underneath,
    //      the Sadu. The cloth was the symptom; the dip was the disease.
    //   2. <video loop> already restarts without a gap. The browser does this in
    //      the compositor. There was no cut to hide.
    //   3. It ran a requestAnimationFrame loop for the ENTIRE time the clip was
    //      playing — i.e. the whole session for anyone sitting on the home
    //      route — purely to produce the flaw above.
    //
    // Deleting it fixes the report and removes a permanent rAF. Do not restore
    // it; if a restart cut ever does show, fix it in the clip, not in opacity.

    // Helper: Apply overlay vignette strength
    function applyOverlayStrength(strength) {
        if (!videoOverlay) return;
        const opacity = strength / 100;
        videoOverlay.style.background = `radial-gradient(circle at center, rgba(15, 23, 42, ${opacity * 0.4}) 0%, rgba(15, 23, 42, ${opacity * 0.8}) 60%, rgba(10, 15, 30, ${opacity * 1.2 > 0.95 ? 0.95 : opacity * 1.2}) 100%)`;
    }

    // --- Sliding Navigation Pill Marker Positioning ---
    function updateNavPill(activeLink) {
        if (!navIndicator || !activeLink) return;
        
        const rect = activeLink.getBoundingClientRect();
        const containerRect = activeLink.parentElement.parentElement.getBoundingClientRect();
        
        const left = rect.left - containerRect.left;
        const width = rect.width;
        
        navIndicator.style.left = `${left}px`;
        navIndicator.style.width = `${width}px`;
        navIndicator.style.opacity = '1';
    }

    // --- Modular Backdrop & Styling Morpher ---
    function manuallyMorphBackdrop(sectionId) {
        // 1. Add active class to current section to launch staggered content slides
        sections.forEach(s => s.classList.remove('active'));
        const targetSec = document.getElementById(sectionId);
        if (targetSec) targetSec.classList.add('active');
        // الكشف المنسوج يُستدعى بعد `.active` بإطارٍ واحد: القسم كان
        // `display:none`، والصنف المضاف على عنصرٍ لم يُخطَّط بعدُ لا يُشغّل حركة.
        requestAnimationFrame(() => weaveSection(sectionId));

        // 2. Set active nav link and slide indicator pill behind it
        navLinkItems.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-target') === sectionId) {
                link.classList.add('active');
                updateNavPill(link);
            }
        });
        
        // 3. Morph background video, body class overlay specificity and widgets dynamically
        const backdrop = sectionBackdrops[sectionId];
        if (backdrop) {
            bodyEl.className = `merged-page-body ${backdrop.bodyClass}`;
            
            // Retrieve customizer values for this section if present
            let savedUrl = localStorage.getItem(backdrop.storageVideoKey);
            let savedOverlay = localStorage.getItem(backdrop.storageOverlayKey);
            
            // Auto migrate legacy keys if preset
            if (savedUrl && (savedUrl.includes('mixkit') || savedUrl.includes('e_boomerang'))) {
                savedUrl = backdrop.url;
                localStorage.setItem(backdrop.storageVideoKey, backdrop.url);
            }
            // Upgrade an un-optimized saved Cloudinary URL in place (so older
            // saved values pick up the smoother f_auto,q_auto delivery too).
            if (savedUrl) {
                const opt = optimizeVideoUrl(savedUrl);
                if (opt !== savedUrl) { savedUrl = opt; localStorage.setItem(backdrop.storageVideoKey, opt); }
            }

            // If user has a custom video URL saved, update the video layer's source
            const targetVideoUrl = savedUrl || backdrop.url;
            const videoLayer = videoLayers[sectionId];
            // Only home has a layer, so this can only ever fire on home.
            if (videoLayer && savedUrl && savedUrl !== backdrop.url) {
                if (videoLayer.src !== savedUrl) {
                    videoLayer.src = savedUrl;
                    videoLayer.load();
                    videoLayer.play().catch(() => {});
                }
            }

            // Instant crossfade — GPU-composited opacity toggle, zero delay
            activateVideoLayer(sectionId);
            // The cards are dealt when their route becomes visible. It has to be
            // here rather than on scroll: the section is display:none until the
            // line above, so no scroll-based trigger would ever fire for it.
            CARDS.enter(sectionId);
            // …and in loom mode the cloth is re-warped for this route instead:
            // same day, different panel. One rAF burst, then it shuts off.
            LOOM.reweave(sectionId);
            
            // Apply overlay strength
            const overlayStrength = savedOverlay ? parseInt(savedOverlay, 10) : 40;
            applyOverlayStrength(overlayStrength);
            
            // Sync customizer UI
            if (overlayRange && overlayValue) {
                overlayRange.value = overlayStrength;
                overlayValue.textContent = `${overlayStrength}%`;
            }
            if (videoUrlInput) {
                videoUrlInput.value = savedUrl ? savedUrl : '';
            }
            presetBtns.forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-url') === targetVideoUrl) {
                    btn.classList.add('active');
                    if (videoUrlInput) videoUrlInput.value = '';
                }
            });
        }
    }

    // --- 60fps GPU-Composited Section Transition Engine ---
    // No scroll-locking, no defocus filters, no setTimeout chains.
    // Pure IntersectionObserver + CSS transform/opacity transitions for buttery smoothness.

    // --- IntersectionObserver Scroll Snap Section Morpher ---
    const observerOptions = {
        root: null,
        rootMargin: '-40% 0px -40% 0px',
        threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const sectionId = entry.target.id;
                const currentActiveSec = document.querySelector('.scroll-section.active');
                
                // Skip if already active
                if (currentActiveSec && currentActiveSec.id === sectionId) return;

                // Directly morph backdrop and activate section — no blocking, no freezing
                manuallyMorphBackdrop(sectionId);
            }
        });
    }, observerOptions);

    sections.forEach(section => observer.observe(section));

    // Smooth scroll clicking for navigation anchors (native smooth scroll, no blocking)
    navLinkItems.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetId = link.getAttribute('href');
            const targetSec = document.querySelector(targetId);
            if (!targetSec) return;

            const targetSectionId = targetId.substring(1);

            // Scroll smoothly to target section 
            targetSec.scrollIntoView({ behavior: 'smooth' });

            // Immediately morph backdrop for instant visual feedback
            manuallyMorphBackdrop(targetSectionId);
            
            mobileToggle.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });

    const homeLogo = document.getElementById('nav-logo');
    if (homeLogo) {
        homeLogo.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSec = document.getElementById('home');
            if (targetSec) {
                targetSec.scrollIntoView({ behavior: 'smooth' });
                manuallyMorphBackdrop('home');
            }
        });
    }

    const startBtn = document.getElementById('get-started-btn');
    if (startBtn) {
        startBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSec = document.getElementById('games');
            if (targetSec) {
                targetSec.scrollIntoView({ behavior: 'smooth' });
                manuallyMorphBackdrop('games');
            }
        });
    }

    // --- Floating Background Customizer Panel Widget ---
    function getActiveSection() {
        return currentActiveSectionId || 'home';
    }

    if (customizerToggle && customizerPanel) {
        customizerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            customizerPanel.classList.toggle('active');
        });
    }

    if (panelClose && customizerPanel) {
        panelClose.addEventListener('click', () => {
            customizerPanel.classList.remove('active');
        });
    }

    if (customizerPanel && customizerToggle) {
        document.addEventListener('click', (e) => {
            if (customizerPanel.classList.contains('active') &&
                !customizerPanel.contains(e.target) &&
                !customizerToggle.contains(e.target)) {
                customizerPanel.classList.remove('active');
            }
        });
    }

    // Customizer URL Apply Handler
    if (applyVideoUrlBtn) {
        applyVideoUrlBtn.addEventListener('click', () => {
            let customUrl = videoUrlInput.value.trim();
            const currentSection = getActiveSection();
            const backdrop = sectionBackdrops[currentSection];
            const videoLayer = videoLayers[currentSection];
            
            if (customUrl && backdrop && videoLayer) {
                if (customUrl.startsWith('http://') || customUrl.startsWith('https://')) {
                    // No mode to switch any more: `videoLayers` only contains
                    // home, so the guard above already means "we are on the one
                    // route that has a clip".
                    customUrl = optimizeVideoUrl(customUrl);
                    videoLayer.src = customUrl;
                    videoLayer.load();
                    videoLayer.play().catch(() => {});

                    presetBtns.forEach(b => b.classList.remove('active'));
                    localStorage.setItem(backdrop.storageVideoKey, customUrl);
                } else {
                    alert("Please enter a valid video URL starting with http:// or https://");
                }
            }
        });
    }

    if (videoUrlInput && applyVideoUrlBtn) {
        videoUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') applyVideoUrlBtn.click();
        });
    }

    // Customizer Presets click
    presetBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            presetBtns.forEach(b => b.classList.remove('active'));
            
            const selectedBtn = e.currentTarget;
            selectedBtn.classList.add('active');
            
            const videoUrl = optimizeVideoUrl(selectedBtn.getAttribute('data-url'));
            const currentSection = getActiveSection();
            const backdrop = sectionBackdrops[currentSection];
            const videoLayer = videoLayers[currentSection];

            if (backdrop && videoLayer) {
                videoLayer.src = videoUrl;
                videoLayer.load();
                videoLayer.play().catch(() => {});
                videoUrlInput.value = '';
                localStorage.setItem(backdrop.storageVideoKey, videoUrl);
            }
        });
    });

    // Customizer overlay strength range input
    if (overlayRange) {
        overlayRange.addEventListener('input', (e) => {
            const value = e.target.value;
            overlayValue.textContent = `${value}%`;
            applyOverlayStrength(value);
            
            const currentSection = getActiveSection();
            const backdrop = sectionBackdrops[currentSection];
            if (backdrop) {
                localStorage.setItem(backdrop.storageOverlayKey, value);
            }
        });
    }

    // --- Mobile Menu Toggle ---
    mobileToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (navLinks.classList.contains('active') && 
            !navLinks.contains(e.target) && 
            !mobileToggle.contains(e.target)) {
            mobileToggle.classList.remove('active');
            navLinks.classList.remove('active');
        }
    });

    // --- "نشرة سُرى" button → scroll to newsletter section ---
    if (watchDemoBtn) {
        watchDemoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSec = document.getElementById('newsletter');
            if (targetSec) {
                targetSec.scrollIntoView({ behavior: 'smooth' });
                manuallyMorphBackdrop('newsletter');
            }
        });
    }

    // --- Mental Games Hub category filtering ---
    const filterPills = document.querySelectorAll('.filter-pill');
    const gameCards = document.querySelectorAll('.game-card');

    if (filterPills.length > 0 && gameCards.length > 0) {
        filterPills.forEach(pill => {
            pill.addEventListener('click', () => {
                filterPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                const filterValue = pill.getAttribute('data-filter');

                gameCards.forEach((card) => {
                    card.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease-out';
                    
                    if (filterValue === 'all' || card.getAttribute('data-category') === filterValue) {
                        card.classList.remove('hidden');
                        setTimeout(() => {
                            card.style.opacity = '1';
                            card.style.transform = 'translateY(0) scale(1)';
                        }, 50);
                        // Hand the card back to the stylesheet once it has settled.
                        // An inline transform outranks every rule in the sheet, so
                        // leaving `translateY(0) scale(1)` pinned here permanently
                        // beat `.game-card:hover` — after the first filter click the
                        // cards stopped lifting on hover for the rest of the session.
                        setTimeout(() => {
                            card.style.transition = '';
                            card.style.opacity = '';
                            card.style.transform = '';
                        }, 500);
                    } else {
                        card.style.opacity = '0';
                        card.style.transform = 'translateY(20px) scale(0.95)';
                        setTimeout(() => {
                            card.classList.add('hidden');
                        }, 400);
                    }
                });
            });
        });
    }

    // ‏«كَلِمة» - محرّكُ اللعبة في `games/wordle.js`. موضعُ النداء جزءٌ من العقد:
    // ‏بعد `window.__sura.games` و`initDict()`, وقبل `initSuraMeta()`/`initLevels()`.
    initWordleGame();

    // --- Featured Issue trigger inside Newsletter block ---
    // The card is repainted from the day's plan by initFeaturedDaily() further
    // down (it needs window.__sura.levels, which is built after this point).
    // Nothing is wired here on purpose: two handlers on one button would open
    // كَلِمة on a day whose featured game is تشابك.

    // ‏لوحةُ الصدارة بوضعَيها. تُسجّل `__lbSearch` قبل تركيب مربّع البحث أدناه.
    initLeaderboard();

    // --- Sura Leaderboard Search filter ---
    const searchInput = document.getElementById('leaderboard-search');

    if (searchInput) {
        // كان كلّ ضغطة مفتاحٍ تُعيد `querySelectorAll` على الجدول ثم
        // `querySelector('.name-col')` و`textContent` **لكلّ صفّ** — استعلامُ
        // DOM وقراءةُ نصٍّ لكلّ صفٍّ لكلّ حرفٍ يُكتب، بلا تهدئة. الأسماء لا
        // تتغيّر بين الضغطات، فتُفهرَس مرّةً وتُبطَل عند إعادة رسم اللوحة.
        let index = null;
        const buildIndex = () => {
            index = [];
            for (const row of document.querySelectorAll('#leaderboard-rows tr')) {
                const nameCol = row.querySelector('.name-col');
                if (nameCol) index.push({ row, name: nameCol.textContent.trim().toLowerCase() });
            }
            return index;
        };
        // اللوحة تُعاد بناؤها عند تبديل «عام»/«يومي» أو عند التحديث، فتصير
        // العُقد المفهرَسة يتيمة. مراقبٌ واحدٌ يُبطل الفهرس بدل إعادة بنائه.
        const rowsEl = document.getElementById('leaderboard-rows');
        if (rowsEl && window.MutationObserver)
            new MutationObserver(() => { index = null; }).observe(rowsEl, { childList: true });

        let timer = null;
        const apply = () => {
            const query = searchInput.value.trim().toLowerCase();
            // اللوحة العامّة تبحث في عمقها هي (١٠٠ صفًّا محفوظة) وتعيد الرسم
            // بنفسها، فتُظهر لاعبًا خارج الخمسة **بمركزه الحقيقي**. وإخفاءُ
            // الصفوف بعدها كان سيمحو ما رُسم للتوّ، فنقف هنا.
            if (window.__sura.__lbSearch && window.__sura.__lbSearch(query)) { index = null; return; }
            for (const { row, name } of (index || buildIndex())) {
                const match = name.includes(query);
                row.classList.toggle('hidden', !match);
                row.classList.toggle('highlighted', match && query !== '');
            }
        };
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(apply, 120);
        });
    }

    // نموذج الاشتراك حُذف مع بطاقته (المالك، ١٢ أغسطس ٢٠٢٦: «احذف مراسلات
    // الفجر وحط بداله جدول الصعوبة»). ولم يُحذف معه أي سلوك: المعالج القديم كان
    // يمنع الإرسال، يخفي النموذج، ويطبع ختمًا شمعيًّا — ولا سطر فيه يرسل البريد
    // إلى خادمٍ أو جدول. أي أن «الاشتراك» لم يكن مشتركًا قطّ. جدول الأسبوع
    // (`initWeekTable` أدناه) يشغل مكانه ويقول شيئًا صحيحًا.

    // ============================================================
    // Shared daily seed (KSA / UTC+3) — deterministic daily content
    // so every player sees the same board, and a small seeded PRNG.
    // ============================================================
    // suraDailySeed + mulberry32 + seededShuffle are imported from core/util.

    // ‏منصّةُ البقاء والتلميحات — تُسجّل `__sura.meta` و`__sura.hints` و`__uid`.
    // ‏تسبق كلَّ من يقرأ `meta`، وهم كلُّ ما تحتها تقريبًا.
    initSuraMeta();

    // ‏سُلّمُ الحملة — يُسجّل `__sura.levels` و`.ranks` و`.rush`.
    // ‏يقرأ `__sura.meta` وقتَ البناء، فلا يسبق `initSuraMeta()` أبدًا.
    initLevels(LOOM);

    // ‏«عدد اليوم» — بطاقةُ النشرة تتبع خطّةَ اليوم. تُنادى **بعد** تسجيل
    // ‏`window.__sura.levels`: تقرؤه وقتَ التركيب لا وقتَ الرسم.
    initFeaturedDaily();

    // ============================================================
    // نافذة واحدة من «القشرة» في كل لحظة.
    // الترويسة (z-index 200) تعلو خلفية النوافذ (150)، فأزرار «حسابي»
    // و«الإعدادات» تبقى قابلة للنقر ونافذةٌ مفتوحة. وبما أن الخلفيات كلها
    // على 150، فالتي تفوز هي الأخيرة في DOM لا الأخيرة فتحًا — فتُفتح
    // الجديدة *خلف* القديمة وتبدو كأنها لم تُفتح.
    // العلاج بنيوي: النوافذ الحاملة [data-modal-solo] أقران يتبادلون المكان
    // ولا يتراكمون. والإغلاق يمرّ بزرّ الإغلاق نفسه لا بنزع الصنف، كي يجري
    // تنظيف كل نافذة (مسح الرسائل...) كما لو أغلقها الزائر بيده.
    // مُراقَبٌ عالميًّا — على نمط قفل التمرير أدناه — فلا يحتاج تعديل مواضع الفتح.
    // ملاحظة: النوافذ التي ترفع z-index بنفسها (#rules-modal 260) تراكُبٌ
    // مقصود فوق نافذة أخرى، ولذلك لا تحمل السمة ولا يمسّها هذا القانون.
    // ============================================================
    initSoloModals();

    // ============================================================
    // Scroll lock. While any modal is open the page behind it must not
    // scroll or take taps — on a phone the home page was still reachable
    // around the board, so a mis-tap scrolled the site out from under the
    // game. Observed globally rather than wired per-modal so modals built
    // later (every game) are covered without touching them.
    // ============================================================
    // يرفع `html.sura-scrolling` ما دام التمرير جاريًا ويُنزلها بعد سكونه.
    // ‏style.css تُعلّق `backdrop-filter` تحتها — انظر التعليق هناك للسبب
    // والقياس. ‏`capture: true` لأنّ الأقسام تُمرَّر داخليًّا (‏#games له
    // مُمرِّرُه الخاصّ) والتمرير لا يصعد بالفقاعة. المهلة ١٥٠ms: أقصر منها
    // تومض الحافّة بين دفعتَي عجلة، وأطول تُبقي الزجاج مُطفأً بعد الوقوف.
    initScrollBlur();

    initScrollLock();

    initFocusTrap();

    initCloseBead();

    // ============================================================
    // Per-game rules — a small ⓘ on each card and inside each game HUD
    // opens a short Arabic explanation. Text comes from each game's
    // levels.register({rules}) config, resolved at click time.
    // ============================================================
    initRules();

    // ‏«شرح مرئي» — جولةٌ مصوَّرةٌ قصيرةٌ لكلّ لعبة. تُسجّل `window.__sura.demo`
    // ‏الذي يقرؤه شريطُ كلّ لعبة، فموضعُها هنا يسبق أوّل قارئٍ له.
    initDemo();

    // ‏«أبلغ وقيّم» — تُسجّل `__sura.feedback`، وتقرأ `demo` و`meta`
    // ‏و`levels` و`track`، فلا تسبق أيًّا منهنّ.
    initFeedback();

    // ============================================================
    // تركيب الألعاب — ولماذا ثمانٍ منها لا تُركَّب أصلًا
    // ============================================================
    // ثمانِ ألعابٍ من أربعَ عشرةَ غيرُ مُطلَقة: بطاقاتُها تُشحَن
    // `style="display:none"` ولا سبيل إلى فتحها. ومع ذلك كانت نوافذُها
    // الثمانِ تُبنى في كلّ تحميلٍ لكلّ زائر، ثمّ تُهيَّأ ألعابُها بالكامل.
    //
    // قيس ثمنُ ذلك على Pixel 5 (بحجب كلّ سكربت، فالرقم للمستند وحده):
    // النوافذ الثمانَ عشرةَ = ٤٤٧ عقدة، وتكلّف **٨٥ms عند خنق ٤× و١٩١ms عند
    // ٦×** من زمن بناء المستند. وقُورنت ثلاثُ صيغ: كما تُشحَن · داخل
    // ‏`<template>` · محذوفةً تمامًا — فاسترجع `<template>` **٧٩٪ من السقف
    // عند ٤× و٨٦٪ عند ٦×**. المحتوى يُحلَّل كما كان، لكن لا عُقَدَ تُبنى له
    // ولا نمطَ يُحلّ ولا تخطيطَ يُحسَب حتى يُستنسَخ.
    //
    // فالعلامة **باقيةٌ في الملفّ حرفًا بحرف** — لا ميزةَ حُذفت، ولا اسمُ
    // صنفٍ تغيّر، ولا سطرَ CSS مسّه شيء. المتغيّر الوحيد: متى تُبنى.
    //
    // والشرط مأخوذٌ من البطاقة نفسها لا من قائمةٍ موازية، وهذا مقصود: من
    // أطلق لعبةً فحذف `display:none` من بطاقتها، رُكّبت لعبتُه من تلقاء
    // نفسها في التحميل التالي. لا قائمةَ ثانية تُنسى، ولا فخَّ صامتًا.
    // (‏`offsetParent` لا تصلح هنا: قسم `#games` كلّه `display:none` عند
    // الإقلاع، فكلّ البطاقات تبدو مخفيّةً له. النمطُ السطريّ يُقرأ بلا تخطيط.)
    function mountGame(cardId, modalId, init) {
        try {
            const card = document.getElementById(cardId);
            const released = !card || card.style.display !== 'none';
            if (!released && !document.getElementById(modalId)) return false;
            // مُطلَقةٌ ونافذتُها ما زالت قالبًا: تُستنسَخ الآن، قبل أن تسأل
            // عنها `init` بـ`getElementById`.
            if (!document.getElementById(modalId)) {
                const tpl = document.getElementById('tpl-' + modalId);
                if (tpl && tpl.content) document.body.appendChild(tpl.content.cloneNode(true));
            }
            init();
            return true;
        } catch (e) {
            window.__sura.reportError('mountGame:' + modalId, e);
            return false;
        }
    }

    // ============================================================
    // Connections (تشابك) — find 4 groups of 4. Curated daily bank,
    // checked client-side; results posted best-effort for streaks.
    // ============================================================
    initConnectionsGame();

    // ============================================================
    // Sudoku (سودوكو) — client-side date-seeded generation with a
    // single-solution guarantee; fully self-validating.
    // ============================================================
    mountGame('sudoku-trigger-card', 'sudoku-modal', initSudokuGame);

    // ============================================================
    // Spelling Bee (نحلة الإملاء) — make words from 7 letters; each
    // word must include the center letter. Curated daily bank.
    // ============================================================
    initBeeGame();

    // ============================================================
    // Letter Boxed (صندوق الحروف) — 12 letters on a square's 4 sides.
    // Chain words: ≥3 letters, no two consecutive letters from the same
    // side, each word starts with the previous word's last letter, use
    // all 12 letters to win. Validated against the shared 31k dictionary.
    // ============================================================
    mountGame('letterboxed-trigger-card', 'letterboxed-modal', initLetterBoxedGame);

    // ============================================================
    // Strands (خيوط) — trace themed Saudi words + a spangram through a
    // letter grid (8-direction adjacency, no cell reuse). Find them all.
    // Tap cells to build a path; it locks in when it traces a hidden word.
    // ============================================================
    mountGame('strands-trigger-card', 'strands-modal', initStrandsGame);

    // ============================================================
    // أمثال (Proverbs) — reorder the scrambled words of a Saudi/Arabic
    // proverb into the right order, guided by its meaning. Harder levels
    // add DECOY words that belong to no part of the proverb. Fully
    // client-side, self-validating against the bundled proverb bank.
    // ============================================================
    initAmthalGame();

    // ============================================================
    // كلمة ناقصة (Missing Word) — fill the blank in a familiar Arabic
    // expression/proverb by picking the missing word from 4 options.
    // Date-seeded daily + 21-level campaign; fully client-side, fair by MCQ.
    // ============================================================
    mountGame('missingword-trigger-card', 'missingword-modal', initMissingWordGame);

    // ============================================================
    // رتّب السالفة (Story Order) — arrange the shuffled fragments of a short
    // everyday سالفة into the right cause→effect order. Date-seeded daily +
    // 21-level campaign with deterministic unique per-level assignment.
    // ============================================================
    mountGame('storyorder-trigger-card', 'storyorder-modal', initStoryOrderGame);

    // ============================================================
    // قرّبها (Warmer) — semantic hot/cold: a hidden daily word the player TYPES
    // free guesses at; each guess returns 🔥/🌡️/❄️ by curated closeness tiers.
    // Date-seeded daily + 21-level campaign; fully client-side, deterministic.
    // ============================================================
    initWarmerGame();

    // ============================================================
    // لمحة (Lamha) — progressive-clue guessing: a hidden word with 3 clues that
    // get more revealing; the player TYPES a guess after any clue and earns more
    // stars for guessing on fewer clues (3⭐ clue 1 · 2⭐ clue 2 · 1⭐ clue 3).
    // Date-seeded daily + 21-level campaign; fully client-side, deterministic.
    // ============================================================
    initLamhaGame();

    // ============================================================
    // زايد (Zayid) — a Saudi naming-bid BLUFF duel: a category appears, the two
    // sides raise a claimed count until one folds, then the last bidder must
    // actually name that many. Best-of-3 vs a human-capped AI rival (or a friend,
    // pass-and-play). The AI is only ever a fair judge, never an un-capped rival.
    // ============================================================
    mountGame('zayid-trigger-card', 'zayid-modal', initZayidGame);

    // ============================================================
    // Tiles (زليج) — match pairs of geometric zellige tiles to clear the
    // board. Daily-seeded layout; consecutive matches build a combo.
    // Fully client-side, self-validating (no dictionary / no server eval).
    // ============================================================
    mountGame('tiles-trigger-card', 'tiles-modal', initTilesGame);

    // ============================================================
    // Pips (نقاط) — place the domino hand onto the board so every region's
    // constraint holds (Σ = target, or all-equal). Client-generated daily-
    // seeded with a known solution; self-validating (no server evaluator).
    // Select two adjacent empty cells (order sets orientation), then a domino.
    // ============================================================
    mountGame('pips-trigger-card', 'pips-modal', initPipsGame);

    // ‏شريطُ اليوم فوق شبكة الألعاب — يُسجّل `refreshDailyStrip` و`dailyGoal`
    // ‏اللذين يناديهما `meta.onWin`، ويقرأ `meta` وقتَ التركيب.
    initDailyStrip();

    initAnnouncementStrip();

    // ESC Key handles closing panels/modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (typeof closeModal === 'function') closeModal();
            // كانت هنا قائمةٌ مكتوبةٌ باليد بسبع نوافذ، وقد **انحرفت عن
            // الطاقم**: تسمّي خمس ألعابٍ مخفيّة وتغفل ثلاثًا حيّة — «أمثال»
            // و«قرّبها» و«لمحة». فكان ESC يغلق ثلاثًا من الستّ الحيّة ويترك
            // ثلاثًا (مقيسًا: `esc.mjs`). ولا حارس لها: القائمة لا تُحدَّث حين
            // يتبدّل الطاقم، ولن تُحدَّث في المرّة القادمة أيضًا.
            //
            // فتُستبدَل بالسؤال نفسه مطروحًا على الصفحة لا على الذاكرة: أيّ
            // نافذةٍ مفتوحةٌ الآن. و`[data-modal-solo]` تُستثنى لأنّ الدخول
            // والإعدادات والحساب لها مُغلقاتها الخاصّة بتنظيفها الخاصّ، وقفلُ
            // التمرير يتولّاه `initScrollLock` بمراقبٍ فلا شيء يعلق.
            document.querySelectorAll('.modal-backdrop.active:not([data-modal-solo])')
                .forEach(m => m.classList.remove('active'));
            if (customizerPanel) customizerPanel.classList.remove('active');
            if (mobileToggle) mobileToggle.classList.remove('active');
            if (navLinks) navLinks.classList.remove('active');
        }
    });
});
