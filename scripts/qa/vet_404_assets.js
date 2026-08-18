// فحص طبقات «الطَّلل» قبل التركيب — الشروط الستّة في
// `prompts/404_tallal_image_prompts.md §6`، مقيسةً لا منظورًا إليها.
//
// السبب أن هذا ملفٌّ لا فحصٌ بالعين: كل عطبٍ هنا يظهر **بعد** التركيب لا قبله
// (هالة قصٍّ بعرض بكسلين، أسودٌ ليس أسود، حافّة لا تلمس الطرف)، وعندها يكون
// الثمن إعادة توليدٍ ودورة كاملة.
//
//   node scripts/qa/vet_404_assets.js
"use strict";
const sharp = require("sharp");
const path = require("node:path");
const fs = require("node:fs");

const DIR = path.join(__dirname, "..", "..", "_design-src", "tallal");

// ما نتوقّعه لكل طبقة. `edges` = يجب أن تلمس الحافّتين (تُكبَّر ١٫٧٥× عموديًّا).
// `black` = تُركَّب بـscreen فخلفيّتها أسود صافٍ لا شفافيّة.
const SPEC = {
    "ridge.png":      { w: 3840, h: 1080, alpha: true,  edges: true,  warm: false },
    "ground.png":     { w: 3840, h: 1600, alpha: true,  edges: true,  warm: false },
    "hearth.png":     { w: 2048, h: 1536, alpha: true,  edges: false, warm: false },
    "trace.png":      { w: 3072, h: 1536, alpha: true,  edges: false, warm: false },
    "stone-near.png": { w: 1536, h: 1536, alpha: true,  edges: false, warm: false },
    "ember.png":      { w: 1024, h: 1024, alpha: false, edges: false, warm: true, black: true }
};

const pct = n => (n * 100).toFixed(1) + "%";

