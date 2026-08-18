// core/daily — «تحدي اليوم»: the date-driven challenge that sits ALONGSIDE the
// 21-level campaign without touching it.
//
// WHY THIS EXISTS: the campaign is level-seeded on purpose (progression.mjs:59)
// — the same board for everyone, forever, so progress is reproducible. That is
// the right model for a ladder you climb at your own pace, and the wrong model
// for a reason to come back tomorrow: nothing about the site changes when the
// date does. This module supplies the missing axis. It never reads or writes
// campaign state; `initLevels` picks one or the other per open game.
//
// Everything here is a PURE FUNCTION OF THE DATE. That is a deliberate
// guarantee, not a convenience: the client can always derive today's plan with
// no network at all, so a signed-out or offline player gets the identical
// board. The server row (table `daily_challenge`) is an override and a
// provenance record — never the source of the board.
//
// .mjs for the same reason as progression.mjs: node can import it in tests
// while esbuild still bundles it normally.

import { BANDS, SALT } from './progression.mjs';

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
// Dates arrive as the YYYYMMDD integer the whole app already speaks
// (`suraDailySeed()` in core/util.js), which is ALREADY a Riyadh-local date.
// So there is no timezone maths here — converting it back through a Date would
// only reintroduce the offset bug it was built to avoid.

