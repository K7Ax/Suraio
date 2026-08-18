// scripts/qa/review_month.js — "show me the whole month" as one readable page.
//
// WHY THIS EXISTS: `/schedule` prints a status table and `/review` prints one
// row's gate verdicts, so the operator could see WHETHER a board passed but
// never the board itself. Approving on a green tick you cannot read is not the
// human approval Constitution §8 asks for — it is a rubber stamp. 186 boards
// also cannot be read in Telegram: the message cap is 4096 characters and the
// month is roughly forty times that.
//
// The page is generated from the SAME derivation the client uses
// (resolveDaily), not from a separate renderer, so what you read here is what a
// player gets — a second renderer would eventually disagree with the first and
// the review would be reviewing the wrong thing.
//
//   node scripts/qa/review_month.js 2026-08          -> review_2026-08.html
//
// Offline, no network, no database: the plan is a pure function of the date.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const arg = (process.argv[2] || "").trim();

const norm = s => String(s || "").normalize("NFC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim();

const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const WD = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const TIER = { easy: "سهل", medium: "متوسط", hard: "صعب", hardest: "التحدي الكبير" };
const TITLE = {
    wordle: "كَلِمة", connections: "تشابك", spelling_bee: "نحلة",
    amthal: "أمثال", lamha: "لمحة", warmer: "قرّبها",
};

// One renderer per game, showing the SOLUTION — this page is for the operator,
// never served to a player. That is also why it is written outside public/ and
// listed in .gitignore.
function renderBoard(game, p) {
    if (!p) return "<em>تعذّر الاشتقاق</em>";
    if (game === "wordle") {
        return `<div class="k">الكلمة</div><div class="v big">${esc(p.word)}</div>`
            + `<div class="k">التلميح</div><div class="v">${esc(p.hint)}</div>`;
    }
    if (game === "connections") {
        const g = (p.groups || []).map(x =>
            `<li><b>${esc(x.theme)}</b> <span class="dim">(${x.difficulty})</span><br>${esc((x.words || []).join(" · "))}</li>`).join("");
        const d = (p.decoys || []);
        return `<ol class="groups">${g}</ol>`
            + (d.length ? `<div class="k">مموّهات (${d.length})</div><div class="v">${esc(d.join(" · "))}</div>` : "");
    }
    if (game === "spelling_bee") {
        return `<div class="k">الحروف</div><div class="v big">${esc((p.letters || []).join(" "))}`
            + ` <span class="dim">— المركز: ${esc(p.center)}</span></div>`
            + `<div class="k">الكلمات (${(p.words || []).length})</div><div class="v">${esc((p.words || []).join(" · "))}</div>`;
    }
    if (game === "amthal") {
        return `<div class="k">المثل</div><div class="v big">${esc(p.proverb)}</div>`
            + `<div class="k">المعنى</div><div class="v">${esc(p.meaning)}</div>`;
    }
    if (game === "lamha") {
        return `<div class="k">الجواب</div><div class="v big">${esc(p.answer)}</div>`
            + `<div class="k">اللمحات</div><ol class="clues">${(p.clues || []).map(c => `<li>${esc(c)}</li>`).join("")}</ol>`
            + (p.explain ? `<div class="k">الشرح</div><div class="v dim">${esc(p.explain)}</div>` : "");
    }
    if (game === "warmer") {
        const t = p.tiers || {};
        return `<div class="k">الهدف</div><div class="v big">${esc(p.target)}`
            + ` <span class="dim">(${esc(p.theme || "—")})</span></div>`
            + ["0", "1", "2"].map(k => `<div class="k">قرب ${k}</div><div class="v">${esc((t[k] || []).join(" · "))}</div>`).join("")
            + `<div class="k">التلميحات</div><ol class="clues">${(p.hints || []).map(c => `<li>${esc(c)}</li>`).join("")}</ol>`;
    }
    return `<pre>${esc(JSON.stringify(p, null, 1))}</pre>`;
}

(async () => {
    const D = await import("../src/core/daily.mjs");
    const R = await import("../src/core/resolve.mjs");
    const C = await import("../src/core/checks.mjs");

    const m = /^(\d{4})-(\d{1,2})$/.exec(arg);
    if (!m) {
        console.error("الصيغة: node scripts/qa/review_month.js 2026-08");
        process.exitCode = 1;
        return;
    }
    const y = +m[1], mo = +m[2];

    const banks = {};
    for (const [g, f] of Object.entries(R.FETCHED_BANKS)) {
        banks[g] = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    }
    const dict = new Set(
        JSON.parse(fs.readFileSync(path.join(ROOT, "bank/words_ar.json"), "utf8")).map(norm));

    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const cards = [];
    let total = 0, bad = 0, warned = 0;
    // Repeat detection across the month, on the real signature — the number the
    // operator actually wants when asking «is anything wrong?» is not «did the
    // gates pass» but «am I shipping the same board twice in one month».
    const seen = new Map();

    for (let d = 1; d <= lastDay; d++) {
        const dateInt = y * 10000 + mo * 100 + d;
        const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const plan = D.dailyPlan(dateInt, R.DAILY_GAMES);
        const rows = [];
        for (const e of plan.entries) {
            total++;
            let res = null, v = { ok: false, errors: ["تعذّر الاشتقاق"], warnings: [], signature: null };
            try {
                res = R.resolveDaily(e, { norm, banks });
                v = C.check(e.game, res.puzzle, R.checkCtxFor(res, { norm, dict }));
            } catch (err) { v.errors = [err.message]; }
            if (!v.ok) bad++;
            if (v.warnings.length) warned++;

            const sig = e.game + "|" + (v.signature || "?");
            const prev = seen.get(sig);
            const dup = prev != null ? `تكرار: نفس لوح ${prev}` : null;
            if (prev == null) seen.set(sig, iso);

            rows.push(`<div class="card ${v.ok ? "" : "bad"}">
        <div class="head"><span class="game">${esc(TITLE[e.game] || e.game)}</span>
          <span class="badge">${v.ok ? "✅" : "❌"}</span>
          ${e.featured ? '<span class="star" title="لعبة الواجهة">★</span>' : ""}
        </div>
        <div class="body">${renderBoard(e.game, res && res.puzzle)}</div>
        ${v.errors.length ? `<div class="err">✗ ${v.errors.map(esc).join("<br>✗ ")}</div>` : ""}
        ${v.warnings.length ? `<div class="warn">⚠ ${v.warnings.map(esc).join("<br>⚠ ")}</div>` : ""}
        ${dup ? `<div class="warn">⚠ ${esc(dup)}</div>` : ""}
      </div>`);
        }
        cards.push(`<section class="day" id="d${d}">
      <h2>${iso} · ${WD[plan.weekday]} · <span class="tier t-${plan.tier.key}">${TIER[plan.tier.key]}</span>
        <span class="dim">نطاق ${plan.tier.band}</span></h2>
      <div class="grid">${rows.join("")}</div>
    </section>`);
    }

    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>مراجعة ${y}-${String(mo).padStart(2, "0")} — سُرى</title>
<style>
 :root{--bg:#0b1220;--card:#141d2e;--ink:#e8eef8;--dim:#8fa0bb;--ok:#3fb27f;--bad:#e05a5a;--warn:#e0a33e}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif;padding:24px}
 header{position:sticky;top:0;background:var(--bg);padding:12px 0 16px;border-bottom:1px solid #22304a;margin-bottom:20px;z-index:5}
 h1{margin:0 0 8px;font-size:22px}
 .sum{color:var(--dim);font-size:14px}
 .sum b{color:var(--ink)}
 .day{margin:0 0 28px}
 h2{font-size:17px;margin:0 0 10px;font-weight:600}
 .tier{padding:1px 8px;border-radius:99px;font-size:13px;background:#22304a}
 .t-hardest{background:#4a2230;color:#ffb4b4}
 .dim{color:var(--dim);font-weight:400;font-size:13px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
 .card{background:var(--card);border:1px solid #22304a;border-radius:12px;padding:12px;overflow-wrap:anywhere}
 .card.bad{border-color:var(--bad)}
 .head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
 .game{font-weight:700}
 .star{color:var(--warn)}
 .k{color:var(--dim);font-size:12px;margin-top:6px}
 .v{font-size:15px}
 .v.big{font-size:19px;font-weight:700}
 .groups,.clues{margin:6px 0;padding-inline-start:18px}
 .groups li{margin-bottom:6px}
 .err{color:var(--bad);font-size:13px;margin-top:8px}
 .warn{color:var(--warn);font-size:13px;margin-top:6px}
 pre{white-space:pre-wrap;font-size:12px;color:var(--dim)}
 @media print{body{background:#fff;color:#000}.card{border-color:#ccc;background:#fff}header{position:static}}
</style></head><body>
<header>
 <h1>مراجعة «تحدي اليوم» — ${y}-${String(mo).padStart(2, "0")}</h1>
 <div class="sum"><b>${total}</b> لوحًا · سقط في الفحص <b>${bad}</b> · بتحذير <b>${warned}</b>
  · الحلول ظاهرةٌ هنا عمدًا — هذه صفحة مُشغِّل، لا تُنشر.</div>
</header>
${cards.join("\n")}
</body></html>`;

    const out = path.join(ROOT, `review_${y}-${String(mo).padStart(2, "0")}.html`);
    fs.writeFileSync(out, html, "utf8");
    console.log(`REVIEW_OK ${path.basename(out)} — ${total} لوحًا · سقط ${bad} · تحذير ${warned}`);
})();
