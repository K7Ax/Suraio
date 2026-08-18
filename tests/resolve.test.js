// core/resolve + the rotation — the seam where a scheduled day becomes a board.
//
// Two failures this file exists to catch, both silent:
//   ١. البوت يفحص لوحًا والعميل يبني غيره. لا شيء يتعطّل — كلاهما يعمل — ولا
//      يُكتشف إلا حين يشتكي لاعبٌ من لغزٍ لم يمرّ بأي فحص.
//   ٢. الدوران ينكسر فيعود اللوح نفسه بعد أيام. يبدو صحيحًا في كل اختبارٍ آخر،
//      وهو بالضبط سبب «لا داعي أرجع بكرة».
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test";
const { normalizeArabic: norm } = require("../bot.js");
const ROOT = path.join(__dirname, "..");
const readJson = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

let D, C, R, banks, dict;
test("تحميل الوحدات والبنوك", async () => {
    D = await import("../src/core/daily.mjs");
    C = await import("../src/core/checks.mjs");
    R = await import("../src/core/resolve.mjs");
    banks = {};
    for (const [g, f] of Object.entries(R.FETCHED_BANKS)) banks[g] = readJson(f);
    dict = new Set(readJson("bank/words_ar.json").map(norm));
});

// Walk a year of real dates. `from` is a YYYYMMDD; iteration goes through day
// numbers so month lengths and leap years are the calendar's problem, not ours.
function eachDay(fromInt, n, fn) {
    const start = D.dayNumber(fromInt);
    for (let k = 0; k < n; k++) {
        const t = new Date((start + k) * 86400000);
        fn(t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate(), k);
    }
}

test("قائمة الألعاب اليومية هي عين LIVE_GAMES في الواجهة", () => {
    // لو أُظهرت لعبةٌ مخفيّة أو أُخفيت حيّة، فالبوت والموقع ينفصلان بصمت.
    assert.deepEqual(R.DAILY_GAMES, require("./helpers/live.js").LIVE_GAMES);
});

test("كل يومٍ في سنةٍ كاملة يُحَلّ ويعبر الفحص", () => {
    let rows = 0;
    const failures = [];
    eachDay(20260801, 365, (dateInt) => {
        for (const e of D.dailyPlan(dateInt, R.DAILY_GAMES).entries) {
            const res = R.resolveDaily(e, { norm, banks });
            const v = C.check(e.game, res.puzzle, R.checkCtxFor(res, { norm, dict }));
            rows++;
            if (!v.ok) failures.push(`${dateInt} ${e.game}: ${v.errors.join(" · ")}`);
        }
    });
    assert.equal(failures.length, 0, failures.slice(0, 5).join("\n"));
    assert.ok(rows > 600, `عدد الصفوف ${rows} أقلّ من المتوقّع`);
});

test("الحلّ حتميّ — نفس اليوم يعطي نفس اللوح", () => {
    eachDay(20260801, 40, (dateInt) => {
        for (const e of D.dailyPlan(dateInt, R.DAILY_GAMES).entries) {
            const a = R.resolveDaily(e, { norm, banks });
            const b = R.resolveDaily(D.dailyPlan(dateInt, R.DAILY_GAMES).entries.find(x => x.game === e.game), { norm, banks });
            assert.deepEqual(a.recipe, b.recipe, `${dateInt} ${e.game}`);
            assert.deepEqual(a.puzzle, b.puzzle, `${dateInt} ${e.game}`);
        }
    });
});

test("عدّاد الظهور يطابق العدّ المباشر", () => {
    // appearanceIndex تحسب بالدورات لا بالمرور على كل يوم. لو انحرفت الصيغة
    // المغلقة عن العدّ الفعليّ لانكسر الدوران كلّه بصمت.
    const live = R.DAILY_GAMES;
    for (const game of live) {
        for (const band of [0, 1, 2]) {
            let brute = 0;
            const from = D.dayNumber(20260801);
            for (let n = 0; n < from; n++) if (D.scheduledOn(n, game, band, live)) brute++;
            assert.equal(D.appearanceIndex(game, band, 20260801, live), brute, `${game} نطاق ${band}`);
        }
    }
});

test("الدوران يمشي على البنك بالترتيب ولا يعيد قبل استنفاده", async () => {
    // الضمانة الحقيقيّة: بين ظهورين متتاليين لنفس اللوح، تظهر كل ألواح النطاق.
    const beeBank = (await import("../src/core/banks.mjs")).BEE_BANK;
    const all = { ...banks, spelling_bee: beeBank };
    for (const [game, bank] of Object.entries(all)) {
        for (const band of [0, 1, 2]) {
            const n = R.bucketOf(bank, band).length;
            const seq = [];
            for (let t = 0; t < n * 3; t++) seq.push(R.pickDailyIndex(bank, band, t));
            // كل نافذةٍ بطول n تحوي n فهرسًا مختلفًا
            for (let i = 0; i + n <= seq.length; i++) {
                assert.equal(new Set(seq.slice(i, i + n)).size, n,
                    `${game} نطاق ${band}: تكرارٌ داخل دورةٍ واحدة`);
            }
        }
    }
});

