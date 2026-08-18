// Generates WebP siblings for the navbar artwork. The PNGs stay on disk as the
// <picture> fallback, so this is additive and safe to re-run.
//
//   node scripts/assets/img_webp.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', '..', 'public', 'navbar');
const QUALITY = 82;

(async () => {
    const pngs = fs.readdirSync(SRC).filter(f => f.endsWith('.png'));
    if (!pngs.length) { console.error('no PNGs in ' + SRC); process.exit(1); }

    let before = 0, after = 0;
    for (const name of pngs.sort()) {
        const src = path.join(SRC, name);
        const out = src.replace(/\.png$/, '.webp');
        const meta = await sharp(src).metadata();
        await sharp(src).webp({ quality: QUALITY, effort: 6 }).toFile(out);
        const a = fs.statSync(src).size, b = fs.statSync(out).size;
        before += a; after += b;
        console.log(
            name.padEnd(26) +
            String(meta.width + 'x' + meta.height).padStart(10) +
            (Math.round(a / 1024) + 'KB').padStart(9) + ' ->' +
            (Math.round(b / 1024) + 'KB').padStart(8) +
            ('  -' + Math.round((1 - b / a) * 100) + '%').padStart(8)
        );
    }
    console.log('\ntotal: ' + Math.round(before / 1024) + 'KB -> ' + Math.round(after / 1024) + 'KB' +
        '  (-' + Math.round((1 - after / before) * 100) + '%, saved ' + Math.round((before - after) / 1024) + 'KB)');
})();
