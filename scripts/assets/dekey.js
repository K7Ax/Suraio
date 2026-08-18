// scripts/assets/dekey.js — recover the alpha the export threw away.
// ============================================================
//   node scripts/assets/dekey.js            all plates
//   node scripts/assets/dekey.js stars      one plate
//
// WHAT HAPPENED. The eight world plates were generated WITH transparency and
// then saved as .jfif — which is JPEG, and JPEG has no alpha channel. The
// viewer's transparency checkerboard was therefore rendered INTO the pixels.
// The art is intact; only the container was wrong.
//
// This is recoverable, and not by a threshold. A checkerboard is a *known*
// background taking exactly two values, so for every pixel we have
//
//     C = a·F + (1−a)·B(x,y),      B(x,y) ∈ { B_hi, B_lo }
//
// with the two-valued B alternating on a grid whose period we measure. That is
// one equation short of solvable per pixel — but the checker is high frequency
// and the artwork is not, so the two terms separate in the frequency domain:
//
//     L = boxblur(C, one period)   ≈ a·F + (1−a)·B̄        (B̄ = mean of the tones)
//     H = C − L                     = ±(1−a)·Δ/2 on background, ≈0 where opaque
//
// so the checker's surviving amplitude IS the transparency:
//
//     a = 1 − 2·max|H| / Δ
//
// and no phase needs to be known — which matters, because these were screen-
// grabbed at six different zooms (periods 55…88 px) and a grid fitted across
// 5056 px drifts out of phase long before it reaches the far edge.
//
// THE ONE PLATE THIS DOES NOT SUIT is `stars`. Its checker is dark (60/117) and
// its subject is faint points of light that live in exactly that value range and
// are small enough to read as high-frequency energy themselves — the estimator
// above would erase them as background. That one uses a grayscale OPENING to
// estimate the background instead, and is the only plate whose result has to be
// judged by eye rather than trusted.
//
// WHAT THIS CANNOT DO, on any plate: where the subject's own value coincides
// with one of the two checker tones, the two are indistinguishable and the
// information is simply gone. That is why the near dune's moonlit face (~200,
// against a 197 dark tone) still scallops along the horizon, and why the
// traveller's pale shemagh (~221, against a 221 dark tone) grows a solid white
// spur. Re-exporting those as PNG is not a nicety — it is the only fix.
//
// `milkyway` and `moon` were delivered on true black with no checker at all and
// are copied straight through: the pipeline keys those two by luma anyway.
// ============================================================
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'promo', 'imgs');
const OUT = path.join(ROOT, '_design-src', 'story');

// The eight names story_assets.js asks for, mapped from what was delivered.
// `dues-mid` and `travaller` keep their spellings on purpose: PLACE in
// story_assets.js already names those files and renaming them here would only
// move the typo somewhere it is harder to see.
const PLATES = [
    { id: 'stars', src: 'stars.jfif', mode: 'open' },
    { id: 'milkyway', src: 'milkyway.jfif', mode: 'copy' },
    // THE MOON IS NOT REPLACED — owner's call, 2026-08-16, and the render agrees.
    // The delivered plate draws a dark disc behind the crescent, and the moon is
    // `blend: true` in story.json, i.e. SCREENED. Screen makes black transparent,
    // so that disc does not occlude anything: the Milky Way reads straight through
    // the moon's dark limb, which no real moon does. The shipped
    // `public/story/moon-2560.webp` is a photographic crescent with a clean limb
    // and it is what `promo/acts/farplane.mjs` already loads. It is 351px against
    // a 279px opening / 395px maximum on-screen size, so it needs no upgrade
    // either. Leave it alone; the other seven plates still get rebuilt.
    { id: 'moon', mode: 'skip', why: 'site crescent is better; screen-blend exposes the delivered disc' },
    // `solid` = the subject has a hard silhouette, so the boundary may be voted
    // flat. `town` is the exception: its warm horizon glow is genuinely soft and
    // a vote would put a rim through the middle of it.
    { id: 'dunes-far', src: 'dunes-far.jfif', mode: 'matte', solid: true },
    { id: 'town', src: 'town.jfif', mode: 'matte', solid: false },
    { id: 'dues-mid', src: 'dues-mid.jfif', mode: 'matte', solid: true },
    { id: 'dune-near', src: 'dune-near.jfif', mode: 'matte', solid: true },
    { id: 'travaller', src: 'travaller.jfif', mode: 'matte', solid: true },
];