(async () => {
    let fail = 0, warn = 0;
    for (const [name, spec] of Object.entries(SPEC)) {
        const file = path.join(DIR, name);
        const say = (lvl, msg) => { console.log(`   ${lvl} ${msg}`); if (lvl === "✖") fail++; else if (lvl === "⚠") warn++; };
        console.log(`\n── ${name}`);
        if (!fs.existsSync(file)) { say("✖", "الملفّ غير موجود"); continue; }

        const img = sharp(file);
        const meta = await img.metadata();
        const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width: W, height: H, channels: C } = info;
        console.log(`   ${W}×${H} · ${meta.channels}ch · ${(fs.statSync(file).size / 1048576).toFixed(2)}MB`);

        // ١. المقاس. الأكبر مقبول (نصغّر)، الأصغر لا (التكبير يفضح نفسه).
        if (W < spec.w || H < spec.h) say("⚠", `أصغر من المطلوب ${spec.w}×${spec.h}`);
        const ar = (W / H) / (spec.w / spec.h);
        if (ar < 0.97 || ar > 1.03) say("⚠", `النسبة ${(W / H).toFixed(2)} بدل ${(spec.w / spec.h).toFixed(2)} — سيقصّ التركيب`);

        // ٢. الشفافيّة: تُقاس بتغطية ألفا، لا بوجود القناة. صورةٌ معتمة كلّها
        //    لها قناة ألفا أيضًا — والفرق أن خلفيّتها ستحجب ما تحتها.
        let opaque = 0, semi = 0, warmPix = 0, pureBlack = 0, lit = 0;
        const colTop = new Int32Array(W).fill(-1);   // أعلى بكسل معتم لكل عمود
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * C;
                const a = C === 4 ? data[i + 3] : 255;
                if (a > 200) { opaque++; if (colTop[x] < 0) colTop[x] = y; }
                else if (a > 20) semi++;
                if (a > 20) {
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    if (r > 90 && r > b + 45 && r > g + 20) warmPix++;
                    if (r + g + b > 60) lit++;
                    if (r === 0 && g === 0 && b === 0) pureBlack++;
                }
            }
        }
        const total = W * H;
        const cov = opaque / total;
        console.log(`   تغطية معتمة ${pct(cov)} · شبه شفّاف ${pct(semi / total)} · دافئ ${pct(warmPix / total)}`);

        if (spec.alpha) {
            if (meta.channels < 4) say("✖", "لا قناة ألفا أصلًا — الخلفيّة مخبوزة");
            else if (cov > 0.97) say("✖", "معتمة كلّها — الخلفيّة مخبوزة رغم وجود ألفا");
            else if (cov < 0.005) say("✖", "شبه فارغة");
        } else if (spec.black) {
            // ٣. الأسود أسود: الزوايا الأربع تُقرأ مباشرةً.
            const corner = p => { const i = p * C; return [data[i], data[i + 1], data[i + 2]]; };
            const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(corner);
            const worst = Math.max(...corners.map(c => Math.max(...c)));
            console.log(`   الزوايا: ${corners.map(c => c.join(",")).join(" | ")}`);
            if (worst > 8) say("✖", `الزوايا ليست سوداء (أعلى قناة ${worst}) — ستظهر مربّعًا شبحيًّا عند screen`);
            else if (worst > 0) say("⚠", `الزوايا شبه سوداء (${worst}) — مقبول، وسأطرح العتبة عند التركيب`);
            else say("✓", "أسود صافٍ في الزوايا");
            console.log(`   مضيء ${pct(lit / total)} (الجمرة نفسها)`);
            if (lit / total > 0.35) say("⚠", "المضيء أكثر من الثلث — جمرةٌ أم نار؟");
        }

        // ٤. هالة القصّ: حزامٌ شبه شفّاف عريض حول جسمٍ حادّ = fringe.
        if (spec.alpha && meta.channels === 4 && opaque > 0) {
            const ratio = semi / opaque;
            if (ratio > 0.9) say("⚠", `شبه الشفّاف ${ratio.toFixed(2)}× المعتم — تحقّق من هالة القصّ`);
        }

        // ٥. ملامسة الحافّتين — تُقاس على أعمدة الطرف لا بالعين.
        if (spec.edges) {
            const colFilled = c => { for (let y = 0; y < H; y++) { const i = (y * W + c) * C; if ((C === 4 ? data[i + 3] : 255) > 200) return true; } return false; };
            const l = colFilled(0), r = colFilled(W - 1);
            if (!l || !r) say("✖", `لا تلمس الحافّة ${!l ? "اليسرى" : ""}${!l && !r ? " ولا " : ""}${!r ? "اليمنى" : ""} — خطٌّ عموديّ عند التكبير`);
            else say("✓", "تلمس الحافّتين");
            // وأن يكون الحدث في الوسط: التركيب العموديّ يقصّ ~٢٢٪ من كل جانب.
            const tops = [...colTop].filter(v => v >= 0);
            if (tops.length) {
                const mid = colTop.slice(Math.floor(W * 0.22), Math.ceil(W * 0.78)).filter(v => v >= 0);
                const rng = Math.max(...mid) - Math.min(...mid);
                console.log(`   تضاريس الوسط: مدى ${rng}px (${pct(rng / H)} من الارتفاع)`);
            }
        }

        // ٦. لا دفء خارج الجمرة — كامل معنى الصفحة «الرماد بارد».
        if (!spec.warm) {
            const share = warmPix / Math.max(opaque + semi, 1);
            if (share > 0.02) say("✖", `بكسلات دافئة ${pct(share)} من الجسم — لا برتقالي إلّا في ember`);
            else if (share > 0.004) say("⚠", `أثر دفء ${pct(share)} — افحصها بالعين`);
            else say("✓", "بارد");
        }
    }
    console.log(`\n${fail ? "✖" : warn ? "⚠" : "✓"} VET: ${fail} رفض · ${warn} تنبيه`);
    process.exit(fail ? 1 : 0);
})();
