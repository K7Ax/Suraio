// The loom's cloth must be a pure function of its seed. "نسيج اليوم" only means
// anything if two people on two devices see the same weave, so determinism is a
// product guarantee, not an implementation detail.
//
// Loaded via dynamic import() because src/core/loom.mjs is ESM while this suite,
// like the rest of tests/, is CommonJS — same arrangement as progression.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MOD = pathToFileURL(path.join(__dirname, "..", "src", "core", "loom.mjs")).href;
let L;

test("load loom.mjs", async () => { L = await import(MOD); });

test("saduPlan is deterministic for a given seed", () => {
    assert.deepEqual(L.saduPlan(12345), L.saduPlan(12345));
});

test("different seeds give different cloth", () => {
    const seen = new Set();
    for (let s = 0; s < 40; s++) {
        seen.add(JSON.stringify(L.saduPlan(s).bands.map(x => x.motif + x.period)));
    }
    // Not all 40 need be unique, but a generator that collapsed to one or two
    // layouts would make every day look the same.
    assert.ok(seen.size > 20, `only ${seen.size} distinct layouts in 40 seeds`);
});

test("daySeed is stable within a day and changes across days", () => {
    const d1 = new Date(2026, 6, 25, 3, 0, 0);
    const d2 = new Date(2026, 6, 25, 22, 30, 0);
    const d3 = new Date(2026, 6, 26, 3, 0, 0);
    assert.equal(L.daySeed(d1), L.daySeed(d2));
    assert.notEqual(L.daySeed(d1), L.daySeed(d3));
});

test("every motif period divides the tile width — the tile must wrap", () => {
    for (let s = 0; s < 200; s++) {
        for (const band of L.saduPlan(s).bands) {
            assert.equal(L.TILE_W % band.period, 0,
                `seed ${s}: period ${band.period} does not divide ${L.TILE_W}`);
        }
    }
});

test("the band stack is symmetrical, as a Sadu panel is", () => {
    const motifs = L.saduPlan(777).bands.map(b => b.motif);
    assert.deepEqual(motifs, motifs.slice().reverse());
});

test("tileH equals the summed band heights", () => {
    for (let s = 0; s < 50; s++) {
        const p = L.saduPlan(s);
        assert.equal(p.tileH, p.bands.reduce((n, b) => n + b.h, 0));
    }
});

test("makeRng stays in [0,1) and is reproducible", () => {
    const r1 = L.makeRng(99), r2 = L.makeRng(99);
    for (let i = 0; i < 500; i++) {
        const v = r1();
        assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
        assert.equal(v, r2());
    }
});

// --- ساعة السُّرى ------------------------------------------------------------
// The hour of the night is the one thing on the site that cannot be copied from
// a template, so it is also the one thing worth pinning down hard: every hour of
// the day must land in exactly one phase, and the boundaries must be where the
// copy says they are.
test("nightPhase covers all 24 hours with no gap", () => {
    const at = h => L.nightPhase(new Date(2026, 0, 1, h, 30));
    for (let h = 0; h < 24; h++) {
        assert.ok(L.PHASES[at(h)], `hour ${h} fell outside every phase`);
    }
});

test("nightPhase boundaries match the four named hours", () => {
    const at = h => L.nightPhase(new Date(2026, 0, 1, h, 0));
    assert.equal(at(0),  "deep");
    assert.equal(at(3),  "deep");
    assert.equal(at(4),  "dawn");
    assert.equal(at(6),  "dawn");
    assert.equal(at(7),  "day");
    assert.equal(at(16), "day");
    assert.equal(at(17), "dusk");
    assert.equal(at(19), "dusk");
    assert.equal(at(20), "deep");
    assert.equal(at(23), "deep");
});

