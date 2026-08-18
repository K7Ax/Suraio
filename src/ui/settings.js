// ‏نافذةُ الإعدادات — الحجمُ والسِّمةُ وما شابه.
//
// ‏`PREFS` تُمرَّر ولا تُستورَد: هي مخزنٌ حيٌّ يُنشَأ مرّةً واحدةً في `main.js`
// ‏(`initPrefs`) ويكتب في `localStorage` ويبثّ `sura:prefs`. واستيرادُ وحدةٍ
// تُنشئ نسختَها يعني مخزنَين لا يريان بعضهما — فالتمريرُ هنا ليس ذوقًا في
// الأسلوب، بل الفرقُ بين إعدادٍ يُحفظ وإعدادٍ يُنسى.
export function initSettings(PREFS) {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const openBtn = document.getElementById('settings-button');
    const closeBtn = document.getElementById('settings-modal-close');
    const zoomLabel = document.getElementById('settings-zoom-label');
    function open() { modal.classList.add('active'); sync(); }
    function close() { modal.classList.remove('active'); }
    function sync() {
        const s = PREFS.get();
        modal.querySelectorAll('.seg-control').forEach(seg => {
            const pref = seg.dataset.pref;
            seg.querySelectorAll('button[data-val]').forEach(b => {
                const v = pref === 'fontScale' ? Number(b.dataset.val) : b.dataset.val;
                b.classList.toggle('active', v === s[pref]);
            });
        });
        if (zoomLabel) zoomLabel.textContent = Math.round(s.fontScale * 100) + '%';
    }
    modal.querySelectorAll('.seg-control').forEach(seg => {
        const pref = seg.dataset.pref;
        seg.addEventListener('click', e => {
            const b = e.target.closest('button[data-val]'); if (!b) return;
            PREFS.set(pref, pref === 'fontScale' ? Number(b.dataset.val) : b.dataset.val);
        });
    });
    const zin = document.getElementById('settings-zoom-in');
    const zout = document.getElementById('settings-zoom-out');
    zin && zin.addEventListener('click', () => PREFS.stepZoom(1));
    zout && zout.addEventListener('click', () => PREFS.stepZoom(-1));
    document.addEventListener('sura:prefs', sync);
    openBtn && openBtn.addEventListener('click', e => { e.preventDefault(); open(); });
    closeBtn && closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) close(); });
    window.__sura.openSettings = open;
}