test("الدوران يستنفد الدلو قبل أن يعود", () => {
    // هذا هو القياس الذي أسقط `seed % len`. وقد تغيّر معناه بعد أن صارت كل لعبة
    // تعمل كل يوم: الفجوة لم تعد خاصّةَ المُنتقي بل خاصّةَ حجم الدلو. فالمطلوب
    // إثباته هو أن الدوران يمشي الدلو كاملًا قبل أن يعود — وهو أقصى ما يملكه
    // مُنتقٍ، وما عداه شأن المحتوى لا شأن الشيفرة.
    const last = {}, minGap = {}, seen = {};
    eachDay(20260801, 365, (dateInt, k) => {
        for (const e of D.dailyPlan(dateInt, R.DAILY_GAMES).entries) {
            const res = R.resolveDaily(e, { norm, banks });
            const key = e.game + "|" + C.signature(e.game, res.puzzle, norm);
            if (last[key] != null) minGap[e.game] = Math.min(minGap[e.game] ?? Infinity, k - last[key]);
            last[key] = k;
            const bk = e.game + "|b" + e.band;
            (seen[bk] = seen[bk] || new Set()).add(key);
            // لا يُرى من الدلو أكثر ممّا فيه — وإلّا فالمُنتقي يخترع.
            // «تشابك» مستثناة: لوحها يُركَّب من تجمّع المجموعات بالبذرة
            // (assembleConnections) لا يُنتقى بفهرسٍ من دلو، فتوقيعاته أكثر من
            // حجم الدلو بطبيعة البناء لا بخللٍ في الانتقاء.
            if (res.bucketSize && e.game !== "connections") {
                assert.ok(seen[bk].size <= res.bucketSize,
                    `${e.game} نطاق ${e.band}: ألواحٌ أكثر من الدلو (${res.bucketSize})`);
            }
        }
    });
    // والفجوة الفعليّة مقيسةٌ لا مرجوّة: هذه أرقام سنةٍ كاملة بعد تحوّل «كل
    // الألعاب كل يوم». إن ارتفعت فقد نما البنك — وهو المراد.
    const floors = { wordle: 40, connections: 15, amthal: 20, warmer: 20, lamha: 14, spelling_bee: 14 };
    for (const [game, floor] of Object.entries(floors)) {
        assert.ok(minGap[game] === undefined || minGap[game] >= floor,
            `${game}: أقصر فجوة ${minGap[game]} يومًا والحدّ ${floor}`);
    }
    // كانت «نحلة» شاهدةَ العيب: دلو نطاق ٢ فيه لوحان، فتعود كل يومين، وكان هذا
    // السطر يؤكّد ذلك ليثبت أن العلّة في المحتوى لا في المُنتقي. صار بنكها ٤٢
    // لوحًا بواقع ١٤ لكل نطاق، فانتقلت إلى `floors` أعلاه كبقيّة الألعاب —
    // والشاهد لم يعد له ما يشهد عليه.
});

test("لم يبقَ نطاقٌ نحيل في أيّ بنك", () => {
    // كان هذا الاختبار يبحث عن نطاقٍ نحيلٍ ليتحقّق أنه يُحذَّر منه ولا يُرفَض،
    // وكان يحمل في نصّه: «لم يبقَ نطاقٌ نحيل — سُدَّت كل البنوك، فاحذف هذا
    // الاختبار». وقد سقط فعلًا في ٨ أغسطس ٢٠٢٦ حين سُدّ آخر نقص («قرّبها»
    // نطاق ٢: ١٣ → ١٤). فقُلب بدل أن يُحذَف: الفرضية صارت الثابت.
    //
    // الحساب الذي يجعله ثابتًا: النطاق الواحد يأخذ حتى ١٣ يومًا في الشهر
    // (النطاق الصعب يملك خميس·جمعة·سبت)، فبنكٌ فيه n عنصرًا يعطي 13−n إعادة.
    // ولهذا THIN_BUCKET = 14، ولهذا فسقوطُ هذا الاختبار يعني أن الشهر القادم
    // سيُعيد لوحًا على اللاعب — سواء انكمش بنكٌ أو أُضيفت لعبةٌ إلى الدوران
    // ببنكٍ ناقص.
    const thin = [];
    for (const e of D.dailyPlan(20260807, R.DAILY_GAMES).entries) {
        for (const band of [0, 1, 2]) {
            const res = R.resolveDaily({ ...e, band }, { norm, banks });
            if (res.bucketSize && res.bucketSize < C.THIN_BUCKET) {
                thin.push(`${e.game} نطاق ${band}: ${res.bucketSize} من ${C.THIN_BUCKET}`);
            }
        }
    }
    assert.deepEqual(thin, [], "بنوكٌ ناقصة تُعيد ألواحًا داخل الشهر: " + thin.join(" · "));
});

