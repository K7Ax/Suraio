// core/dict — المعجم مبنيًّا لا محمولًا.
//
// كان المعجم يُشحن مصفوفةَ JSON من ١٧٥٬٦٢٧ سلسلة، ٢٫٥٣ ميغا خامًا و٤٧١ك مضغوطة،
// ثم يُبنى منها `Set` في الخيط الرئيس. وهذا أثقل شيءٍ في الموقع كلّه: أثقل من
// الحزمة نفسها بثلاث مرّات ونصف. ويُدفع كاملًا عند فتح «نحلة» أو «صندوق الحروف»،
// أي في اللحظة التي ينتظر فيها اللاعب اللوح.
//
// وثلاث ملاحظاتٍ عن الاستعمال الفعليّ تُحرّر الشكل كلّه:
//
//   ١. المعجم **مرتَّبٌ أصلًا**، ومتوسّط الكلمة ٥٫٢ حرفًا وأقصاها ٦. فالكلمات
//      المتجاورة تتشارك بادئاتٍ طويلة، وترميز البادئة المشتركة (front coding)
//      يهبط بالخام من ٢٫٥٣ ميغا إلى ٨١٢ك وبالمضغوط من ٤٧١ك إلى **٢٠٦ك**.
//   ٢. لا شيء في المشروع يحتاج من المعجم غير `has(w)` وتَعدادٍ واحدٍ في تلميح
//      «صندوق الحروف». لا يحتاج أحدٌ مصفوفةَ ١٧٥ ألف سلسلة JS — وهي وحدها
//      عشرون ميغابايت من الكومة.
//   ٣. المرتَّب يُبحَث فيه ثنائيًّا. ١٨ مقارنة لكل استعلام، والاستعلام يقع مرّةً
//      عند تسليم كلمة. القياس: ٠٫٠٠٠٦٥ms للاستعلام الواحد — أبطأ من `Set.has`
//      بأربعة عشر ضعفًا وأسرع من أن يُقاس في مسارٍ بشريّ.
//
// فالبنية هنا: **سلسلةٌ واحدة مرصوصة + `Int32Array` بالإزاحات + بحثٌ ثنائيّ**.
// لا ١٧٥ ألف سلسلة، ولا جدول تجزئة. القياس: بناءٌ ١٧٫٠ms بدل ٢٨٫٨ms، وكومةٌ
// ~٢٫٥ ميغا بدل ~٢٠.
//
// وواجهتها **متوافقةٌ مع `Set` عمدًا** — `has` و`size` و`Symbol.iterator` —
// كي يبقى `for (const w of dict)` في تلميح «صندوق الحروف» عاملًا كما هو.
// النقل هنا تبديل تمثيلٍ لا تبديل عقد.

// صيغة الملفّ: سطرٌ لكل كلمة، أوّل حرفٍ فيه طول البادئة المشتركة مع الكلمة
// السابقة مزاحًا بـ48 (فـ'0' = صفر، '3' = ثلاثة). الطول أقصاه ٦ فلا يتجاوز '6'
// أبدًا، ولا حاجة لترميزٍ متعدّد البايت.
export const FC_BASE = 48;

/** يرمّز قائمةً مرتَّبة إلى نصٍّ مرمَّز بالبادئة المشتركة. يُستعمل في التوليد. */
export function encodeFrontCoded(words) {
    const out = new Array(words.length);
    let prev = "";
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        let k = 0;
        const lim = Math.min(prev.length, w.length);
        while (k < lim && prev.charCodeAt(k) === w.charCodeAt(k)) k++;
        out[i] = String.fromCharCode(FC_BASE + k) + w.slice(k);
        prev = w;
    }
    return out.join("\n");
}

export class Dict {
    /**
     * @param {string} packed  كلّ الكلمات ملتصقةً بلا فواصل
     * @param {Int32Array} off  إزاحاتٌ بطول n+1؛ الكلمة i هي packed[off[i]..off[i+1]]
     */
    constructor(packed = "", off = new Int32Array(1)) {
        this._p = packed;
        this._o = off;
    }

    /** يفكّ نصًّا مرمَّزًا بالبادئة المشتركة إلى المعجم المرصوص. */
    static decode(text) {
        if (!text) return new Dict();
        const lines = text.split("\n");
        // سطرٌ أخيرٌ فارغ (ملفٌّ ينتهي بسطرٍ جديد) ليس كلمة.
        const n = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
        const off = new Int32Array(n + 1);
        const parts = new Array(n);
        let prev = "", pos = 0;
        for (let i = 0; i < n; i++) {
            const l = lines[i];
            const k = l.charCodeAt(0) - FC_BASE;
            const w = prev.slice(0, k) + l.slice(1);
            parts[i] = w;
            off[i] = pos;
            pos += w.length;
            prev = w;
        }
        off[n] = pos;
        return new Dict(parts.join(""), off);
    }

    /** يبني من مصفوفةٍ عاديّة — مسار التوافق مع `words_ar.json` والاختبارات. */
    static from(words) {
        const sorted = [...words].sort();
        const off = new Int32Array(sorted.length + 1);
        let pos = 0;
        for (let i = 0; i < sorted.length; i++) { off[i] = pos; pos += sorted[i].length; }
        off[sorted.length] = pos;
        return new Dict(sorted.join(""), off);
    }

    get size() { return this._o.length - 1; }

    /** الكلمة رقم i. */
    at(i) { return this._p.slice(this._o[i], this._o[i + 1]); }

    /**
     * بحثٌ ثنائيّ. المقارنة بترتيب وحدات UTF-16، وهو نفس ترتيب `Array.sort`
     * الافتراضيّ الذي رُتّب به الملفّ — فالاتّساق شرطُ الصحّة هنا، لا تفصيل.
     */
    has(w) {
        if (!w) return false;
        let lo = 0, hi = this._o.length - 2;
        while (lo <= hi) {
            const m = (lo + hi) >> 1;
            const s = this._p.slice(this._o[m], this._o[m + 1]);
            if (s === w) return true;
            if (s < w) lo = m + 1; else hi = m - 1;
        }
        return false;
    }

    *[Symbol.iterator]() {
        const n = this._o.length - 1;
        for (let i = 0; i < n; i++) yield this._p.slice(this._o[i], this._o[i + 1]);
    }
}
