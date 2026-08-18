// ============================================================
// Honest Arabic dictionary — shared validator for the word games.
// Strict membership, NO gibberish fallback. Deterministic, offline, no LLM.
//
// كان هنا أيضًا مُطابِقٌ صرفيّ (`isWord`) يقبل اشتقاقات الجذر بتجريد سابقةٍ
// ولاحقة. حُذف في جولة الأداء (٨ أغسطس ٢٠٢٦) لأنه **كودٌ ميّت**: الجولة ٤
// أوقفت استعماله عمدًا («لا اختراع صرفيّ — تركيبةُ حروفٍ تتحلّل إلى سابقةٍ
// وجذرٍ ليست كلمةً عربيّة»)، فبقي مُعرَّفًا ومُصدَّرًا ولا يناديه شيء —
// ٥٠٠ نداء `normalizeArabic` محتملة في دالّةٍ لا تُستدعى، ونصٌّ في الحزمة.
// القبول اليوم عضويّةٌ تامّةٌ وحدها، وهو ما تريده الألعاب الثلاث.
//
// ‏وهذا ملفٌّ غيرُ `core/dict.mjs`: ذاك **يحمّل** المعجم ويملك بنيته، وهذا
// يركّب سطحَه العامّ `window.__sura.dict` الذي تسأله الألعاب. لا يستورد
// شيئًا: كلُّ ما يحتاجه يقرؤه من `window.__sura.games` وقتَ التركيب، فنداؤه
// يجب أن يقع بعد تسجيل الألعاب — وهو حيث كان.
// ============================================================

export function initDict() {
    const G = window.__sura.games;
    const norm = window.__sura.normalizeArabic;
    function has(w) { const n = norm(w); return !!(G._dict && G._dict.has(n)); }
    const D = {
        ready: false,
        async load() { await G.loadDict(); D.ready = !!(G._dict && G._dict.size); return D.ready; },
        size() { return G._dict ? G._dict.size : 0; },
        has
    };
    window.__sura.dict = D;
}
