// scripts/qa/mobilebench.js — the phone bench. perfbench.js measures the payload in
// node; this measures the device, because that is where this round's problem is.
//
// What the pre-round survey found, and why this file has the shape it has:
//
//   · The wire is already fine. A Pixel 5 pulls 0.77 MB over 22 requests. A round
//     that starts by shrinking assets would be fixing what is not broken.
//   · The main thread is not fine. ~900-1000 ms of blocking across 3-4 long tasks,
//     the longest of them 360-527 ms. That is what a visitor feels as "the page is
//     stuck", and that is what the columns here are aimed at.
//   · A single run lies. The last round produced two contradictory readings of the
//     same effect from two single runs, and only a repeated A/B settled it. So
//     every number printed here is a MEDIAN over `--reps` runs, never one sample.
//
// It also measures scrolling, in a headed browser, on purpose: headless Chromium
// has no real compositor, so frame timing measured there is meaningless. Anything
// about paint or smoothness must be taken with a window on screen.
//
//   node scripts/qa/mobilebench.js                    -> the table
//   node scripts/qa/mobilebench.js --json             -> machine-readable, for diffing
//   node scripts/qa/mobilebench.js --label before     -> tag the run
//   node scripts/qa/mobilebench.js --reps 3           -> fewer/more repetitions
//   node scripts/qa/mobilebench.js --device "Pixel 5" -> one device only
//   node scripts/qa/mobilebench.js --url http://...   -> point at another server
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
    const i = argv.indexOf("--" + name);
    return i === -1 ? dflt : argv[i + 1];
};
const has = name => argv.includes("--" + name);

const URL_BASE = flag("url", "http://localhost:8000/");
const REPS = Number(flag("reps", 5));
const JSON_OUT = has("json");
const LABEL = flag("label", "");
const ONLY_DEVICE = flag("device", "");
// الطبقة تُفرَض عند القياس لسببٍ مقيس: محاكاةُ الأجهزة في Playwright **لا**
// تزيّف `deviceMemory` ولا `hardwareConcurrency` — الهاتف المُحاكى يُبلّغ عن
// ذاكرة الحاسوب المضيف وأنويته (١٦/١٦ هنا)، فيُصنَّف `full` دائمًا مهما كان
// الجهاز المُحاكى. فقياسُ الطبقات لا يكون إلّا بفرضها.
const FORCE_TIER = flag("tier", "");

// Playwright is not a dependency of this repo — it lives in the npx cache. Try the
// normal resolution first so the script keeps working if it is ever installed
// properly, then fall back to the known cache location on this machine.
const NPX_PLAYWRIGHT =
    "file:///C:/Users/khali/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
async function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* not installed locally */ }
    try { return await import(NPX_PLAYWRIGHT); } catch (e) {
        console.error("playwright not found. install it, or run:  npx playwright@latest --version");
        process.exit(1);
    }
}

// --- what gets measured ------------------------------------------------------
// Two phones and three CPU multipliers. The 1x row is the control: if a change
// helps only at 1x it did not help the people this round is for. 4x is roughly a
// mid-range Android against this desktop; 6x is the low end.
const DEVICES = ["Pixel 5", "iPhone 12"];
const RATES = [1, 4, 6];

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const r0 = n => Math.round(n);

// Injected before any page script runs, so nothing is missed. LCP and long tasks
// both need their observer installed before the events they observe.
const PROBE = () => {
    window.__mb = { lcp: 0, tasks: [], errs: [] };
    try {
        new PerformanceObserver(l => {
            for (const e of l.getEntries()) window.__mb.lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) { }
    try {
        new PerformanceObserver(l => {
            for (const e of l.getEntries()) window.__mb.tasks.push(Math.round(e.duration));
        }).observe({ entryTypes: ["longtask"] });
    } catch (e) { }
};

// The frame clock. Started fresh for each measured window so the idle stretch
// before it does not dilute the percentiles.
const CLOCK = () => {
    window.__f = [];
    let last = performance.now();
    (function tick(t) { window.__f.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); })(performance.now());
};
const READ_CLOCK = () => {
    // drop the first two: the first gap spans the evaluate() round-trip itself
    const f = window.__f.slice(2);
    const s = [...f].sort((a, b) => a - b);
    return {
        n: f.length,
        p50: s[Math.floor(s.length * 0.5)] || 0,
        p95: s[Math.floor(s.length * 0.95)] || 0,
        worst: s[s.length - 1] || 0,
        // >32ms means at least one frame missed at 60Hz — the thing the eye calls a stutter
        dropped: f.filter(d => d > 32).length,
    };
};

async function once(pw, deviceName, rate) {
    const device = pw.devices[deviceName];
    // headed: the compositor is the point. `channel: 'chrome'` because the bundled
    // headed chromium binary is not installed on this machine.
    const browser = await pw.chromium.launch({ headless: false, channel: "chrome" });
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();

    const errs = [];
    page.on("pageerror", e => errs.push(String(e).slice(0, 120)));

    let bytes = 0, requests = 0;
    page.on("response", async res => {
        requests++;
        try { const h = res.headers()["content-length"]; if (h) bytes += Number(h); } catch (e) { }
    });

    const cdp = await ctx.newCDPSession(page);
    if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });

    // زمن JS الكلّيّ من المُعرِّف، وهو **العمود الذي يُعتمد عليه**. عمود
    // `block` (مجموع المهامّ الطويلة) قيس فوجد ثنائيّ المنوال: تسعُ تشغيلاتٍ
    // متطابقة الشروط أعطت ٥٢٥ و٩٤٠ms بالتناوب على الطبقات الثلاث جميعًا — أي
    // أنّ ضجيجه أكبر من كلّ ما تقيسه هذه الجولة. زمنُ JS المُعيَّن لا يعتمد على
    // مواضع حدود المهامّ، فخرج نظيفًا ومطّردًا: ٦٦٣ ← ٤٥٠ms لتغييرٍ واحد.
    // ‏`block` يبقى مطبوعًا للاطّلاع، ولا يُبنى عليه حكم.
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");

    await page.addInitScript(PROBE);
    const t0 = Date.now();
    const url = FORCE_TIER ? URL_BASE + (URL_BASE.includes("?") ? "&" : "?") + "tier=" + FORCE_TIER : URL_BASE;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    const load = Date.now() - t0;
    await page.waitForTimeout(3500);   // let the deferred/idle work land too

    let js = 0;
    try {
        const { profile } = await cdp.send("Profiler.stop");
        const byId = new Map(profile.nodes.map(n => [n.id, n]));
        profile.samples.forEach((id, i) => {
            const n = byId.get(id); if (!n) return;
            const f = n.callFrame.functionName;
            if (f !== "(idle)" && f !== "(program)") js += (profile.timeDeltas[i] || 0) / 1000;
        });
    } catch (e) { }

    const boot = await page.evaluate(() => {
        const t = window.__mb.tasks;
        return {
            lcp: Math.round(window.__mb.lcp),
            blocking: t.reduce((a, d) => a + d, 0),
            longest: t.length ? Math.max(...t) : 0,
            nTasks: t.length,
            heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0,
            nodes: document.getElementsByTagName("*").length,
            tier: document.documentElement.getAttribute("data-tier") || "-",
        };
    });

    // --- scrolling ----------------------------------------------------------
    // Fast alternating sweeps, the exact motion the owner reported as sticky.
    // `mouse.wheel` rather than touch because touch scrolling on a mobile context
    // is composited off-thread and would hide main-thread cost we want to see.
    await page.mouse.move(Math.round(device.viewport.width / 2), Math.round(device.viewport.height / 2));
    await page.evaluate(CLOCK);
    for (let i = 0; i < 30; i++) {
        await page.mouse.wheel(0, i % 2 ? -1200 : 1200);
        await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
    const scroll = await page.evaluate(READ_CLOCK);
    await page.evaluate(() => cancelAnimationFrame(window.__raf));

    await browser.close();
    return { ...boot, js, load, bytes, requests, errs, scroll };
}

