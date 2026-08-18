// core/loom — النَّول. The backdrop is a Sadu weave, painted rather than filmed.
//
// Why this exists: the site's backdrop used to be 25MB of video that could not
// react to anything. Sadu (سدو) is Bedouin weaving, and weaving is geometry —
// bands of motifs repeated along a warp. Geometry is generatable, so the same
// backdrop costs ~0KB, adapts to the viewport, changes with the date, and can
// respond to the player.
//
// THE COMPOSITION, and why it is not a tiled background:
// A pattern repeated edge-to-edge across a screen is wallpaper, and wallpaper
// reads as generated no matter how good the pattern is — there is no author in
// it, no decision about where anything goes. So the cloth is composed instead:
//
//   • It runs on a SLANT. Traditional Sadu is strictly horizontal; a raked
//     panel is the one move that says a person placed this.
//   • There are TWO of them at different angles, scales and speeds, so the
//     backdrop has depth (parallax) rather than being a flat film.
//   • Each panel has EDGES — a selvedge, and fringe hanging off the lower one.
//     Cloth with edges is an object in space; cloth without them is a texture.
//   • Each panel dissolves at both ends into its own loose threads, so it never
//     looks cropped by the viewport.
//   • Colour is FULL strength inside the panels and absent everywhere else,
//     instead of a weak wash spread over everything.
//
// Three technical decisions worth knowing:
//   1. Every panel is one canvas painted ONCE. Motion is a CSS transform on the
//      canvas element — the compositor slides a finished bitmap and JavaScript
//      runs zero frames for it.
//   2. rAF runs only while something is actively weaving (a route change, a
//      win) and shuts itself off at the end.
//   3. `saduPlan()` is pure — a seed in, a band layout out, no canvas and no
//      DOM. That is what makes it testable, and what lets the 404 page reuse
//      the same cloth without loading the app bundle.

// ما يقرّر كم قطعةً وبأيّ دقّةٍ يُرسم هذا النَّول على هذا الجهاز. النسيج واحدٌ
// في الطبقات الثلاث — العدد والدقّة يتغيّران، لا الشكل ولا اللون.
import { budget, reduced as reducedMotion } from './tier.mjs';

// Weaving is a DISCRETE craft: a weaver can only place a thread at a crossing
// of warp and weft, never halfway between. That is why real Sadu motifs are
// stepped and blocky rather than smooth, and it is the single thing that makes
// generated Sadu look woven instead of drawn. Every motif below is therefore a
// small grid of cells, stamped square by square, exactly as it would be woven.
export const CELL = 4;          // design units per crossing (scaled at paint time)
export const TILE_W = 192;      // = 48 cells; every motif width below divides it

// '#' = thread · '+' = accent thread (the lit colour) · '.' = ground shows through
export const MOTIFS = {
    // العيون — "eyes". The most recognisable Sadu figure.
    uyun: { w: 8, rows: [
        '...##...',
        '..#..#..',
        '.#....#.',
        '#..++..#',
        '.#....#.',
        '..#..#..',
        '...##...',
    ] },
    // العرجان — the running zigzag; tiles into a continuous chevron.
    irjan: { w: 8, rows: [
        '#......#',
        '.#....#.',
        '..#..#..',
        '...##...',
    ] },
    // المشط — the comb.
    mushat: { w: 6, rows: [
        '#.#.#.',
        '#.#.#.',
        '######',
        '#.#.#.',
        '#.#.#.',
    ] },
    // الأضراس — "molars", the stepped triangle row.
    adhras: { w: 6, rows: [
        '..##..',
        '.####.',
        '######',
        '++++++',
    ] },
    // الشجرة — the tree, the widest and most ornate band.
    shajarah: { w: 12, rows: [
        '.....##.....',
        '....####....',
        '...##..##...',
        '..##.##.##..',
        '.#..#++#..#.',
        '..##.##.##..',
        '...##..##...',
        '....####....',
        '.....##.....',
    ] },
    // الدرج — the staircase. Two cells thick and climbing corner to corner, so
    // it tiles into one continuous diagonal instead of a row of solid wedges;
    // filled triangles read as heavy blocks and swallow the band.
    daraj: { w: 8, rows: [
        '#.......',
        '##......',
        '.##.....',
        '..##....',
        '...##...',
        '....##..',
        '.....##.',
        '......##',
    ] },
    // The twill that every plain ground is actually made of — a 1-cell diagonal.
    // Without it a "plain" band is flat paint and the whole thing dies.
    twill: { w: 4, rows: [
        '#...',
        '.#..',
        '..#.',
        '...#',
    ] },
};

// --- seeded randomness ------------------------------------------------------
// mulberry32: tiny, fast, and stable across engines — the same seed must give
// the same cloth on every device, because "نسيج اليوم" is shared by everyone.
export function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Local calendar date → a stable integer. Local, not UTC, so the weave turns
// over at the player's midnight — the same rule the daily puzzles use.
export function daySeed(d) {
    const n = d || new Date();
    const ymd = n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate();
    let h = Math.imul(ymd ^ 0x9E3779B9, 0x85EBCA6B) >>> 0;
    h ^= h >>> 13;
    return Math.imul(h, 0xC2B2AE35) >>> 0;
}

function hash(seed, label) {
    let s = seed >>> 0;
    const t = String(label || '');
    for (let i = 0; i < t.length; i++) s = Math.imul(s ^ t.charCodeAt(i), 0x01000193) >>> 0;
    return s >>> 0;
}

// --- the cloth plan (pure) --------------------------------------------------
const ORNAMENTS = ['uyun', 'irjan', 'mushat', 'adhras', 'shajarah', 'daraj'];

export function saduPlan(seed, opts) {
    const rnd = makeRng(seed);
    const pick = arr => arr[Math.floor(rnd() * arr.length) % arr.length];

    // The hour restricts the weaver's vocabulary: heavy solid figures at dusk,
    // open scattered ones at the deep hour. Falling back to the full set keeps
    // saduPlan(seed) usable on its own — the 404 page and the tests call it bare.
    const vocab = ((opts && opts.ornaments) || ORNAMENTS).filter(m => MOTIFS[m]);
    const list = vocab.length ? vocab : ORNAMENTS;
    // A restricted vocabulary can be smaller than the three slots, so `without`
    // only excludes while something is left to exclude.
    const without = (a, ex) => { const r = a.filter(m => ex.indexOf(m) < 0); return r.length ? r : a; };

    const outer = pick(list);
    const inner = pick(without(list, [outer]));
    const centre = pick(without(list, [outer, inner]));

    // ink / bg index into the palette arrays. Sadu is not a monochrome craft —
    // it is crimson, cream, rust and gold on black. Each band picks its own
    // thread colour, which is where the cloth stops looking like a filter.
    const ink = () => Math.floor(rnd() * 5);
    const orn = motif => ({
        motif,
        h: MOTIFS[motif].rows.length * CELL,
        period: MOTIFS[motif].w * CELL,
        ink: ink(),
        bg: Math.floor(rnd() * 3),
    });
    const ground = cells => ({
        motif: 'twill', h: cells * CELL, period: MOTIFS.twill.w * CELL,
        ink: ink(), bg: Math.floor(rnd() * 3), dim: true,
    });
    const rule = () => ({ motif: 'solid', h: CELL, period: TILE_W, ink: ink(), bg: 0 });

    // A palindrome around one centre band — the way a Sadu panel is laid out.
    // The panel is deliberately SHORT (≈40 cells): the fewer bands it has, the
    // bigger each cell can be drawn, and cell size is what separates bold
    // ornament from fine noise.
    const half = [
        ground(2), orn(outer), ground(1), rule(), ground(1), orn(inner), ground(1),
    ];
    const bands = half.concat([rule(), orn(centre), rule()]).concat(half.slice().reverse());

    return {
        tileW: TILE_W,
        tileH: bands.reduce((s, b) => s + b.h, 0),
        bands,
        motifs: [outer, inner, centre],
    };
}

