// ============================================================
// حبسُ التركيز داخل النافذة المفتوحة.
//
// قيس على «كَلِمة»: أربع عشرة ضغطة Tab متتالية، **كلّها** حطّت خارج
// النافذة — على مرشِّحات الرفّ ثمّ على أزرار البطاقات خلف اللوح. أي أنّ
// من يلعب بلوحة المفاتيح لا يبلغ زرّ الإغلاق ولا التلميح ولا القواعد ولا
// «تحدي اليوم»؛ ويضغط Enter فيُطلق زرًّا لا يراه خلف النافذة. وهو نقضٌ
// صريح لـWCAG 2.1.2 و2.4.3، والأسوأ منه أنّه يجعل الموقع يبدو معطوبًا.
//
// ولا يُبنى هذا في كلّ لعبةٍ على حدة — أربع عشرة نافذةً تتذكّر عقدًا هو
// نفسه ما انحرف في قائمة ESC. يُراقَب `.modal-backdrop.active` عالميًّا،
// فتُغطّى كلّ نافذةٍ بُنيت أو ستُبنى.
//
// ثلاثة أشياء تجري عند الفتح: يُنقل التركيز إلى داخل النافذة (زرّ الإغلاق
// إن وُجد)، ويُحبَس Tab/Shift-Tab في أحفادها، ويُعاد التركيز عند الإغلاق
// إلى العنصر الذي فتحها — فلا يسقط المؤشّر إلى رأس الصفحة.
// ============================================================
export function initFocusTrap() {
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),'
        + ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let openModal = null, returnTo = null;

    const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const focusables = m => Array.prototype.filter.call(m.querySelectorAll(SEL), visible);

    document.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || !openModal) return;
        const f = focusables(openModal);
        if (!f.length) { e.preventDefault(); openModal.focus(); return; }
        const first = f[0], last = f[f.length - 1];
        const here = document.activeElement;
        // خارج النافذة أصلًا (أوّل ضغطة) ⇒ يُسحَب إلى داخلها.
        if (!openModal.contains(here)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
        if (e.shiftKey && here === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus(); }
    }, true);

    function sync() {
        const m = document.querySelector('.modal-backdrop.active');
        if (m === openModal) return;
        if (!m) {
            // إغلاق: يعود التركيز إلى فاتحِ النافذة إن كان ما يزال قابلًا له.
            const back = returnTo;
            openModal = null; returnTo = null;
            if (back && document.contains(back) && visible(back)) { try { back.focus(); } catch (e) { } }
            return;
        }
        if (!openModal) returnTo = document.activeElement;
        openModal = m;
        if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1');
        // ودلالةُ الحوار. قيس على الستّ جميعًا: `role` و`aria-modal`
        // و`aria-labelledby` كلّها `null` — أي أنّ اللعبة عند قارئ الشاشة
        // ‏`div` رُسم فوق الصفحة، بلا اسمٍ ولا إعلانِ فتح. تُوضع هنا لا في
        // `index.html` لأنّ المصدر واحدٌ حينئذٍ: ما دام مفتوحًا فهو حوار،
        // مهما كانت النافذة قديمةً أو بُنيت بعد هذا السطر. (ولا يُمَسّ
        // شكلُ DOM ولا صنفٌ ولا نصّ — سماتٌ تُضاف فقط.)
        if (!m.hasAttribute('role')) m.setAttribute('role', 'dialog');
        if (!m.hasAttribute('aria-modal')) m.setAttribute('aria-modal', 'true');
        if (!m.hasAttribute('aria-labelledby') && !m.hasAttribute('aria-label')) {
            const h = m.querySelector('h1, h2, h3');
            if (h) {
                if (!h.id) h.id = 'sura-mt-' + (m.id || Math.random().toString(36).slice(2, 8));
                m.setAttribute('aria-labelledby', h.id);
            }
        }
        const target = m.querySelector('.modal-close') || focusables(m)[0] || m;
        // بعد الإطار كي تكون النافذة قد صارت مرئيّةً فعلًا؛ `focus()` على
        // عنصرٍ ما يزال مخفيًّا لا يفعل شيئًا.
        requestAnimationFrame(() => { if (openModal === m) { try { target.focus({ preventScroll: true }); } catch (e) { } } });
    }
    new MutationObserver(sync).observe(document.body, {
        subtree: true, childList: true,
        attributes: true, attributeFilter: ['class']
    });
    sync();
}
