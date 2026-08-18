// scripts/qa/perfbench.js — the measurement that has to exist BEFORE the optimisation.
//
// The rule for this round is that no performance change ships without a number on
// both sides of it. Not "this should be faster" — a before and an after, printed
// by the same script, so a change that does nothing gets reverted instead of
// being believed. That is the whole reason this file exists.
//
// It measures three different kinds of cost, because they fail differently:
//
//   · BYTES  — what the visitor downloads. Gzip is what actually crosses the
//     wire, but raw matters separately: raw is what the JS engine has to parse,
//     and a bundle full of \uXXXX escapes is small gzipped and still slow to
//     parse.
//   · BOOT   — the one-time cost of turning a payload into a usable structure.
//     Reported as a median of repeated runs, not a single sample, because a
//     single sample on a warm cache is a coin flip.
//   · HOT    — the per-interaction work. These are pure-function extracts of the
//     real code paths; they cannot catch DOM cost, which is why the report also
//     carries browser-measured numbers.
//
//   node scripts/qa/perfbench.js            -> print the table
//   node scripts/qa/perfbench.js --json     -> machine-readable, for diffing
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..", "..");
const JSON_OUT = process.argv.includes("--json");

const kb = n => (n / 1024).toFixed(1) + "k";
const ms = n => n.toFixed(2) + "ms";

// A single timing is noise. Take the median of `runs` — median, not mean, so one
// GC pause during the sample does not move the reported number.
function median(fn, runs = 7) {
    const t = [];
    for (let i = 0; i < runs; i++) {
        const a = process.hrtime.bigint();
        fn();
        t.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    return t.sort((x, y) => x - y)[t.length >> 1];
}

function sizeOf(rel) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return { raw: buf.length, gz: zlib.gzipSync(buf, { level: 9 }).length };
}

// --- the escape-sequence tax -------------------------------------------------
// esbuild defaults to --charset=ascii, which rewrites every non-ASCII character
// as a six-byte \uXXXX escape. In an Arabic bundle that is not a rounding error,
// so it gets its own measurement rather than hiding inside the raw size.
function escapeTax(rel) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return null;
    const src = fs.readFileSync(p, "utf8");
    const n = (src.match(/\\u0[6-7][0-9a-fA-F]{2}/g) || []).length;
    return { count: n, bytes: n * 6, pct: n * 6 / Buffer.byteLength(src) * 100 };
}

