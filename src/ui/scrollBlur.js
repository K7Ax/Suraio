// ‏صنفٌ على الجذر أثناء التمرير، يُرفع بعد سكونٍ قصير.
//
// ‏تستعمله `style.css` لتخفيف ما يَغلى أثناء الحركة (ضبابٌ وظلالٌ وطبقات)،
// فالتمريرُ يبقى سلسًا ثمّ يعود المظهرُ كاملًا عند الوقوف. المهلةُ ١٥٠ms:
// أقصرُ منها يُرفرِف الصنفُ بين دفعتَي تمرير، وأطولُ يُبقي المظهرَ المخفَّف
// مرئيًّا بعد أن يكون الإصبعُ قد رُفع.
//
// ‏`capture: true` لأنّ التمريرَ قد يقع على حاويةٍ داخليّة لا على النافذة،
// و`passive: true` لأنّ المُنصِتَ لا يُلغي الحدث أبدًا — والوعدُ بذلك يسمح
// للمتصفّح ألّا ينتظره قبل الرسم.
export function initScrollBlur() {
    const root = document.documentElement;
    let t = 0, on = false;
    const rest = () => { on = false; root.classList.remove('sura-scrolling'); };
    addEventListener('scroll', () => {
        if (!on) { on = true; root.classList.add('sura-scrolling'); }
        clearTimeout(t);
        t = setTimeout(rest, 150);
    }, { passive: true, capture: true });
}