/**
 * Move any file already at `dst` aside before writing over it.
 *
 * `_design-src/` is not tracked by git, so an overwrite here is unrecoverable —
 * and this script's first run learned that the hard way, replacing the eight
 * master plates the previous world set was built from. The shipped derivatives
 * in `public/story/` survived, but the masters did not. Nothing that writes into
 * an untracked source directory should do so destructively.
 */
function keepPrevious(dst) {
    if (!fs.existsSync(dst)) return null;
    const dir = path.join(path.dirname(dst), '_replaced');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = fs.statSync(dst).mtime.toISOString().replace(/[:.]/g, '-');
    const to = path.join(dir, `${path.basename(dst, '.png')}.${stamp}.png`);
    if (!fs.existsSync(to)) fs.renameSync(dst, to);
    return path.relative(path.dirname(dst), to);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const median = a => { const b = Float64Array.from(a).sort(); return b[b.length >> 1]; };

// ---------------------------------------------------------------- grid fit
/**
 * Measure the checkerboard from a strip of pure background.
 *
 * Brute force over (period, phase) maximising the contrast between the two
 * phases, sampling only the middle 40% of each cell so that JPEG ringing along
 * the cell edges — which is considerable at this compression — never enters the
 * tone estimate.
 *
 * Returns null when nothing periodic is there, which is how `milkyway` and
 * `moon` are recognised rather than assumed.
 */
function fitChecker(lum, W) {
    let best = null;
    for (let P = 20; P <= 140; P++) {
        for (let p = 0; p < P * 2; p++) {
            const A = [], B = [];
            for (let x = 0; x < W; x++) {
                const o = (x + p) % P;
                if (o < P * 0.3 || o > P * 0.7) continue;
                (Math.floor((x + p) / P) % 2 ? A : B).push(lum[x]);
            }
            if (A.length < 50 || B.length < 50) continue;
            const a = median(A), b = median(B);
            const c = Math.abs(a - b);
            if (!best || c > best.contrast) best = { period: P, phase: p, contrast: c, hi: Math.max(a, b), lo: Math.min(a, b) };
        }
    }
    return best && best.contrast > 12 ? best : null;
}

/**
 * Luma profile of the top strip, averaged down its height.
 *
 * `stride` is the full image width and `W` the sampled width: they differ, and
 * conflating them reads the buffer diagonally and fits a checkerboard that is
 * not there (measured 218/232 instead of the true 197/255 — a contrast low
 * enough to pass the detector and wrong enough to key everything to zero).
 */
function profile(data, stride, W, H, ch) {
    const lum = new Float64Array(W);
    for (let x = 0; x < W; x++) {
        let s = 0;
        for (let y = 0; y < H; y++) {
            const i = (y * stride + x) * ch;
            s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        lum[x] = s / H;
    }
    return lum;
}

// ---------------------------------------------------------------- filters
/** Separable box blur over a Float64 plane, radius r, edge-clamped. */
function boxBlur(src, W, H, r) {
    const tmp = new Float64Array(W * H), dst = new Float64Array(W * H);
    const n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
        const row = y * W;
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, W - 1)];
        for (let x = 0; x < W; x++) {
            tmp[row + x] = acc / n;
            acc -= src[row + clamp(x - r, 0, W - 1)];
            acc += src[row + clamp(x + r + 1, 0, W - 1)];
        }
    }
    for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, H - 1) * W + x];
        for (let y = 0; y < H; y++) {
            dst[y * W + x] = acc / n;
            acc -= tmp[clamp(y - r, 0, H - 1) * W + x];
            acc += tmp[clamp(y + r + 1, 0, H - 1) * W + x];
        }
    }
    return dst;
}

