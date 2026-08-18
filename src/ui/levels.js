// ============================================================
// Level campaign (Round 5). Each game is a self-paced ladder of 21
// numbered levels — 6 سهل · 9 متوسط · 6 صعب — each a fixed, designed
// board whose difficulty rises smoothly. Finish a level → you win →
// press «التالي ←» to climb to the next. No artificial side-conditions:
// the board itself is the test. The level is the difficulty unit
// (level-seeded, NOT date-seeded), so it is reproducible and fair.
// Per-uid progress via meta.read/write.
//
// ‏تصحيحُ رقمٍ عند النقل: الترويسةُ القديمة كانت تقول «٣ سهل · ٦ متوسط ·
// ‏١٢ صعب»، وهي قسمةُ الجولة الخامسة. `BANDS` في `core/progression.mjs`
// ‏صارت ٦/٩/٦ في إعادة تصميم التدرّج — والبصمةُ التقطت السلّم الحقيقيّ،
// فصُحّح الوصفُ ولم يُمَسَّ الحساب.
//
// ‏وهي تُسجّل `window.__sura.levels` و`.ranks` و`.rush`، وتقرأ
// ‏`window.__sura.meta` **وقتَ البناء** (أوّلُ سطرٍ فيها) — فموضعُ ندائها
// ‏بعد `initSuraMeta()` شرطٌ لا ترتيبُ ذوق.
// ============================================================
import * as P from '../core/progression.mjs';
import * as D from '../core/daily.mjs';
import * as FX from '../core/fx.js';
import { suraDailySeed } from '../core/util.js';
import { advanceStreak, streakAsOf } from '../core/streak.mjs';

