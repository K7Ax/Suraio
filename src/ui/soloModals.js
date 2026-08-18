// ‏نوافذُ `[data-modal-solo]` — الدخولُ والإعداداتُ والحساب — واحدةٌ فقط في
// كلّ لحظة. تُغلَق السابقةُ بضغطِ زرّ إغلاقها لا بنزعِ الصنف، كي يجري مُنظِّفُها
// الخاصّ (فكُّ قفلِ المطالبة باسمٍ مثلًا) بدل أن يبقى معلَّقًا.
export function initSoloModals() {
    function close(el) {
        const btn = el.querySelector('.modal-close');
        if (btn) btn.click();                       // يشغّل مُنظِّف النافذة نفسه
        else el.classList.remove('active');
    }
    new MutationObserver(records => {
        for (const r of records) {
            const el = r.target;
            if (!(el instanceof Element)) continue;
            if (!el.matches('[data-modal-solo].active')) continue;
            document.querySelectorAll('[data-modal-solo].active').forEach(other => {
                if (other !== el) close(other);
            });
        }
    }).observe(document.body, {
        subtree: true, attributes: true, attributeFilter: ['class']
    });
}
