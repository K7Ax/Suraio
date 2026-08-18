// ‏لماذا صارت وحدةً. كانت دالّةً عُلويّةً في `main.js`، فلمّا خرجت
// ‏«أبلغ وقيّم» إلى وحدتها كانت هي **كلَّ** ما تبقّى من اعتمادها على الملفّ
// ‏الأصل — متغيّرٌ حرٌّ واحدٌ في ٧٥٣ سطرًا. وهي سلوكٌ لا حالة (لا تحتفظ بشيء
// ‏بين الندءات)، فتُستورَد ولا تُمرَّر: القاعدةُ نفسُها التي جعلت `PREFS`
// ‏و`LOOM` وسيطَين.
//
// ‏وقارئُها الآن ثلاثة: الهيرو وقسمُ الألعاب في `main.js`، ولوحا «أبلغ»
// ‏و«اقترح» في `ui/feedback.js`.
// ---- الكشف المنسوج: مالكٌ واحد لِـ`clip-path` على النصّ ---------------------
// كان الكشف قاعدةَ CSS تُشتقّ من `.active` + `data-booted`، فوقع في عطبين
// شكاهما المالك: يُنفَق قبل أن يُرى (الهيرو محجوبٌ لحظة الإقلاع)، ويترك النصّ
// مختفيًا إن لم تُعَد الحركة تشغيلها (إطار البداية `inset(… 100%)` = خفاءٌ تامّ).
// هنا الصنف يُضاف عند لحظة الكشف نفسها ويُزال عند انتهائها — فحالة الراحة
// دائمًا «بلا clip-path»، ويستحيل أن يعلق نصٌّ مخفيًّا.
//
// شبكة الأمان زمنيّة لأن `animationend` لا يصل أبدًا إن أُلغيت الحركة (قسمٌ
// صار `display:none` في منتصفها، أو تبويبٌ خلفيّ لا يرسم).
export function weaveIn(nodes, opts) {
    const o = opts || {};
    const els = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!els.length) return;
    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
    if (reduced) return;
    const dur = o.dur || 0.53, delay = o.delay || 0;
    els.forEach((el, i) => {
        const d = delay + (o.stagger || 0) * i;
        el.classList.remove('is-weaving');
        void el.offsetWidth;                       // إعادة تشغيل مضمونة
        el.style.setProperty('--weave-dur', dur.toFixed(3) + 's');
        el.style.setProperty('--weave-delay', d.toFixed(3) + 's');
        if (o.dir === 'ltr') el.setAttribute('data-weave', 'ltr');
        else el.removeAttribute('data-weave');
        const done = () => {
            clearTimeout(t);
            el.removeEventListener('animationend', done);
            el.classList.remove('is-weaving');
            el.style.removeProperty('--weave-dur');
            el.style.removeProperty('--weave-delay');
            el.removeAttribute('data-weave');
        };
        const t = setTimeout(done, (dur + d) * 1000 + 400);
        el.addEventListener('animationend', done);
        el.classList.add('is-weaving');
    });
}
