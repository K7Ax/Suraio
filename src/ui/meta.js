// ============================================================
// Sura retention + smart-hint platform (client-side, localStorage).
// No backend change: the server `streaks` table stays the source of
// truth for the streak number; this layer adds the adrenaline UX
// (XP, levels, Saudi badges, daily combo, countdown) and the FREE
// offline smart-hint engine (3/puzzle/day + a daily streak-saver).
//
// ‏هذه أوسعُ وحدةٍ في الواجهة، وأكثرُ ما يُقرأ منها: تُسجّل
// ‏`window.__sura.meta` و`window.__sura.hints`، وتضبط `__uid` و`__uidReady`
// ‏و`__owner` و`__allLevels`. وكلُّ وحدةٍ أخرى تقريبًا تقرأ `meta` — فموضعُ
// ندائها في `main.js` **يسبق قرّاءَها جميعًا**، وهو حيث كانت بالضبط.
//
// ‏و`LIVE_GAMES` هنا: هي مصدرُ الحقيقة لعدد الألعاب الحيّة، لا عددُ النوافذ
// في `index.html` (ثمانٍ منها مخفيّةٌ عمدًا).
// ============================================================
import * as P from '../core/progression.mjs';
import { sb } from '../core/supabaseClient.js';
import { arNum, escapeHtmlShared, suraDailySeed } from '../core/util.js';

