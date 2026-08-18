// scripts/qa/loadtest.js — does the backend hold at 10, 50, 75 and 100 concurrent players?
//
// The static half of the site is not the question. Cloudflare Pages serves files
// off an edge cache with no request ceiling on the free plan, and at the time of
// writing the site is not deployed there yet, so there is nothing to point this
// at. The question is Supabase: one free-tier project, a 500k monthly invocation
// quota, and — measured in the August security round — **no effective rate limit
// on the open endpoints**. That is what this measures.
//
// READ-ONLY ON PRODUCTION. Two rules follow from that, and both are enforced
// rather than intended:
//
//   1. Only GET endpoints that read. No `submit-*`, no `game_events`, no auth.
//   2. `get-todays-puzzle` is EXCLUDED even though it is a GET. The audit (A2)
//      found it writes with the service key on an unauthenticated call — it
//      upserts into `daily_puzzles` and stamps `puzzle_bank.used_on`. Hammering
//      it would burn the puzzle bank. A GET verb is not a promise of a read.
//
// So the surface is exactly what an anonymous visitor's first seconds touch:
//
//   GET /functions/v1/get-daily-challenge              (once per session)
//   GET /functions/v1/get-leaderboard?board=global     (once per session)
//   GET /functions/v1/get-leaderboard?game=<g>         (once per opened game)
//
// WHAT A "CONCURRENT PLAYER" MEANS HERE. Not a connection held open — a visitor
// running the session sequence with human-shaped pauses between steps. N of them
// start at the same instant and run independently, which is what a link going
// round a group chat actually looks like.
//
//   node scripts/qa/loadtest.js               -> the four waves, then the report
//   node scripts/qa/loadtest.js --waves 10,50 -> a subset
//   node scripts/qa/loadtest.js --iterations 1
//   node scripts/qa/loadtest.js --dry-run     -> quota arithmetic only, zero requests
//   node scripts/qa/loadtest.js --json        -> machine-readable
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Config — read from index.html, never duplicated.
// ---------------------------------------------------------------------------
// A second copy of the URL and key in this file would be a second thing to keep
// in sync, and the day it drifts this script measures a project nobody is using.
// The publishable key is the one the browser already ships; nothing secret is
// read here, and nothing secret would work anyway — these endpoints are public.
function readConfig() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const url = /SUPABASE_URL:\s*'([^']+)'/.exec(html);
  const key = /SUPABASE_ANON_KEY:\s*'([^']+)'/.exec(html);
  if (!url || !key) {
    console.error("loadtest: could not read SURA_CONFIG out of index.html");
    process.exit(1);
  }
  return { url: url[1], key: key[1] };
}

// The live games, read from the source rather than typed here.
//
// Typed by hand the first time, and the first run spent 5% of every wave on 400s
// because the نحلة key is `spelling_bee`, not `bee`. A hardcoded list in a load
// test does not fail loudly — it quietly reports the service as broken. Reading
// the real list means a wrong name here is impossible rather than merely
// unlikely, and adding a game to the site adds it to the test for free.
//
// The array moved out of `src/main.js` into `src/ui/meta.js` when the retention
// platform was split into its own module. The exit(1) below is why that move was
// caught here rather than in a wave of 400s.
const LIVE_GAMES_SRC = path.join("src", "ui", "meta.js");
function readLiveGames() {
  const src = fs.readFileSync(path.join(ROOT, LIVE_GAMES_SRC), "utf8");
  const m = /const LIVE_GAMES = \[([^\]]+)\]/.exec(src);
  if (!m) {
    console.error(`loadtest: could not read LIVE_GAMES out of ${LIVE_GAMES_SRC}`);
    process.exit(1);
  }
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}
const GAMES = readLiveGames();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FLAG = (name) => process.argv.includes(`--${name}`);

const WAVES = String(arg("waves", "10,50,75,100")).split(",").map(Number).filter(Boolean);
const ITERATIONS = Number(arg("iterations", 3));      // sessions per virtual player
const COOLDOWN_MS = Number(arg("cooldown", 20000));   // between waves
const TIMEOUT_MS = Number(arg("timeout", 15000));
const BUDGET = Number(arg("budget", 5000));           // hard ceiling on requests