// Days since 1970-01-01. Used instead of the raw YYYYMMDD wherever we take a
// modulo: YYYYMMDD jumps by ~70 at every month boundary, so `YYYYMMDD % 6`
// visits some games ~15% more often than others. A day counter is contiguous.
export function dayNumber(dateInt) {
    const n = dateInt | 0;
    const y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100;
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// 0 = Sunday … 6 = Saturday. 1970-01-01 (day 0) was a Thursday, hence +4.
export function weekdayOf(dateInt) {
    return (((dayNumber(dateInt) + 4) % 7) + 7) % 7;
}

// ---------------------------------------------------------------------------
// The 24-hour window
// ---------------------------------------------------------------------------
// «كل لغز يجلس يوم فقط ٢٤ ساعة ثم ينتهي وينزل الجديد، والموعد ١٢:٠٠ منتصف الليل».
//
// The whole app already speaks ONE clock — `suraDailySeed()` shifts by +3h and
// takes the calendar date, i.e. Riyadh (UTC+3, no DST ever). The SQL side says
// the same thing a second way: `(now() at time zone 'Asia/Riyadh')::date`. So
// "midnight" here is unambiguous: **00:00 Asia/Riyadh**, the same instant for a
// player in Jeddah and one in Berlin. A local-midnight rule would hand some
// players tomorrow's board eleven hours early and split the leaderboard.
//
// These are the only functions in this file that read the wall clock, and they
// take `nowMs` so the tests never have to.
export const RIYADH_OFFSET_MS = 3 * 3600000;
export const DAY_MS = 86400000;

// Today's YYYYMMDD in Riyadh. Identical to suraDailySeed() by construction —
// it is that function with the clock injected.
export function dateIntAt(nowMs) {
    const k = new Date((nowMs == null ? Date.now() : nowMs) + RIYADH_OFFSET_MS);
    return k.getUTCFullYear() * 10000 + (k.getUTCMonth() + 1) * 100 + k.getUTCDate();
}

// UTC epoch-ms of 00:00 Riyadh on that date — the instant the puzzle DROPS.
export function dayStartMs(dateInt) { return dayNumber(dateInt) * DAY_MS - RIYADH_OFFSET_MS; }
// …and of the following midnight — the instant it EXPIRES. Exactly 24h later,
// with no DST case to get wrong.
export function dayEndMs(dateInt) { return dayStartMs(dateInt) + DAY_MS; }

// Milliseconds left in the day's window; 0 once it has expired (never negative,
// so a countdown can render it without a guard).
export function msLeft(dateInt, nowMs) {
    return Math.max(0, dayEndMs(dateInt) - (nowMs == null ? Date.now() : nowMs));
}

// Is this date the one live window? The daily is a SINGLE day — no catch-up on
// yesterday, no preview of tomorrow. Both halves matter: yesterday's board is
// over (that is the point of a 24-hour puzzle), and tomorrow's is unpublished
// content that must never leak.
export function isLive(dateInt, nowMs) { return (dateInt | 0) === dateIntAt(nowMs); }

// ---------------------------------------------------------------------------
// Issue identity — رقم العدد، واليوم باسمه
// ---------------------------------------------------------------------------
// «واكتب عند عدد اليوم، اليوم، والصعوبة» (المالك، ١٢ أغسطس ٢٠٢٦). النشرة كانت
// تقول «عدد اليوم» بلا رقمٍ يميّزه عن عدد أمس — واسمٌ بلا رقمٍ ليس عددًا.
//
// العدد الأوّل هو أوّل يومٍ نُشر فيه «تحدي اليوم» فعلًا: ١ أغسطس ٢٠٢٦. اختيارٌ
// لا اكتشاف، ولذلك هو ثابتٌ مُصدَّر يُقرأ ويُختبر بدل أن يكون رقمًا سحريًّا.
// وقبل ذلك التاريخ يبقى الرقم موجبًا محسوبًا للخلف، فلا يظهر «العدد ٠−» أبدًا.
export const ISSUE_EPOCH = 20260801;

export function issueNumber(dateInt) {
    return Math.max(1, dayNumber(dateInt) - dayNumber(ISSUE_EPOCH) + 1);
}

// ٠ = الأحد … ٦ = السبت، بترتيب `weekdayOf` نفسه.
export const WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export function weekdayName(dateInt) { return WEEKDAY_AR[weekdayOf(dateInt)]; }

// تاريخٌ بعد `k` يومًا (أو قبله إن كان سالبًا). يمرّ بعدّاد الأيّام لا بحساب
// الأرقام على YYYYMMDD مباشرةً — وإلّا كسر أوّلُ يومٍ في الشهر الحساب.
export function shiftDate(dateInt, k) {
    return dateIntAt(dayStartMs(dateInt) + (k | 0) * DAY_MS + 1);
}

// نافذةُ أسبوع: ثلاثةٌ قبل، واليوم في الوسط، وثلاثةٌ بعد (اختيار المالك:
// «أسبوع كامل»). لا تُرجع حلولًا ولا وصفات — الصعوبة وحدها معلومةٌ يجوز
// نشرها مسبقًا لأنها مشتقّةٌ من اليوم، بينما اللوح نفسه محتوى غير منشور.
export function weekAround(dateInt, before = 3, after = 3) {
    const out = [];
    for (let k = -before; k <= after; k++) {
        const d = shiftDate(dateInt, k);
        out.push({
            date: d,
            offset: k,
            today: k === 0,
            past: k < 0,
            weekday: weekdayOf(d),
            weekdayName: weekdayName(d),
            issue: issueNumber(d),
            tier: tierFor(d)
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------
// FOUR tiers over THREE bands — and there is no fourth band, by design.
//
// The obvious way to express "Friday is the hardest" is BANDS[3]. It breaks
// four things at once, quietly:
//   1. pickBankIndex (progression.mjs:66) filters on `item.difficulty === band`,
//      and every bank file carries only 0/1/2 — so band 3 selects an EMPTY pool
//      and falls back to the whole bank. Friday would come out EASIER.
//   2. Five curve tables are 3-element arrays indexed by band (curves.wordle
//      .wordLen, connections.lives, BUDGETS.*, RUSH_SECS, BAND_XP in
//      submit-progress) — band 3 reads `undefined` in all of them.
//   3. The CSS classes band-easy|medium|hard have no fourth member.
//   4. XP and rank would need a new tier server-side, splitting the leaderboard.
//
// So Friday is band 2 wearing modifiers. The one that actually bites is
// `freeFloorHint: false`: the free hint on your frontier level (main.js:3632)
// is the guarantee that no level is ever a wall. Withdrawing it — and only on
// Friday — is precisely what «التحدي الكبير» should mean.
export const DAILY_TIERS = {
    easy:    { key: 'easy',    label: 'سهل',   band: 0, budgetMul: 1.00, freeFloorHint: true,  decoyBonus: 0 },
    medium:  { key: 'medium',  label: 'متوسط', band: 1, budgetMul: 1.00, freeFloorHint: true,  decoyBonus: 0 },
    hard:    { key: 'hard',    label: 'صعب',   band: 2, budgetMul: 1.00, freeFloorHint: true,  decoyBonus: 0 },
    hardest: { key: 'hardest', label: 'التحدي الكبير',
                                              band: 2, budgetMul: 0.70, freeFloorHint: false, decoyBonus: 4 }
};

// أحد·اثنين سهل · ثلاثاء·أربعاء متوسط · خميس·سبت صعب · جمعة التحدي الكبير
const TIER_BY_WEEKDAY = ['easy', 'easy', 'medium', 'medium', 'hard', 'hardest', 'hard'];

export function tierKeyFor(weekday) { return TIER_BY_WEEKDAY[((weekday % 7) + 7) % 7]; }
export function tierFor(dateInt) { return DAILY_TIERS[tierKeyFor(weekdayOf(dateInt))]; }

// ---------------------------------------------------------------------------
// Modifier application
// ---------------------------------------------------------------------------
// Named helpers rather than one generic object-merger, because each modifier
// has a floor that matters and a generic merge would silently drop it.

// Never below 3: a budget of 1–2 is not a challenge, it is a coin flip, and
// running out is supposed to be a FINISH (a rank + partial XP), not a loss.
export function dailyBudget(n, tier) {
    const base = Number(n) || 0;
    if (!base || !tier) return base;
    return Math.max(3, Math.round(base * tier.budgetMul));
}

// Decoys belong to no group, so adding them widens the search without ever
// creating a second valid solution — the one lever that raises تشابك's
// difficulty while keeping the Constitution's "single intended solution".
export function dailyDecoys(n, tier) {
    return Math.max(0, (Number(n) || 0) + ((tier && tier.decoyBonus) || 0));
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

// Which game is today's headline. Takes the live list as an ARGUMENT rather
// than importing it, so a game the owner un-hides later joins the rotation with
// no edit here — and so this stays testable without touching main.js.
export function featuredGame(dateInt, liveGames) {
    const list = (liveGames && liveGames.length) ? liveGames : ['wordle'];
    return list[((dayNumber(dateInt) % list.length) + list.length) % list.length];
}

// Fixed seed per (game, date). Disjoint from the campaign by construction:
// levelSeed maxes out at SALT_max*1000 + 20*7919 = 1_689_380, while
// dayNumber*7919 passed 2_000_000 in 1970 and is ~163_000_000 today. So a
// daily board can never coincide with a campaign board a player has climbed.
export function dailySeed(game, dateInt) {
    return (SALT[game] || 1) * 1000 + dayNumber(dateInt) * 7919;
}

// The whole day in one object. `games` is a single-item list Sat–Thu and the
// full live roster on Friday — «يوم الجمعة العب كل الألعاب».
export function dailyPlan(dateInt, liveGames) {
    const date = dateInt | 0;
    const list = (liveGames && liveGames.length) ? liveGames.slice() : ['wordle'];
    const tier = tierFor(date);
    const featured = featuredGame(date, list);
    // EVERY LIVE GAME, EVERY DAY, at that weekday's difficulty.
    //
    // This used to be one rotating game a day (Friday excepted), which meant a
    // player who opened «قرّبها» on a Tuesday found nothing there — the daily was
    // «تشابك» that day. A daily mode that is dark for five games out of six is not
    // a daily mode; it is a rota. `featured` survives as the one game the home
    // card highlights (and the one `daily_challenge_one_featured` allows per
    // date), but it no longer decides who PLAYS.
    const games = list;
    return {
        date,
        weekday: weekdayOf(date),
        tier,
        featured,
        games,
        // `turn` is carried on the entry because dailyPlan is the one place that
        // knows the roster — a resolver holding only {game, band, seed} could not
        // recompute it, and passing the roster down twice invites the two copies
        // to disagree. See the rotation note at the foot of this file.
        entries: games.map(game => ({
            game,
            band: tier.band,
            seed: dailySeed(game, date),
            turn: appearanceIndex(game, tier.band, date, list),
            mods: tier,
            featured: game === featured
        }))
    };
}

// A representative level inside a band, so every existing per-LEVEL curve
// (curves.*, BUDGETS.*) keeps working untouched when a game runs in daily mode.
//
// It used to return `b.start` — the band's FLOOR — which made «صعب» mean level
// 15 of 15–20, i.e. the easiest hard day there is, and «متوسط» mean 6 of 6–14.
// Every daily was the gentlest rung of its own band, and the owner felt it
// before the numbers showed it. The daily is one board a day for a player who
// chose to come, not a ladder to climb, so it belongs at the band's CEILING:
// 5 / 14 / 20. That also gives Friday somewhere to stand — L20 carrying
// ×0.70 budget and no free floor hint is the hardest thing in the product,
// which is what «التحدي الكبير» was always supposed to name.
export function bandRepLevel(band) {
    const b = BANDS[Math.max(0, Math.min(BANDS.length - 1, band | 0))];
    return b.start + b.size - 1;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------
// HOW OFTEN A DAILY MAY REPEAT ITSELF — and why this is not `seed % bankSize`.
//
// I built the selection as a hash of the day's seed first, then measured it over
// 120 days against the reuse windows in core/checks.mjs. It failed badly: «نحلة»
// repeated a board after 6 days, «لمحة» after 8. A hash SAMPLES a bank, it does
// not CYCLE one — nothing stops it landing on the same index twice in a row, and
// with 8 bee boards (2–3 per band) the birthday maths makes that near-certain.
//
// The fix is to count, not to hash. `appearanceIndex` answers "how many times has
// this game already run at this difficulty?" purely from the date, and the
// selector takes that modulo the bucket size — so the bucket is walked in order
// and a board cannot return until every one of its peers has been used. The gap
// between repeats stops being luck and becomes a property of the schedule.
//
// It stays a pure function of the date (the offline guarantee holds) because the
// schedule is periodic: game g is featured when dayNumber % L === i, Friday is
// dayNumber % 7 === 1, and both bands and tiers are fixed per weekday. So the
// whole calendar repeats every lcm(7, L) days. We count one period exactly, then
// brute-force the remainder — at most 41 iterations, and no CRT to get wrong.

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Is (game, band) on the schedule for this day number?
export function scheduledOn(dayNum, game, band, liveGames) {
    const list = (liveGames && liveGames.length) ? liveGames : ['wordle'];
    const n = dayNum | 0;
    const wd = (((n + 4) % 7) + 7) % 7;
    const tier = DAILY_TIERS[tierKeyFor(wd)];
    if (tier.band !== (band | 0)) return false;
    // Every live game runs every day now, so «is it scheduled?» collapses to «is
    // today's band this band?». The weekday-index selection that used to pick one
    // game is gone; keeping it here would have made `turn` count a sixth of the
    // real appearances and the rotation would revisit a board six times sooner
    // than the counter believed.
    return list.indexOf(game) >= 0;
}

// The indices a band may draw from. Falls back to the whole bank when a bucket
// is empty — same rule as pickBankIndex, so a bank that loses its hard items
// degrades rather than throws. Its LENGTH is what the checker reports, because a
// bucket of one or two is the real cause of a daily that repeats itself, and no
// amount of cleverness in the selector can compensate for it.
export function bucketOf(bank, band) {
    if (!bank || !bank.length) return [];
    const pool = [];
    bank.forEach((b, i) => {
        const d = (b && b.difficulty != null) ? b.difficulty : 1;
        if (d === (band | 0)) pool.push(i);
    });
    return pool.length ? pool : bank.map((_, i) => i);
}

// Deterministic pick inside a band's bucket, from the appearance counter — NOT
// the seed. Lives here beside `appearanceIndex` (rather than in resolve.mjs,
// which imports every bundled bank) so the browser can reproduce the bot's
// choice by importing this file alone.
export function pickDailyIndex(bank, band, turn) {
    const list = bucketOf(bank, band);
    if (!list.length) return 0;
    return list[(((turn | 0) % list.length) + list.length) % list.length];
}

// How many times (game, band) ran strictly BEFORE this date. Exact, O(period).
export function appearanceIndex(game, band, dateInt, liveGames) {
    const list = (liveGames && liveGames.length) ? liveGames : ['wordle'];
    if (list.indexOf(game) < 0) return 0;
    const N = dayNumber(dateInt);
    if (N <= 0) return 0;
    const period = 7 * list.length / gcd(7, list.length);
    let perPeriod = 0;
    for (let k = 0; k < period; k++) if (scheduledOn(k, game, band, list)) perPeriod++;
    const full = Math.floor(N / period);
    let tail = 0;
    for (let k = full * period; k < N; k++) if (scheduledOn(k, game, band, list)) tail++;
    return full * perPeriod + tail;
}