// ‏`LOOM` وسيطٌ لا استيراد: كائنٌ حيٌّ واحدٌ يُبنى في `main.js`، واستيرادُ
// ‏`createLoom` هنا كان سيبني نَولًا ثانيًا ينسج في فراغ. القاعدة نفسها التي
// ‏تحكم `initSettings(PREFS)` و`initPhaseCopy(LOOM)`: الحالةُ تُمرَّر، والبياناتُ
// تُستورَد.
export function initLevels(LOOM) {
    const meta = window.__sura.meta;
    const arNum = (window.__sura.games && window.__sura.games.arNum) || (n => String(n));
    const cfgs = {};
    const bars = {};            // game -> { modal, refresh, showNext, hideNext }
    const read = (s, d) => meta.read(s, d);
    const write = (s, v) => meta.write(s, v);
    // Bands, seeding and bank-picking now live in core/progression.mjs so they
    // can be unit-tested without a DOM. This block just re-exposes them under
    // the names the rest of initLevels() already uses.
    const LEVELS = P.LEVELS, MAX = P.MAX, SALT = P.SALT;
    const clampLevel = P.clampLevel;
    const bandOf = P.bandOf, bandIndex = P.bandIndex, bandLabel = P.bandLabel;
    const levelInBand = P.levelInBand;

    // ---- progress state (v2) -------------------------------------------
    // Every level is playable at any time. A 21-bit mask records WHICH ones
    // are cleared, because with free navigation a player who clears L12
    // before L3 must still be credited. cleared() keeps its old contract —
    // the highest CONTIGUOUS cleared level, -1 when none — so the daily
    // strip, dashboard and share text read exactly what they always did.
    function mask(game) { return read(`lvl.${game}.mask`, 0) | 0; }
    function cleared(game) { return P.contiguousFrontier(mask(game)); }
    function frontier(game) { return Math.min(MAX, cleared(game) + 1); }   // next unseen level
    function playable(game) { return MAX; }                                 // kept: no caller breaks
    // Sequential ladder: a level is playable only once the one before it is
    // cleared. `frontier` is the single next level you may attempt; anything
    // beyond it is locked. Already-cleared levels stay replayable even if an
    // earlier gap exists (legacy holes from the old free-navigation era), so
    // the mask never hides a trophy the player already earned.
    // `__allLevels` هو حسابُ الاختبار وحده (انظر ALL_LEVELS_EMAIL): السلّم
    // مفتوحٌ له بالكامل، والقفل يعود بمجرّد الخروج لأن الرايةَ تُعاد ضبطها
    // مع كلّ تغيّر جلسة. وهذه بوّابةُ العرض فحسب — الخبرة تبقى بيد الخادم.
    function unlocked(game, lv) {
        if (window.__sura.__allLevels) return true;
        const l = clampLevel(lv); return l <= frontier(game) || P.maskHas(mask(game), l);
    }
    function level(game) {
        // In «تحدي اليوم» the level is the band's representative, not the
        // player's campaign position — that is what routes every existing
        // curve (diff, budget, bank bucket) to the day's difficulty with no
        // per-game code. See the daily seam further down. The campaign's
        // stored level is untouched and comes straight back on exit.
        if (inDaily(game)) return D.bandRepLevel(dailyCtx.band);
        const want = read(`lvl.${game}.level`, null);
        const lv = (want == null) ? frontier(game) : clampLevel(want);
        return unlocked(game, lv) ? lv : frontier(game);   // never sit on a locked level
    }
    // Set of games whose stored level is stale: the player cleared it but
    // left without pressing «التالي», so reopening dropped them back onto a
    // level they had already beaten while the picker showed it as cleared.
    // Applied on the next open (see mountControls) rather than immediately,
    // so the win screen still names the level that was just won.
    // Persisted, not in-memory: the player usually closes the tab between
    // the win and the next visit, which is exactly the case this fixes.
    function setPendingNext(game, v) { write(`lvl.${game}.pending`, v ? 1 : 0); }
    function pendingNext(game) { return !!read(`lvl.${game}.pending`, 0); }
    function setLevel(game, n) {
        let lv = clampLevel(n);
        if (!unlocked(game, lv)) lv = frontier(game);   // can't jump past the lock
        setPendingNext(game, 0);   // an explicit choice wins over the auto-advance
        write(`lvl.${game}.level`, lv); return lv;
    }
    function next(game) { const t = nextTarget(game); return setLevel(game, t < 0 ? level(game) : t); }
    // Where «المستوى التالي ←» should go. Normally one step forward, but with
    // free navigation a player can be sitting on L20 with L7 still open — so
    // fall back to the first remaining gap rather than a dead button.
    function nextTarget(game) {
        const m = mask(game), lv = level(game);
        if (lv < MAX && !P.maskHas(m, lv + 1)) return lv + 1;
        for (let i = 0; i <= MAX; i++) if (!P.maskHas(m, i)) return i;
        return -1;   // 21/21
    }
    // Call on win. Marks the current level cleared wherever it sits.
    function complete(game) {
        const lv = level(game), m = mask(game);
        const advanced = !P.maskHas(m, lv);
        const m2 = P.maskSet(m, lv);
        // ثبِّت المستوى الحاليّ قبل تحريك القناع. `level()` ترتدّ إلى
        // `frontier()` ما لم يُخزَّن مستوًى صراحةً — وهذا حال كلّ لاعبٍ جديد
        // لم يفتح المُنتقي قطّ. وبما أن الفوز يحرّك القناع، كانت الجبهة تتقدّم
        // فتتقدّم معها `level()` **في لحظة الفوز نفسها**، فيعلن الشريط المستوى
        // التالي بينما اللوح ما زال لوحَ المستوى السابق: «انتقلت لمستوى جديد
        // وتتكرر نفس المرحلة» (بلاغ المالك، ١٢ أغسطس ٢٠٢٦). الكتابة هنا تجعل
        // `level()` ساكنةً حتى ينتقل اللاعب بنفسه، وتُبقي `pendingNext` هي
        // وحدها صاحبةَ التقدّم — عند الفتح التالي كما صُمّمت.
        if (advanced) {
            write(`lvl.${game}.level`, lv);
            write(`lvl.${game}.mask`, m2);
            setPendingNext(game, 1);
        }
        const bandUp = advanced && lv < MAX && bandIndex(lv) !== bandIndex(lv + 1);
        window.__sura.dailyGoal && window.__sura.dailyGoal.mark(game, lv);
        // Server-authoritative credit: report the FIRST clear of this level to
        // the global leaderboard. Fire-and-forget — signed-in only, no-op for
        // anon (they keep local XP). The server owns XP/rank; the on-screen
        // number stays optimistic juice. Only `advanced` fires, so replays cost
        // no request (and the server is idempotent even if one slips through).
        if (advanced && window.__sura.games && window.__sura.games.submitProgress) {
            try {
                window.__sura.games.submitProgress({ game_type: game, level: lv }).then(r => {
                    // Once the server credits the clear, refresh the global board
                    // and the account standing live (no reload needed).
                    if (r && (r.credited || r.already)) {
                        if (window.__sura.refreshLeaderboard) window.__sura.refreshLeaderboard();
                        if (window.__sura.refreshStanding) window.__sura.refreshStanding();
                        return;
                    }
                    // ولا يُبتلع جسمُ الخطأ بعد اليوم. كان يُهمَل، فيلعب
                    // اللاعب حملةً كاملة ويرى نقاطه المحلّيّة ترتفع ولا
                    // يظهر في لوحة الصدارة أبدًا — بلا رسالةٍ ولا سطرٍ في
                    // الطرفيّة. أن يفشل الاحتساب أمرٌ، وأن يفشل صامتًا أمرٌ
                    // آخر: الأوّل عطبٌ يُصلَح، والثاني خيانةُ ثقة.
                    if (r && r.error === 'email_not_verified') {
                        meta.toast('<span class="t-ico">✉️</span> فعّل بريدك ليُحتسب تقدّمك في لوحة الصدارة');
                    } else if (r && r.error && r.error !== 'too_fast') {
                        window.__sura.reportError('submitProgress.rejected', new Error(String(r.error)), { game, level: lv });
                    }
                }).catch(() => { });
            } catch (e) { }
        }
        return {
            advanced, level: lv, bandUp,
            last: lv >= MAX,
            allDone: P.contiguousFrontier(m2) >= MAX
        };
    }

    // v1 → v2: seed the mask from the old scalar `cleared` plus retroactive
    // «مُتقِن» ranks, so a returning player's picker is a trophy shelf and
    // not blank. Additive and idempotent — nothing is ever lowered.
    function migrateV2() {
        const games = (meta.LIVE_GAMES || []);
        let touched = false;
        games.forEach(g => {
            const next = P.migrateProgressV2({
                v: read(`lvl.${g}.v`, 0),
                cleared: read(`lvl.${g}.cleared`, -1),
                mask: read(`lvl.${g}.mask`, 0),
                rank: read(`lvl.${g}.rank`, null)
            });
            if (!next) return;
            write(`lvl.${g}.mask`, next.mask);
            write(`lvl.${g}.rank`, next.rank);
            write(`lvl.${g}.v`, next.v);
            if (next.mask) touched = true;   // they actually had progress
        });
        if (touched && !read('lvl.seqNotice', 0)) {
            write('lvl.seqNotice', 1);
            setTimeout(() => meta.toast('<span class="t-ico">🪜</span> المستويات صارت تِباعية — تُفتح واحدًا تلو الآخر كل ما تكمّل السابق'), 1200);
        }
    }
    // Wait for the real uid — running earlier would migrate under `sura.anon.*`
    // and orphan a signed-in player's actual progress.
    (window.__sura.__uidReady || Promise.resolve()).then(migrateV2).catch(() => { });
    // Adopt the recorded daily streak as soon as we know who the player is, so
    // a returning member sees their real flame BEFORE they play rather than
    // watching a 0 jump to 12 after the first win.
    (window.__sura.__uidReady || Promise.resolve()).then(() => {
        const G = window.__sura.games;
        if (G && G.loadDailyStreak) G.loadDailyStreak().catch(() => { });
    }).catch(() => { });

    function register(game, cfg) { cfgs[game] = cfg; }
    function cfgOf(game) { return cfgs[game] || { mode: 'generated', diff: () => ({}) }; }
    function rulesOf(game) { return (cfgOf(game).rules) || ''; }

    // ====================================================================
    // «تحدي اليوم» — the daily seam
    // ====================================================================
    // A game asks for its board through exactly four calls: level(), then
    // levelSeed / diffFor / budgetFor / pickBankIndex with that level. So the
    // daily needs no per-game code at all — it substitutes what those four
    // return while one game is open in daily mode, and nothing else changes.
    //
    // THE 24-HOUR RULE, in the owner's words: «كل لغز حسب صعوبة يومه يجلس يوم
    // فقط ٢٤ ساعة ثم ينتهي وينزل الجديد، والموعد ١٢:٠٠ منتصف الليل». One live
    // day, no catch-up on yesterday, no preview of tomorrow. `dailyCtx.date`
    // is stamped on entry and re-checked on every read, so a tab left open
    // across midnight cannot keep playing an expired board.
    //
    // Midnight means 00:00 Asia/Riyadh — the clock suraDailySeed() and the
    // SQL side already share, so every player's day turns at the same instant.
    let dailyCtx = null;          // {date, game, band, seed, turn, mods, source}
    let dailyPlanCache = null;    // {date, plan}
    const dailyServer = {};       // date -> {expiresAt, entries:{game:recipe}}

    function todayInt() { return suraDailySeed(); }
    function planToday() {
        const d = todayInt();
        if (!dailyPlanCache || dailyPlanCache.date !== d) {
            dailyPlanCache = { date: d, plan: D.dailyPlan(d, meta.LIVE_GAMES || []) };
        }
        return dailyPlanCache.plan;
    }
    function dailyEntry(game) {
        return planToday().entries.find(e => e.game === game) || null;
    }
    // Expiry is checked HERE, not on a timer, because a timer can be throttled
    // in a background tab: the answer must be wrong-proof at the moment of use.
    function dailyLive() { return !!(dailyCtx && dailyCtx.date === todayInt()); }
    function inDaily(game) { return dailyLive() && dailyCtx.game === game; }
    // The level that stands in for the band, so every existing per-level curve
    // keeps working untouched in daily mode.
    function repLv(game, lv) { return inDaily(game) ? D.bandRepLevel(dailyCtx.band) : clampLevel(lv); }

    function diffFor(game, lv) { const c = cfgOf(game); return (c.diff ? c.diff(repLv(game, lv)) : {}) || {}; }
    // Same seed all day for everyone, and disjoint from every campaign seed by
    // construction (see dailySeed in core/daily.mjs).
    function levelSeed(game, lv) { return inDaily(game) ? dailyCtx.seed : P.levelSeed(game, lv); }
    // The daily walks a band's bucket in order by APPEARANCE COUNT, never by a
    // hash of the seed — the identical call the Telegram bot made when it
    // generated and gated this row weeks ago, so both sides build one board.
    function pickBankIndex(game, bank, lv, random) {
        if (!random && inDaily(game)) return D.pickDailyIndex(bank, dailyCtx.band, dailyCtx.turn);
        return P.pickBankIndex(game, bank, lv, random);
    }
    // Friday's «التحدي الكبير» tightens the budget — never below 3, because
    // running out is meant to be a finish with a rank, not a coin flip.
    function budgetFor(game, lv) {
        const b = P.budgetFor(game, repLv(game, lv));
        if (b && inDaily(game)) return Object.assign({}, b, { n: D.dailyBudget(b.n, dailyCtx.mods) });
        return b;
    }
    // تشابك's decoys belong to no group, so adding them widens the search
    // without ever creating a second valid solution.
    function decoysFor(game, lv) {
        const n = P.curves.connections.decoys(repLv(game, lv));
        return inDaily(game) ? D.dailyDecoys(n, dailyCtx.mods) : n;
    }

    // --- daily session state --------------------------------------------
    // Keyed by date, so yesterday's record neither blocks today nor lingers:
    // reading `daily.<date>.<game>` for a date that is over simply misses.
    function dailyKey(game, date) { return `daily.${date || todayInt()}.${game}`; }
    function dailyDone(game) { return !!read(dailyKey(game), 0); }

    // --- «السلسلة اليوميّة» ------------------------------------------------
    // Two layers, and the split is deliberate. The LOCAL one exists so an
    // anonymous or offline player has a streak at all — the daily is playable
    // signed out, and a flame that only lights for members would make the mode
    // feel gated. The SERVER one (daily_streaks, written only by submit-daily)
    // is the record: it survives a cleared browser and cannot be typed into
    // devtools. When both exist the server wins, and the local number is never
    // uploaded — that is the same rule the hint wallet will follow, and for the
    // same reason: letting localStorage mint server state kills the authority
    // on the day it is born.
    const STREAK_KEY = 'daily.streak';
    let serverStreakVal = null;   // {current, max} once submit-daily has answered
    function localStreak() { return read(STREAK_KEY, null) || { current: 0, max: 0, lastDay: 0 }; }
    // Read honestly: a streak whose last day is older than yesterday is already
    // broken, and showing it intact until the next play would be a lie the
    // player discovers at the worst moment.
    function streakNow() {
        if (serverStreakVal) return serverStreakVal;
        const s = localStreak();
        return { current: streakAsOf(s, todayInt()), max: Math.max(0, s.max | 0) };
    }
    // Called once per day, on the first daily FINISHED — not on entry, and not
    // per game: Friday's six games are still one day (advanceStreak is
    // idempotent on the date, so a second call is a no-op either way).
    function bumpStreak(game) {
        const next = advanceStreak(localStreak(), todayInt());
        if (next.changed) write(STREAK_KEY, { current: next.current, max: next.max, lastDay: next.lastDay });
        const G = window.__sura.games;
        if (G && G.submitDaily) {
            G.submitDaily(game).then(r => {
                // The server's answer replaces the optimistic local one — it is
                // the record. Fire-and-forget: a failed request never costs the
                // player the streak they can see.
                if (r && r.ok) { serverStreakVal = { current: r.current | 0, max: r.max | 0 }; refreshStreakUI(); }
            }).catch(() => { });
        }
        return next;
    }
    const streakWatchers = [];
    function refreshStreakUI() { streakWatchers.forEach(fn => { try { fn(streakNow()); } catch (e) { } }); }

    // ONE ticker for the whole app, and it exists only while a daily is open.
    // A per-modal interval would leave five idle timers running for a mode
    // nobody is in — the exact kind of background cost the perf pass removed.
    const dailyReRender = {};     // game -> repaint the HUD + rebuild the board
    let dailyTimer = null;
    function stopDailyTick() { if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; } }

    // والنافذة تُخفى ولا تُهدَم. فمن أغلق «تحدي اليوم» دون أن يخرج منه
    // ترك الساعة تدقّ كلّ ثانية على HUD لا يراه أحد — ساعةٌ تعمل في
    // غرفةٍ فارغة إلى أن يُغلق التبويب. فلتقف مع الإغلاق، ولتستأنف من
    // نفسها مع الفتح: `dailyCtx` باقٍ كما هو، فالعائد يعود إلى تحدّيه.
    const dailyWatched = new WeakSet();
    function dailyModal() {
        const b = dailyCtx && bars[dailyCtx.game];
        return (b && b.modal) || null;
    }
    function watchDailyModal(m) {
        if (!m || dailyWatched.has(m)) return;
        dailyWatched.add(m);
        new MutationObserver(() => {
            if (!dailyTimer && dailyCtx && m.classList.contains('active')) startDailyTick();
        }).observe(m, { attributes: true, attributeFilter: ['class'] });
    }

    function startDailyTick() {
        stopDailyTick();
        watchDailyModal(dailyModal());
        dailyTimer = setInterval(() => {
            if (!dailyCtx) return stopDailyTick();
            const m = dailyModal();
            watchDailyModal(m);   // النافذة قد تُركَّب بعد الدخول، فالمراقب يُثبَّت أوّل ما تظهر
            if (m && !m.classList.contains('active')) return stopDailyTick();
            const hud = dailyReRender[dailyCtx.game];
            if (!dailyLive()) {
                // Midnight passed with the tab open. The board the player is
                // looking at is over — say so and hand back the campaign
                // rather than letting an expired puzzle be finished.
                exitDaily();
                meta.toast('<span class="t-ico">🌅</span> انتهى تحدي أمس — نزل تحدي اليوم');
                if (hud) hud.rebuild();
                return stopDailyTick();
            }
            if (hud) hud.paint();
        }, 1000);
    }

    function enterDaily(game) {
        const e = dailyEntry(game);
        if (!e) return null;
        const date = todayInt();
        const srv = (dailyServer[date] && dailyServer[date].entries[game]) || null;
        // The server row is an OVERRIDE and a provenance record, never the
        // source: if it is missing, stale or unreachable, the derived plan is
        // already correct and the player never notices.
        dailyCtx = {
            date, game,
            band: srv && srv.band != null ? (srv.band | 0) : e.band,
            seed: srv && srv.seed != null ? (srv.seed | 0) : e.seed,
            turn: srv && srv.turn != null ? (srv.turn | 0) : e.turn,
            mods: e.mods,
            source: srv ? 'server' : 'derived'
        };
        startDailyTick();
        // لوحُ اليوم غير لوح الحملة، فتلميح ذاك لا يصلح لهذا.
        wipeHintPanel(game);
        if (window.__sura.track) window.__sura.track('daily_started', { game, metadata: { tier: e.mods.key, band: dailyCtx.band, source: dailyCtx.source } });
        return dailyCtx;
    }
    function exitDaily() {
        // والعكس كذلك: العائد إلى الحملة يعود إلى لوحٍ آخر.
        if (dailyCtx && dailyCtx.game) wipeHintPanel(dailyCtx.game);
        dailyCtx = null;
        stopDailyTick();
    }
    function dailyState(game) {
        const e = game ? dailyEntry(game) : null;
        const p = planToday();
        return {
            date: p.date, tier: p.tier, featured: p.featured, games: p.games.slice(),
            available: !!e, active: inDaily(game), done: game ? dailyDone(game) : false,
            msLeft: D.msLeft(p.date), expiresAt: D.dayEndMs(p.date)
        };
    }

    // ---- HUD icons -----------------------------------------------------
    // Drawn here as inline paths rather than shipped as files: four <svg>
    // nodes cost zero requests, stay sharp at any density, and — the reason
    // that actually decided it — inherit `currentColor`, so one CSS rule
    // tints all four gold on hover, amber when «تحدّي» is on, muted at rest.
    // A PNG can do none of that.
    //
    // Each one is a different IDEA, not the same shape with a different
    // glyph dropped in, and each is borrowed from something the site
    // already owns:
    //   شرح    — «الدرج», the stepped Sadu motif: walk up through it.
    //   قواعد  — the eight-pointed Najdi star: the fixed pattern, with the
    //            «i» mark inside it (dot ABOVE the stroke — dot below would
    //            read as an exclamation, which is a warning, not an offer).
    //   الصوت  — «العرجان», the running zigzag, growing as it travels; the
    //            muted state keeps the identical opening and cuts the rest.
    //   التحدّي — the misbaha in the navbar, one bead falling toward the rest.
    // Geometry stays inside a 20×20 safe area of the 24×24 box so the 30px
    // circle never clips it.
    const ICON = (d) => '<svg class="hud-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>';
    const ICONS = {
        // Rises leftward, the direction Arabic reads. TWO risers, not three:
        // at 17px a third step shrank every feature until the whole thing
        // read as a dotted diagonal rather than stairs (seen, not guessed).
        demo: ICON('<path d="M19.5 18.5H14V13H8.5V7.5H4.5"/><circle cx="19.5" cy="18.5" r="2" fill="currentColor" stroke="none"/>'),
        // The two squares sit as wide as the safe area allows, because a
        // smaller star packed its strokes together and filled in solid.
        rules: ICON('<path d="M5.2 5.2H18.8V18.8H5.2Z"/><path d="M12 2.4L21.6 12L12 21.6L2.4 12Z"/>'
            + '<circle cx="12" cy="9.2" r="1.05" fill="currentColor" stroke="none"/><path d="M12 11.9V15.6"/>'),
        sound: ICON('<path d="M3.5 12L6.5 9.4L9.5 14.6L12.5 6.8L15.5 17.2L18 12"/>'),
        // identical opening, then the thread is cut — not a slashed speaker
        muted: ICON('<path d="M3.5 12L6.5 9.4L9.5 14.6L11 11.8"/><path d="M15 9.5L20 14.5"/><path d="M20 9.5L15 14.5"/>'),
        // Three passes to get here, and the last change was the one that
        // mattered: the cord must NOT run through the beads. Drawn full
        // length it turned the pair into a pushpin. Now it is a bead, the
        // short length of thread it is travelling, and the bead it falls
        // toward — three separate marks, each big enough to survive 17px.
        rush: ICON('<circle cx="12" cy="5.8" r="2.7" fill="currentColor" stroke="none"/>'
            + '<path d="M12 10.2V13.2"/><circle cx="12" cy="18" r="3.4"/>'),
    };

    // ---- HUD: level bar + picker + «التالي ←» + ⓘ rules ----------------
    function mountControls(modal, game, opts) {
        opts = opts || {};
        const hud = modal && modal.querySelector('.sura-hud');
        if (!hud) return { refresh() { } };
        // Carry out an advance the player earned last session but never
        // confirmed, so opening a game always lands on where they actually
        // got to — not on the level they already cleared.
        if (pendingNext(game)) {
            setPendingNext(game, 0);
            const t = nextTarget(game);
            if (t >= 0 && t !== level(game)) write(`lvl.${game}.level`, t);
        }
        if (!hud.style.position) hud.style.position = 'relative';
        let bar = hud.querySelector('.lvl-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'lvl-bar';
            // Two visual groups, not one flat row of six. Left: what you DO
            // (where am I, change level, go next). Right: how it BEHAVES
            // (explain, rules, sound, challenge) — uniform icon buttons behind
            // a divider, so the primary actions stop competing with toggles.
            bar.innerHTML =
                '<div class="lvl-main">'
                + '<span class="lvl-info"></span>'
                + '<button type="button" class="lvl-pick-btn">المستويات</button>'
                + '<button type="button" class="lvl-next-btn hidden">المستوى التالي ←</button>'
                // Only appears on the days this game is actually scheduled —
                // Sat–Thu that is one game, Friday it is all six.
                + '<button type="button" class="lvl-daily-btn hidden" aria-pressed="false"></button>'
                + '</div>'
                + '<div class="lvl-tools">'
                + '<button type="button" class="demo-btn" title="شرح مرئي" aria-label="شرح مرئي">' + ICONS.demo + '</button>'
                + '<button type="button" class="rules-btn" title="قواعد اللعبة" aria-label="قواعد اللعبة">' + ICONS.rules + '</button>'
                + '<button type="button" class="mute-btn" title="الصوت" aria-label="الصوت"></button>'
                + '<button type="button" class="rush-btn" title="وضع التحدّي" aria-label="وضع التحدّي" aria-pressed="false">' + ICONS.rush + '</button>'
                + '</div>'
                + '<div class="lvl-picker hidden" role="menu" aria-label="اختر المستوى"></div>';
            hud.appendChild(bar);
            const picker = bar.querySelector('.lvl-picker');
            bar.querySelector('.demo-btn').addEventListener('click', () => { if (window.__sura.demo) window.__sura.demo.open(game); });
            bar.querySelector('.rules-btn').addEventListener('click', () => { if (window.__sura.rules) window.__sura.rules.open(game); });
            const muteBtn = bar.querySelector('.mute-btn');
            // `innerHTML` with a constant from `ICONS` — never player text.
            const paintMute = () => {
                const off = FX.muted();
                muteBtn.innerHTML = off ? ICONS.muted : ICONS.sound;
                muteBtn.classList.toggle('off', off);
                // `.ariaLabel` only landed in Safari 16.4; the site still
                // supports older iPhones, so set the attribute directly.
                muteBtn.title = off ? 'الصوت مطفأ' : 'الصوت يعمل';
                muteBtn.setAttribute('aria-label', muteBtn.title);
            };
            paintMute();
            muteBtn.addEventListener('click', () => { FX.setMuted(!FX.muted()); paintMute(); if (!FX.muted()) FX.sfx('tick'); });
            const rushBtn = bar.querySelector('.rush-btn');
            const paintRushBtn = () => {
                const on = timedOn(game);
                rushBtn.classList.toggle('on', on);
                rushBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            };
            paintRushBtn();
            rushBtn.addEventListener('click', () => {
                const on = setTimed(game, !timedOn(game));
                paintRushBtn();
                if (on) { meta.toast('<span class="t-ico">⏱</span> وضع التحدّي: أنهِ قبل الوقت لتكسب +٢٥٪ خبرة'); startTimer(game, modal); }
                else { stopTimer(game); meta.toast('<span class="t-ico">🧘</span> وضع التحدّي مطفأ — العب على راحتك'); }
            });
            bar.querySelector('.lvl-daily-btn').addEventListener('click', () => {
                if (inDaily(game)) exitDaily(); else if (!enterDaily(game)) return;
                picker.classList.add('hidden');
                if (opts.onChange) opts.onChange(level(game));
                if (bars[game]) bars[game].refresh();
            });
            bar.querySelector('.lvl-pick-btn').addEventListener('click', () => { picker.classList.toggle('hidden'); if (!picker.classList.contains('hidden')) buildPicker(); });
            // بلا `track('level_started')` هنا: `opts.onChange` تعيد بناء
            // اللوح، واللعبة تنادي `startLevel()` في نهاية `start()` —
            // فكان الحدث يُسجَّل مرّتين لكلّ تغيير مستوى. قِيس على حساب
            // المالك: ٥٨ حدثًا، **١٩ منها مكرّرٌ خلال ٣ ثوانٍ** من مثيله،
            // و«لعبتَ ٥٧» كان عدّ ضغطاتٍ لا عدّ ألعاب.
            // ‏`refresh()` هنا وفي المُنتقي أدناه: `.lvl-info` كان يُرسَم عند
            // التركيب وبعد الفوز فقط، فمن اختار مستوًى من المُنتقي لعب
            // المستوى ٢١ والشريطُ يقول له «المستوى ١». كُشف بمسح ٢١×٦
            // (المستوى يتغيّر، والكلمةُ السرّيّة تتغيّر، والشريطُ جامد).
            // وزرُّ «تحدي اليوم» كان ينادي `refresh()` أصلًا — فالسطران
            // التاليان يسدّان الطريقين اللذين فاتا، لا يخترعان نمطًا جديدًا.
            bar.querySelector('.lvl-next-btn').addEventListener('click', () => { const nl = next(game); picker.classList.add('hidden'); if (opts.onChange) opts.onChange(nl); refresh(); });
            picker.addEventListener('click', e => {
                const b = e.target.closest('button[data-lv]'); if (!b) return;
                const n = Number(b.dataset.lv);
                if (!unlocked(game, n)) { meta.toast('<span class="t-ico">🔒</span> أكمِل المستوى السابق ليُفتح هذا'); return; }
                setLevel(game, n); picker.classList.add('hidden');
                // ولا هنا — للسبب نفسه المشروح عند «التالي ←».
                if (opts.onChange) opts.onChange(n);
                refresh();
            });
        }
        const infoEl = bar.querySelector('.lvl-info');
        const nextBtn = bar.querySelector('.lvl-next-btn');
        const picker = bar.querySelector('.lvl-picker');
        // Sequential ladder: cleared levels show their medal, the frontier is
        // the one open next, and everything beyond it is a padlock until the
        // player earns their way there.
        function buildPicker() {
            const lv = level(game), m = mask(game);
            const ranks = read(`lvl.${game}.rank`, null) || {};
            // `unlocked()` تقرأ `frontier()` و`mask()`، وكلٌّ منهما
            // `localStorage.getItem` + `JSON.parse`. مناداتها داخل الحلقة
            // كانت ٤٢ قراءةً متزامنة لكلّ فتحةِ مُنتقٍ. الجبهة والقناع
            // ثابتان طوال البناء، فيُقرآن مرّةً.
            const f = frontier(game);
            // هذا السطر يكرّر منطق `unlocked()` بدل أن يناديه (للسبب أعلاه)،
            // فكلّ شرطٍ يُضاف هناك يجب أن يُعاد هنا — وإلا فُتحت البوّابة
            // وبقي المُنتقي يرسم أقفالًا. وقد وقع ذلك فعلًا: حساب الاختبار
            // فُتح له السلّم في `unlocked()` لكنّ الخلايا خرجت `disabled`
            // فلم يبلغ النقرُ المعالِجَ أصلًا (بلاغ المالك، ١٢ أغسطس ٢٠٢٦).
            const all = !!window.__sura.__allLevels;
            let html = '';
            for (let i = 0; i < LEVELS; i++) {
                const b = bandOf(i);
                const cls = ['lvl-cell', 'band-' + b.key];
                if (i === lv) cls.push('cur');
                const done = P.maskHas(m, i);
                if (done) cls.push('done');
                const locked = !(all || i <= f || done);
                if (locked) cls.push('locked');
                const mark = locked ? '🔒' : (done ? (P.TIERS[ranks[i] | 0] || P.TIERS[0]).icon : '');
                html += `<button type="button" class="${cls.join(' ')}" data-lv="${i}" role="menuitem"${locked ? ' disabled aria-disabled="true"' : ''}>${arNum(i + 1)}<span class="lvl-cell-mark">${mark}</span></button>`;
            }
            picker.innerHTML = html;
        }
        const dailyBtn = bar.querySelector('.lvl-daily-btn');
        const pickBtn = bar.querySelector('.lvl-pick-btn');
        // «متبقٍ ٥:٤٢:١٠». The board expires at 00:00 Asia/Riyadh whether or
        // not anyone is watching, so this is a readout, not the clock itself —
        // dailyLive() re-checks the date on every use and a throttled tab
        // cannot buy a player an extra minute.
        function countdown() {
            const ms = D.msLeft(todayInt());
            const s = Math.floor(ms / 1000);
            const two = n => arNum(n < 10 ? '0' + n : String(n));
            return `${arNum(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
        }
        function paintDailyBtn() {
            const st = dailyState(game);
            dailyBtn.classList.toggle('hidden', !st.available);
            if (!st.available) return;
            dailyBtn.classList.toggle('on', st.active);
            dailyBtn.setAttribute('aria-pressed', st.active ? 'true' : 'false');
            dailyBtn.textContent = st.active ? 'الحملة ←' : (st.done ? 'تحدي اليوم ✓' : 'تحدي اليوم');
            dailyBtn.title = st.active ? 'العودة إلى مستويات الحملة' : `تحدي اليوم «${st.tier.label}» — ينتهي منتصف الليل`;
        }
        function refresh() {
            paintDailyBtn();
            if (inDaily(game)) {
                const st = dailyState(game);
                // No level number here on purpose: in daily mode there is no
                // ladder position to report, and showing one would imply the
                // campaign moved. What matters is the day's difficulty and
                // how long is left.
                const sk = streakNow();
                const flame = sk.current > 0 ? ` · <span class="lvl-streak" title="سلسلتك اليوميّة">🔥 ${arNum(sk.current)}</span>` : '';
                infoEl.innerHTML = `<span class="lvl-num">تحدي اليوم</span> · <span class="lvl-band band-${bandOf(level(game)).key}">${st.tier.label}</span> · <span class="lvl-left" dir="ltr">${countdown()}</span>${flame}`;
                pickBtn.classList.add('hidden');
                nextBtn.classList.add('hidden');
                picker.classList.add('hidden');
                return;
            }
            pickBtn.classList.remove('hidden');
            const lv = level(game), b = bandOf(lv);
            infoEl.innerHTML = `<span class="lvl-num">المستوى ${arNum(lv + 1)}</span> · <span class="lvl-band band-${b.key}">${b.label} ${arNum(levelInBand(lv))}/${arNum(b.size)}</span>`;
            nextBtn.classList.add('hidden');
            if (!picker.classList.contains('hidden')) buildPicker();
        }
        // `paint` runs every second (the countdown); `rebuild` runs once, only
        // when the window closes under the player and the board must change.
        dailyReRender[game] = { paint: refresh, rebuild: () => { refresh(); if (opts.onChange) opts.onChange(level(game)); } };
        bars[game] = {
            modal, refresh,
            showNext() {
                if (opts.noHudNext) return; // game manages its own «next level» button
                const t = nextTarget(game);
                if (t < 0) { nextBtn.textContent = 'أكملت الكل 🎉'; nextBtn.disabled = true; }
                else if (t <= level(game)) { nextBtn.textContent = `أكمل المستوى ${arNum(t + 1)} ←`; nextBtn.disabled = false; }
                else { nextBtn.textContent = 'المستوى التالي ←'; nextBtn.disabled = false; }
                nextBtn.classList.remove('hidden');
            },
            hideNext() { nextBtn.classList.add('hidden'); }
        };
        refresh();
        // Provenance, not permission: the button is already correct from the
        // derived plan, so this only folds in a row the bot may have
        // regenerated. Fire-and-forget — the HUD never waits on the network.
        if (dailyEntry(game) && window.__sura.games && window.__sura.games.fetchDaily) {
            window.__sura.games.fetchDaily().then(paintDailyBtn).catch(() => { });
        }
        // Analytics: this is a modal OPEN, not a level attempt. Firing
        // level_started here counted every reopen as a fresh attempt and
        // inflated the denominator of every completion rate. Games call
        // startLevel() when a board actually begins.
        if (window.__sura.track) window.__sura.track('game_opened', { game, level: level(game) });
        // A first-timer gets the walkthrough without having to find the ▶ button.
        if (window.__sura.demo) window.__sura.demo.maybeAutoOpen(game, bar);
        return bars[game];
    }

    // لوحٌ جديد ⇒ تُمحى لوحة التلميح. كانت هذه الضمانة موكولةً إلى أن
    // تنادي كلُّ لعبةٍ `memo(game).reset()` في بداية `start()` — والتدقيق
    // أثبت أنّ **أربعًا من الستّ الحيّة لا تناديها**، فبقي تلميح اللوح
    // السابق معروضًا فوق لوحٍ لا يخصّه: لوحةٌ تقول «الحرف رقم 1 هو «ك»»
    // وجوابُ اللوح «ق». وتلميحٌ دُفع ثمنُه ثمّ كذب أسوأ من لا تلميح.
    //
    // فبدل انتظار أربع عشرة لعبةً تتذكّر عقدًا، تُمحى من المواضع الثلاثة
    // التي تعرف وحدها أنّ اللوح تبدّل: بدءُ مستوى، ودخولُ اليوميّ،
    // والخروجُ منه. ونداءات الألعاب تبقى كما هي — تصير بلا أثر، لا خطأ.
    function wipeHintPanel(game) {
        const H = window.__sura.hints;
        if (H && H.memo) { try { H.memo(game).reset(); } catch (e) { } }
    }

    // Call when a board actually begins (not when the modal opens). This is
    // the real denominator for every per-level completion rate.
    function startLevel(game, lv) {
        const n = (lv == null) ? level(game) : clampLevel(lv);
        const h = bars[game];
        wipeHintPanel(game);
        if (h && h.modal) { startTimer(game, h.modal); rushMount(h.modal, game); }
        if (window.__sura.track) window.__sura.track('level_started', { game, level: n, metadata: { timed: timedOn(game) ? 1 : 0 } });
        return n;
    }

    // The daily's own round-end. Same SHAPE as finish() — every game reads
    // `.rank`, `.tier`, `.advanced` off the return — but it touches no
    // campaign state at all: no mask, no rank ladder, no submit-progress.
    // `advanced` is false and `last` is false so no caller offers «التالي ←»;
    // there is no next level in a mode that is one board a day.
    function finishDaily(game, o) {
        const beat = o.won !== false && timedOn(game) && beatTimer(game);
        const peakRush = rushMax();
        stopTimer(game);
        const tier = P.tierFor(o.score01 == null ? 0.5 : o.score01);
        const st = dailyState(game);
        const first = o.won !== false && !dailyDone(game);
        if (o.won !== false) write(dailyKey(game), tier.idx + 1);   // +1: 0 is "not played"
        const h = bars[game];
        if (h) { h.refresh(); }

        if (o.won === false) { FX.sfx('wrong'); FX.haptic([30, 60, 30]); }
        else {
            FX.confetti(tier.idx >= 3 ? 140 : 80); FX.sfx(tier.idx >= 3 ? 'rank' : 'win'); FX.haptic([18, 50, 24]);
            LOOM.weaveRow();
            // «الجمعة العب كل الألعاب» reuses the combo tracker that already
            // exists rather than inventing a second one — marking the game
            // here is what makes «بطل سُرى 👑» fire on the hardest day.
            if (first) meta.combo.mark(game);
        }

        // The streak advances on the first FINISH of the day, win only — a day
        // you ran out of guesses is a day you showed up but did not clear it,
        // and a streak that survives losing measures nothing.
        const sk = (o.won !== false && first) ? bumpStreak(game) : null;
        if (sk) refreshStreakUI();

        // Ordered by rarity: the Friday crown outranks the flame, the flame
        // outranks the plain rank. One toast per round-end, never two stacked.
        if (o.won === false) {
            meta.toast(`<span class="t-ico">${tier.icon}</span> انتهت محاولاتك في تحدي اليوم — رتبتك: <b>${tier.name}</b>`);
        } else if (st.tier.key === 'hardest' && meta.combo.allDone()) {
            meta.toast('<span class="t-ico">👑</span> أنهيت ألعاب الجمعة كلها — بطل سُرى!');
        } else if (sk && sk.extended) {
            meta.toast(`<span class="t-ico">🔥</span> سلسلتك <b>${arNum(sk.current)}</b> ${sk.current >= 3 ? 'أيام متتالية' : 'يومان متتاليان'} — رتبتك: <b>${tier.name}</b>`);
        } else if (sk && sk.reset) {
            // Said kindly and once: the point is that they are back, not that
            // they lapsed. `current` is 1 here, never 0.
            meta.toast(`<span class="t-ico">🔥</span> بدأت سلسلةً جديدة — رتبتك: <b>${tier.name}</b>`);
        } else {
            meta.toast(`<span class="t-ico">${tier.icon}</span> تحدي اليوم «${st.tier.label}» — رتبتك: <b>${tier.name}</b>`);
        }
        if (beat) setTimeout(() => meta.toast('<span class="t-ico">⚡</span> سبقت الوقت!'), 900);
        // A separate name from level_completed on purpose: the daily runs at
        // the band's representative level, so folding it into the campaign
        // funnel would report levels 0/6/15 as far busier than they are and
        // skew the completion rates the Constitution's targets are read from.
        if (window.__sura.track) window.__sura.track('daily_finished', { game, metadata: { tier: st.tier.key, won: o.won !== false ? 1 : 0, rank: tier.idx, first: first ? 1 : 0 } });
        // بطاقة «تحدي اليوم» وشرائطها تُرسَم من `paint()`، وهي لا تعمل إلا
        // عند التحميل و**كلّ ٦٠ ثانية** وعند العودة إلى اللسان. فمن أنهى
        // تحدّيًا ثمّ أغلق النافذة فورًا لا يرى «✓» حتّى تمرّ الدقيقة.
        // بلاغ المالك (١٣ أغسطس): «كَلِمة» حطّت صح و«تشابك» لا — والسبب أنّ
        // بينه وبين «كَلِمة» سبع دقائق، وبينه وبين «تشابك» ثوانٍ. الحدث هنا
        // يجعل الرسم يتبع الإنجاز لا الساعة.
        document.dispatchEvent(new CustomEvent('sura:daily-done', { detail: { game } }));
        rushMiss();
        return {
            advanced: false, level: level(game), bandUp: false, last: false, allDone: false,
            daily: true, tier, rank: tier.idx, rankImproved: false, timed: beat, rushMax: peakRush
        };
    }

    // Call on a level win: records progress, updates the bar, reveals «التالي ←».
    function won(game) {
        if (inDaily(game)) return finishDaily(game, { won: true, score01: 0.5 });
        const res = complete(game);
        const h = bars[game];
        if (h) { h.refresh(); h.showNext(); }
        if (res.advanced) {
            const lv = res.level;
            if (res.allDone) meta.toast('<span class="t-ico">🏆</span> أكملت كل المستويات 21! بطل سُرى 🎉');
            else if (res.bandUp) meta.toast(`<span class="t-ico">🔓</span> فتحت مرحلة «${bandLabel(lv + 1)}»!`);
            else meta.toast(`<span class="t-ico">🏅</span> أكملت المستوى ${arNum(lv + 1)}! اضغط «المستوى التالي» للأصعب.`);
        }
        return res;
    }

    // ---- guess budgets --------------------------------------------------
    // A shared pip strip (● ● ● ○ ○) so every game reads the same way. The
    // budget is state the GAME owns; this just renders it and warns early —
    // amber at 2 left, one toast, and a free hint offered at 1. Surprise is
    // the enemy: a player who can see it coming never feels cheated.
    const budgets = {};   // game -> { n, left, label }
    function budgetOf(game) { return budgets[game] || null; }
    function mountBudget(modal, game, n, label) {
        const hud = modal && modal.querySelector('.sura-hud');
        if (!hud) return null;
        let el = hud.querySelector('.budget-strip');
        if (!el) { el = document.createElement('div'); el.className = 'budget-strip'; hud.appendChild(el); }
        budgets[game] = { n, left: n, label: label || 'محاولات', el, warned: false };
        paintBudget(game);
        return budgets[game];
    }
    function paintBudget(game) {
        const b = budgets[game]; if (!b || !b.el) return;
        let pips = '';
        for (let i = 0; i < b.n; i++) pips += (i < b.left ? '●' : '○');
        b.el.className = 'budget-strip' + (b.left <= 2 ? ' low' : '');
        b.el.innerHTML = `<span class="budget-label">${b.label}</span><span class="budget-pips">${pips}</span>`;
    }
    // Returns true when the budget just ran out.
    function spendBudget(game) {
        const b = budgets[game]; if (!b) return false;
        b.left = Math.max(0, b.left - 1);
        paintBudget(game);
        if (b.left === 0) return true;
        if (b.left <= 2 && !b.warned) {
            b.warned = true;
            meta.toast(`<span class="t-ico">⚠️</span> باقٍ ${arNum(b.left)} — خذ وقتك`);
            if (b.left === 1 && window.__sura.hints) meta.toast('<span class="t-ico">💡</span> تلميح هذا المستوى مجاني — استخدمه');
        }
        return false;
    }
    function resetBudget(game) {
        const b = budgets[game]; if (!b) return;
        b.left = b.n; b.warned = false; paintBudget(game);
    }

    // «حاول من جديد ↻» — free, same level, budget refilled. Every end state
    // gets one, so no round is ever a dead end.
    function showRetry(modal, game, onRetry) {
        const hud = modal && modal.querySelector('.sura-hud');
        if (!hud || !onRetry) return;
        let btn = hud.querySelector('.retry-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'retry-btn';
            hud.appendChild(btn);
        }
        btn.textContent = 'حاول من جديد ↻';
        btn.classList.remove('hidden');
        btn.onclick = () => { btn.classList.add('hidden'); resetBudget(game); onRetry(); };
    }
    function hideRetry(modal) {
        const btn = modal && modal.querySelector('.retry-btn');
        if (btn) btn.classList.add('hidden');
    }

    // Backdrop taps used to close a game instantly, discarding the round with
    // no confirm and no saved state. With a guess budget on the line that is
    // a rage-quit generator, so a round in progress asks first.
    function confirmClose(modal, midRound, close) {
        const doClose = () => { rushMiss(); if (rush.game) stopTimer(rush.game); close(); };
        if (!midRound) { doClose(); return; }
        let strip = modal.querySelector('.close-guard');
        if (!strip) {
            strip = document.createElement('div');
            strip.className = 'close-guard';
            strip.innerHTML = '<span>تبغى تطلع؟ الجولة بتضيع.</span>'
                + '<button type="button" class="cg-stay">أكمل</button>'
                + '<button type="button" class="cg-go">اخرج</button>';
            modal.appendChild(strip);
            strip.querySelector('.cg-stay').addEventListener('click', () => strip.classList.remove('show'));
        }
        strip.querySelector('.cg-go').onclick = () => { strip.classList.remove('show'); doClose(); };
        strip.classList.add('show');
        clearTimeout(strip._t);
        strip._t = setTimeout(() => strip.classList.remove('show'), 6000);
    }

    // ---- «تحدّي» timed mode ---------------------------------------------
    // Strictly OPT-IN and off by default, remembered per game. Expiry is NOT
    // a failure: the bonus is forfeited, the board stays fully playable, and
    // one calm message says so. It never consumes budget and never blocks
    // hints — it is a bonus layered on top, not a second way to lose.
    const RUSH_SECS = [180, 150, 120];
    const timers = {};   // game -> { id, endsAt, el, expired }
    function timedOn(game) { return !!read(`timed.${game}`, 0); }
    function setTimed(game, v) { write(`timed.${game}`, v ? 1 : 0); return !!v; }
    function stopTimer(game) {
        const t = timers[game];
        if (t) { clearInterval(t.id); if (t.el) t.el.remove(); }
        delete timers[game];
    }
    function startTimer(game, modal) {
        stopTimer(game);
        if (!timedOn(game)) return null;
        // Into .lvl-main so the clock reads next to "which level am I on",
        // not adrift among the toggle icons.
        const bar = modal && (modal.querySelector('.lvl-main') || modal.querySelector('.lvl-bar'));
        if (!bar) return null;
        const el = document.createElement('span');
        el.className = 'rush-clock';
        bar.appendChild(el);
        const secs = RUSH_SECS[bandIndex(level(game))];
        const t = { endsAt: Date.now() + secs * 1000, el, expired: false };
        timers[game] = t;
        const paint = () => {
            const leftMs = t.endsAt - Date.now();
            if (leftMs <= 0) {
                t.expired = true;
                clearInterval(t.id);
                el.textContent = '⏱ انتهى';
                el.classList.add('done');
                meta.toast('<span class="t-ico">⏱</span> انتهى وقت التحدّي — كمّل بهدوء، ما خسرت شيء');
                return;
            }
            const s = Math.ceil(leftMs / 1000);
            el.textContent = `⏱ ${arNum(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
            el.classList.toggle('low', s <= 20);
        };
        paint();
        t.id = setInterval(paint, 250);
        return t;
    }
    // true only when the round was both timed AND finished before expiry
    function beatTimer(game) {
        const t = timers[game];
        return !!(t && !t.expired);
    }

    // ---- rush: the in-session combo multiplier ---------------------------
    // Deliberately NOT meta.combo (that is the daily all-games tracker, a
    // different thing entirely). Never persisted: it resets on a miss and on
    // modal close, so it is pure in-the-moment momentum.
    const rush = { n: 0, el: null, game: null };
    function rushMult() { return 1 + Math.min(1, rush.n * 0.1); }   // ×1.0 → ×2.0 over 10
    function rushPaint() {
        if (!rush.el) return;
        if (rush.n < 2) { rush.el.classList.remove('show'); return; }
        rush.el.textContent = `×${rushMult().toFixed(1)} 🔥`;
        rush.el.classList.add('show');
    }
    function rushMount(modal, game) {
        const bar = modal && (modal.querySelector('.lvl-main') || modal.querySelector('.lvl-bar'));
        rush.n = 0; rush.game = game;
        if (!bar) { rush.el = null; return; }
        let el = bar.querySelector('.rush-chip');
        if (!el) { el = document.createElement('span'); el.className = 'rush-chip'; bar.appendChild(el); }
        rush.el = el; rushPaint();
    }
    function rushHit() {
        rush.n++;
        if (rush.n >= 2) FX.sfx('combo', rush.n);
        rushPaint();
        return rush.n;
    }
    function rushMiss() { rush.n = 0; rushPaint(); }
    function rushMax() { return rush.n; }

    // ---- rank tiers -----------------------------------------------------
    // Clearing a level is now only half the story: HOW WELL you cleared it
    // earns one of five tiers. Tier 0 is reachable by simply finishing, so a
    // round always ends with something.
    function ranksOf(game) { return read(`lvl.${game}.rank`, null) || {}; }
    function recordRank(game, lv, tierIdx) {
        const l = clampLevel(lv), all = ranksOf(game);
        const prev = all[l] == null ? -1 : all[l] | 0;
        if (tierIdx <= prev) return { tier: prev, improved: false };
        all[l] = tierIdx;
        write(`lvl.${game}.rank`, all);          // only ever raised
        return { tier: tierIdx, improved: true };
    }
    function bestRank(game, lv) { const r = ranksOf(game)[clampLevel(lv)]; return r == null ? -1 : r | 0; }
    function rankSummary() {
        const games = meta.LIVE_GAMES || [];
        let legendRanks = 0, maxGameCleared = 0, totalCleared = 0;
        games.forEach(g => {
            const n = P.maskCount(mask(g));
            totalCleared += n;
            if (n > maxGameCleared) maxGameCleared = n;
            const r = ranksOf(g);
            Object.keys(r).forEach(k => { if ((r[k] | 0) >= 4) legendRanks++; });
        });
        return { legendRanks, maxGameCleared, totalCleared };
    }

    // The ONE seam every game ends a round through — win or not. It records
    // the rank, advances the campaign on a win, and emits a SINGLE merged
    // toast (games used to fire their own alongside won()'s, and they
    // clobbered each other).
    function finish(game, o) {
        o = o || {};
        // FIRST LINE, deliberately: a daily round must never mark a campaign
        // level cleared. complete() writes the mask at level(game), which in
        // daily mode is the band's representative — so one Friday win would
        // silently gift the player L15. The daily is a separate mode; it
        // records its own result and leaves the ladder exactly where it was.
        if (inDaily(game)) return finishDaily(game, o);
        const lv = level(game);
        const beat = o.won !== false && timedOn(game) && beatTimer(game);
        const peakRush = rushMax();
        stopTimer(game);
        const tier = P.tierFor(o.score01 == null ? 0.5 : o.score01);
        const rec = recordRank(game, lv, tier.idx);
        const res = o.won === false
            ? { advanced: false, level: lv, bandUp: false, last: false, allDone: false }
            : complete(game);
        const h = bars[game];
        if (h) { h.refresh(); h.showNext(); }

        // one juice burst per round-end, scaled to how it went
        if (o.won === false) { FX.sfx('wrong'); FX.haptic([30, 60, 30]); }
        else {
            FX.confetti(tier.idx >= 3 ? 140 : 80); FX.sfx(tier.idx >= 3 ? 'rank' : 'win'); FX.haptic([18, 50, 24]);
            // The backdrop keeps score too: every win weaves one more row
            // into today's cloth, so a good day is visible behind the game.
            LOOM.weaveRow();
        }

        const medal = `${tier.icon} ${tier.name}`;
        if (o.won === false) {
            meta.toast(`<span class="t-ico">${tier.icon}</span> انتهت محاولاتك — رتبتك: <b>${tier.name}</b>`);
        } else if (res.allDone) {
            meta.toast('<span class="t-ico">🏆</span> أكملت كل المستويات 21! بطل سُرى 🎉');
        } else if (res.bandUp) {
            meta.toast(`<span class="t-ico">🔓</span> ${medal} — وفتحت مرحلة «${bandLabel(lv + 1)}»!`);
        } else if (res.advanced) {
            meta.toast(`<span class="t-ico">${tier.icon}</span> المستوى ${arNum(lv + 1)} — رتبتك: <b>${tier.name}</b>`);
        } else if (rec.improved) {
            meta.toast(`<span class="t-ico">${tier.icon}</span> رفعت رتبتك إلى <b>${tier.name}</b>!`);
        } else {
            meta.toast(`<span class="t-ico">${tier.icon}</span> أعدتها — رتبتك تبقى <b>${tier.name}</b>`);
        }
        if (beat) setTimeout(() => meta.toast('<span class="t-ico">⚡</span> سبقت الوقت! <small>+٢٥٪ خبرة</small>'), 900);
        rushMiss();   // momentum never carries across rounds
        return Object.assign({}, res, { rank: tier.idx, tier, rankImproved: rec.improved, timed: beat, rushMax: peakRush });
    }

    window.__sura.ranks = { TIERS: P.TIERS, tierFor: P.tierFor, record: recordRank, best: bestRank, bestMap: ranksOf, summary: rankSummary };
    // NOT meta.combo — that is the daily all-games tracker. This is momentum
    // within a single round and is never persisted.
    window.__sura.rush = { hit: rushHit, miss: rushMiss, mult: rushMult, max: rushMax };
    window.__sura.levels = {
        LEVELS, register, cfgOf, diffFor, rulesOf, levelSeed,
        level, setLevel, next, nextTarget, cleared, frontier, mask, playable, complete, won, finish, startLevel,
        bandOf, bandIndex, bandLabel, levelInBand, clampLevel, mountControls, pickBankIndex,
        budgetFor, decoysFor, mountBudget, spendBudget, resetBudget, budgetOf, showRetry, hideRetry, confirmClose,
        // «تحدي اليوم». `state()` is the only read a caller needs; `enter`
        // returns null when the game is not on today's schedule, so the call
        // site never has to ask twice.
        daily: {
            plan: planToday, state: dailyState, entry: dailyEntry,
            enter: enterDaily, exit: exitDaily, active: inDaily, live: dailyLive,
            done: dailyDone, msLeft: () => D.msLeft(todayInt()),
            // The daily streak. `streak()` is honest about a lapse (a stale
            // one reads 0, it is not shown intact until the next play).
            streak: streakNow,
            onStreak(fn) { if (typeof fn === 'function') { streakWatchers.push(fn); fn(streakNow()); } },
            // Adopt the server row on sign-in. NEVER the other way round: the
            // local number is a courtesy for anonymous play, not a source.
            adoptServerStreak(s) {
                if (!s) return;
                serverStreakVal = { current: s.current | 0, max: s.max | 0 };
                refreshStreakUI();
            },
            // Friday withdraws the free frontier hint — the one modifier that
            // actually bites, and the whole meaning of «التحدي الكبير».
            freeFloorHint: g => { const e = dailyEntry(g); return !e || e.mods.freeFloorHint !== false; },
            // Fold a fetched server response in. Never required: the plan is a
            // pure function of the date, so this only records provenance and
            // lets the bot override a row it regenerated.
            absorb(res) {
                if (!res || !res.entries) return;
                const d = Number(String(res.date || '').replace(/-/g, '')) || todayInt();
                const map = {};
                res.entries.forEach(e => { if (e && e.game) map[e.game] = Object.assign({ band: e.band }, e.recipe || {}); });
                dailyServer[d] = { entries: map, expiresAt: res.expires_at || null };
            }
        }
    };
}