/**
 * How strongly the checkerboard is still modulating the image, per pixel.
 *
 * A high-pass is not enough — it cannot tell the checker from the dune's own
 * gradients, and the first attempt read every plate as 0% opaque because the
 * crest-to-shadow falloff produced as much local contrast as the checker did.
 *
 * So demodulate at the checker's carrier instead. A board of cell size P is
 * `sign(sin πx/P)·sign(sin πy/P)`, whose fundamental sits at the separable 2D
 * frequency (1/2P, 1/2P). Projecting onto all four quadrature phases of that
 * carrier and taking the magnitude gives the local amplitude WITHOUT knowing
 * the phase — which matters, because these were grabbed at six different zooms
 * and a phase fitted at the origin has drifted a full cell by the far edge.
 *
 * Content survives this only to the extent it happens to contain energy at
 * exactly the carrier frequency, which smooth sand does not.
 */
function carrierAmp(lum, W, H, P) {
    const N = W * H;
    const k = Math.PI / P;
    const cx = new Float64Array(W), sx = new Float64Array(W);
    for (let x = 0; x < W; x++) { cx[x] = Math.cos(k * x); sx[x] = Math.sin(k * x); }
    const cy = new Float64Array(H), sy = new Float64Array(H);
    for (let y = 0; y < H; y++) { cy[y] = Math.cos(k * y); sy[y] = Math.sin(k * y); }

    // A window of one full period: wider is more frequency-selective but
    // smears the silhouette by its own radius, and these edges are hard.
    const r = Math.round(P);
    const acc = new Float64Array(N);
    const tmp = new Float64Array(N);
    for (const [gx, gy] of [[cx, cy], [sx, cy], [cx, sy], [sx, sy]]) {
        for (let y = 0; y < H; y++) {
            const row = y * W, g = gy[y];
            for (let x = 0; x < W; x++) tmp[row + x] = lum[row + x] * gx[x] * g;
        }
        const R = boxBlur(tmp, W, H, r);
        for (let i = 0; i < N; i++) acc[i] += R[i] * R[i];
    }
    for (let i = 0; i < N; i++) acc[i] = Math.sqrt(acc[i]);
    return acc;
}

/**
 * Repair the matte using the one thing we know about these plates that no
 * per-pixel estimator does: each is a SINGLE SOLID SILHOUETTE against nothing.
 *
 * Two artefacts come out of the demodulator and neither is real:
 *   · holes inside the subject, wherever the artwork has an edge sharp enough to
 *     carry energy at the carrier frequency — the dune's own crest line drills
 *     straight through the matte
 *   · a sawtooth along the boundary at exactly the cell period, from the window
 *     quantising the edge
 *
 * A hole is any background region that cannot be reached from the frame border,
 * so a flood fill from the edge separates true sky from punctures. The sawtooth
 * is undulation at scale P, which a majority vote over a disk of radius ~P/3
 * removes while leaving the real silhouette — which curves over hundreds of
 * pixels — untouched.
 */