function main() {
    const out = { bytes: {}, boot: {}, hot: {} };

    // --- BYTES ---------------------------------------------------------------
    for (const f of ["app.js", "style.css", "index.html", "bank/words_ar.json", "bank/words_ar.txt"]) {
        const s = sizeOf(f);
        if (s) out.bytes[f] = s;
    }
    out.bytes["__escapes"] = escapeTax("app.js");

    // --- BOOT ----------------------------------------------------------------
    // The dictionary is the heaviest single thing a player ever downloads. Parse
    // and Set construction are timed apart because they are fixed by different
    // means: parse cost is payload, Set cost is entry count.
    const dictPath = path.join(ROOT, "bank/words_ar.json");
    if (fs.existsSync(dictPath)) {
        const txt = fs.readFileSync(dictPath, "utf8");
        let parsed = null;
        out.boot["dict.parse"] = median(() => { parsed = JSON.parse(txt); });
        const words = Array.isArray(parsed) ? parsed : (parsed.words || []);
        out.boot["dict.set"] = median(() => { new Set(words); });
        out.boot["dict.entries"] = words.length;
    }

    // The shipped path, measured against the one it replaced: decode the
    // front-coded file into the packed buffer the browser actually queries.
    const fcPath = path.join(ROOT, "bank/words_ar.txt");
    if (fs.existsSync(fcPath)) {
        const fc = fs.readFileSync(fcPath, "utf8");
        out.boot["dict.decodePacked"] = median(() => {
            const lines = fc.split("\n");
            const n = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
            const off = new Int32Array(n + 1);
            const parts = new Array(n);
            let prev = "", pos = 0;
            for (let i = 0; i < n; i++) {
                const l = lines[i];
                const w = prev.slice(0, l.charCodeAt(0) - 48) + l.slice(1);
                parts[i] = w; off[i] = pos; pos += w.length; prev = w;
            }
            off[n] = pos;
            return parts.join("");
        });
    }

    // --- HOT -----------------------------------------------------------------
    // Arabic collation. bee.js sorts its found-list with `a.localeCompare(b,'ar')`,
    // which asks for a collator on every single comparison. The alternative is one
    // hoisted Intl.Collator. Same ordering, and the gap is the finding.
    const sample = ["سلام", "بحر", "نجم", "كتاب", "قمر", "شمس", "مطر", "ريح",
        "جبل", "نهر", "بيت", "باب", "شجر", "زهر", "طير", "سمك"];
    const many = Array.from({ length: 64 }, (_, i) => sample[i % sample.length] + i);
    out.hot["sort.localeCompare"] = median(() =>
        many.slice().sort((a, b) => a.localeCompare(b, "ar")), 21);
    const coll = new Intl.Collator("ar");
    out.hot["sort.collator"] = median(() => many.slice().sort(coll.compare), 21);

    // Letter Boxed hint search. The shipped version walks the dictionary linearly
    // from index 0 on every press, capped at 80k. The comparison is a per-board
    // prefix index built once. Both are run against the real dictionary so the
    // ratio is the real ratio, not a toy one.
    if (fs.existsSync(dictPath)) {
        const words = JSON.parse(fs.readFileSync(dictPath, "utf8"));
        const list = Array.isArray(words) ? words : (words.words || []);
        const letters = new Set([..."ابتثجحخدذرزس"]);
        const start = "ا";

        out.hot["lb.linearScan"] = median(() => {
            let n = 0, found = 0;
            for (const w of list) {
                if (n++ > 80000) break;
                if (w[0] !== start) continue;
                let ok = w.length >= 3;
                if (ok) for (const c of w) if (!letters.has(c)) { ok = false; break; }
                if (ok) found++;
            }
            return found;
        }, 5);

        // Build once, then answer many times. The build is amortised across the
        // whole round, so the honest comparison is build + one query vs one scan.
        const buildIndex = () => {
            const idx = new Map();
            for (const w of list) {
                if (w.length < 3) continue;
                let ok = true;
                for (const c of w) if (!letters.has(c)) { ok = false; break; }
                if (!ok) continue;
                const k = w[0];
                let a = idx.get(k); if (!a) idx.set(k, a = []);
                a.push(w);
            }
            return idx;
        };
        let idx = null;
        out.hot["lb.indexBuild"] = median(() => { idx = buildIndex(); }, 5);
        out.hot["lb.indexQuery"] = median(() => (idx.get(start) || []).length, 999);
    }

    if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }

    console.log("\n=== BYTES ===");
    for (const [k, v] of Object.entries(out.bytes)) {
        if (k === "__escapes") continue;
        console.log(`  ${k.padEnd(22)} ${String(v.raw).padStart(9)} B raw   ${kb(v.gz).padStart(8)} gz`);
    }
    const e = out.bytes.__escapes;
    if (e) console.log(`  ${"\\uXXXX escapes".padEnd(22)} ${String(e.count).padStart(9)} seq   ${kb(e.bytes)} = ${e.pct.toFixed(1)}% of app.js raw`);

    console.log("\n=== BOOT (median) ===");
    for (const [k, v] of Object.entries(out.boot))
        console.log(`  ${k.padEnd(22)} ${k.endsWith("entries") ? v : ms(v)}`);

    console.log("\n=== HOT (median) ===");
    for (const [k, v] of Object.entries(out.hot))
        console.log(`  ${k.padEnd(22)} ${ms(v)}`);
    console.log("");
}

main();
