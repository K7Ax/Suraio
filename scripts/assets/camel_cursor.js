#!/usr/bin/env node
// Turns pixel_camel.png into the two cursor assets the stylesheet points at.
//
// Three things here are not optional, and each one is a way this goes wrong:
//
//   TRIM FIRST. The source has transparent margin, and a cursor's hotspot is
//   measured from the FILE's top-left, not from the drawing's. Untrimmed, the
//   hotspot lands in empty space and the camel hangs away from what you click.
//
//   NEAREST-NEIGHBOUR. `image-rendering: pixelated` does NOT apply to CSS
//   cursors — the browser scales the file with its own smooth filter and there
//   is no way to ask it not to. So the file has to ARRIVE at its display size,
//   scaled with a kernel that keeps the squares square.
//
//   TWO DENSITIES. Same reason: on a 2x screen a 1x cursor is upscaled by the
//   compositor and goes soft. `image-set()` hands the retina file over instead.
//
// Run: node scripts/assets/camel_cursor.js
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '_design-src', 'pixel_camel.png');
const OUT = path.join(__dirname, '..', '..', 'public', 'brand');

// Tall enough to read as a camel, small enough not to sit on top of the thing
// you are pointing at. Below ~26px the legs merge and it becomes a smudge.
const H = 32;

(async () => {
    const base = sharp(SRC).trim({ threshold: 1 });
    const { info } = await base.toBuffer({ resolveWithObject: true });
    const w = Math.round((info.width / info.height) * H);
    console.log(`trimmed ${info.width}x${info.height} -> ${w}x${H}`);

    // Two states, because a themed cursor that reverts to the system hand over
    // every button is worse than no themed cursor at all — the affordance is the
    // part users actually rely on. `lit` is the same camel under lamplight, so
    // "you can click this" is said in the site's own language instead of the OS's.
    const VARIANTS = {
        '': null,
        '-lit': { brightness: 1.5, saturation: 1.15 },
    };

    for (const [suffix, mod] of Object.entries(VARIANTS)) {
        for (const k of [1, 2]) {
            const out = path.join(OUT, `camel-cursor${suffix}${k > 1 ? '@2x' : ''}.png`);
            let img = sharp(SRC)
                .trim({ threshold: 1 })
                .resize(w * k, H * k, { kernel: 'nearest' });
            if (mod) img = img.modulate(mod);
            await img.png({ compressionLevel: 9, palette: true }).toFile(out);
            console.log(`${path.basename(out)}  ${w * k}x${H * k}`);
        }
    }
    // The hotspot. The camel faces RIGHT, so its head is the leading edge — and
    // in an RTL page that is also the direction the eye travels from. Anchoring
    // on the muzzle makes the camel point at what it is over, the way an arrow
    // cursor's tip does; anchoring at 0,0 would leave it pointing with its tail.
    console.log(`hotspot: ${w - 2} 6   (muzzle, 1x)`);
})();