async function main() {
    const pw = await loadPlaywright();
    const devices = ONLY_DEVICE ? [ONLY_DEVICE] : DEVICES;
    const out = { label: LABEL, url: URL_BASE, reps: REPS, at: new Date().toISOString(), rows: [] };

    for (const d of devices) {
        for (const rate of RATES) {
            const runs = [];
            for (let i = 0; i < REPS; i++) {
                try { runs.push(await once(pw, d, rate)); }
                catch (e) { console.error(`  run failed (${d} @${rate}x): ${String(e).slice(0, 120)}`); }
            }
            if (!runs.length) continue;
            const pick = k => median(runs.map(r => r[k]));
            const pickS = k => median(runs.map(r => r.scroll[k]));
            out.rows.push({
                device: d, rate, n: runs.length, tier: runs[0].tier,
                lcp: r0(pick("lcp")), js: r0(pick("js")), blocking: r0(pick("blocking")), longest: r0(pick("longest")),
                nTasks: r0(pick("nTasks")), heap: r0(pick("heap")), nodes: r0(pick("nodes")),
                load: r0(pick("load")), kb: r0(pick("bytes") / 1024), requests: r0(pick("requests")),
                fp50: r0(pickS("p50")), fp95: r0(pickS("p95")), fworst: r0(pickS("worst")),
                dropped: r0(pickS("dropped")),
                errs: [...new Set(runs.flatMap(r => r.errs))],
            });
            if (!JSON_OUT) process.stdout.write(".");
        }
    }

    if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }

    const pad = (s, n) => String(s).padStart(n);
    console.log(`\n\n=== mobilebench ${LABEL ? "[" + LABEL + "] " : ""}· median of ${REPS} · ${URL_BASE}\n`);
    console.log("  device      tier      cpu   LCP     JS  block  longest  tasks   heap  nodes    kB  req |  f50  f95  worst  dropped");
    console.log("  " + "-".repeat(121));
    for (const r of out.rows) {
        console.log(`  ${r.device.padEnd(10)} ${String(r.tier).padEnd(8)} ${pad(r.rate + "x", 4)}${pad(r.lcp, 5)} ${pad(r.js, 6)} ${pad(r.blocking, 6)} ${pad(r.longest, 8)} ${pad(r.nTasks, 6)} ${pad(r.heap, 5)}M ${pad(r.nodes, 6)} ${pad(r.kb, 5)} ${pad(r.requests, 4)} | ${pad(r.fp50, 4)} ${pad(r.fp95, 4)} ${pad(r.fworst, 6)} ${pad(r.dropped, 8)}`);
    }
    const allErrs = [...new Set(out.rows.flatMap(r => r.errs))];
    console.log(allErrs.length ? `\n  page errors: ${allErrs.slice(0, 5).join(" | ")}` : "\n  page errors: none");
    console.log("\n  JS = total profiler CPU time (the reliable column) · block/longest in ms · f50/f95/worst = frame gap during a fast scroll sweep · dropped = frames >32ms\n");

    // Keep the raw run on disk so a later "after" run can be diffed against this
    // one without re-measuring the "before".
    if (LABEL) {
        const dir = path.join(ROOT, ".bench");
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, `mobile-${LABEL}.json`);
        fs.writeFileSync(f, JSON.stringify(out, null, 2));
        console.log(`  saved -> ${path.relative(ROOT, f)}\n`);
    }
}

main();
