// ============================================================
// Close bead — every .modal-close is a misbaha bead on a thread.
// Pushing it plays the «tasbih» animation: the bead tilts along the
// thread, a gold ripple leaves it, and the neighbouring bead glows.
// Delegated on pointerdown so it fires *before* the modal starts its
// fade-out, and so modals created later are covered without rewiring.
// ============================================================
export function initCloseBead() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest && e.target.closest('.modal-close');
        if (!btn) return;
        btn.classList.remove('pushed');
        void btn.offsetWidth;              // restart the animation
        btn.classList.add('pushed');
        setTimeout(() => btn.classList.remove('pushed'), 800);
    }, true);
}
