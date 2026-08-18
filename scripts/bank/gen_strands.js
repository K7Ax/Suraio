// gen_strands.js — pack Saudi themes into "Strands" (خيوط) boards. Each theme's
// spangram + words are placed as snaking 8-direction paths on a grid (no cell
// reused across words), remaining cells filled with common Arabic letters.
//
// Output: bank/strands.json  [{ theme, spangram, words, rows, cols, grid, placements }]
// Usage: node scripts/bank/gen_strands.js
'use strict';
const fs = require('fs');

const NORM = s => String(s).normalize('NFC')
    .replace(/[ً-ْٰؐ-ؚۖ-ۭـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').trim();

const FILLER = 'اللللاللمنيورتبهسدكعفقمناةيورتبا'.split(''); // weighted toward common letters
const ROWS = 8, COLS = 6;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function rint(n) { return Math.floor(Math.random() * n); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; }

// Try to place `word` (array of letters) into the grid via randomized DFS over
// empty cells, 8-direction adjacency, no reuse. Returns the path or null.
function placeWord(grid, word) {
    const starts = shuffle([...Array(ROWS * COLS).keys()]);
    for (const s of starts) {
        const sr = (s / COLS) | 0, sc = s % COLS;
        if (grid[sr][sc] !== null) continue;
        const path = [];
        const used = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
        if (dfs(grid, used, word, 0, sr, sc, path)) return path;
    }
    return null;
}
function dfs(grid, used, word, i, r, c, path) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
    if (used[r][c] || grid[r][c] !== null) return false;
    used[r][c] = true; path.push([r, c]);
    if (i === word.length - 1) return true;
    for (const [dr, dc] of shuffle(DIRS)) {
        if (dfs(grid, used, word, i + 1, r + dr, c + dc, path)) return true;
    }
    used[r][c] = false; path.pop();
    return false;
}

function buildBoard(theme) {
    const span = NORM(theme.spangram);
    const words = theme.words.map(NORM);
    const all = [span, ...words];
    // place longest first for better packing; retry a few times
    for (let attempt = 0; attempt < 200; attempt++) {
        const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        const placements = {};
        const ordered = [span, ...shuffle(words)].sort((a, b) => b.length - a.length);
        let ok = true;
        for (const w of ordered) {
            const path = placeWord(grid, w.split(''));
            if (!path) { ok = false; break; }
            path.forEach(([r, c], k) => { grid[r][c] = w[k]; });
            placements[w] = path;
        }
        if (!ok) continue;
        // fill remainder
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] === null) grid[r][c] = FILLER[rint(FILLER.length)];
        return {
            theme: theme.theme, spangram: span, words,
            difficulty: (theme.difficulty != null ? theme.difficulty : 1),
            rows: ROWS, cols: COLS,
            grid: grid.map(row => row.join('')),
            placements
        };
    }
    return null;
}

const themes = JSON.parse(fs.readFileSync('bank/saudi/strands_themes.json', 'utf8'));
const out = [];
for (const t of themes) {
    const b = buildBoard(t);
    if (b) { b.cultural_tags = ['saudi', 'strands']; out.push(b); }
    else console.error('FAILED to pack theme:', t.theme);
}
fs.writeFileSync('bank/strands.json', JSON.stringify(out, null, 1));
console.log('strands boards:', out.length, '/', themes.length);
if (out[0]) { console.log('sample theme:', out[0].theme, 'spangram:', out[0].spangram); console.log(out[0].grid.join('\n')); }
