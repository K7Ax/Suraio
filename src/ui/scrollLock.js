// ‏قفلُ تمريرِ الخلفيّة ما دامت نافذةٌ مفتوحة.
//
// ‏يُراقَب `.modal-backdrop.active` عالميًّا بدل أن تُبلِّغ كلُّ نافذةٍ عن
// نفسها: أربع عشرة نافذةً تتذكّر عقدًا هو نفسه ما ينحرف أوّلًا، والمراقبُ
// يغطّي كلَّ نافذةٍ بُنيت أو ستُبنى.
//
// ‏والقفلُ بـ`position: fixed` يفقد موضعَ التمرير، فيُحفظ عند القفل ويُعاد
// عند الفتح — وإلّا قُذف اللاعبُ إلى رأس الصفحة كلَّما أغلق لعبة.
export function initScrollLock() {
    let lockedAt = 0;
    function sync() {
        const active = document.querySelector('.modal-backdrop.active');
        const open = !!active;
        // A game modal goes full-bleed on phones, and .header (z-index 200)
        // sits above the backdrop (150) — so it would clip the board's HUD.
        // Flagged separately from the lock: only the full-bleed case needs it.
        document.body.classList.toggle('sura-game-open',
            !!(active && active.querySelector('.game-modal-container, .wordle-modal-container')));
        const locked = document.body.classList.contains('sura-modal-open');
        if (open === locked) return;
        if (open) {
            lockedAt = window.scrollY || window.pageYOffset || 0;
            document.body.style.top = `-${lockedAt}px`;
            document.body.classList.add('sura-modal-open');
        } else {
            document.body.classList.remove('sura-modal-open');
            document.body.style.top = '';
            window.scrollTo(0, lockedAt);   // position:fixed dropped it
        }
    }
    new MutationObserver(sync).observe(document.body, {
        subtree: true, childList: true,
        attributes: true, attributeFilter: ['class']
    });
    sync();
}