function cleanAlpha(a, W, H, P, solid) {
    const N = W * H;
    const core = new Uint8Array(N);
    for (let i = 0; i < N; i++) core[i] = a[i] >= 0.5 ? 1 : 0;

    // Flood the background inward from the border; whatever it never reaches is
    // enclosed, and enclosed background is a hole, not sky.
    const outside = new Uint8Array(N);
    const stack = new Int32Array(N);
    let sp = 0;
    const push = i => { if (!core[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (sp > 0) {
        const i = stack[--sp], x = i % W, y = (i - x) / W;
        if (x > 0) push(i - 1);
        if (x < W - 1) push(i + 1);
        if (y > 0) push(i - W);
        if (y < H - 1) push(i + W);
    }
    let filled = 0;
    const holes = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!core[i] && !outside[i]) { holes[i] = 1; core[i] = 1; filled++; }

    // A plate whose edge is genuinely soft — `town`, whose warm horizon glow
    // fades over hundreds of pixels — must keep its raw gradient. There the
    // hole fill is the whole repair: flattening that boundary to a vote would
    // put a hard rim in the middle of the glow.
    if (!solid) {
        const out = Float64Array.from(a);
        for (let i = 0; i < N; i++) if (holes[i]) out[i] = 1;
        return { alpha: out, filled };
    }

    // Majority vote at the cell scale — removes the period-P sawtooth. Half a
    // cell rather than a third: the dune's moonlit face sits at ~200 luma, which
    // is the checker's own dark tone, so the demodulator is weakest exactly
    // along that stretch of the horizon and needs the wider vote to hold the
    // line straight.
    const vote = boxBlur(Float64Array.from(core), W, H, Math.max(2, Math.round(P / 2)));
    for (let i = 0; i < N; i++) core[i] = vote[i] >= 0.5 ? 1 : 0;

    // Keep only the largest connected region. Each of these plates is ONE
    // subject, so anything else is not art — it removes the pair of vertical
    // streaks the generator left in the sky above the near dune, which are a
    // defect in the source and would survive a perfect alpha channel too.
    const label = new Int32Array(N).fill(-1);
    let bestId = -1, bestSize = 0, next = 0;
    for (let seed = 0; seed < N; seed++) {
        if (!core[seed] || label[seed] >= 0) continue;
        const id = next++;
        let size = 0;
        label[seed] = id; stack[sp++] = seed;
        while (sp > 0) {
            const i = stack[--sp], x = i % W, y = (i - x) / W;
            size++;
            const visit = j => { if (core[j] && label[j] < 0) { label[j] = id; stack[sp++] = j; } };
            if (x > 0) visit(i - 1);
            if (x < W - 1) visit(i + 1);
            if (y > 0) visit(i - W);
            if (y < H - 1) visit(i + W);
        }
        if (size > bestSize) { bestSize = size; bestId = id; }
    }
    for (let i = 0; i < N; i++) if (label[i] !== bestId) core[i] = 0;

    // Re-soften: a 3px blur restores an antialiased edge without reintroducing
    // the scallop, and the S-curve keeps it from reading as a glow.
    const soft = boxBlur(Float64Array.from(core), W, H, 3);
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const v = clamp(soft[i], 0, 1);
        out[i] = v * v * (3 - 2 * v);
    }
    return { alpha: out, filled };
}

/** The p-th percentile of a plane, from a subsample (exact is not needed). */
function percentile(plane, p) {
    const s = [];
    for (let i = 0; i < plane.length; i += 97) s.push(plane[i]);
    s.sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// ---------------------------------------------------------------- modes
/**
 * MATTE — the general case. Alpha from the checker amplitude that survives a
 * high-pass, then un-composite the background out of the colour.
 *
 * Colour is taken from the sharp original where the layer is opaque and from
 * the blurred estimate where it is not: the checker residue is largest exactly
 * where alpha is smallest, and there it is multiplied away.
 */
function matte(rgb, W, H, ch, fit, solid) {
    const N = W * H;
    const r = Math.round(fit.period);
    const bgMean = (fit.hi + fit.lo) / 2;

    const lum = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const j = i * ch;
        lum[i] = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
    }
    const amp = carrierAmp(lum, W, H, fit.period);

    // Self-calibrating: rather than derive the square wave's Fourier constant,
    // read the response off a region we know is bare background. Every plate is
    // at least 40% empty (measured), so the 92nd percentile IS bare checker.
    const full = percentile(amp, 0.92);

    const Lr = boxBlur(pick(rgb, N, ch, 0), W, H, r);
    const Lg = boxBlur(pick(rgb, N, ch, 1), W, H, r);
    const Lb = boxBlur(pick(rgb, N, ch, 2), W, H, r);

    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        let a = 1 - amp[i] / full;
        // The window smears the silhouette by its own radius, so an edge that is
        // hard in the artwork arrives here as a ~55px ramp. The S-curve pulls it
        // back to something like its true width; the tails snap because JPEG
        // noise otherwise leaves the sky at 2/255 and the dune at 253/255.
        a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
        a = clamp((a - 0.18) / 0.64, 0, 1);
        raw[i] = a < 0.03 ? 0 : a > 0.97 ? 1 : a;
    }
    const cleaned = cleanAlpha(raw, W, H, fit.period, solid);

    const out = Buffer.alloc(N * 4);
    for (let i = 0; i < N; i++) {
        const a = cleaned.alpha[i];
        const j = i * ch, k = i * 4;
        const blur = [Lr[i], Lg[i], Lb[i]];
        for (let c = 0; c < 3; c++) {
            // Sharp original where the layer is opaque, blurred estimate where
            // the checker still shows through — the residue is largest exactly
            // where alpha is smallest, and there it is multiplied away.
            const src = a * rgb[j + c] + (1 - a) * blur[c];
            const f = a > 0.004 ? (src - (1 - a) * bgMean) / a : 0;
            out[k + c] = clamp(Math.round(f), 0, 255);
        }
        out[k + 3] = Math.round(a * 255);
    }
    return { out, filled: cleaned.filled };
}