// --- painting ---------------------------------------------------------------
// One band, drawn cell by cell at whatever cell size the panel calls for.
// عدد الخلايا في البلاطة الواحدة أفقيًّا. كل عرض زخرفةٍ يقسمه (انظر MOTIFS)،
// فالنسيج يعيد نفسه أفقيًّا كل هذا العدد بالضبط.
export const TILE_CELLS = TILE_W / CELL;

// ضجيجٌ **دوريّ** بدل `rnd()` المتسلسل — وهذا شرطُ الانجراف اللانهائي لا زينة.
// النسخة الأولى كانت تستهلك المولّد بالترتيب، فيخرج لكل بلاطةٍ نثارٌ مختلف،
// أي أن اللوح لا يعيد نفسه أفقيًّا — ومع الانجراف تظهر **قفزة** عند نهاية كل
// دورة. وبالمفتاح (العمود ضمن البلاطة، الصفّ) تتطابق البلاطات تمامًا، فيصير
// اللوح قابلًا للّفّ، ويبقى النثار عشوائيَّ المظهر داخل البلاطة الواحدة.
// `salt` يُبقي لكل لوحٍ نثاره الخاصّ رغم أن الدالّة صارت نقيّة.
export function noise01(salt, col, row) {
    let n = (Math.imul(salt | 0, 374761393) + Math.imul(col | 0, 668265263)
        + Math.imul(row | 0, 2246822519)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const wrapCol = v => ((v % TILE_CELLS) + TILE_CELLS) % TILE_CELLS;

function paintBand(ctx, band, y, w, cp, pal, sparse, salt) {
    const rows = band.h / CELL;
    if (!sparse) {
        ctx.fillStyle = pal.grounds[band.bg % pal.grounds.length];
        ctx.fillRect(0, y, w, rows * cp);
    }
    // How lit the cloth is at this hour. Applied once here rather than baked
    // into every colour, so the phase is one number and not a second palette.
    const lit = pal.alpha == null ? 1 : pal.alpha;

    if (band.motif === 'solid') {
        // A rule is an unbroken line of weft. In a SPARSE panel it must break up
        // like everything else — drawn solid it became four hard bright scratches
        // across the night sky, which is exactly what a distant panel must not do.
        ctx.globalAlpha = lit * (sparse ? 0.5 : 1);
        ctx.fillStyle = pal.threads[band.ink % pal.threads.length];
        if (!sparse) {
            ctx.fillRect(0, y, w, rows * cp);
        } else {
            for (let x = 0; x < w; x += cp) {
                if (noise01(salt, wrapCol(Math.round(x / cp)), 0) > sparse) continue;
                ctx.fillRect(x, y, cp + 0.5, rows * cp);
            }
        }
        ctx.globalAlpha = 1;
        return;
    }

    const m = MOTIFS[band.motif];
    const thread = pal.threads[band.ink % pal.threads.length];
    const period = m.w * cp;
    // Grounds are woven from the same thread as everything else, just barely
    // catching the light — that is what a twill IS.
    ctx.globalAlpha = (band.dim ? 0.22 : 1) * lit;

    // Accent cells are held back and drawn last, together, so their glow can be
    // set once instead of per-rect — a shadowBlur toggled thousands of times is
    // what makes a canvas backdrop expensive.
    const stars = [];
    for (let x = -period; x < w + period; x += period) {
        for (let r = 0; r < m.rows.length; r++) {
            const row = m.rows[r];
            for (let c = 0; c < m.w; c++) {
                const ch = row[c];
                if (ch === '.' || ch === undefined) continue;
                // The far panel keeps only a scatter of its threads, so it
                // reads as cloth remembered rather than cloth present.
                const col = wrapCol(Math.round(x / cp) + c);
                if (sparse && noise01(salt, col, r + 1) > sparse) continue;
                // At the deep hour the far panel stops being remembered cloth
                // and becomes sky: its threads are read as stars, not weave.
                // This is what makes the night a different picture rather than
                // a darker one.
                const asStar = ch === '+'
                    || (sparse && pal.sky && noise01(salt + 977, col, r + 1) < pal.sky);
                if (asStar && pal.star) { stars.push([x + c * cp, y + r * cp]); continue; }
                ctx.fillStyle = ch === '+' ? pal.lit : thread;
                ctx.fillRect(x + c * cp, y + r * cp, cp + 0.5, cp + 0.5);
            }
        }
    }

    // The same grid is cloth and sky. A Sadu accent cell sits exactly where a
    // weaver ties a bright thread, and at the deep hours it burns — so the
    // motifs are not "a pattern about the night", they ARE the night.
    if (stars.length) {
        ctx.globalAlpha = Math.min(1, (band.dim ? 0.5 : 1) * lit);
        ctx.shadowColor = pal.lit;
        ctx.shadowBlur = cp * (1.5 + pal.star * 3.5);
        ctx.fillStyle = pal.lit;
        for (const s of stars) ctx.fillRect(s[0], s[1], cp + 0.5, cp + 0.5);
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
    }
    ctx.globalAlpha = 1;
}

// Paints one PANEL of cloth: the band stack scaled to fill `h`, repeating
// horizontally across `w`, with a selvedge and optional hanging fringe.
// Pure apart from the ctx it is handed — this is what the 404 page reuses.
export function paintPanel(ctx, plan, pal, w, h, opts) {
    const o = opts || {};
    const salt = (o.seed || 1) >>> 0;
    const cells = plan.tileH / CELL;
    const fringeCells = o.fringe ? 3 : 0;
    // حجم الخليّة. يقبل قيمةً مفروضة (`o.cp`) لأن الانجراف يشترط أن تكون
    // البلاطة عددًا **صحيحًا** من البكسلات: بخليّةٍ كسريّة يخرج نسيجٌ دوريّ
    // في الحساب وغيرُ دوريّ في الراستر (كل بلاطة تسقط على حدودٍ جزئيّة مختلفة
    // فتختلف حوافّها)، فتظهر قفزةٌ عند لفّ الدورة قِيست بـ١٦٬٠٥٠ بكسل.
    const cp = o.cp || (h / (cells + fringeCells));

    ctx.clearRect(0, 0, w, h);

    let y = 0;
    let bi = 0;
    for (const band of plan.bands) {
        // ملحٌ مختلف لكل نطاق كي لا تتطابق نثاراتها رأسيًّا، ودوريٌّ مع ذلك.
        paintBand(ctx, band, y, w, cp, pal, o.sparse || 0, (salt + bi * 7919) | 0);
        y += (band.h / CELL) * cp;
        bi++;
    }

    if (!o.sparse) {
        // The selvedge — the finished edge a weaver leaves. Two hard lines are
        // the difference between "a panel of cloth" and "a region of pattern".
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = pal.threads[0];
        ctx.fillRect(0, 0, w, Math.max(1, cp * 0.35));
        ctx.fillRect(0, y - cp * 0.35, w, Math.max(1, cp * 0.35));
        ctx.globalAlpha = 1;
    }

    if (o.fringe) {
        // Warp ends left hanging below the last weft — uneven, as cut threads
        // always are. This is the detail that makes it read as a real textile.
        // الخطوة مضبوطةٌ لتقسم البلاطة عددًا صحيحًا من المرّات. بدونها يبقى
        // الهدب وحده غير دوريّ — والهدب على اللوح القريب، أي أظهر ما يُرى —
        // فتظهر قفزةٌ عند لفّ الانجراف مهما انضبط ما فوقه. الكثافة كما كانت.
        const K = Math.max(8, Math.round(TILE_CELLS / 0.55));
        const step = (TILE_CELLS * cp) / K;
        for (let i = 0; i * step < w; i++) {
            const x = i * step, j = i % K;
            const len = cp * (1.1 + noise01(salt + 31, j, 1) * 1.9);
            ctx.globalAlpha = 0.30 + noise01(salt + 32, j, 2) * 0.45;
            ctx.fillStyle = pal.threads[Math.floor(noise01(salt + 33, j, 3) * pal.threads.length)];
            ctx.fillRect(x, y, Math.max(1, step * 0.45), len);
        }
        ctx.globalAlpha = 1;
    }
}

// --- ساعة السُّرى — the hour of the night ------------------------------------
// سُرى means travelling by night. A site named for the night journey that looks
// exactly the same at 3am as it does at noon has thrown its own name away.
//
// So the cloth is woven for the hour the player is actually in: which threads
// dominate, which ground they sit on, how strongly the whole cloth is lit, and
// whether the accent cells burn like stars. This is the one thing on the page
// that no template can carry and no screenshot can capture — you have to be
// here, at this hour, to see this cloth.
//
// `order` indexes THREADS below, dominant thread first — band ink is drawn
// from a seeded index, so putting a colour first makes it the one you read.
const THREAD_TOKENS = [
    ['--sadu-cream',   '#f2e4c9'],
    ['--sadu-gold',    '#e0a33e'],
    ['--sadu-crimson', '#c1274a'],
    ['--sadu-rust',    '#e2652a'],
    // One cool thread that no traditional Sadu panel would carry. That single
    // wrong note is what stops the palette reading as folklore pastiche.
    ['--sadu-cool',    '#2f7d8c'],
];

// A phase is a full art direction, on the same footing as SCENES — NOT a tint.
// The first attempt at this only re-ORDERED the five threads, which changes
// nothing: every band draws its colour from a seeded index, so all five threads
// still appeared in the same proportions and the only real difference left was
// brightness. RESTRICTION is what makes a palette read, not permutation. So a
// phase now decides:
//
//   threads   — WHICH threads exist at all (two at the deep hour, not five)
//   ornaments — which motifs the weaver is allowed to use
//   scene     — how the two panels are composed: height, position, rake, scatter
//   drift     — how fast the cloth moves (night is slow)
//   sky       — how much of the far panel stops being cloth and becomes stars
//
// The deep hour is the argument for all of it: real night vision collapses
// colour, so the cloth goes almost monochrome, the panel thins, and the sky
// takes the screen. That is a different picture — not the same picture dimmed.
export const PHASES = {
    // الغروب — the hour you set out. Warm only: no cream, no cool thread. The
    // cloth sits low and heavy across the bottom, the way a horizon does.
    dusk: {
        name: 'الغروب', line: 'الليلُ في أوَّلِه، والطريقُ أمامَك',
        threads: [3, 1, 2],                                  // rust · gold · crimson
        mix: [0, 0, 0, 1, 2],                                // and rust DOMINATES
        lit: '--sadu-lit',                                    // lamp gold
        ornaments: ['shajarah', 'adhras', 'daraj'],           // solid, heavy figures
        ground: 1, alt: 1, alpha: 1.00, star: 0.25, sky: 0.00,
        scene: { nearH: 1.30, nearTop: -0.03, farH: 0.70, farSparse: 0.20, rake: 1.15, drift: 1.00 },
    },
    // عمقُ الليل — the long middle. Two threads only, and the composition flips:
    // the cloth becomes a thin band and the sparse far panel becomes a sky.
    deep: {
        name: 'عمقُ الليل', line: 'في عمقِ السُّرى، النجمُ دليلُك',
        threads: [4, 0],                                     // cool · cream
        mix: [0, 0, 0, 1, 1],
        lit: '--sadu-lit-cool',                               // starlight, not lamplight
        ornaments: ['uyun', 'irjan'],                         // open, scattered figures
        ground: 0, alt: 0, alpha: 1.00, star: 1.00, sky: 0.55,
        // The near band stays BOLD even though the night is quiet: shrink it far
        // and its cells drop under ~4px, where ornament stops being ornament and
        // becomes noise. Cell size is the floor everything else is tuned above.
        scene: { nearH: 1.15, nearTop: 0.05, farH: 1.60, farSparse: 0.38, rake: 0.65, drift: 0.45 },
    },
    // الفجر — crimson climbing from the lower edge over midnight blue, at the
    // steepest rake of the day: the hour something is about to happen.
    dawn: {
        name: 'الفجر', line: 'قبلَ أن يطلعَ الفجر… لغزٌ أخير',
        threads: [2, 0, 1],                                  // crimson · cream · gold
        mix: [0, 0, 0, 0, 1],                                // crimson floods it
        lit: '--sadu-lit-rose',
        ornaments: ['mushat', 'uyun', 'adhras'],
        ground: 2, alt: 2, alpha: 0.96, star: 0.18, sky: 0.12,
        scene: { nearH: 1.10, nearTop: 0.09, farH: 0.85, farSparse: 0.30, rake: 1.40, drift: 0.80 },
    },
    // النهار — the loom rests. This is not the site's hour and it should not
    // pretend to be: thin, high, pale, and quick.
    day: {
        name: 'النهار', line: 'كلُّ طريقٍ يحملُ قصة',
        threads: [0, 1],                                     // cream · gold
        mix: [0, 0, 0, 0, 1],                                // washed out, barely gold
        lit: '--sadu-lit-pale',
        ornaments: ['irjan', 'mushat'],
        ground: 2, alt: 2, alpha: 0.55, star: 0.00, sky: 0.00,
        scene: { nearH: 0.70, nearTop: -0.07, farH: 0.70, farSparse: 0.20, rake: 0.85, drift: 1.30 },
    },
};

// Local hours, like daySeed uses the local date — the night that matters is the
// player's night, not UTC's.
export function nightPhase(d) {
    const h = (d || new Date()).getHours();
    if (h >= 20 || h < 4) return 'deep';
    if (h >= 17) return 'dusk';
    if (h >= 7) return 'day';
    return 'dawn';
}

// --- palette ----------------------------------------------------------------
// Read from the design tokens rather than a private colour list, so the loom
// re-tints with the brand and follows the theme for free. The phase then
// re-ORDERS those same tokens instead of introducing colours of its own —
// the hour changes emphasis, never the brand.
export function palette(root, phaseKey) {
    const cs = getComputedStyle(root || document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    const key = PHASES[phaseKey] ? phaseKey : nightPhase();
    const ph = PHASES[key];
    const base = THREAD_TOKENS.map(t => v(t[0], t[1]));
    const g = [
        v('--sadu-ground-1', '#0b0f1a'),
        v('--sadu-ground-2', '#1c0d12'),
        v('--sadu-ground-3', '#0e1626'),
    ];
    return {
        phase: key,
        ground: v('--surface-0', '#070d18'),
        // Two thirds of the bands sit on the hour's ground, so the panel has a
        // dominant key rather than three grounds competing.
        grounds: [g[ph.ground], g[ph.ground], g[ph.alt]],
        // The hour decides which threads are on the loom at all — AND in what
        // proportion. `ink` is a seeded 0..4, so expanding the phase's `mix`
        // into exactly five slots is what makes one thread dominate instead of
        // all of them appearing equally. Even weighting is why the first
        // version looked the same at every hour.
        threads: ph.mix.map(i => base[ph.threads[i % ph.threads.length]]),
        lit: v(ph.lit || '--sadu-lit', '#ffd27a'),
        alpha: ph.alpha,
        star: ph.star,
        sky: ph.sky,
    };
}

// --- the composition --------------------------------------------------------
// Where each panel sits, per route. These numbers ARE the art direction: steep
// rakes, off-centre, bleeding past the edges. A backdrop that is centred and
// level is a backdrop nobody notices.
// `mask` is where along its own length the panel actually exists, in percent —
// the cloth dissolves into loose threads outside it. Keeping the window inside
// the viewport is what makes a panel read as an object with two ends rather
// than as a pattern the screen happens to crop.
export const SCENES = {
    home:       { near: { angle:  -9, top: 0.73, h: 0.26, mask: [24, 64] },
                  far:  { angle:   7, top: 0.05, h: 0.20, mask: [34, 76] } },
    games:      { near: { angle:   5, top: 0.00, h: 0.16, mask: [30, 70] },
                  far:  { angle: -12, top: 0.70, h: 0.24, mask: [26, 62] } },
    newsletter: { near: { angle: -12, top: 0.64, h: 0.26, mask: [28, 68] },
                  far:  { angle:   6, top: 0.04, h: 0.20, mask: [32, 72] } },
};

// --- easing -----------------------------------------------------------------
// The same curve as --ease-expo, evaluated in JS so canvas motion and CSS
// motion speak one language.
function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const fx = t => ((ax * t + bx) * t + cx) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return function (x) {
        let t = x;
        for (let i = 0; i < 5; i++) {
            const d = dx(t);
            if (Math.abs(d) < 1e-6) break;
            t -= (fx(t) - x) / d;
        }
        t = Math.min(1, Math.max(0, t));
        return ((ay * t + by) * t + cy) * t;
    };
}
const easeExpo = bezier(0.16, 1, 0.30, 1);

// --- the live loom ----------------------------------------------------------
export function createLoom(stage, opts) {
    const o = opts || {};
    const reduced = () => reducedMotion();

    // The DOM is built here rather than in index.html so the two panels can
    // never drift out of sync with the code that paints them.
    // القماش يُقسَّم إلى شرائح، كلٌّ لوحٌ مستقلّ يُرسم **مرّة واحدة**. التموّج
    // بعدها ليس رسمًا بل `transform` على كل شريحة — يحرّكها المُركّب وحده.
    //
    // جرّبت أولًا لوحًا واحدًا يُعاد تجميعه كل إطار: كلفة الرسم نفسها ٠٫٢١ms
    // (قِيست داخل الصفحة)، لكن الإطار كله هبط إلى **٣ إطارات/ثانية** — لأن
    // تلويث لوحين بعرض ٢٥٢٠px يرفع ٦٫٧MB من النسيج إلى المُركّب في كل إطار.
    // الشرائح تُلغي ذلك من أصله: صفر إعادة رسم، وصفر رفع، ١٦ سطر style فقط.
    // ‏١٦ هو سقفُ الجهاز القادر. الشرائح تُنشَأ مرّةً واحدة عند البناء، فكلّ
    // شريحةٍ لوحٌ (`<canvas>`) بذاكرته وطبقةِ تركيبِه — وعلى هاتفٍ بذاكرة جيغين
    // ذلك هو الثمن الأكبر في الصفحة كلّها. الميزانيّة تنزل به إلى ٨ ثمّ ٤.
    // والنسيج نفسه لا يتغيّر: العدد يقسّم القماش، لا يرسمه.
    const SEGS = budget().segs;
    function makeStrip(cls) {
        const wrap = document.createElement('div');
        wrap.className = 'loom-strip ' + cls;
        const cloth = document.createElement('div');
        cloth.className = 'loom-cloth';
        const segs = [];
        for (let i = 0; i < SEGS; i++) {
            const c = document.createElement('canvas');
            c.className = 'loom-seg';
            cloth.appendChild(c);
            segs.push(c);
        }
        wrap.appendChild(cloth);
        stage.appendChild(wrap);
        const src = document.createElement('canvas');
        return {
            wrap, cloth, segs, src, sctx: src.getContext('2d'),
            n: SEGS, W: 0, H: 0, HT: 0, topPx: 0, dpr: 1, cp: 4,
            live: null, seen: null, dirty: null, x0: null, mat: null,
        };
    }
    const far = makeStrip('loom-far');
    const near = makeStrip('loom-near');

    let phase = PHASES[o.phase] ? o.phase : nightPhase();
    let pal = palette(null, phase);
    let route = 'home';
    let seed = o.seed != null ? o.seed : daySeed();
    let wins = 0;
    let raf = 0, frames = 0;
    let progress = 1;           // 0 = nothing woven yet, 1 = both panels present

    // --- اليد على النَّول ------------------------------------------------------
    // كان هنا «المصباح»: هالةٌ ذهبية تتبع المؤشّر. حُذفت بطلب المالك — ورأيه
    // صحيح تقنيًّا أيضًا: `mix-blend-mode: screen` على طبقة بحجم الشاشة يُجبر
    // المتصفّح على إعادة تركيب المشهد كلّه مع كل حركة مؤشّر، وهي أغلى حركة في
    // الصفحة مقابل أقلّ أثر. ذهب معها إطارُ rAF وطبقةُ تركيب كاملة.
    //
    // وبقي ما تحته: **الفكّ**. يدك لا تضيء القماش، بل تفكّ خيوطه — وهذا هو
    // التفاعل الذي يقول «نَوْل» فعلًا، لا الضوء.
    // بوّابةُ رؤية. على الواجهة (`data-backdrop="video"`) يقع النسيج **خلف
    // الفيلم**، فلا أحد يرى ما تفكّه اليد — وكان الفكّ يعمل كاملًا مع ذلك:
    // قراءةُ تخطيطٍ قسريّة ومسحُ آلاف الخلايا في كلّ حركة مؤشّر، على أكثر
    // المسارات زيارةً. `setInteractive` تُناديها main.js مع تغيّر المسار.
    let interactive = true;

    // المستطيل يُقرأ عند الحاجة لا في كلّ حدث. `stage` عنصرٌ ثابت المقاس لا
    // يتحرّك إلا بتمريرٍ أو تغيير مقاس، وكلاهما يُبطله صراحةً.
    let stageRect = null;
    const dropRect = () => { stageRect = null; };

    // الفكّ يجري مرّةً في الإطار لا مرّةً في الحدث. أحداث المؤشّر تصل على
    // شاشة ١٢٠ هرتز بضِعف معدّل الإطارات، فنصف الفكّ كان يُحسب ثمّ يُطمَس
    // بحسابٍ تالٍ قبل أن يراه أحد: ٢٫٠٨ms من السكربت لكلّ حدث على مسار
    // «الألعاب» — نحو ٢٥٪ من نواةٍ كاملة لتأثيرٍ زخرفيّ.
    //
    // والحساب نفسه لم يتغيّر: نفس المسافة ونفس `dt` ونفس `tug`. ما تغيّر أنّ
    // السرعة تُقاس الآن بين إطارٍ وإطار لا بين حدثٍ وحدث — وهو ما يراه العين
    // أصلًا. ولا شيء يُفقَد: الموضع المحفوظ هو **آخر** موضع، والمواضع الوسطى
    // كانت تُطمَس على أيّة حال.
    function onPointer(e) {
        if (!interactive) return;
        const r = stageRect || (stageRect = stage.getBoundingClientRect());
        if (!r.width || !r.height) { stageRect = null; return; }
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const now = e.timeStamp || performance.now();
        if (prevPx && now > lastMove) {
            const dt = Math.max(8, Math.min(64, now - lastMove));
            tug(e.clientX, e.clientY,
                (px - prevPx[0]) / dt * 16, (py - prevPx[1]) / dt * 16);
        }
        prevPx = [px, py]; lastMove = now;
    }

    // --- الفكّ والنسج ---------------------------------------------------------
    // يدك تمرّ على النَّول فتفكّ الخيوط التي لمستها، ثم تُنسج من جديد خلفك.
    //
    // ولماذا لا موجة؟ لأن الموجة المخمّدة **فيزياء عامّة**: نفس ما يفعله الماء
    // والهلام وكل عرض إزاحة على الإنترنت. جُرّبت ورُفضت بحقّ — عاملَت السدو
    // كمطّاط، والسدو ليس مطّاطًا بل **خيوط**. القماش المنسوج لا يتموّج: ينفكّ.
    //
    // ولذلك تتحرّك الخلية **كخلية كاملة**، وتترك **فراغًا** في مكانها — وهذا هو
    // الفكّ فعلًا لا إزاحة صورة — ثم تعود إلى تقاطعها بالضبط. الحوافّ تبقى
    // حادّة لأن البكسلات تُنقل ولا تُشوَّه، والدقّة هي ما امتدحه المالك.
    //
    // وهذا مستحيل بفلتر: يحتاج قماشًا مولَّدًا خليةً خليةً، وهو ما نملكه وحدنا.
    const PAD = 56;            // px — هامش يبتلع أقصى إزاحة خلية
    const REACH = 210;         // px — نصف قطر يد الفكّ
    const CAP = 900;           // أقصى عدد خلايا منفكّة في وقت واحد
    const SETTLE = 1150;       // ms من آخر لمسة إلى السكون التامّ
    let clothRaf = 0, clothLast = 0, tugAt = 0, lastMove = 0, prevPx = null;

    // تُنفَّذ مرّة عند التخطيط: كل شريحة تأخذ نصيبها من اللوح المرسوم. تتداخل
    // الشرائح بكسلًا كي لا يظهر خيط شفّاف عند التقريب الكسري.
    function sliceCloth(strip, W, H, cp) {
        const { segs, dpr } = strip;
        const HT = H + PAD * 2;
        strip.W = W; strip.H = H; strip.HT = HT;
        strip.cp = Math.max(2, Math.round(cp));
        strip.live = [];
        strip.dirty = new Set();
        strip.seen = new Set();
        strip.x0 = [];
        const n = segs.length;
        for (let i = 0; i < n; i++) {
            const x0 = Math.floor((W * i) / n);
            const x1 = Math.ceil((W * (i + 1)) / n) + 1;
            strip.x0.push(x0);
            const c = segs[i];
            c.width = Math.round((x1 - x0) * dpr);
            c.height = Math.round(HT * dpr);
            c.style.width = (x1 - x0) + 'px';
            c.style.height = HT + 'px';
            c.style.left = x0 + 'px';
            restoreSeg(strip, i);
        }
    }

    // الشريحة كما نُسجت: نسخة مباشرة من اللوح المصدر.
    function restoreSeg(strip, i) {
        const c = strip.segs[i], g = c.getContext('2d'), d = strip.dpr;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(strip.src, strip.x0[i] * d, 0, c.width, c.height,
                    0, 0, c.width, c.height);
    }

    // نقطة على الشاشة ⇒ إحداثيات داخل القماش. اللوح مُدار ومُزاح، فبدون عكس
    // المصفوفة تنفكّ الخيوط في مكان غير الذي تلمسه — وذلك يقتل الإحساس كلّه.
    function toCloth(strip, cx, cy) {
        try {
            if (!strip.mat) {
                const t = getComputedStyle(strip.wrap).transform;
                strip.mat = (t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix()).inverse();
            }
            const r = strip.wrap.getBoundingClientRect();
            const p = strip.mat.transformPoint(
                new DOMPoint(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2)));
            return [p.x + strip.wrap.offsetWidth / 2,
                    p.y + strip.wrap.offsetHeight / 2 + PAD];
        } catch (e) { return null; }
    }

    // فكّ الخيوط تحت اليد: الخلية تنطلق بعيدًا عن مركز اليد وفي اتجاه حركتها،
    // فتُقرأ كخيط انسحب لا كجسيم انفجر.
    function unweave(strip, cx, cy, vx, vy, force) {
        if (!strip.live) return 0;
        const at = toCloth(strip, cx, cy);
        if (!at) return 0;
        const px = at[0], py = at[1];
        const cp = strip.cp, n = strip.segs.length;
        if (py < -REACH || py > strip.HT + REACH) return 0;
        if (px < -REACH || px > strip.W + REACH) return 0;
        let added = 0;
        const c0 = Math.floor((px - REACH) / cp), c1 = Math.ceil((px + REACH) / cp);
        const r0 = Math.floor((py - REACH) / cp), r1 = Math.ceil((py + REACH) / cp);
        for (let r = r0; r <= r1; r++) {
            const y = r * cp;
            if (y < 0 || y + cp > strip.HT) continue;
            for (let c = c0; c <= c1; c++) {
                const x = c * cp;
                if (x < 0 || x + cp > strip.W) continue;
                const dx = x + cp / 2 - px, dy = y + cp / 2 - py;
                const dist = Math.hypot(dx, dy);
                if (dist > REACH) continue;
                if (strip.live.length >= CAP) return added;
                // ليست كل خلية تنفكّ: النسيج يفقد خيوطًا متفرّقة لا رقعة كاملة،
                // والرقعة الكاملة تُقرأ كمحو لا كفكّ.
                const bite = (1 - dist / REACH) * force;
                // ليست كل خلية تنفكّ — لكن كثيرًا منها يفعل. المعادلة:
                // نسبة عالية + اندفاع ضعيف = رذاذ داكن (جُرّب ورُفض)؛
                // ونسبة منخفضة + اندفاع قويّ = خيوط شاردة لا فتحة في
                // النسيج. المطلوب الاثنان معًا كي تُرى **رقعة تنفكّ**.
                if (Math.random() > bite * 0.62) continue;
                const k = ((c & 0xffff) << 16) | (r & 0xffff);
                if (strip.seen.has(k)) continue;
                strip.seen.add(k);
                const away = dist < 0.001 ? 0 : 1 / dist;
                const seg = Math.min(n - 1, Math.max(0, Math.floor((x / strip.W) * n)));
                strip.live.push({
                    k: k, seg: seg, x: x, y: y, ox: 0, oy: 0,
                    vx: dx * away * bite * 12.0 + vx * 0.55,
                    vy: dy * away * bite * 12.0 + vy * 0.55,
                });
                strip.dirty.add(seg);
                added++;
            }
        }
        return added;
    }

    // كل خلية منفكّة تنجذب إلى تقاطعها الأصلي وتخمد — «تُنسج من جديد». والفراغ
    // الذي تركته يُملأ لحظة عودتها، فلا يبقى في القماش ثقب.
    function reweave(strip, fade) {
        if (!strip.live) return 0;
        const live = strip.live;
        let w = 0;
        for (let i = 0; i < live.length; i++) {
            const p = live[i];
            p.vx = (p.vx - p.ox * 0.075) * 0.905;
            p.vy = (p.vy - p.oy * 0.075) * 0.905;
            p.ox = (p.ox + p.vx) * fade;
            p.oy = (p.oy + p.vy) * fade;
            if (Math.abs(p.ox) + Math.abs(p.oy) + Math.abs(p.vx) + Math.abs(p.vy) < 0.35) {
                strip.seen.delete(p.k);
                strip.dirty.add(p.seg);
                continue;                       // عادت إلى مكانها: خيط انتُسج
            }
            live[w++] = p;
        }
        live.length = w;
        return w;
    }

    // الرسم: الشرائح المتأثّرة فقط تُعاد — لا اللوح كلّه. شريحتان أو ثلاث صغيرة
    // في الإطار بدل بِتّة بعرض ٢٥٢٠px، وهذا ما يجعل الفكرة أرخص من التموّج.
    function drawCloth(strip) {
        if (!strip.live) return;
        const touched = strip.dirty;
        for (let i = 0; i < strip.live.length; i++) touched.add(strip.live[i].seg);
        touched.forEach(i => restoreSeg(strip, i));
        const d = strip.dpr, cp = strip.cp, sz = cp * d;
        const ctxs = {};
        for (let i = 0; i < strip.live.length; i++) {
            const p = strip.live[i];
            const g = ctxs[p.seg] || (ctxs[p.seg] = strip.segs[p.seg].getContext('2d'));
            const lx = (p.x - strip.x0[p.seg]) * d, ly = p.y * d;
            g.clearRect(lx, ly, sz, sz);                        // الفراغ: خيط انفكّ
            g.drawImage(strip.src, p.x * d, p.y * d, sz, sz,
                        lx + p.ox * d, ly + p.oy * d, sz, sz);   // والخلية تسبح
        }
        touched.clear();
    }

    function clothStep(now) {
        const t = now || performance.now();
        const dt = clothLast ? Math.min(64, t - clothLast) : 16;
        clothLast = t;
        // ميزانية زمنية صارمة فوق الفيزياء: «ثم يسكن» في الوثيقة وعدٌ يُضمن
        // بالبناء لا يُرجى من معادلة. الذبول خطّي ويبلغ الصفر بعد SETTLE.
        const fade = Math.max(0, 1 - (t - tugAt) / SETTLE);
        let alive = 0;
        for (let k = Math.max(1, Math.min(4, Math.round(dt / 16))); k > 0; k--) {
            alive = reweave(near, fade) + reweave(far, fade);
        }
        drawCloth(near); drawCloth(far);
        frames++;
        if (alive && fade > 0) { clothRaf = requestAnimationFrame(clothStep); return; }
        [near, far].forEach(function (s) {
            if (!s.live) return;
            s.live.length = 0; s.seen.clear();
            for (let i = 0; i < s.segs.length; i++) restoreSeg(s, i);
        });
        clothRaf = 0; clothLast = 0;
    }

    function tug(cx, cy, vx, vy) {
        const speed = Math.min(70, Math.hypot(vx, vy));
        if (speed < 1.4 || reduced()) return;
        const force = Math.min(1, 0.30 + speed * 0.030);
        const n = unweave(near, cx, cy, vx, vy, force)
                + unweave(far, cx, cy, vx, vy, force * 0.5);
        if (!n) return;
        tugAt = performance.now();
        if (!clothRaf) { clothLast = 0; clothRaf = requestAnimationFrame(clothStep); }
    }

    // إيقاع الدخول. كان هذا «مرور الضوء» — هالة تعبر الشاشة مرّة عند الوصول —
    // وقد ذهب مع المصباح. لكن **توقيته** لم يذهب، لأن CSS تشتقّ منه لحظة كشف
    // النصّ: لو ثُبّت الرقم في الطرفين لانفصل النصّ عن ساعة الليل عند تغيّرها.
    //
    // فبقيت الدالّة سطرًا واحدًا: تنشر المدّة ولا ترسم شيئًا. صفر إطارات عند
    // الدخول بدل ٩٠ إطارًا — وهذا أثقل ما كان يُرسم في أول ثانية من الزيارة.
    function sweep() {
        // الساعة تغيّر السرعة، لكن ضمن حدّين: بلا قصّ تبلغ مدّةُ عمق الليل
        // ٢٥٥٦ms — أي أن الزائر ينتظر النصّ ٢٫٥ ثانية، وهذا انتظار لا نبرة.
        const ms = Math.max(900, Math.min(1500,
            Math.round(1150 / PHASES[phase].scene.drift)));
        try { document.documentElement.style.setProperty('--sweep', ms + 'ms'); } catch (e) { }
    }

    function layout(strip, scene, isFar) {
        const vw = stage.clientWidth || window.innerWidth;
        const vh = stage.clientHeight || window.innerHeight;
        // The hour re-composes the route's scene rather than merely tinting it:
        // a low heavy horizon at dusk, a thin band under a wide sky at the deep
        // hour, a steep climb at dawn. SCENES says where the route puts cloth;
        // this says what the hour does with it.
        const ps = PHASES[phase].scene;
        // The panel must overhang the viewport or its rotated corners show.
        const W = Math.round(vw * 1.75);
        const H = Math.max(90, Math.round(vh * scene.h * (isFar ? ps.farH : ps.nearH)));
        // السقف كان ٢ ثابتًا. صار من الميزانيّة: على `minimal` يصير ١، فتهبط
        // بكسلاتُ اللوح إلى الربع — وهي أرخص خطوةٍ في الجولة كلّها، لأنّ الكلفة
        // في الرسم مساحةٌ لا عددُ أشكال. والنسيج نفسه لا ينقص، يخشن قليلًا.
        const dpr = Math.min(budget().dpr, window.devicePixelRatio || 1);

        // هامش رأسي أعلى وأسفل يبتلع أقصى تموّج، وإلا انكشف قصٌّ حادّ عند حافّة
        // اللوح عند أول موجة. اللوح يُزاح لأعلى بنفس القدر فيبقى مكانه كما كان.
        const HT = H + PAD * 2;
        strip.src.width = Math.round(W * dpr);
        strip.src.height = Math.round(HT * dpr);
        strip.sctx.setTransform(dpr, 0, 0, dpr, 0, PAD * dpr);

        strip.dpr = dpr;
        strip.cloth.style.width = W + 'px';
        strip.cloth.style.height = HT + 'px';

        const tag = isFar ? ':far' : ':near';
        const plan = saduPlan(
            hash(seed, route + ':' + phase + tag + (isFar ? '' : ':' + wins)),
            { ornaments: PHASES[phase].ornaments }
        );
        // حجم الخليّة يُقنَص إلى شبكة **بكسل الجهاز**: عرض البلاطة هو
        // TILE_CELLS × cp، ولا يكون النسيج دوريًّا في الراستر إلا إذا كان هذا
        // العرض عددًا صحيحًا من بكسلات الجهاز — وإلّا سقطت كل بلاطةٍ على حدودٍ
        // جزئيّة مختلفة فاختلفت حوافّها، وظهرت قفزةٌ عند لفّ الانجراف (قِيست
        // ١٦٬٠٥٠ بكسل قبل هذا القنص). الفارق عن المقاس المثاليّ دون بكسلٍ واحد.
        const cpIdeal = H / ((plan.tileH / CELL) + (isFar ? 0 : 3));
        const cpPaint = Math.max(2 / dpr, Math.round(cpIdeal * dpr) / dpr);
        paintPanel(strip.sctx, plan, pal, W, H, {
            seed: hash(seed, route + phase + tag),
            fringe: !isFar,
            sparse: isFar ? ps.farSparse : 0,
            cp: cpPaint,
        });
        sliceCloth(strip, W, H, H / (plan.tileH / CELL));

        // Clamped so a steep hour can push the cloth off the top or bottom of
        // the composition without ever pushing it out of the page.
        const top = Math.min(0.92, Math.max(-0.12, scene.top + (isFar ? 0 : ps.nearTop)));
        strip.topPx = Math.round(vh * top);
        strip.wrap.style.setProperty('--strip-angle', (scene.angle * ps.rake).toFixed(2) + 'deg');
        strip.wrap.style.setProperty('--strip-top', strip.topPx + 'px');
        strip.wrap.style.setProperty('--cloth-pad', PAD + 'px');
        strip.mat = null;                      // الميل تغيّر ⇒ يلزم عكسٌ جديد
        strip.wrap.style.setProperty('--strip-h', H + 'px');
        // الانجراف — عاد بأمر المالك (١٢ أغسطس ٢٠٢٦): «نقوشات السدو أبيها
        // تتحرّك كأنّ شخصًا يسحبها بشكل لا نهائي في الألعاب ونشرة سُرى».
        // كان قد حُذف لأن حركةً دائمة بلا سبب هي توقيع شاشة التوقّف
        // (docs/architecture/identity.md §٢) — والقرار قرار المالك، ومكتوبٌ هنا كي يُقرأ
        // اختيارًا لا سهوًا. وهو محصورٌ في المسارين: الواجهة يغطّيها الفيلم.
        //
        // المسافة **بلاطةٌ واحدة بالضبط** لا رقمًا ذوقيًّا: اللوح يعيد نفسه
        // أفقيًّا كل TILE_CELLS خليّة (وقد صار كذلك حقًّا بعد تدوير الضجيج
        // أعلاه)، فالانتقال من صفر إلى ‎-بلاطة ثم العودة لا يُرى أبدًا. أمّا
        // التغطية فمضمونة: اللوح أعرض من شريطه بـ٢٥٪ والقناع يُذيب الحافّتين.
        //
        // والسرعة بالبكسل/الثانية لا بالمدّة: مدّةٌ ثابتة تعني أن اللوح
        // الأكبر ينزلق أسرع، فتختلف سرعة القماشين على الشاشة نفسها.
        //
        // السرعة رُفعت من ٩ إلى ٢٦ بكسل/ثانية بأمر المالك (١٥ أغسطس ٢٠٢٦):
        // «أسرِع حركة شريط السدو». والحدّان تبعاها — سقفُ ٩٠ ثانية كان يعني
        // بلاطةً تعبر الشاشة في دقيقةٍ ونصف، وهي سرعةٌ لا تُرى أصلًا.
        //
        const tilePx = TILE_CELLS * cpPaint;
        const pxPerSec = 26 * ps.drift;
        // ‏«زِقزاق» — سعةُ التعرّج العموديّ. القماشُ الأقربُ يتعرّج أكثر:
        // فرقُ السعة بين اللوحين هو ما يُبقي التباعُدَ (parallax) قائمًا بدل
        // أن يتحرّك المشهد كقطعةٍ واحدة.
        //
        // والسقفُ ليس ذوقيًّا: `PAD` = ٥٦ بكسل من الهامش المرسوم فوق النطاق
        // وتحته، فأيُّ سعةٍ دونه لا تكشف حافّةً أبدًا. ١٦ و٩ تتركان ثلاثة
        // أضعافها احتياطًا.
        setDrift(strip, tilePx,
            Math.max(6, Math.min(40, tilePx / pxPerSec)),
            isFar ? 9 : 16);
        const mk = scene.mask || [28, 68];
        strip.wrap.style.setProperty('--mask-a', mk[0] + '%');
        strip.wrap.style.setProperty('--mask-b', mk[1] + '%');
        return plan;
    }

    // ‏الانجراف — قياسٌ كشف أنّه لم يكن مُركَّبًا أصلًا
    // ------------------------------------------------------------------
    // كان في CSS: `@keyframes loom-pull` تحرّك `transform` مكتوبًا بـ
    // ‏`calc(-1 * var(--drift-x))`. والتعليق فوقه كان يقول إنّ المُركِّب
    // يتولّاه وإنّ جافاسكربت تصفر — والنصفُ الأوّل كان **خطأً**.
    //
    // فحركةٌ تمرّ قيمتُها بمتغيّر CSS لا يستطيع المُركِّب أخذَها إلى خيطه:
    // المتغيّر يُحَلّ في إعادة حساب الأنماط، فتُحسب الأنماطُ كلَّ إطار.
    // والقياس (٤× خنقٍ للمعالج، ست ثوانٍ سكونٍ على مسار النشرة):
    //
    //     الانجراف موقوف →  ٣٦٧م.ث إعادةَ حسابِ أنماط
    //     الانجراف يعمل   →  ٨٤٤م.ث
    //
    // أي نحو ٤٨٠م.ث في كلّ ستّ ثوانٍ ثمنًا لخلفيّةٍ لا تفعل شيئًا. لم يكن
    // هذا من تسريعِ اليوم — كان قائمًا قبله — لكنّه في هذه الحركة بعينها،
    // وشرطُ المالك أن لا تمسّ التعديلاتُ الأداء، فيُصلَح لا يُورَث.
    //
    // والحلّ: WAAPI بأرقامٍ صريحة. لا متغيّرَ في القيمة ⇒ لا حلَّ في الأنماط
    // ⇒ المُركِّبُ يأخذها فعلًا. وهي تُبنى في `layout()` حيث `tilePx` معلومةٌ
    // أصلًا، فلا حسابَ جديد.
    function setDrift(strip, dist, durSec, zig) {
        if (strip.drift) { strip.drift.cancel(); strip.drift = null; }
        // الواجهة يغطّيها الفيلم: انجرافٌ تحته عملٌ لا يراه أحد. والسكون
        // يُحترَم هنا لا في CSS — صار محرّكُ الحركة هنا.
        if (route === 'home' || reduced() || !strip.cloth.animate) return;
        const at = (fx, fy) => ({
            transform: `translate3d(${(-dist * fx).toFixed(2)}px, ${fy}px, 0)`,
        });
        // خمسُ نقاطٍ وزمنٌ خطّيّ ⇒ خطوطٌ مستقيمةٌ بزوايا حادّة: زِقزاقٌ لا موجة.
        // والنهايةُ بلاطةٌ كاملةٌ أفقيًّا وصفرٌ رأسيًّا — وإلّا رُئيت قفزةٌ
        // عند كلّ دورة.
        strip.drift = strip.cloth.animate(
            [at(0, 0), at(0.25, zig), at(0.5, 0), at(0.75, -zig), at(1, 0)],
            { duration: durSec * 1000, iterations: Infinity, easing: 'linear' });
    }

    let lastPlan = null;
    function build() {
        const scene = SCENES[route] || SCENES.home;
        layout(far, scene.far, true);
        lastPlan = layout(near, scene.near, false);
        frames++;
    }

    // Announce the hour so the page's words can follow the cloth. The loom
    // deliberately does not touch the copy itself — it knows about thread, not
    // about headlines.
    function announce() {
        document.documentElement.setAttribute('data-phase', phase);
        try {
            document.dispatchEvent(new CustomEvent('sura:phase', {
                detail: { phase, name: PHASES[phase].name, line: PHASES[phase].line },
            }));
        } catch (e) { /* older engines: the data-attribute is enough */ }
    }

    // A player who opens the site at 19:58 should watch it cross into night.
    // One comparison a minute, and a repaint only on the four moments a day
    // when the answer actually changes.
    let phaseTimer = 0;
    function watchPhase() {
        clearInterval(phaseTimer);
        phaseTimer = setInterval(() => {
            const next = nightPhase();
            if (next === phase) return;
            phase = next;
            pal = palette(null, phase);
            build();
            announce();
        }, 60000);
    }

    // ‏«مرور المكوك» — انتقالُ المسار (١٥ أغسطس ٢٠٢٦، بأمر المالك: «ينتقل من
    // صفحة الألعاب إلى النشرة بطريقةٍ إبداعيّة»).
    //
    // كان اللوحان يدخلان معًا من الجهة نفسها ويستقرّان: انزلاقٌ مهذّبٌ لا
    // يقول شيئًا. وصارا **يتقاطعان**: القريبُ يمضي في اتّجاه، والبعيدُ في
    // ضدّه — وهي حركةُ المكوك على النَّول حرفيًّا، يذهب ويعود فيُنسَج الصفّ.
    // فالانتقالُ بين صفحتين صار نسجَ صفٍّ جديد، لا تبديلَ خلفيّة.
    //
    // والقريبُ وحدَه يتجاوز موضعَه قليلًا ثمّ يرتدّ إليه (`easeBack`): شدُّ
    // الخيط حتى يستوي. وهذا مقصورٌ على تغيير المسار — الوصولُ الأوّل استقرارٌ
    // لا رمية، فلا شيءَ قبله ليُنسَج عليه.
    //
    // ولا كلفة: العنصران هما نفسُهما، والخاصيّةُ هي نفسُها (`transform`)،
    // والإطاراتُ هي نفسُها — يتغيّر الرقمُ المكتوبُ في المتغيّر لا عددُ
    // العمليّات. وتنتهي الحركةُ فيعود النَّولُ إلى صفرِ إطار.
    const easeBack = bezier(0.34, 1.56, 0.52, 1);
    let crossing = false;

    function apply() {
        // The panels arrive by sliding in along their own rake and settling —
        // transform only, never opacity on a fixed section (see style.css:118).
        const k = easeExpo(progress);
        const nk = crossing ? easeBack(progress) : k;
        near.wrap.style.setProperty('--strip-in', (1 - nk).toFixed(4));
        // ‏الإشارةُ سالبةٌ دائمًا لا في الانتقال وحده: التقاطعُ تركيبٌ لا
        // مؤثّر، ولو كان مؤقّتًا لاستقرّ اللوحُ البعيدُ على موضعين مختلفين
        // قبل أوّل انتقالٍ وبعده.
        far.wrap.style.setProperty('--strip-in', (-(1 - k * 0.85)).toFixed(4));
    }

    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function run(ms, done) {
        stop();
        if (reduced()) { progress = 1; apply(); done && done(); return; }
        const t0 = performance.now();
        const step = now => {
            const k = Math.min(1, (now - t0) / ms);
            progress = k;
            frames++;
            apply();
            if (k < 1) raf = requestAnimationFrame(step);
            else { raf = 0; progress = 1; apply(); done && done(); }
        };
        raf = requestAnimationFrame(step);
    }

    let resizeTimer = 0;
    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { build(); }, 150);
    }

    return {
        start() {
            build();
            announce();
            progress = 0; apply();
            addEventListener('resize', onResize, { passive: true });
            addEventListener('resize', dropRect, { passive: true });
            addEventListener('scroll', dropRect, { passive: true, capture: true });
            addEventListener('pointermove', onPointer, { passive: true });
            addEventListener('pointerdown', onPointer, { passive: true });
            watchPhase();
            crossing = false;
            run(900);
            sweep();
        },
        reweave(routeName) {
            const next = SCENES[routeName] ? routeName : 'home';
            if (next === route) return;
            route = next;
            build();
            crossing = true;
            progress = 0; apply();
            // ‏٦٢٠ لا ٩٠٠: الرميةُ حركةُ يدٍ لا انزلاقُ ستارة. وما بعد الحركة
            // صفرُ إطارٍ كما كان، فالتقصيرُ يوفّر عملًا ولا يضيف شيئًا.
            run(620, () => { crossing = false; });
        },
        // A win adds another woven band to the near panel — the backdrop keeps
        // score, and the cloth genuinely changes rather than just flashing.
        weaveRow() { wins++; build(); },
        // «اختبار الليلة الثلاثين» (docs/architecture/identity.md §6): قماش الزائر الجديد
        // خفيف، وقماش صاحب الشهر كثيف. بلا رقم ولا شارة — كثافةً تُلمَح فقط.
        setWins(n) {
            const v = Math.max(0, Math.min(9, n | 0));
            if (v === wins) return;
            wins = v; build();
        },
        get wins() { return wins; },
        // اليد على النَّول تعمل حين يُرى النَّول وحده. على الواجهة يقع القماش
        // خلف الفيلم، ففكُّ خيوطٍ لا يراها أحد عملٌ خالص. تُناديها main.js مع
        // كلّ تغيّر مسار.
        setInteractive(on) {
            interactive = !!on;
            if (!interactive) { prevPx = null; stageRect = null; }
        },
        get interactive() { return interactive; },
        retint() { pal = palette(null, phase); build(); },
        // Escape hatch for previewing an hour you are not currently in — the
        // whole point is that it changes, so it has to be inspectable.
        setPhase(next) {
            if (!PHASES[next]) return;
            phase = next;
            pal = palette(null, phase);
            build();
            announce();
        },
        get phase() { return phase; },
        get seed() { return hash(seed, route); },
        get plan() { return lastPlan; },
        get frames() { return frames; },
        get weaving() { return raf !== 0; },
        // مكشوف عمدًا: «صفر إطار عند الراحة» ادّعاءٌ يجب أن يكون قابلًا للقياس
        // من الخارج، لا وعدًا في تعليق.
        get clothLive() { return clothRaf !== 0; },
        get clothCells() { return (near.live ? near.live.length : 0) + (far.live ? far.live.length : 0); },
        stop() {
            stop();
            cancelAnimationFrame(clothRaf); clothRaf = 0;
            clearInterval(phaseTimer);
            removeEventListener('resize', onResize);
            removeEventListener('resize', dropRect);
            removeEventListener('scroll', dropRect, { capture: true });
            removeEventListener('pointermove', onPointer);
            removeEventListener('pointerdown', onPointer);
            stage.innerHTML = '';
        },
    };
}
