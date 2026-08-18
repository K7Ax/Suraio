// scripts/px_asset — turn a delivered pixel-art plate into a usable asset.
//
// Image generators hand back pixel art the way they hand back everything else:
// a large smooth bitmap. The art underneath is genuinely on a grid, but it has
// been upscaled with interpolation, so every hard edge has become a two- or
// three-pixel ramp and a 64-column drawing arrives as a 1536-pixel 2MB PNG.
//
// Shipping that as-is would defeat the whole direction: `image-rendering:
// pixelated` cannot un-blur an edge, and the browser would then scale a blurry
// bitmap by a fractional amount on top of that. So the plate is brought back to
// its NATIVE resolution — one output pixel per authored cell — which restores
// hard edges, drops the size by ~99%, and puts the asset on the same integer
// grid as everything the renderer draws.
//
// Usage:  node scripts/assets/px_asset.js public/px/horizon.png [--block N]
const sharp = require('sharp');
const path = require('node:path');

// How well does the image hold still inside blocks of size `d`? If `d` is the
// true cell size, colour barely varies within a block and the score is near
// zero; if it is wrong, blocks straddle edges and the score climbs. Interpolated
// upscales never score a clean zero, so the winner is the LARGEST size that
// still comes in under the threshold — the largest cell that explains the image.
function blockScore(data, W, H, C, d) {
    let err = 0, n = 0;
    for (let by = 0; by + d <= H; by += d) {
        for (let bx = 0; bx + d <= W; bx += d) {
            // Compare the block's corners against its centre. Sampling the whole
            // block is 30x slower and says the same thing.
            const cx = bx + (d >> 1), cy = by + (d >> 1);
            const ci = (cy * W + cx) * C;
            for (const [ox, oy] of [[1, 1], [d - 2, 1], [1, d - 2], [d - 2, d - 2]]) {
                const i = ((by + oy) * W + (bx + ox)) * C;
                err += Math.abs(data[i] - data[ci]) + Math.abs(data[i + 1] - data[ci + 1])
                     + Math.abs(data[i + 2] - data[ci + 2]) + Math.abs(data[i + 3] - data[ci + 3]);
                n++;
            }
        }
    }
    return n ? err / n : Infinity;
}

async function main() {
    const file = process.argv[2];
    if (!file) { console.error('usage: node scripts/assets/px_asset.js <file.png> [--block N]'); process.exit(1); }
    const forced = process.argv.indexOf('--block');
    const src = sharp(file).ensureAlpha();
    const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = info;

    let block = forced > 0 ? parseInt(process.argv[forced + 1], 10) : 0;
    if (!block) {
        // Only sizes that divide the canvas evenly — a cell size that does not
        // is a cell size the artwork cannot actually have been drawn on.
        const cands = [];
        for (let d = 4; d <= 64; d++) if (W % d === 0 && H % d === 0) cands.push(d);
        let best = 1;
        for (const d of cands) if (blockScore(data, W, H, C, d) < 6) best = d;
        block = best;
    }
    const nw = Math.round(W / block), nh = Math.round(H / block);

    // Resample by reading each block's CENTRE rather than averaging it. The
    // average would fold the interpolation ramps back in and give soft colours;
    // the centre is the one sample the upscaler did not touch.
    const out = Buffer.alloc(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
            const sx = Math.min(W - 1, x * block + (block >> 1));
            const sy = Math.min(H - 1, y * block + (block >> 1));
            const si = (sy * W + sx) * C, di = (y * nw + x) * 4;
            out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2];
            // Alpha is forced to fully on or fully off. A pixel that is 40%
            // present is a leftover of the blur, and a soft edge is exactly what
            // this whole pipeline exists to remove.
            out[di + 3] = data[si + 3] > 127 ? 255 : 0;
        }
    }

    // Trim the empty margin the generator padded around the drawing, so the
    // renderer can place the plate by its own edges instead of guessing.
    let x0 = nw, y0 = nh, x1 = -1, y1 = -1;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        if (out[(y * nw + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) { console.error('the plate is entirely transparent'); process.exit(1); }

    const dst = file.replace(/\.png$/i, '.native.png');
    await sharp(out, { raw: { width: nw, height: nh, channels: 4 } })
        .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
        .png({ compressionLevel: 9, palette: true })
        .toFile(dst);

    const before = (await sharp(file).metadata()).size;
    const after = (await sharp(dst).metadata()).size;
    console.log(`${path.basename(file)}  ${W}x${H} → ${x1 - x0 + 1}x${y1 - y0 + 1}` +
                `  (cell ${block}px)  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(1)}KB`);
}

main();