function pick(rgb, N, ch, c) {
    const p = new Float64Array(N);
    for (let i = 0; i < N; i++) p[i] = rgb[i * ch + c];
    return p;
}

/** Sliding-window extremum, separable, O(N) via a monotonic deque. */
function boxExtreme(src, W, H, r, wantMax) {
    const tmp = new Float64Array(W * H), dst = new Float64Array(W * H);
    const better = wantMax ? (a, b) => a <= b : (a, b) => a >= b;
    const run = (get, set, N, M) => {
        const dq = new Int32Array(N + 1);
        for (let m = 0; m < M; m++) {
            let head = 0, tail = 0;
            for (let i = 0; i < N + r; i++) {
                if (i < N) {
                    const v = get(m, i);
                    while (tail > head && better(get(m, dq[tail - 1]), v)) tail--;
                    dq[tail++] = i;
                }
                const o = i - r;
                if (o >= 0) {
                    while (dq[head] < o - r) head++;
                    set(m, o, get(m, dq[head]));
                }
            }
        }
    };
    run((y, x) => src[y * W + x], (y, x, v) => { tmp[y * W + x] = v; }, W, H);
    run((x, y) => tmp[y * W + x], (x, y, v) => { dst[y * W + x] = v; }, H, W);
    return dst;
}

/**
 * OPENING — for `stars` only, and the one plate whose result must be judged by
 * eye rather than trusted.
 *
 * Its checker is DARK (tones 60/117) and its subject is faint points of light
 * living in exactly that value range, so the amplitude estimator used above
 * would read every star as background and erase the sky. Fitting the grid
 * analytically instead is no better: a period known to ±0.05px has drifted half
 * a cell by x=5056 and starts subtracting the wrong tone.
 *
 * A grayscale opening needs neither. Eroding then dilating by a disk larger
 * than a star but smaller than a cell deletes every small bright feature and
 * leaves the checker plateaus standing — so the opening IS the background, and
 * whatever stands above it is starlight. Stars are screen-blended by the site
 * (`blend: true` in PLACE), so that difference is precisely the signal wanted.
 *
 * What it cannot recover: a faint star sitting on a dark cell whose value never
 * rises above the light cells around it. Those are gone, and no algorithm gets
 * them back from a flattened JPEG.
 */
function opening(rgb, W, H, ch, fit) {
    const N = W * H;
    const r = Math.max(3, Math.round(fit.period / 4));
    const lum = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const j = i * ch;
        lum[i] = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
    }
    const bg = boxExtreme(boxExtreme(lum, W, H, r, false), W, H, r, true);

    const out = Buffer.alloc(N * 4);
    let lit = 0;
    for (let i = 0; i < N; i++) {
        const j = i * ch, k = i * 4;
        // Gain: what survives the subtraction is a fraction of the original
        // star's brightness, because the checker it sat on was already 60-117
        // of the 255 it was composited into.
        const a = clamp(Math.round((lum[i] - bg[i]) * 1.9), 0, 255);
        const scale = a > 0 ? 255 / Math.max(rgb[j], rgb[j + 1], rgb[j + 2], 1) : 0;
        out[k] = clamp(Math.round(rgb[j] * scale), 0, 255);
        out[k + 1] = clamp(Math.round(rgb[j + 1] * scale), 0, 255);
        out[k + 2] = clamp(Math.round(rgb[j + 2] * scale), 0, 255);
        out[k + 3] = a < 8 ? 0 : a;
        if (a >= 8) lit++;
    }
    return { out, lit };
}