// ---------------------------------------------------------------------------
// Quota guard — refuse to start rather than apologise afterwards.
// ---------------------------------------------------------------------------
// The free tier is 500,000 edge invocations a month. This prints what the run
// will cost BEFORE spending it, and exits if a mistyped flag would blow past the
// declared budget. A `--waves 1000` typo should cost nothing.
const PER_SESSION = 3; // daily + global board + one per-game board
function plannedRequests() {
  return WAVES.reduce((n, w) => n + w * ITERATIONS * PER_SESSION, 0);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
// Percentiles from the full sorted sample, not a streaming estimate: the samples
// number in the thousands at most, so exactness is free. p99 on a 30-sample wave
// is the max and is reported as such rather than pretending to be a percentile.
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

function summarise(samples) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: samples.length,
    p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99),
    min: ms[0] ?? null, max: ms[ms.length - 1] ?? null,
  };
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------
// Every outcome is recorded, including the ones that are not HTTP: a timeout and
// a DNS failure are different diagnoses, and collapsing both into "error" is how
// a load test tells you the service fell over when your laptop's wifi dropped.
async function hit(label, url, key, out) {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let status = 0, bytes = 0, kind = "ok";
  try {
    const res = await fetch(url, {
      headers: { apikey: key },
      cache: "no-store",
      signal: ctl.signal,
    });
    status = res.status;
    const body = await res.arrayBuffer();
    bytes = body.byteLength;
    if (status === 429) kind = "throttled";
    else if (status >= 500) kind = "server";
    else if (status >= 400) kind = "client";
  } catch (e) {
    kind = e.name === "AbortError" ? "timeout" : "network";
  } finally {
    clearTimeout(timer);
  }
  out.push({ label, ms: performance.now() - t0, status, bytes, kind });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

// ---------------------------------------------------------------------------
// One virtual player
// ---------------------------------------------------------------------------
// The pauses are the point. Firing three requests back to back measures a
// benchmark; a real visitor reads the page, opens a game, and looks at a board.
// Without the pause the concurrency number is a lie — 100 players who each pause
// for two seconds are not 100 simultaneous requests, and pretending otherwise
// inflates the result in the pessimistic direction, which is its own kind of
// wrong answer.
async function session(cfg, out) {
  await hit("daily", `${cfg.url}/functions/v1/get-daily-challenge`, cfg.key, out);
  await sleep(jitter(200, 900));
  await hit("board:global", `${cfg.url}/functions/v1/get-leaderboard?board=global&limit=10`, cfg.key, out);
  await sleep(jitter(1000, 4000));  // reading the page, choosing a game
  const g = GAMES[Math.floor(Math.random() * GAMES.length)];
  await hit("board:game", `${cfg.url}/functions/v1/get-leaderboard?game=${g}&limit=6`, cfg.key, out);
}

async function player(cfg, out) {
  for (let i = 0; i < ITERATIONS; i++) {
    await session(cfg, out);
    if (i < ITERATIONS - 1) await sleep(jitter(1500, 4000));
  }
}

// ---------------------------------------------------------------------------
// One wave
// ---------------------------------------------------------------------------
async function wave(cfg, n) {
  const out = [];
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, () => player(cfg, out)));
  const seconds = (performance.now() - t0) / 1000;

  const byLabel = {};
  for (const s of out) (byLabel[s.label] ||= []).push(s);

  const statuses = {}, kinds = {};
  let bytes = 0;
  for (const s of out) {
    statuses[s.status] = (statuses[s.status] || 0) + 1;
    kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    bytes += s.bytes;
  }

  const okCount = out.filter((s) => s.status >= 200 && s.status < 300).length;
  return {
    concurrency: n,
    requests: out.length,
    seconds: +seconds.toFixed(1),
    rps: +(out.length / seconds).toFixed(1),
    successPct: +((okCount / out.length) * 100).toFixed(2),
    bytes,
    statuses,
    kinds,
    overall: summarise(out),
    endpoints: Object.fromEntries(
      Object.entries(byLabel).map(([k, v]) => [k, summarise(v)]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const GATE = 99.7;
const fmt = (v) => (v == null ? "—" : `${v.toFixed(0)}ms`);

function print(results) {
  console.log("\n=== WAVES ===");
  console.log("  conc  reqs   ok%     rps    p50     p95     p99    bytes");
  for (const r of results) {
    const pass = r.successPct >= GATE ? " " : "!";
    console.log(
      `${pass} ${String(r.concurrency).padStart(4)}  ${String(r.requests).padStart(4)}  ` +
      `${r.successPct.toFixed(2).padStart(6)}  ${String(r.rps).padStart(6)}  ` +
      `${fmt(r.overall.p50).padStart(6)}  ${fmt(r.overall.p95).padStart(6)}  ` +
      `${fmt(r.overall.p99).padStart(6)}  ${(r.bytes / 1024).toFixed(0).padStart(6)}k`,
    );
  }

  console.log("\n=== PER ENDPOINT (p95) ===");
  const labels = ["daily", "board:global", "board:game"];
  console.log("  conc  " + labels.map((l) => l.padStart(13)).join(""));
  for (const r of results) {
    console.log(
      `  ${String(r.concurrency).padStart(4)}  ` +
      labels.map((l) => fmt(r.endpoints[l]?.p95).padStart(13)).join(""),
    );
  }

  console.log("\n=== STATUS / ERROR CLASSES ===");
  for (const r of results) {
    const st = Object.entries(r.statuses).map(([k, v]) => `${k}×${v}`).join(" ");
    const kd = Object.entries(r.kinds).filter(([k]) => k !== "ok")
      .map(([k, v]) => `${k}×${v}`).join(" ") || "none";
    console.log(`  ${String(r.concurrency).padStart(4)}  ${st}   [${kd}]`);
  }

  const failed = results.filter((r) => r.successPct < GATE);
  const total = results.reduce((n, r) => n + r.requests, 0);
  console.log(`\n  quota spent: ${total} invocations (${((total / 500000) * 100).toFixed(2)}% of 500k/month)`);
  if (failed.length) {
    console.log(`\nLOADTEST_FAIL — below the ${GATE}% gate at: ` +
      failed.map((r) => `${r.concurrency} (${r.successPct}%)`).join(", "));
    process.exitCode = 1;
  } else {
    console.log(`\nLOADTEST_OK (all waves >= ${GATE}%)`);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const cfg = readConfig();
  const planned = plannedRequests();

  console.log(`target      ${cfg.url}`);
  console.log(`waves       ${WAVES.join(" -> ")} concurrent`);
  console.log(`sessions    ${ITERATIONS} per player, ${PER_SESSION} reads each`);
  console.log(`planned     ${planned} invocations (${((planned / 500000) * 100).toFixed(2)}% of the monthly quota)`);
  console.log(`writes      none — get-todays-puzzle deliberately excluded (it writes)`);

  if (planned > BUDGET) {
    console.error(`\nloadtest: refusing to start — ${planned} planned exceeds the ${BUDGET} budget.`);
    console.error(`Raise it explicitly with --budget if that is really what you meant.`);
    process.exit(1);
  }
  if (FLAG("dry-run")) { console.log("\n(dry run — no requests sent)"); return; }

  const results = [];
  for (const n of WAVES) {
    process.stdout.write(`\nwave ${n} ... `);
    const r = await wave(cfg, n);
    process.stdout.write(`${r.requests} reqs in ${r.seconds}s, ${r.successPct}% ok`);
    results.push(r);
    if (n !== WAVES[WAVES.length - 1]) {
      // Cooling down matters: without it each wave inherits the previous wave's
      // warm isolates and connection pool, and wave 4 measures wave 3's warmth.
      process.stdout.write(`  (cooling ${COOLDOWN_MS / 1000}s)`);
      await sleep(COOLDOWN_MS);
    }
  }
  console.log();

  if (FLAG("json")) console.log(JSON.stringify(results, null, 2));
  else print(results);
}

main().catch((e) => { console.error(e); process.exit(1); });
