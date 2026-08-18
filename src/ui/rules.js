// ============================================================
// Per-game rules — a small ⓘ on each card and inside each game HUD
// opens a short Arabic explanation. Text comes from each game's
// levels.register({rules}) config, resolved at click time.
// ============================================================
export function initRules() {
    const modal = document.getElementById('rules-modal');
    const titleEl = document.getElementById('rules-title');
    const bodyEl = document.getElementById('rules-body');
    const closeBtn = document.getElementById('rules-modal-close');
    const EMOJI = { wordle: '🔤', connections: '🔗', sudoku: '🔢', spelling_bee: '🐝', letterboxed: '🔡', strands: '🧵', tiles: '🔷', pips: '🎲', amthal: '🗣️', missing_word: '✏️', story_order: '🧩', warmer: '🎯', lamha: '💡', zayid: '🃏' };
    function rulesText(game) {
        const cfg = window.__sura.levels && window.__sura.levels.cfgOf(game);
        return (cfg && cfg.rules) || 'افتح اللعبة واكتشف قواعدها — أو جرّب التلميح الذكي.';
    }
    function open(game) {
        if (!modal) return;
        const title = (window.__sura.meta && window.__sura.meta.titleOf(game)) || game;
        if (titleEl) titleEl.innerHTML = `<span class="rules-emoji">${EMOJI[game] || '🎮'}</span> <span>${title}</span>`;
        if (bodyEl) bodyEl.textContent = rulesText(game);
        modal.classList.add('active');
    }
    function close() { if (modal) modal.classList.remove('active'); }
    closeBtn && closeBtn.addEventListener('click', close);
    modal && modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && modal.classList.contains('active')) close(); });
    document.querySelectorAll('.card-info-btn[data-rules]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); open(btn.dataset.rules); });
    });
    window.__sura.rules = { open, close };
}