export function initSuraMeta() {
    // missing_word + story_order soft-hidden 2026-06-23, letterboxed + strands soft-hidden 2026-06-24 (founder: hide the crossword/letter-grid games); tiles (زليج) soft-hidden 2026-07-15, replaced by lamha (لمحة) — all code/banks/tests kept; restore by re-adding the id here + removing the card's display:none.
    // «زايد» soft-hidden 2026-07-22 (founder: «مو وقتها الآن») — reversible:
    // module/bank/modal/migration all kept; re-add 'zayid' here + un-hide
    // #zayid-trigger-card to bring it back.
    const LIVE_GAMES = ['wordle', 'connections', 'spelling_bee', 'amthal', 'warmer', 'lamha'];
    const TITLES = { wordle: 'كَلِمة', connections: 'تشابك', sudoku: 'سودوكو', spelling_bee: 'نحلة الإملاء', letterboxed: 'صندوق الحروف', strands: 'خيوط', tiles: 'زليج', pips: 'نقاط', amthal: 'أمثال', missing_word: 'كلمة ناقصة', story_order: 'رتّب السالفة', warmer: 'قرّبها', lamha: 'لمحة', zayid: 'زايد' };

    // --- per-user namespaced storage -------------------------------------
    function uid() { return (window.__sura && window.__sura.__uid) || 'anon'; }
    function k(suffix) { return `sura.${uid()}.${suffix}`; }
    function read(suffix, def) {
        try { const v = localStorage.getItem(k(suffix)); return v == null ? def : JSON.parse(v); }
        catch (e) { return def; }
    }
    function write(suffix, val) { try { localStorage.setItem(k(suffix), JSON.stringify(val)); } catch (e) { } }
    // --- anonymous → account merge ---------------------------------------
    // Un-gated play means a visitor accrues real progress under `sura.anon.*`
    // before they ever sign up. On sign-in that has to fold into the account
    // WITHOUT clobbering what the account already had (same person, second
    // device), so every field merges by its own rule (see mergeProgress).
    // Operates on raw localStorage keys — it must run BEFORE __uid flips.
    function migrateAnon(newUid) {
        if (!newUid || newUid === 'anon') return false;
        const flag = `sura.${newUid}.anonMerged`;
        try { if (localStorage.getItem(flag)) return false; } catch (e) { return false; }
        const pre = 'sura.anon.';
        const suffixes = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.indexOf(pre) === 0) suffixes.push(key.slice(pre.length));
        }
        if (!suffixes.length) { try { localStorage.setItem(flag, '1'); } catch (e) { } return false; }
        const backup = {};
        suffixes.forEach(s => {
            const rawA = localStorage.getItem(pre + s);
            const rawU = localStorage.getItem(`sura.${newUid}.${s}`);
            backup[s] = rawA;
            let a, u;
            try { a = rawA == null ? null : JSON.parse(rawA); } catch (e) { return; }
            try { u = rawU == null ? null : JSON.parse(rawU); } catch (e) { u = null; }
            const merged = P.mergeProgress(s, a, u);
            try { localStorage.setItem(`sura.${newUid}.${s}`, JSON.stringify(merged)); } catch (e) { }
        });
        // keep one release worth of undo, then clear the anon namespace
        try {
            localStorage.setItem(`sura.${newUid}.anonBackup`, JSON.stringify(backup));
            suffixes.forEach(s => localStorage.removeItem(pre + s));
            localStorage.setItem(flag, '1');
        } catch (e) { }
        return true;
    }

    // الدمج كان محلّيًّا فقط، فبقيت الجبهة الخادميّة عند الصفر.
    //
    // بلاغ المالك (١٢ أغسطس ٢٠٢٦): «لعبت بدون تسجيل، ثمّ سجّلت — يحفظ وين
    // كنت، بس إذا جيت تكمّلها ما يحسب؛ ولا اللي لعبته ولا اللي كمّلته بعد
    // التسجيل. وإذا لعبت لعبةً من المرحلة الأولى ما لعبتها قبل التسجيل يبدأ
    // يحسب».
    //
    // السبب: `migrateAnon` تدمج `localStorage` وحدها ولا تُخبر الخادم. فيبقى
    // `player_progress` فارغًا لتلك اللعبة، وبوّابةُ التتابع في
    // `submit-progress` — `level > contiguousFrontier(cleared) + 1` ← 403
    // `level_locked` — ترفض كلّ إرسالٍ إلى الأبد: اللاعب عند المستوى ٧
    // والخادم عند جبهة ٠، فلا يُقبل ٧، ولا يُدرَج شيء، فتبقى الجبهة ٠. أمّا
    // لعبةٌ تُبدأ من المستوى ٠ بعد التسجيل فإرسالها متتابعٌ فتُحتسب. وهذا
    // يطابق البلاغ حرفًا بحرف، ويؤكّده الإنتاج: كلّ سجلّات `player_progress`
    // الخمسة تبدأ من المستوى ٠ ومتّصلة — ولا سجلَّ واحدٌ يبدأ فوق الصفر.
    //
    // العلاج: بعد الدمج، تُرسَل المستوياتُ المُنجَزة **بالترتيب من الصفر**
    // فتوافق البوّابة بدل أن تصطدم بها. الإرسال متسلسلٌ لأن كلّ خطوةٍ تحرّك
    // الجبهة التي تفحصها التالية، ومتوقّفٌ عند أوّل رفضٍ فلا يُغرَق الخادم.
    // والخادم مُتماثلُ الاستدعاء (idempotent)، فتكرار الترحيل لا يضاعف نقطة.
    function backfillServerProgress(uid) {
        const G = window.__sura.games;
        if (!uid || uid === 'anon' || !G || !G.submitProgress) return;
        // `.v2` عمدًا. الإصلاحُ أعلاه جعل رفعَ العلامة مشروطًا بالنجاح، لكنّه
        // لم يمسّ العلاماتِ المحروقةَ سلفًا — وهي محروقةٌ عند كلّ حسابٍ لعب
        // قبله، لأنّ النسخةَ السابقةَ كانت ترفعها دائمًا. فالسطرُ الذي
        // يقرؤها يُنهي الترحيلَ إلى الأبد، وتبقى الجبهةُ الخادميّةُ عند
        // الصفر، فيردّ `submit-progress` على كلّ فوزٍ حيٍّ بـ403
        // `level_locked` بلا رسالةٍ للّاعب. وهذا نصُّ بلاغ المالك
        // (١٧ أغسطس ٢٠٢٦): حسابُه القديم «ما كان يحسب نقاط» بينما حسابٌ
        // جديدٌ كليًّا «صار يحسب نقاط ويحسب الألعاب بشكل كويس» — الجديدُ لم
        // يحرق علامةً قطّ فيصعد من الصفر متتابعًا.
        //
        // فتغييرُ المفتاح هو الترحيلُ نفسه: يُعاد مرّةً واحدةً لكلّ حسابٍ
        // قائم. وهو مجّانيٌّ لمن اكتمل ترحيله أصلًا — الخادمُ متماثلُ
        // الاستدعاء فيردّ `already` بلا خبرةٍ جديدة، والحدُّ اليوميّ لا
        // يُمَسّ لأنّ `bump_ai_usage` يقع بعد فرعِ `already`.
        const done = `sura.${uid}.serverBackfill.v2`;
        try { if (localStorage.getItem(done)) return; } catch (e) { return; }
        // `meta` يُسنَد لاحقًا في هذا الملفّ. الاستدعاء هنا يقع داخل `then`
        // على جلسةٍ شبكيّة فيصل بعده دائمًا عمليًّا — لكن «عمليًّا» ليست
        // ضمانة، والخروج بلا رفع العلامة يجعلها تُعاد لا تُحرَق.
        const games = (window.__sura.meta && window.__sura.meta.LIVE_GAMES) || [];
        if (!games.length) return;
        // ولا تُرفع العلامة إلّا إذا تمّ الترحيل كلّه. كان يُرفع دائمًا،
        // وهذا كان يفقد اللاعب تقدّمه إلى الأبد:
        //
        // الخادم يحدّ الإنجازات الجديدة بستٍّ في الدقيقة
        // (`submit-progress:200-205` ← 429 `too_fast`)، وستٌّ ليست حالةً
        // نادرة بل **الحالة المتوقَّعة** — الحلقة تمرّ على ستّ ألعابٍ حتى
        // ٢١ مستوًى لكلّ لعبة. فعند الإنجاز السابع يأتي `too_fast` بلا
        // `credited` ولا `already`، فتنكسر الحلقة، **ثمّ تُرفع العلامة**؛
        // والسطر الذي يقرأها يجعل ذلك نهائيًّا في كلّ جلسةٍ قادمة.
        //
        // والضرر لا يقف عند «لم يكتمل الترحيل»: بوّابة التتابع ترفض بعدها
        // كلّ فوزٍ حيٍّ فوق الجبهة العالقة — أي يعود العطب نفسه الذي
        // كُتب هذا الترحيل لإصلاحه، من بابٍ آخر.
        //
        // العلاج ثلاثةٌ صغار: (١) العلامة تُرفع عند النجاح الكامل وحده،
        // (٢) الرفض المؤقّت «أعِد لاحقًا» لا «انتهيت» — والخادم متماثل
        // الاستدعاء فإعادةُ الترحيل لا تكلّف شيئًا ولا تضاعف نقطة،
        // (٣) مهلةٌ بين الدفعات تبقي الإرسال تحت حدّ الخادم بدل أن تصطدم به.
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        (async () => {
            let clean = true;
            let sent = 0;
            outer:
            for (const game of games) {
                let m = 0;
                try {
                    const raw = localStorage.getItem(`sura.${uid}.lvl.${game}.mask`);
                    m = raw == null ? 0 : (JSON.parse(raw) | 0);
                } catch (e) { continue; }
                // الجبهة المتّصلة وحدها: مستوًى مُنجَزٌ فوق ثغرةٍ لا تقبله
                // البوّابة أصلًا، وإرساله ضجيجٌ ورفضٌ مؤكَّد.
                const upto = P.contiguousFrontier(m);
                for (let lv = 0; lv <= upto; lv++) {
                    // خمسٌ ثمّ تنفّس. الحدّ ستٌّ في الدقيقة، والهامش مقصود.
                    if (sent && sent % 5 === 0) await sleep(11000);
                    const r = await G.submitProgress({ game_type: game, level: lv });
                    // `already` لا يُحتسب عند الخادم فلا يُعدّ هنا أيضًا.
                    if (r && r.credited) sent++;
                    if (!r || (!r.credited && !r.already)) { clean = false; break outer; }
                }
            }
            // فشلٌ ⇒ تُترك العلامة مرفوعةً غدًا: الترحيل يُستأنف في الجلسة
            // القادمة من حيث وقف، لأنّ ما مرّ يرجع `already` بلا تكلفة.
            if (clean) { try { localStorage.setItem(done, '1'); } catch (e) { } }
            if (window.__sura.refreshStanding) window.__sura.refreshStanding();
            if (window.__sura.refreshLeaderboard) window.__sura.refreshLeaderboard();
        })().catch(() => { });
    }

    // owner account gets perks (e.g. unlimited hints). Kept in sync below.
    const OWNER_EMAIL = 'khalid.alzahem@gmail.com';
    // حسابُ اختبارٍ واحد يفتح السلّم كلّه (طلب المالك، ١٢ أغسطس ٢٠٢٦):
    // «افتح كل المستويات فقط على user fff أو f7l@email.com».
    //
    // البريد هو المرجع لا اسم المستخدم: `username` قابلٌ للتغيير من اللوحة
    // بينما البريد هو هويّة الحساب في `auth.users`. (الحساب المقصود
    // 4d68d053، اسمه «fff» فعلًا اليوم — فلو بدّله بقي الفتح قائمًا.)
    //
    // فتحٌ للّعب فقط، لا لسكّ الخبرة: لا تُدرَج صفوفٌ في `player_progress`،
    // وبوّابةُ التتابع في `submit-progress` سترفض أيّ قفزةٍ فوق الجبهة
    // الخادميّة بـ403 كما تفعل مع الجميع. فاللوح مفتوحٌ أمامه والصدارة
    // مصونةٌ منه — وهذا مقصودٌ لا نقص.
    const ALL_LEVELS_EMAIL = 'f7l@email.com';
    const hasAllLevels = u => !!(u && u.email && u.email.toLowerCase() === ALL_LEVELS_EMAIL);
    function isOwner() { return !!(window.__sura && window.__sura.__owner); }
    // Resolve the signed-in uid once so storage is per-account (best effort).
    // uid() returns 'anon' until this settles, so anything that reads or writes
    // progress before then lands in the wrong namespace and is orphaned.
    // __uidReady lets callers await the resolution instead of racing it.
    window.__sura.__uidReady = (!sb) ? Promise.resolve('anon') : sb.auth.getSession().then(({ data }) => {
        const u = data && data.session && data.session.user;
        if (u) {
            migrateAnon(u.id);                 // must precede the __uid flip
            window.__sura.__uid = u.id;
            window.__sura.__owner = !!(u.email && u.email.toLowerCase() === OWNER_EMAIL);
            window.__sura.__allLevels = hasAllLevels(u);
            // بعد استقرار المعرّف لا قبله: الترحيل يقرأ `sura.<uid>.*`.
            // ومعلّقٌ خارج `migrateAnon` عمدًا — تلك ترتدّ فورًا للحسابات
            // المدموجة سلفًا، وهي أحوج ما تكون إلى ردم جبهتها الخادميّة.
            backfillServerProgress(u.id);
        }
        return window.__sura.__uid || 'anon';
    }).catch(() => 'anon');
    // keep the owner flag accurate if the account signs in/out after load
    if (sb) sb.auth.onAuthStateChange((_e, session) => {
        const u = session && session.user;
        if (u && u.id && window.__sura.__uid !== u.id) {
            // signing in mid-session: fold the anon run into the account
            if (migrateAnon(u.id)) toast('<span class="t-ico">💾</span> حفظنا تقدّمك في حسابك');
            window.__sura.__uid = u.id;
            backfillServerProgress(u.id);
            if (window.__sura.refreshAccountStats) window.__sura.refreshAccountStats();
        }
        window.__sura.__owner = !!(u && u.email && u.email.toLowerCase() === OWNER_EMAIL);
        // يُعاد ضبطها عند كلّ تغيّر جلسة — فالخروج يغلق السلّم من جديد.
        window.__sura.__allLevels = hasAllLevels(u);
    });

    // analytics: track the currently-open game modal so we can tell a WIN
    // from a rage-quit (modal closed without completing). Set on open
    // (mountChrome), flipped to won in onWin, read by the close observer.
    let openCtx = null; // { game, level, openedAt, won }
    function levelOf(game) { try { return window.__sura.levels ? window.__sura.levels.level(game) : null; } catch (e) { return null; } }
    function ev(type, props) { try { if (window.__sura.track) window.__sura.track(type, props); } catch (e) { } }

    // --- XP / levels ------------------------------------------------------
    // cumulative xp for a level: 100·L·(L-1)/2 style ramp (gentle then steeper)
    function xpForLevel(L) { return Math.round(60 * (L - 1) * L / 2); }
    function levelFromXp(xp) { let L = 1; while (xpForLevel(L + 1) <= xp) L++; return L; }
    // Pure: level/progress for ANY xp value. Used both for the local xp and for
    // the server-authoritative total_xp (so the account bar can show one number).
    function xpInfoOf(xp) {
        xp = Math.max(0, xp | 0);
        const L = levelFromXp(xp);
        const base = xpForLevel(L), next = xpForLevel(L + 1);
        return { xp, level: L, into: xp - base, span: Math.max(1, next - base), pct: Math.min(100, Math.round((xp - base) / Math.max(1, next - base) * 100)) };
    }
    function levelInfo() { return xpInfoOf(read('xp', 0)); }

    // --- Saudi-themed badges ---------------------------------------------
    const BADGES = [
        { id: 'first_win', name: 'أول نصر', icon: '⭐', test: s => s.wins >= 1 },
        { id: 'fast', name: 'سريع كالبرق', icon: '⚡', test: s => s.bestSeconds && s.bestSeconds <= 60 },
        { id: 'flame3', name: 'لهيب نجد', icon: '🔥', test: s => s.maxStreak >= 3 },
        { id: 'gulf', name: 'بحّار الخليج', icon: '⚓', test: s => s.maxStreak >= 7 },
        { id: 'falcon', name: 'صقر', icon: '🦅', test: s => s.level >= 5 },
        { id: 'palm', name: 'نخلة ذهبية', icon: '🌴', test: s => s.level >= 10 },
        { id: 'arraf', name: 'عرّاف الجزيرة', icon: '🧠', test: s => s.wins >= 25 },
        { id: 'combo', name: 'بطل اليوم', icon: '👑', test: s => s.comboAllDays >= 1 },
        // campaign badges — driven by rank/level progress, not daily play
        { id: 'legend', name: 'أسطورة', icon: '👑', test: s => s.legendRanks >= 1 },
        { id: 'trailblazer', name: 'فاتح الطريق', icon: '🪜', test: s => s.maxGameCleared >= 21 },
        { id: 'campaign_falcon', name: 'صقر الحملة', icon: '🦅', test: s => s.totalCleared >= 42 }
    ];

    // --- daily helpers ----------------------------------------------------
    function todayKey() { return String(suraDailySeed()); }
    function secsToMidnight() {
        const ksaSecs = Math.floor(Date.now() / 1000) + 3 * 3600;
        return 86400 - (ksaSecs % 86400);
    }
    function fmtClock(total) {
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
        const p = n => arNum(String(n).padStart(2, '0'));
        return `${p(h)}:${p(m)}:${p(s)}`;
    }

    // --- streak-saver (1/day) --------------------------------------------
    function saverState() {
        const st = read('saver', null);
        if (!st || st.day !== todayKey()) { const fresh = { day: todayKey(), left: 1 }; write('saver', fresh); return fresh; }
        return st;
    }
    function saverLeft() { return saverState().left; }
    function useSaver() { const st = saverState(); if (st.left <= 0) return false; st.left--; write('saver', st); return true; }

    // --- daily combo ------------------------------------------------------
    function comboSet() { const st = read('combo', null); if (!st || st.day !== todayKey()) return { day: todayKey(), done: [] }; return st; }
    function markDone(gameType) {
        const st = comboSet();
        if (!st.done.includes(gameType)) st.done.push(gameType);
        write('combo', st);
        return st.done.length;
    }
    function comboDone() { return comboSet().done.slice(); }
    function comboAllDone() { return LIVE_GAMES.every(g => comboSet().done.includes(g)); }

    // --- server streak (read-only, RLS-scoped) ---------------------------
    //
    // كانت تقرأ `streaks` — الجدول الفارغ — فتُرجع صفرًا **في كلّ فوزٍ في كلّ
    // لعبة**. وهي تُنادى من `won()` في الألعاب الثلاث عشرة ومن شريط الحالة،
    // فكانت «السلسلة» صفرًا في نخب الفوز وفي الشريط معًا، لا في لوحة الحساب
    // وحدها (بلاغ المالك «الإحصائيات لا تعمل»، ١٢ أغسطس ٢٠٢٦).
    //
    // المصدر الآن `my_stats()` نفسه، فالرقم واحدٌ متّسق في الموقع كلّه بدل
    // رقمين متنافسين. و`gameType` بقي في التوقيع لأن ثلاثة عشر مُناديًا
    // يمرّرونه، لكنّه لم يعد يُفرّق: «السلسلة» صارت أيامَ لعبٍ متتالية
    // للحساب لا سلسلةً لكلّ لعبة (اختيار المالك).
    //
    // مخزّنةٌ بمفتاح يوم الرياض: السلسلة لا تتغيّر إلا بتغيّر اليوم، فنداءٌ
    // واحد يكفي الجلسة كلّها بدل نداءٍ عند كلّ فوز.
    // المفتاح يحمل الحساب مع اليوم: تسجيلُ خروجٍ ثمّ دخولٌ بحسابٍ آخر في
    // الجلسة نفسها كان سيقرأ سلسلة الحساب السابق من المخزن. (الخروج وحده
    // آمنٌ أصلًا — النداء يعود بصفرٍ قبل أن يكتب المخزن.)
    let streakCache = null;   // { key, val }
    async function serverStreak(gameType) {
        const zero = { current: 0, max: 0 };
        if (!sb) return zero;
        const key = `${todayKey()}|${window.__sura.__uid || 'anon'}`;
        if (streakCache && streakCache.key === key) return streakCache.val;
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (!session) return zero;   // no point querying when signed out
            const { data } = await sb.rpc('my_stats');
            const r = Array.isArray(data) ? data[0] : data;
            const val = r ? { current: r.current_streak || 0, max: r.max_streak || 0 } : zero;
            streakCache = { key, val };
            return val;
        } catch (e) { window.__sura.reportError('serverStreak', e, { game: gameType }); return zero; }
    }

    // --- toast (level-up / badge / combo) --------------------------------
    // FIFO queue, not a single reused slot. A win can legitimately fire several
    // toasts at once (level cleared + band unlocked + badge earned); the old
    // implementation cleared the pending timer each time, so the last one in
    // silently ate the ones before it and the player never saw them.
    const tQueue = [];
    let tShowing = false;
    function toast(html, ms = 2600) {
        const last = tQueue[tQueue.length - 1];
        if (last && last.html === html) return;      // drop consecutive duplicates
        if (tQueue.length >= 4) tQueue.shift();      // never build an unbounded backlog
        tQueue.push({ html, ms });
        if (!tShowing) pumpToast();
    }
    function pumpToast() {
        const item = tQueue.shift();
        if (!item) { tShowing = false; return; }
        tShowing = true;
        let el = document.getElementById('sura-toast');
        if (!el) { el = document.createElement('div'); el.id = 'sura-toast'; el.className = 'sura-toast'; document.body.appendChild(el); }
        el.innerHTML = item.html;
        el.classList.add('show');
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(pumpToast, 260);              // let the fade-out finish
        }, item.ms);
    }

    // --- streak-saver prompt ---------------------------------------------
    // Offer a once-daily retry on a failed daily puzzle so the streak survives.
    function offerSaver(gameType, onUse) {
        ev('level_failed', { game: gameType, level: levelOf(gameType) });
        if (saverLeft() <= 0) return false;
        let el = document.getElementById('sura-saver');
        if (!el) { el = document.createElement('div'); el.id = 'sura-saver'; el.className = 'sura-saver'; document.body.appendChild(el); }
        el.innerHTML = `<span class="saver-msg">🛡️ خسرت اللغز — استخدم <b>منقذ السلسلة</b> وأعد المحاولة؟ <small>(${arNum(saverLeft())} متبقٍ اليوم)</small></span><span class="saver-btns"><button class="saver-yes" type="button">أنقذني</button><button class="saver-no" type="button">لا</button></span>`;
        el.classList.add('show');
        const hide = () => el.classList.remove('show');
        el.querySelector('.saver-yes').onclick = () => { if (useSaver()) { hide(); if (onUse) onUse(); } };
        el.querySelector('.saver-no').onclick = hide;
        clearTimeout(el._t); el._t = setTimeout(hide, 9000);
        return true;
    }

    // --- post-win signup ask ----------------------------------------------
    // Now that play is un-gated, this is the ONLY place we ask for an account.
    // Not on the first win (let them enjoy it) and at most once a day, and the
    // copy cites progress they'd actually lose.
    // Escalates with how much the player now stands to lose. Once a day was
    // too quiet for someone who had already built up real progress that
    // lives in one browser and nowhere else.
    //   ask 1  → quiet card, retires itself
    //   ask 2+ → card that stays until dismissed, cites the actual numbers
    //   3+ levels or a 👑 → one celebration modal, offered a single time
    function signupTier() {
        const camp = (window.__sura.ranks && window.__sura.ranks.summary()) || { totalCleared: 0, legendRanks: 0 };
        if (!read('signupBigAsk', 0) && (camp.totalCleared >= 3 || camp.legendRanks > 0)) return 'modal';
        return read('signupAsks', 0) >= 1 ? 'sticky' : 'soft';
    }
    function shouldPromptSignup() {
        if (window.__sura.__uid && window.__sura.__uid !== 'anon') return false;
        // One cleared level is enough to have something worth losing.
        if (read('wins', 0) < 1) return false;
        if (signupTier() === 'modal') return true;         // the big ask ignores the daily cap
        return read('signupPromptDay', null) !== todayKey();
    }
    // A passive card, NOT a modal. Hijacking the screen right after a win
    // punishes the exact moment we want to feel good, and a player who came to
    // play a game did not come to fill a form. This sits at the bottom, the
    // game stays fully playable behind it, and ignoring it costs nothing.
    function promptSignup() {
        if (!shouldPromptSignup()) return false;
        write('signupPromptDay', todayKey());
        const tier = signupTier();
        write('signupAsks', read('signupAsks', 0) + 1);
        const camp = (window.__sura.ranks && window.__sura.ranks.summary()) || { totalCleared: 0, legendRanks: 0 };
        const bits = [];
        if (camp.totalCleared) bits.push(`${arNum(camp.totalCleared)} مستويات`);
        if (camp.legendRanks) bits.push(`${arNum(camp.legendRanks)} رتبة 👑`);
        const xp = read('xp', 0);
        if (xp) bits.push(`${arNum(xp)} خبرة`);
        const what = bits.length ? `عندك ${bits.join(' و')}` : 'تقدّمك محفوظ في هذا المتصفح فقط';

        if (tier === 'modal') { write('signupBigAsk', 1); return bigSignupAsk(what); }

        let el = document.getElementById('signup-nudge');
        if (el) el.remove();
        el = document.createElement('div');
        el.id = 'signup-nudge';
        el.className = 'signup-nudge';
        el.setAttribute('role', 'complementary');
        el.innerHTML =
            '<span class="sn-ico">💾</span>'
            + `<span class="sn-text"><b>${what}</b><small>سجّل مجاناً عشان ما يضيع لو غيّرت جهازك</small></span>`
            + '<button type="button" class="sn-cta">سجّل</button>'
            + '<button type="button" class="sn-x" aria-label="إخفاء">&times;</button>';
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('in'));

        const dismiss = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); };
        el.querySelector('.sn-x').addEventListener('click', dismiss);
        el.querySelector('.sn-cta').addEventListener('click', () => {
            dismiss();
            if (window.__sura.openAuth) window.__sura.openAuth('signup');
        });
        // The first ask retires itself; later ones stay until dismissed,
        // because by then there is real progress riding on it.
        if (tier === 'soft') setTimeout(() => { if (document.body.contains(el)) dismiss(); }, 15000);
        return true;
    }

    // The single loud ask, earned by 3+ cleared levels or an أسطورة rank.
    // Still fully dismissable — it celebrates first and asks second.
    function bigSignupAsk(what) {
        let el = document.getElementById('signup-bigask');
        if (el) el.remove();
        el = document.createElement('div');
        el.id = 'signup-bigask';
        el.className = 'modal-backdrop signup-bigask';
        el.innerHTML =
            '<div class="modal-container signup-bigask__box">'
            + '<button type="button" class="modal-close" aria-label="إغلاق">✖</button>'
            + '<div class="sba-body">'
            + '<div class="sba-ico">🏆</div>'
            + '<h3>ما شاء الله — صرت تلعب بجد</h3>'
            + `<p class="sba-what">${what}</p>`
            + '<p class="sba-warn">كل هذا محفوظ في <b>هذا المتصفح فقط</b>. لو نظّفته أو غيّرت جهازك، يروح.</p>'
            + '<button type="button" class="btn-primary sba-cta">احفظ تقدّمي — مجاناً</button>'
            + '<button type="button" class="sba-later">لاحقاً</button>'
            + '</div></div>';
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('active'));
        const close = () => { el.classList.remove('active'); setTimeout(() => el.remove(), 400); };
        el.querySelector('.modal-close').addEventListener('click', close);
        el.querySelector('.sba-later').addEventListener('click', close);
        el.addEventListener('click', e => { if (e.target === el) close(); });
        el.querySelector('.sba-cta').addEventListener('click', () => {
            close();
            if (window.__sura.openAuth) window.__sura.openAuth('signup');
        });
        return true;
    }

    // --- central win hook -------------------------------------------------
    // Call on every win. Awards XP, marks the combo, unlocks badges, and
    // returns a summary the game can fold into its share text.
    // How much of the base reward each rank tier earns. Playing well is
    // worth ~2.5x playing sloppily, but the floor is never punitive.
    const RANK_MULT = [0.60, 0.80, 1.00, 1.25, 1.55];

    async function onWin(gameType, opts = {}) {
        opts = opts || {};
        const before = levelInfo();
        const seconds = opts.seconds || 0;
        // XP: (base + speed bonus + streak multiplier) scaled by rank.
        // opts.rank was silently discarded before — games computed a quality
        // score every round and it changed nothing.
        let gained = 20;
        if (seconds && seconds <= 60) gained += 15; else if (seconds && seconds <= 180) gained += 8;
        const streak = (opts.streak && opts.streak.current) || 0;
        gained += Math.min(40, streak * 4);
        const rank = Math.max(0, Math.min(4, (opts.rank != null ? opts.rank : 2) | 0));
        gained = Math.round(gained * RANK_MULT[rank]);
        if (opts.timed) gained = Math.round(gained * 1.25);        // «تحدّي» beaten
        // Rush is flavour, not the main course: capped small on purpose so a
        // long streak never dwarfs actually clearing the level.
        if (opts.rushMax >= 2) gained += Math.min(10, opts.rushMax);
        write('xp', read('xp', 0) + gained);
        // coins: a spendable currency earned on wins, used to buy extra hints
        const coinGain = Math.round((10 + Math.min(20, streak * 2)) * RANK_MULT[rank]);
        write('coins', read('coins', 0) + coinGain);

        const wins = read('wins', 0) + 1; write('wins', wins);
        const best = read('bestSeconds', 0);
        if (seconds && (!best || seconds < best)) write('bestSeconds', seconds);

        const doneCount = markDone(gameType);
        const comboComplete = comboAllDone();
        if (comboComplete) {
            const days = read('comboAllDays', 0);
            const last = read('comboLastDay', null);
            if (last !== todayKey()) { write('comboAllDays', days + 1); write('comboLastDay', todayKey()); }
        }

        const after = levelInfo();
        const leveledUp = after.level > before.level;

        // badge check
        const camp = (window.__sura.ranks && window.__sura.ranks.summary())
            || { legendRanks: 0, maxGameCleared: 0, totalCleared: 0 };
        const sstats = {
            wins, level: after.level, bestSeconds: read('bestSeconds', 0),
            maxStreak: Math.max(streak, (opts.streak && opts.streak.max) || 0),
            comboAllDays: read('comboAllDays', 0),
            legendRanks: camp.legendRanks, maxGameCleared: camp.maxGameCleared, totalCleared: camp.totalCleared
        };
        const have = read('badges', []);
        const newBadges = [];
        BADGES.forEach(b => { if (!have.includes(b.id) && b.test(sstats)) { have.push(b.id); newBadges.push(b); } });
        if (newBadges.length) write('badges', have);

        // celebratory toasts (sequenced)
        // «الرتبة», not «المستوى» — the campaign level is a different number
        // and calling both the same thing confused every screen they share.
        if (leveledUp) toast(`<span class="t-ico">🎉</span> الرتبة ${arNum(after.level)}! <small>+${arNum(gained)} نقطة خبرة</small>`);
        newBadges.forEach((b, i) => setTimeout(() => toast(`<span class="t-ico">${b.icon}</span> وسام جديد: <b>${b.name}</b>`), (leveledUp ? 1 : 0) * 2700 + i * 2700));
        if (comboComplete) setTimeout(() => toast(`<span class="t-ico">👑</span> أكملت كل ألعاب اليوم! بطل سُرى`), (leveledUp ? 1 : 0) * 2700 + newBadges.length * 2700);

        if (window.__sura.refreshDailyStrip) window.__sura.refreshDailyStrip();
        if (window.__sura.refreshAccountStats) window.__sura.refreshAccountStats();
        // Anon players reach here too now. Ask once the win is worth keeping —
        // after the celebratory toasts have had their moment.
        setTimeout(promptSignup, 3200);

        // «كيف وجدتَ هذه؟» — asked in context, where the player still
        // remembers how the level felt, which is the only moment the answer
        // is worth anything. Never on a first win (a first-timer has no basis
        // for a verdict), never twice for the same game, and late enough that
        // it cannot collide with the signup prompt above.
        if (wins >= 2) setTimeout(() => {
            if (window.__sura.feedback) window.__sura.feedback.askRating(gameType);
        }, 7000);

        // analytics: this puzzle/level was completed — also mark the open
        // modal as won so the close observer doesn't log it as a quit.
        if (openCtx && openCtx.game === gameType) openCtx.won = true;
        ev('level_completed', { game: gameType, level: levelOf(gameType), metadata: { seconds: seconds || 0, streak, xp: gained, rank } });

        return { xpGained: gained, leveledUp, level: after.level, newBadges, comboComplete, comboCount: doneCount, rank };
    }

    // --- partial credit ---------------------------------------------------
    // A round that ended without a win still took effort. It pays 40% XP and
    // records a rank, so no session ever ends with literally nothing — the
    // counterweight that lets games have real stakes without feeling cruel.
    async function onPartial(gameType, opts = {}) {
        opts = opts || {};
        const rank = Math.max(0, Math.min(4, (opts.rank || 0) | 0));
        const gained = Math.max(4, Math.round(20 * RANK_MULT[rank] * 0.40));
        write('xp', read('xp', 0) + gained);
        write('coins', read('coins', 0) + 3);
        if (window.__sura.refreshAccountStats) window.__sura.refreshAccountStats();
        ev('level_failed', { game: gameType, level: levelOf(gameType), metadata: { kind: opts.kind || 'exhausted', rank, xp: gained } });
        return { xpGained: gained, rank };
    }

    // --- countdown mount --------------------------------------------------
    const countdownEls = new Set();
    function mountCountdown(el) {
        if (!el) return;
        countdownEls.add(el);
        el.textContent = fmtClock(secsToMidnight());
    }
    setInterval(() => {
        const t = secsToMidnight();
        countdownEls.forEach(el => { if (el.isConnected) el.textContent = fmtClock(t); else countdownEls.delete(el); });
    }, 1000);

    window.__sura.meta = {
        LIVE_GAMES, titleOf: g => TITLES[g] || g,
        xp: { info: levelInfo, infoOf: xpInfoOf, add: a => write('xp', read('xp', 0) + a) },
        badges: { all: () => BADGES, unlocked: () => read('badges', []), defOf: id => BADGES.find(b => b.id === id) },
        saver: { left: saverLeft, use: useSaver },
        coins: { get: () => read('coins', 0), add: n => write('coins', read('coins', 0) + n), spend: n => { if (read('coins', 0) < n) return false; write('coins', read('coins', 0) - n); return true; } },
        combo: { done: comboDone, count: () => comboDone().length, total: LIVE_GAMES.length, allDone: comboAllDone, mark: markDone },
        countdown: { mount: mountCountdown, secsToMidnight, fmt: fmtClock },
        serverStreak, onWin, onPartial, offerSaver, toast, read, write,
        promptSignup, shouldPromptSignup, migrateAnon
    };

    // ============================================================
    // Free offline smart-hint engine. Each game registers a provider
    // closure that computes a real nudge from the puzzle's own
    // solution/constraints. 3 hints per game per day.
    // ============================================================
    const MAX_HINTS = 3;
    const providers = {};      // local deterministic hint (offline fallback)
    const ctxProviders = {};   // optional safe context for the AI (Groq) hint
    const sessionUsed = {}; // hints used THIS game session (for mission goals)
    function hkey(g) { return `hints.${g}.${todayKey()}`; }
    function bkey(g) { return `hintsbuy.${g}.${todayKey()}`; }
    function used(g) { return read(hkey(g), 0); }
    function bought(g) { return read(bkey(g), 0); }
    // 3 free per day, then buyable with earned coins at an escalating price.
    // Owner account is uncapped (never needs to buy).
    function left(g) {
        if (isOwner()) return 999;
        const base = Math.max(0, MAX_HINTS + bought(g) - used(g));
        return base + (floorFree(g) ? 1 : 0);   // the free per-level hint
    }
    function hintPrice(g) { return 20 * Math.pow(2, bought(g)); }

    // FREE PER-LEVEL HINT FLOOR — the direct counterweight to guess budgets.
    // The first hint on a level you have never cleared is free and does not
    // touch the daily 3, so a new level can never become a hard wall.
    function floorKey(g) {
        const L = window.__sura.levels;
        // The daily has no frontier to hang this on — it is one board a day —
        // so its floor hint is keyed by DATE instead. Same guarantee (a board
        // is never a wall), same budget (one per game per day).
        if (L && L.daily && L.daily.active(g)) return `hintfloor.daily.${g}.${todayKey()}`;
        return `hintfloor.${g}.${L ? L.level(g) : 0}`;
    }
    function floorFree(g) {
        const L = window.__sura.levels;
        if (!L || !L.mask || !L.frontier) return false;
        if (L.daily && L.daily.active(g)) {
            // Friday «التحدي الكبير» withdraws it entirely. That is the whole
            // modifier: without the free hint a hard board is genuinely hard,
            // and it is the only day of the week where that is true.
            if (!L.daily.freeFloorHint(g)) return false;
            return !read(floorKey(g), 0);
        }
        const lv = L.level(g);
        if (P.maskHas(L.mask(g), lv)) return false;      // already cleared it
        // ONLY on the frontier — the furthest level actually reached. Any
        // uncleared level used to qualify, so hopping around the ladder
        // handed out a fresh free hint every time: the daily 3 never moved
        // and the counter bounced 4→3→4→3. Tying it to the frontier keeps
        // the "a new level is never a wall" guarantee while bounding the
        // total to one per level you genuinely got to.
        if (lv !== L.frontier(g)) return false;
        return !read(floorKey(g), 0);
    }
    // record one consumed hint (counter + session + analytics)
    // لوحةُ التلميح لكلّ لعبة — تُملأ من `showHint` وتُفرَغ مع كلّ لوحٍ
    // جديد (`memo(game).reset()`، وهي السطر الذي تناديه كلّ لعبةٍ في
    // بداية `start()` أصلًا، فلا تحتاج لعبةٌ واحدة إلى تعديل).
    const panels = {};
    function showHint(gameType, text, ico) {
        const p = panels[gameType];
        if (!p) { toast(`<span class="t-ico">${ico || '💡'}</span> ${text}`, 3200); return; }
        p.innerHTML = `<span class="hint-panel-ico" aria-hidden="true">${ico || '💡'}</span>`
            + `<span class="hint-panel-text">${escapeHtmlShared(String(text))}</span>`;
        p.classList.remove('hidden');
    }
    function clearHint(gameType) {
        const p = panels[gameType];
        if (!p) return;
        p.innerHTML = '';
        p.classList.add('hidden');
    }

    // أيُّ رصيدٍ خُصم آخر مرّة لكلّ لعبة — لأنّ الردّ يحتاج أن يعرف هل
    // أُنفقت هديّةُ المستوى أم واحدةٌ من رصيد اليوم؛ وهما مفتاحان مختلفان.
    const lastConsume = {};
    function consume(gameType, via) {
        if (floorFree(gameType)) {
            write(floorKey(gameType), 1);
            sessionUsed[gameType] = (sessionUsed[gameType] || 0) + 1;
            lastConsume[gameType] = 'floor';
            ev('hint_used', { game: gameType, level: levelOf(gameType), metadata: { via: via || 'local', free: 'level_floor' } });
            toast('<span class="t-ico">🎁</span> تلميح مجاني لهذا المستوى');
            return;
        }
        write(hkey(gameType), used(gameType) + 1);
        sessionUsed[gameType] = (sessionUsed[gameType] || 0) + 1;
        lastConsume[gameType] = 'daily';
        ev('hint_used', { game: gameType, level: levelOf(gameType), metadata: { used: used(gameType), bought: bought(gameType), via: via || 'local' } });
    }
    // يُردّ الخصم حين لا يصل اللاعبَ نصٌّ. لا يُطلق حدثًا مضادًّا: نوع
    // الحدث في `game_events` مقيَّدٌ بـCHECK، وإضافة نوعٍ تحتاج ترحيلًا —
    // فيبقى `hint_used` أعلى من الواقع بعدد المردودات، وهي حالةٌ نادرة
    // ومعروفة الآن بدل أن تكون خصمًا صامتًا من اللاعب.
    function refund(gameType) {
        const kind = lastConsume[gameType];
        if (!kind) return;
        lastConsume[gameType] = null;
        sessionUsed[gameType] = Math.max(0, (sessionUsed[gameType] || 0) - 1);
        if (kind === 'floor') write(floorKey(gameType), 0);
        else write(hkey(gameType), Math.max(0, used(gameType) - 1));
    }
    // LOCAL deterministic hint (offline fallback / non-AI path).
    function trigger(gameType) {
        if (left(gameType) <= 0) {
            return { ok: false, needBuy: true, price: hintPrice(gameType), balance: read('coins', 0) };
        }
        const fn = providers[gameType];
        if (!fn) return { ok: false, message: '' };
        let res;
        try { res = fn(); } catch (e) { res = { ok: false, message: 'تعذّر التلميح' }; }
        if (res && res.ok !== false) consume(gameType, 'local');
        return res || { ok: true };
    }
    // PRIMARY hint path: the local deterministic provider first, Groq only
    // where it has nothing to say.
    //
    // This order is the cost rule («صفر نداء AI يمكن للكود أن يغني عنه»)
    // and it was previously inverted — every hint press on a game with a
    // registered context provider spent a Groq call even when the local
    // hint was already the right answer. The local provider signals
    // "nothing to add" by returning ok:false WITHOUT consuming a hint, so
    // escalating there costs the player nothing and double-consumes nothing.
    //
    // Two side benefits, both real: the common hint is now instant instead
    // of waiting on a round trip that can take up to the 6s timeout, and the
    // game keeps working identically with no key, no network, and no
    // account. AI remains reachable — it is not removed, only demoted to
    // the case code cannot cover.
    async function deliverHint(gameType) {
        if (left(gameType) <= 0) {
            return { ok: false, needBuy: true, price: hintPrice(gameType), balance: read('coins', 0) };
        }
        // خصمٌ واحدٌ لكل ضغطة — كان اثنين.
        //
        // `trigger` يخصم بنفسه متى كان `res.ok !== false`. فإن أرجع المزوّد
        // المحلّيّ `ok:true` برسالةٍ فارغة (وهذا يقع فعلًا: الذاكرة تمنع
        // إعادة تلميحٍ سبق تقديمه، فيعود بلا نصّ) سقط التنفيذ إلى مسار
        // الذكاء الاصطناعيّ، و`consume(…,'groq')` خصم **مرّةً ثانية**.
        // ضغطةٌ واحدة، تلميحٌ واحد، وحدثان في السجلّ ورصيدٌ ناقصٌ اثنين.
        //
        // الدليل من بيانات المالك (١٣ أغسطس ٢٠٢٦، «كَلِمة» المستوى ٢٠):
        // حدثا `hint_used` بـ`used:2` و`used:3` في **نفس الدفعة**، وهو
        // بالضبط شعوره أنّه «ضيّع محاولاته».
        const res = trigger(gameType);
        const charged = !!(res && res.ok !== false);
        if (charged && res.message) {
            showHint(gameType, res.message, '💡');
            return res;
        }
        const ctxFn = ctxProviders[gameType];
        if (ctxFn && window.__sura.aiHint) {
            let ctx = null;
            try { ctx = ctxFn(); } catch (e) { ctx = null; }
            if (ctx) {
                const ai = await window.__sura.aiHint(gameType, {
                    level: levelOf(gameType), hint_level: used(gameType) + 1,
                    difficulty: ctx.difficulty, player_state: ctx.player_state,
                    safe_context: ctx.safe_context, solution: ctx.solution
                });
                if (ai && ai.hint) {
                    if (!charged) consume(gameType, 'groq');
                    showHint(gameType, ai.hint, '✨');
                    return { ok: true, ai: true };
                }
            }
        }
        // ولو خُصم ولم يصل نصٌّ من أيّ مسار، فقد دفع اللاعب بلا مقابل —
        // يُردّ الخصم بدل أن يُبتلع صامتًا.
        if (charged && !(res && res.message)) {
            refund(gameType);
            toast('<span class="t-ico">💡</span> ما قدرت أعطيك تلميحًا جديدًا هنا — ما خصمت شيئًا');
            return { ok: false, message: '' };
        }
        if (res && res.message) showHint(gameType, res.message, '💡');
        return res;
    }
    // spend coins to unlock one more hint today; returns true on success
    function buyHint(gameType) {
        const price = hintPrice(gameType);
        if (read('coins', 0) < price) return false;
        write('coins', read('coins', 0) - price);
        write(bkey(gameType), bought(gameType) + 1);
        return true;
    }

    // Inject a shared HUD (flame · countdown · hint button) into a game
    // modal's container, and wire the hint button to the provider.
    // Returns { refresh } to re-sync the hint counter after external use.
    function mountChrome(modal, gameType) {
        if (!modal) return { refresh() { } };
        sessionUsed[gameType] = 0; // fresh session — reset the mission hint counter

        // analytics: a game modal just opened. Record context and watch for
        // close-without-win (rage-quit) via a one-time class observer.
        const lvNow = levelOf(gameType);
        openCtx = { game: gameType, level: lvNow, openedAt: Date.now(), won: false };
        ev('game_opened', { game: gameType, level: lvNow });
        modal._suraOpen = true;
        if (!modal._suraQuitObs) {
            modal._suraQuitObs = new MutationObserver(() => {
                const active = modal.classList.contains('active');
                if (active) { modal._suraOpen = true; return; }
                if (!modal._suraOpen) return;
                modal._suraOpen = false;
                // عرضُ الشراء لا ينجو من إغلاق النافذة. النافذة تُخفى ولا
                // تُهدَم، و`refresh()` تعود فورًا ما دامت `dataset.buy`
                // مرفوعة — فكان اللاعب يعود غدًا وله ثلاثة تلميحاتٍ
                // مجّانيّة وزرٌّ يقول «اشترِ»، والضغطة تخصم نقاطًا لا
                // داعي لها. الإغلاق = تراجع، لا تعليقٌ للقرار.
                const hb = modal.querySelector('.hint-btn');
                if (hb && hb.dataset.buy === '1') {
                    hb.dataset.buy = '';
                    hb.dataset.buyPrice = '';
                    if (modal._suraRefreshHint) modal._suraRefreshHint();
                }
                if (openCtx && openCtx.game === gameType) {
                    if (!openCtx.won) ev('level_quit', { game: gameType, level: openCtx.level, metadata: { seconds: Math.round((Date.now() - openCtx.openedAt) / 1000) } });
                    openCtx = null;
                }
            });
            modal._suraQuitObs.observe(modal, { attributes: true, attributeFilter: ['class'] });
        }
        const container = modal.querySelector('.wordle-modal-container, .game-modal-container, .modal-content') || modal.firstElementChild || modal;
        let hud = modal.querySelector('.sura-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.className = 'sura-hud';
            hud.innerHTML = `
                <span class="hud-flame" title="سلسلتك">🔥 <b class="hud-streak">0</b></span>
                <span class="hud-count" title="لغز جديد بعد"><span class="hud-clock">00:00:00</span></span>
                <button class="hint-btn" type="button"><span class="hint-ico">💡</span> تلميح ذكي <b class="hint-left">(3)</b></button>`;
            container.insertBefore(hud, container.firstChild);
        }
        // لوحةُ التلميح — تحلّ محلّ الـtoast.
        //
        // كان التلميح يُعرض إشعارًا يزول بعد ٣٫٢ ثانية (٤٫٢ للذكيّ) ولا
        // يُسترجَع. وبلاغ المالك (١٣ أغسطس ٢٠٢٦): «مرات تختفي ولا ألحق
        // أشوفها». والإشعار أداةُ **إخطار**: يقول «حدث شيء» ثمّ ينصرف.
        // أمّا التلميح فمعلومةٌ مرجعيّة تُقرأ أثناء التفكير في اللوح، وقد
        // دفع اللاعب من رصيده ثمنَها. فتبقى معروضةً حتى يبدأ لوحًا جديدًا.
        let panel = modal.querySelector('.hint-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'hint-panel hidden';
            panel.setAttribute('role', 'status');
            panel.setAttribute('aria-live', 'polite');
            hud.insertAdjacentElement('afterend', panel);
        }
        panels[gameType] = panel;
        const streakEl = hud.querySelector('.hud-streak');
        const clockEl = hud.querySelector('.hud-clock');
        const btn = hud.querySelector('.hint-btn');
        mountCountdown(clockEl);
        // «—» لا «٠» للفراغ (docs/architecture/identity.md §83).
        serverStreak(gameType).then(s => {
            const n = (s && s.current) || 0;
            if (streakEl) streakEl.textContent = n ? arNum(n) : '—';
        });
        function refresh() {
            if (btn.dataset.buy === '1') return; // keep the buy prompt until acted on
            btn.classList.remove('hint-buy');
            if (isOwner()) {
                btn.innerHTML = '<span class="hint-ico">💡</span> تلميح ذكي <b class="hint-left">(∞)</b>';
                return;
            }
            // The number is the DAILY balance only. Folding the free
            // per-level hint into it made the count rise when you changed
            // level, which read as "I used one and it didn't go down".
            // The gift is its own badge instead.
            const daily = Math.max(0, MAX_HINTS + bought(gameType) - used(gameType));
            const gift = floorFree(gameType)
                ? '<span class="hint-gift" title="تلميح مجاني لهذا المستوى">🎁</span>' : '';
            btn.innerHTML = `<span class="hint-ico">💡</span> تلميح ذكي <b class="hint-left">(${arNum(daily)})</b>${gift}`;
        }
        if (!btn._wired) {
            btn._wired = true;
            let busy = false;
            btn.addEventListener('click', async () => {
                if (busy) return; busy = true;          // ignore re-clicks while AI is thinking
                try {
                    if (btn.dataset.buy === '1') {       // second click = confirm purchase
                        btn.dataset.buy = '';
                        // السعرُ المعروض هو السعرُ المخصوم — أو لا خصم.
                        // كان الملصق يُطبع من `res.price` لحظةَ العرض بينما
                        // التأكيد يُعيد حساب `hintPrice` (‏٢٠×٢^المشترَى)،
                        // فأيّ شراءٍ بينهما — في تبويبٍ آخر أو لعبةٍ أخرى —
                        // يجعل الزرّ يقول «٢٠» ويخصم «٤٠». وقد قيس ذلك
                        // فعلًا. فإذا تحرّك السعر يُعاد العرض بالسعر الجديد
                        // ولا يُخصم شيء: وعدٌ مكسورٌ أسوأ من ضغطةٍ زائدة.
                        const shown = Number(btn.dataset.buyPrice || 0);
                        const now = hintPrice(gameType);
                        btn.dataset.buyPrice = '';
                        if (shown && now !== shown) {
                            btn.dataset.buy = '1';
                            btn.dataset.buyPrice = String(now);
                            btn.innerHTML = `<span class="hint-ico">🪙</span> اشترِ تلميحًا (${arNum(now)})`;
                            toast(`<span class="t-ico">🪙</span> تغيّر السعر إلى ${arNum(now)} — اضغط للتأكيد`, 3600);
                            return;
                        }
                        if (buyHint(gameType)) await deliverHint(gameType);
                        else toast('<span class="t-ico">🪙</span> نقاطك غير كافية — العب واربح المزيد');
                        refresh();
                        if (window.__sura.refreshAccountStats) window.__sura.refreshAccountStats();
                        return;
                    }
                    const res = await deliverHint(gameType);
                    if (res && res.needBuy) {            // out of free hints → offer to buy
                        btn.dataset.buy = '1';
                        btn.dataset.buyPrice = String(res.price);
                        btn.classList.add('hint-buy');
                        btn.innerHTML = `<span class="hint-ico">🪙</span> اشترِ تلميحًا (${arNum(res.price)})`;
                        toast(`<span class="t-ico">🪙</span> رصيدك ${arNum(res.balance)} نقطة — اضغط لشراء تلميح بـ ${arNum(res.price)}`, 3600);
                        return;
                    }
                    refresh();
                } finally { busy = false; }
            });
        }
        modal._suraRefreshHint = refresh;
        // تبويبان. العدّادات في `localStorage` — مشتركةٌ بين التبويبات —
        // لكنّ الزرّ لا يُعاد رسمه إلّا في التبويب الذي تصرّف. فالتبويب
        // الثاني يعرض رصيدًا كان صحيحًا حين فُتحت نافذته: «تلميح ذكي (٣) 🎁»
        // والرصيد الحقيقيّ صفر (مقيسٌ في `fail.mjs §7`). الحالة سليمة
        // والرسم كاذب — وهذا يكفي: اللاعب يقرأ الرسم لا الحالة.
        if (!modal._suraStorageWired) {
            modal._suraStorageWired = true;
            window.addEventListener('storage', e => {
                if (!e.key || !/\b(hints|hintsbuy|hintfloor|coins)\b/.test(e.key)) return;
                if (btn.dataset.buy === '1') return;   // لا يُمحى عرضُ شراءٍ قائم
                refresh();
            });
        }
        refresh();
        return { refresh };
    }

    // ذاكرةُ تلميحاتٍ قصيرة لكل لعبة — الدرس الذي خرج من «كلمة»:
    // تلميحٌ يعيد ما يعرفه اللاعب ليس تلميحًا، وأكثر المزوِّدات كانت تختار
    // عشوائيًّا من المتبقّي فتُعيد الاقتراح نفسه مرّتين وتخصم مرّتين.
    // المزوِّد يسأل `take(key)`: تُرجع false إن سبق تقديمه. و`reset()` عند
    // كل لوحٍ جديد. واحدةٌ هنا خيرٌ من سبع مجموعاتٍ متفرّقة تنحرف.
    const memos = {};
    function memo(game) {
        if (!memos[game]) {
            const s = new Set();
            memos[game] = {
                has: k => s.has(String(k)),
                take(k) { const v = String(k); if (s.has(v)) return false; s.add(v); return true; },
                // لوحٌ جديد ⇒ تُمحى اللوحة أيضًا، وإلّا بقي تلميح اللوح
                // السابق معروضًا فوق لوحٍ لا يخصّه.
                reset() { s.clear(); clearHint(game); }
            };
        }
        return memos[game];
    }

    window.__sura.hints = {
        MAX: MAX_HINTS,
        register: (g, fn) => { providers[g] = fn; },
        registerCtx: (g, fn) => { ctxProviders[g] = fn; }, // safe context for the Groq hint
        left, used, trigger, deliverHint, mountChrome, memo,
        sessionHints: (g) => sessionUsed[g] || 0
    };
}