// ---------------------------------------------------------------- driver
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const only = process.argv[2];
    const report = [];

    for (const p of PLATES) {
        if (only && p.id !== only) continue;
        if (p.mode === 'skip') { report.push([p.id, 'KEPT', p.why]); continue; }
        const file = path.join(SRC, p.src);
        if (!fs.existsSync(file)) { report.push([p.id, 'MISSING', '']); continue; }

        const img = sharp(file);
        const meta = await img.metadata();
        const dst = path.join(OUT, `${p.id}.png`);

        if (p.mode === 'copy') {
            // Delivered on true black. The pipeline keys these by luma, so the
            // absent alpha channel costs nothing — but assert the black, because
            // a checker here would be silently keyed into garbage downstream.
            const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
            const s = Math.min(2400, info.width);
            const f = fitChecker(profile(data, info.width, s, 8, info.channels), s);
            if (f) { report.push([p.id, 'REFUSED', `checker found (contrast ${f.contrast.toFixed(0)}) — not a black plate`]); continue; }
            keepPrevious(dst);
            await sharp(file).png({ compressionLevel: 9 }).toFile(dst);
            report.push([p.id, 'copied', `${meta.width}×${meta.height}  black bg, luma-keyed downstream`]);
            continue;
        }

        const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const W = info.width, H = info.height, ch = info.channels;
        const strip = Math.min(2400, W);
        const fit = fitChecker(profile(data, W, strip, 8, ch), strip);
        if (!fit) { report.push([p.id, 'FAILED', 'no checkerboard detected in the top strip']); continue; }

        let out, note;
        if (p.mode === 'open') {
            const g = opening(data, W, H, ch, fit);
            out = g.out;
            note = `opening r=${Math.round(fit.period / 4)} tones ${fit.lo.toFixed(0)}/${fit.hi.toFixed(0)}  ` +
                `${(100 * g.lit / (W * H)).toFixed(2)}% lit  — JUDGE BY EYE`;
        } else {
            const m = matte(data, W, H, ch, fit, p.solid);
            out = m.out;
            let opaque = 0, clear = 0;
            for (let i = 3; i < out.length; i += 4) { if (out[i] === 255) opaque++; else if (out[i] === 0) clear++; }
            const n = W * H;
            note = `matte P=${fit.period} tones ${fit.lo.toFixed(0)}/${fit.hi.toFixed(0)}  ` +
                `${(100 * opaque / n).toFixed(1)}% opaque / ${(100 * clear / n).toFixed(1)}% clear  ` +
                `${(100 * m.filled / n).toFixed(2)}% holes repaired`;
        }

        keepPrevious(dst);
        await sharp(out, { raw: { width: W, height: H, channels: 4 } })
            .png({ compressionLevel: 9 }).toFile(dst);
        report.push([p.id, 'keyed', `${W}×${H}  ${note}`]);
    }

    const w = Math.max(...report.map(r => r[0].length));
    for (const [id, state, note] of report) console.log(`  ${id.padEnd(w)}  ${state.padEnd(8)}  ${note}`);
    const bad = report.filter(r => ['FAILED', 'MISSING', 'REFUSED'].includes(r[1]));
    if (bad.length) { console.error(`\nDEKEY_FAIL  ${bad.map(b => b[0]).join(', ')}`); process.exit(1); }
    console.log(`\nDEKEY_OK  ${report.length} plates -> ${path.relative(ROOT, OUT)}`);
})().catch(e => { console.error('DEKEY_FAIL', e.stack); process.exit(1); });
