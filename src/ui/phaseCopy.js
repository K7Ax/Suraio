// ‏سطرُ الطَّور تحت العنوان، يُعاد نسجُه كلّما تبدّل طَورُ النَّول.
//
// ‏`LOOM` تُمرَّر لأنّها المِنوالُ الحيُّ الواحد الذي بُني في `main.js`؛
// و`PHASES` تُستورَد لأنّها جدولٌ ثابتٌ لا حالةَ فيه. والفرقُ بين الاثنين هو
// القاعدةُ نفسُها: ما له حالةٌ يُمرَّر، وما هو بياناتٌ يُستورَد.
import { PHASES } from '../core/loom.mjs';

export function initPhaseCopy(LOOM) {
    const el = document.getElementById('hero-phase-line');
    if (!el) return;
    // The loom announces on start(), which has already happened by the time
    // this runs — so seed from the current phase rather than waiting for the
    // next hour to turn. Silently: nothing has changed yet to reweave.
    const now = PHASES[LOOM.phase];
    if (now) el.textContent = now.line;
    document.addEventListener('sura:phase', e => {
        const line = e.detail && e.detail.line;
        if (!line || line === el.textContent) return;
        el.classList.remove('is-reweaving');
        void el.offsetWidth;              // restart the wipe
        el.classList.add('is-reweaving');
        setTimeout(() => { el.textContent = line; }, 220);
    });
}