test("every phase is a complete art direction, not a tint", () => {
    for (const [key, p] of Object.entries(L.PHASES)) {
        assert.ok(p.threads.length >= 2, `${key}: a loom needs at least two threads`);
        assert.ok(p.threads.length <= 5, `${key}: only five threads exist`);
        assert.equal(new Set(p.threads).size, p.threads.length, `${key}: duplicate thread`);
        for (const t of p.threads) assert.ok(t >= 0 && t < 5, `${key}: thread ${t} out of range`);
        assert.ok(p.ornaments.length >= 2, `${key}: needs a motif vocabulary`);
        for (const m of p.ornaments) assert.ok(L.MOTIFS[m], `${key}: unknown motif ${m}`);
        assert.ok(p.ground >= 0 && p.ground < 3, `${key}: ground out of range`);
        assert.ok(p.alt >= 0 && p.alt < 3, `${key}: alt out of range`);
        assert.ok(p.alpha > 0 && p.alpha <= 1, `${key}: alpha out of range`);
        assert.ok(p.star >= 0 && p.star <= 1, `${key}: star out of range`);
        assert.ok(p.sky >= 0 && p.sky <= 1, `${key}: sky out of range`);
        assert.equal(p.mix.length, 5, `${key}: mix must fill all five ink slots`);
        for (const i of p.mix) assert.ok(i >= 0 && i < p.threads.length, `${key}: mix points past its threads`);
        assert.ok(/^--sadu-lit/.test(p.lit), `${key}: needs its own lit colour`);
        assert.ok(p.name && p.line, `${key}: needs a name and a hero line`);
        for (const k of ["nearH", "nearTop", "farH", "farSparse", "rake", "drift"]) {
            assert.equal(typeof p.scene[k], "number", `${key}: scene.${k} missing`);
        }
        assert.ok(p.scene.drift > 0, `${key}: a drift of zero freezes the cloth`);
    }
});

// The failure this suite exists to prevent. The first version of the phases
// only re-ORDERED all five threads, so every hour drew the same colour mix and
// the owner rightly called it superficial. A phase must RESTRICT.
test("phases restrict the palette rather than permute it", () => {
    const sets = Object.values(L.PHASES).map(p => [...p.threads].sort().join(","));
    assert.equal(new Set(sets).size, 4, "two hours are drawing from the same threads");
    for (const [key, p] of Object.entries(L.PHASES)) {
        assert.ok(p.threads.length < 5, `${key}: uses every thread, so it cannot read as its own hour`);
    }
    assert.equal(L.PHASES.deep.threads.length, 2, "the deep hour must be near-monochrome");

    // Restriction alone is not enough: with an even mix, three threads still
    // average out to the same muddy result at every hour. One thread has to
    // carry the hour.
    for (const [key, p] of Object.entries(L.PHASES)) {
        const counts = p.threads.map((_, i) => p.mix.filter(m => m === i).length);
        assert.ok(Math.max(...counts) >= 3, `${key}: no thread dominates, so the hour has no colour`);
    }
    // And the light itself differs — one gold for every hour is what made dusk,
    // dawn and noon all measure as gold-dominant.
    const lits = new Set(Object.values(L.PHASES).map(p => p.lit));
    assert.equal(lits.size, 4, "two hours are lit by the same colour");
});

test("phases change the composition, not just the colour", () => {
    const shape = Object.values(L.PHASES).map(p =>
        [p.scene.nearH, p.scene.farH, p.scene.rake, p.scene.drift].join(","));
    assert.equal(new Set(shape).size, 4, "two hours compose the panels identically");
    // Night is slow and wide; noon is quick and thin. If this inverts, the
    // backdrop is loudest at exactly the hour nobody is travelling.
    assert.ok(L.PHASES.deep.scene.drift < L.PHASES.day.scene.drift);
    assert.ok(L.PHASES.deep.scene.farH > L.PHASES.deep.scene.nearH);
    assert.ok(L.PHASES.deep.scene.nearH < L.PHASES.dusk.scene.nearH);
});

test("saduPlan honours a phase's motif vocabulary", () => {
    for (const [key, p] of Object.entries(L.PHASES)) {
        const plan = L.saduPlan(99, { ornaments: p.ornaments });
        for (const m of plan.motifs) {
            assert.ok(p.ornaments.includes(m), `${key}: wove ${m}, which is not in its vocabulary`);
        }
    }
});

test("saduPlan survives a vocabulary smaller than its three slots", () => {
    // The deep hour has only two motifs, and a bare call has none at all.
    assert.equal(L.saduPlan(7, { ornaments: ["uyun"] }).motifs.every(m => m === "uyun"), true);
    assert.ok(L.saduPlan(7, { ornaments: [] }).bands.length > 0);
    assert.ok(L.saduPlan(7, { ornaments: ["not-a-motif"] }).bands.length > 0);
    assert.deepEqual(L.saduPlan(7), L.saduPlan(7, {}));
});


test("the four phases say four different things", () => {
    const lines = new Set(Object.values(L.PHASES).map(p => p.line));
    assert.equal(lines.size, 4, "two phases would say the same thing");
});

test("deep night is the lit hour and day is the quiet one", () => {
    // The whole idea collapses if the site is at its loudest at noon.
    assert.equal(L.PHASES.deep.star, 1);
    assert.equal(L.PHASES.day.star, 0);
    assert.ok(L.PHASES.day.alpha < L.PHASES.deep.alpha);
});