test("النحالة تُبلَّغ تحذيرًا لا رفضًا", () => {
    // والآلية نفسها ما زالت تحتاج اختبارًا بعد أن غاب مثالها الحقيقي: حجمُ
    // الدلو ليس عيبًا في اللوح، فلوحٌ سليمٌ يجب ألّا يسقط لأن إخوته قليلون —
    // لكن الشهر لا يجوز أن يُولَّد بصمتٍ وفيه إعادة. الدلو هنا مُصطنَع.
    const e = D.dailyPlan(20260807, R.DAILY_GAMES).entries.find(x => x.game === "wordle");
    const res = R.resolveDaily({ ...e, band: 0 }, { norm, banks });
    const ctx = R.checkCtxFor({ ...res, bucketSize: C.THIN_BUCKET - 1 }, { norm, dict });
    const v = C.check("wordle", res.puzzle, ctx);
    assert.equal(v.ok, true, "لوحٌ صحيحٌ يجب ألّا يسقط بسبب حجم البنك");
    assert.ok(v.warnings.some(w => w.includes("عنصر فقط")), "غاب تحذير النطاق النحيل");
});

test("الجمعة أصعب لا أسهل", () => {
    // ٢٠٢٦-٠٨-٠٧ جمعة، و٢٠٢٦-٠٨-٠٦ خميس — كلاهما نطاق ٢.
    const fri = D.dailyPlan(20260807, R.DAILY_GAMES);
    const thu = D.dailyPlan(20260806, R.DAILY_GAMES);
    assert.equal(fri.tier.key, "hardest");
    assert.equal(thu.tier.band, fri.tier.band, "كلاهما نطاق ٢ — وإلّا فالمقارنة باطلة");
    // كل الألعاب تعمل كل يوم الآن، ففرق الجمعة لم يعد «عدد الألعاب» بل المعدِّلات وحدها.
    assert.equal(fri.games.length, R.DAILY_GAMES.length);
    assert.equal(thu.games.length, R.DAILY_GAMES.length);
    const rf = R.resolveDaily(fri.entries.find(e => e.game === "connections"), { norm, banks });
    const rt = R.resolveDaily({ ...thu.entries[0], game: "connections", band: 2, turn: 0 }, { norm, banks });
    assert.ok(rf.recipe.decoys > rt.recipe.decoys, "الجمعة يجب أن تحمل مموّهاتٍ أكثر");
    assert.equal(fri.tier.freeFloorHint, false);
    assert.equal(thu.tier.freeFloorHint, true);
});

test("لعبةٌ غير مجدولة تفشل مغلقةً", () => {
    assert.throws(() => R.resolveDaily({ game: "sudoku", band: 0, seed: 1, turn: 0 }, { norm, banks }),
        /ليست لعبةً قابلة للجدولة/);
    assert.throws(() => R.resolveDaily({ game: "wordle", band: 0, seed: 1, turn: 0 }, {}),
        /norm/);
});

test("الوصفة لا تحمل الحلّ", () => {
    // الصفّ الخادميّ يخزّن recipe فقط. لو تسرّبت الكلمة أو المجموعات إليها،
    // لصار الردّ على العميل كاشفًا للحلّ قبل أن يلعب.
    eachDay(20260801, 30, (dateInt) => {
        for (const e of D.dailyPlan(dateInt, R.DAILY_GAMES).entries) {
            const res = R.resolveDaily(e, { norm, banks });
            const s = JSON.stringify(res.recipe);
            assert.ok(!/[؀-ۿ]/.test(s), `${dateInt} ${e.game}: عربيةٌ في الوصفة — ${s}`);
            for (const k of ["word", "groups", "words", "answer", "proverb", "target", "solution"]) {
                assert.ok(!(k in res.recipe), `${dateInt} ${e.game}: الوصفة تحمل «${k}»`);
            }
        }
    });
});

test("سقف الشهر يصمد على ثلاث سنوات", () => {
    const { MAX_MONTH_ROWS } = require("../bot.js");
    for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) {
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        let n = 0;
        for (let d = 1; d <= lastDay; d++) n += D.dailyPlan(y * 10000 + m * 100 + d, R.DAILY_GAMES).entries.length;
        assert.ok(n <= MAX_MONTH_ROWS, `${y}-${m}: ${n} صفًّا يتجاوز ${MAX_MONTH_ROWS}`);
    }
});
