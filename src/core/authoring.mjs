// core/authoring — the AI proposal layer that feeds the banks.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A CONTRADICTION OF core/checks.
// checks.mjs opens by explaining why a model must not generate a puzzle. That
// still holds, and nothing here changes it. What changed is that we measured the
// actual constraint. Each daily game runs ~104 times a year and draws from a
// BAND BUCKET, and the buckets are: أمثال 10/10/10, قرّبها 10/10/10, لمحة 8/9/8.
// A player meets the same proverb every other month. checks.mjs already names
// the only fix — «the owner can then act on the only thing that would actually
// help: more content» — and this file is that fix.
//
// So the division is precise:
//   • checks.mjs  — code GATES. Set membership, connectivity, uniqueness.
//   • resolve.mjs — code GENERATES the board, deterministically, from the bank.
//   • authoring   — a model PROPOSES bank CONTENT, offline, never at play time,
//                   and never reaching a player without passing checks.mjs AND
//                   a human /adopt. CONSTITUTION §8 forbids AI authoring a level
//                   at play time and requires human approval; it does not forbid
//                   a reviewed proposal, which is what a human author would file.
//
// WHAT IS AUTHORABLE AND WHAT IS NOT — decided by whether code can already do it
// better, not by taste:
//   authorable  تشابك · كَلِمة · أمثال · لمحة · قرّبها — world knowledge and free
//               text. No algorithm produces «في الحركة بركة» or a good clue.
//   NOT         نحلة · صندوق الحروف · خيوط · سودوكو · بيبس — set maths and
//               solvers, correct BY CONSTRUCTION (gen_bank.js). A model asked
//               for Arabic words invents ones that look right and do not exist;
//               we shipped exactly that bug and fixed it in Round 4.
//
// RETRIEVAL IS LEXICAL, NOT VECTOR — and that is a constraint, not a preference:
// Groq exposes no embeddings endpoint at all, so pgvector RAG would mean adding
// a second provider for retrieval alone. BM25 over the repo's own prose needs no
// provider, is deterministic (the same question retrieves the same context, so a
// bad proposal is reproducible), and costs nothing. The strongest grounding here
// is not the docs anyway: it is few-shot from bank rows the owner already
// approved. Style is shown, not described.
//
// PURE MODULE. No fs, no fetch, no Deno. The caller reads the corpus and calls
// Groq; this file decides what to ask, and what to believe of the answer.
// normalizeArabic is INJECTED (`norm`) for the same reason checks.mjs injects it.

// ── What each game's bank row looks like, and what the model must not get wrong.
//
// `shape` is echoed into the prompt verbatim as the required JSON. It is copied
// from a REAL row of each bank rather than written by hand, because the parser
// and the generator both key off these exact field names — a prompt that drifts
// from the bank shape produces proposals that parse and then break at play time.
export const AUTHORABLE = {
    connections: {
        file: 'bank/saudi/connections.json',
        title: 'تشابك',
        // The bank row carries 4 groups; decoys are added at assemble time by
        // banks.mjs, so the author must NOT invent them.
        shape: '{"groups":[{"theme":"…","difficulty":1,"words":["…","…","…","…"]}],"cultural_tags":["saudi","connections"]}',
        rules: [
            'أربع مجموعات بالضبط، وكل مجموعة أربع كلمات بالضبط.',
            'الستّ عشرة كلمة مختلفة تمامًا — ولا كلمة تصلح لمجموعتين.',
            'هذا أخطر ما في اللعبة: «الصقر» طائرٌ بريّ ورياضةٌ تراثيّة معًا، فلا يصلح.',
            'difficulty لكل مجموعة من ١ (أوضحها) إلى ٤ (أخفاها).',
            'لا تضف كلماتٍ مموّهة — الكود يضيفها بنفسه.'
        ],
        key: it => (it.groups || []).map(g => g.theme).join('|')
    },
    wordle: {
        file: 'bank/saudi/wordle.json',
        title: 'كَلِمة',
        shape: '{"word":"…","hint":"…","cultural_tags":["saudi","wordle"]}',
        rules: [
            'الكلمة عربيّةٌ فصيحةٌ موجودةٌ في المعجم، بلا تشكيل ولا همزات زائدة.',
            'من أربعة إلى ستّة حروف.',
            'التلميح لا يذكر الكلمة ولا مقطعًا من ثلاثة حروفٍ منها.',
            'التلميح ≤ ٦٠ حرفًا، وسطرٌ واحد.'
        ],
        key: it => String(it.word || '')
    },
    amthal: {
        file: 'bank/saudi/amthal.json',
        title: 'أمثال',
        shape: '{"proverb":"…","meaning":"…","difficulty":0}',
        rules: [
            'مثلٌ سعوديٌّ أو عربيٌّ متداوَل فعلًا — لا تخترع مثلًا.',
            'من ثلاث كلماتٍ إلى ثماني.',
            'المعنى جملةٌ واحدةٌ تشرح المقصود ولا تعيد المثل بلفظه.',
            'difficulty: ٠ شائعٌ يعرفه الجميع · ١ متوسط · ٢ أقلّ تداولًا.'
        ],
        key: it => String(it.proverb || '')
    },
    lamha: {
        file: 'bank/saudi/lamha.json',
        title: 'لمحة',
        shape: '{"id":"lm_x1","difficulty":0,"answer":"…","accepted":["…"],"clues":["…","…","…"],"explain":"…"}',
        rules: [
            'ثلاثة تلميحاتٍ بالترتيب: الأوّل بعيدٌ عامّ، والثالث يكاد يكشف.',
            'لا تلميحٌ يذكر الجواب ولا اشتقاقًا منه.',
            'accepted تحوي الجواب وصيغه المتداولة (بأل وبدونها، والجمع إن ورد).',
            'الجواب شيءٌ يعرفه أي عربيّ — لا معرفةً محلّيّةً ضيّقة ولا بحثًا خارجيًّا.'
        ],
        key: it => String(it.answer || '')
    },
    warmer: {
        file: 'bank/saudi/warmer.json',
        title: 'قرّبها',
        shape: '{"id":"wr_x1","difficulty":0,"target":"…","theme":"…","accepted":["…"],'
            + '"tiers":{"0":["…"],"1":["…"],"2":["…"]},"hints":["…","…","…"],"explain":"…"}',
        rules: [
            'tiers ثلاث درجاتٍ من القرب: "0" بعيدةٌ عن الهدف، "2" ألصقُها به.',
            'كل درجةٍ من أربع كلماتٍ إلى ستّ، ولا كلمة تتكرّر بين الدرجات.',
            'لا كلمة في tiers هي الهدف نفسه ولا اشتقاقٌ منه.',
            'ثلاثة hints متدرّجة، وآخرها يذكر الحرف الأوّل.'
        ],
        key: it => String(it.target || '')
    }
};

export const AUTHORABLE_GAMES = Object.keys(AUTHORABLE);

// Games deliberately excluded, with the reason kept next to the name so nobody
// re-adds one in six months without meeting the argument.
export const NOT_AUTHORABLE = {
    spelling_bee: 'الألواح مستخرَجةٌ من المعجم بتغطية مجموعات — صحّتها مُبرهَنةٌ بالبناء (gen_bank.js)',
    letterboxed: 'حلّالٌ يثبت وجود حلٍّ ≤٣ كلمات؛ لا نموذج يغلب حلّالًا',
    strands: 'تغطية شبكةٍ بمساراتٍ متّصلة بلا تداخل — مسألة هندسيّة',
    sudoku: 'يُولَّد على الجهاز ووحدانيّة حلّه مُبرهَنة',
    pips: 'رياضيّات مجموعات'
};

// ── BM25 ──────────────────────────────────────────────────────────────────────
// Okapi BM25 with the standard k1/b. Chosen over raw TF-IDF because the corpus
// mixes a 40-line doc section with a 4-line bank row, and BM25's length
// normalisation is the whole reason a short, exactly-on-topic row can outrank a
// long document that merely mentions the term.
const K1 = 1.5, B = 0.75;

// Tokenisation folds Arabic the same way the rest of the app does (via the
// injected norm), then strips the definite article and common clitics. Without
// that, «القهوة» and «قهوة» are two different terms and retrieval quietly halves.
export function tokenize(text, norm) {
    const n = norm ? norm(String(text || '')) : String(text || '').toLowerCase();
    return n
        .replace(/[^ء-يa-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.replace(/^(ال|و|ف|ب|ك|ل)(?=.{3,})/, ''))
        .filter(w => w.length > 1);
}

// docs: [{id, text, ...}] — anything else on the object is carried through, so
// the caller can attach a path or a heading and print it back as provenance.
export function buildIndex(docs, norm) {
    const entries = (docs || []).map(d => {
        const terms = tokenize(d.text, norm);
        const tf = new Map();
        for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
        return { doc: d, tf, len: terms.length };
    });
    const df = new Map();
    for (const e of entries) for (const t of e.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const avgLen = entries.length
        ? entries.reduce((s, e) => s + e.len, 0) / entries.length
        : 0;
    return { entries, df, avgLen, n: entries.length };
}

export function retrieve(index, query, k = 6, norm) {
    if (!index || !index.n) return [];
    const q = tokenize(query, norm);
    const scored = index.entries.map(e => {
        let score = 0;
        for (const t of q) {
            const f = e.tf.get(t);
            if (!f) continue;
            const n_q = index.df.get(t) || 0;
            // +1 inside the log keeps the idf strictly positive: a term present
            // in EVERY document would otherwise score negative and actively
            // push the most on-topic documents down the list.
            const idf = Math.log(1 + (index.n - n_q + 0.5) / (n_q + 0.5));
            const denom = f + K1 * (1 - B + B * (e.len / (index.avgLen || 1)));
            score += idf * (f * (K1 + 1)) / denom;
        }
        return { doc: e.doc, score };
    });
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, k | 0));
}

// ── Prompt ────────────────────────────────────────────────────────────────────
const BAND_AR = ['سهل', 'متوسط', 'صعب'];

// Everything the model is told about who it is. Kept short on purpose: a long
// persona costs tokens on every call and moves the output far less than the
// few-shot examples do.
const SYS = [
    'أنت مؤلّف محتوى لموقع سُرى للألعاب الذهنيّة العربيّة.',
    'تكتب اقتراحاتٍ لبنك المحتوى، ولا تكتب كودًا ولا شرحًا خارج JSON.',
    '',
    'قواعدٌ لا تُخرَق:',
    '١) لا تخترع كلمةً عربيّةً غير موجودة. إن شككتَ في وجود كلمة فاتركها.',
    '٢) لا شيء يحتاج بحثًا خارجيًّا أو معرفةً محلّيّةً ضيّقة؛ الهويّة سعوديّة والمتعة متاحةٌ لكل عربيّ.',
    '٣) حلٌّ واحدٌ مقصودٌ بلا غموض. إن صلح جوابٌ ثانٍ فالمادّة مرفوضة.',
    '٤) لا تكرّر ما في قائمة «الموجود سلفًا».',
    '٥) أعد JSON فقط: {"items":[…]} ولا شيء قبله ولا بعده.'
].join('\n');

/**
 * Build the two messages for one authoring call.
 *
 * The order is deliberate: rules, then retrieved repo context, then approved
 * examples, then the avoid-list. The examples sit closest to the answer because
 * they are the strongest signal, and the avoid-list is last because it is the
 * instruction most often dropped when a prompt gets long.
 */
export function buildPrompt(game, opts = {}) {
    const spec = AUTHORABLE[game];
    if (!spec) {
        const why = NOT_AUTHORABLE[game];
        throw new Error(why ? `«${game}» لا يُؤلَّف بالذكاء الاصطناعيّ: ${why}` : `لعبةٌ مجهولة: ${game}`);
    }
    // `n` multiplies the cost of the call and arrives from a chat message, so
    // anything not a sane count falls back to the default rather than being
    // clamped into it: `Math.max(1, …)` would silently turn a typo'd «-3» into a
    // one-item batch and look like it worked.
    const nRaw = Number(opts.n);
    const n = Number.isFinite(nRaw) && nRaw >= 1 ? Math.min(12, Math.floor(nRaw)) : 5;
    const band = Math.max(0, Math.min(2, opts.band | 0));
    const context = (opts.retrieved || []).map(r => `— ${r.doc.id}:\n${r.doc.text}`).join('\n\n');
    const examples = (opts.fewShot || []).map(x => JSON.stringify(x)).join('\n');
    const avoid = (opts.avoid || []).join(' · ');

    const user = [
        `اللعبة: ${spec.title} (${game})`,
        `المطلوب: ${n} عنصرًا جديدًا، الصعوبة «${BAND_AR[band]}» (difficulty = ${band}).`,
        '',
        'قواعد هذه اللعبة:',
        ...spec.rules.map((r, i) => `${i + 1}. ${r}`),
        '',
        `شكل العنصر الواحد بالضبط:\n${spec.shape}`,
        context ? `\nمن وثائق المشروع:\n${context}` : '',
        examples ? `\nأمثلةٌ معتمدةٌ من البنك — احتذِ أسلوبها لا موضوعها:\n${examples}` : '',
        avoid ? `\nالموجود سلفًا (لا تكرّره):\n${avoid}` : ''
    ].filter(Boolean).join('\n');

    return { system: SYS, user, game, n, band };
}

// ── Believing the answer ──────────────────────────────────────────────────────

/**
 * Parse a model reply into candidate bank rows.
 *
 * Never throws: a malformed reply is a normal outcome of calling a model, and
 * the caller needs the good items out of a partly-bad batch rather than losing
 * the whole call. Everything rejected is reported with its reason so a recurring
 * failure shows up as a pattern instead of a silent drop.
 */
export function parseProposals(game, raw, opts = {}) {
    const spec = AUTHORABLE[game];
    if (!spec) return { items: [], errors: [`لعبةٌ مجهولة: ${game}`] };
    const errors = [];
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); }
        catch {
            // Models wrap JSON in prose or a fence often enough to be worth one
            // salvage attempt — but only one, and only on the outermost object.
            const m = String(raw).match(/\{[\s\S]*\}/);
            if (!m) return { items: [], errors: ['الردّ ليس JSON'] };
            try { obj = JSON.parse(m[0]); }
            catch { return { items: [], errors: ['الردّ ليس JSON'] }; }
        }
    }
    const list = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.items) ? obj.items : null);
    if (!list) return { items: [], errors: ['لا يوجد حقل items'] };

    const band = Math.max(0, Math.min(2, opts.band | 0));
    const items = [];
    const seen = new Set();
    list.forEach((it, i) => {
        if (!it || typeof it !== 'object') { errors.push(`#${i + 1}: ليس كائنًا`); return; }
        const key = spec.key(it);
        if (!key) { errors.push(`#${i + 1}: ناقص الحقل الأساسيّ`); return; }
        // Within-batch duplicates are common when n is large; catching them here
        // keeps the checker's report about content quality rather than repeats.
        if (seen.has(key)) { errors.push(`#${i + 1}: مكرّرٌ داخل الدفعة «${key}»`); return; }
        seen.add(key);
        // The band was requested, so it is ours to assert — a model that returns
        // difficulty:2 for an "easy" batch has not earned the right to relabel it.
        if (game !== 'connections') it.difficulty = band;
        items.push(it);
    });
    return { items, errors };
}

// The identity of a bank item for duplicate purposes.
//
// normalizeArabic is NOT enough on its own: it folds tashkeel and alef/ya, but
// «القهوة» and «قهوة» stay two different strings — so a model that prefixes the
// definite article slips a duplicate straight past a norm-only compare, and the
// bank grows without the rotation getting any richer, which is the entire point
// of this pipeline. Folding the article and interior spaces here is safe because
// it applies to BOTH sides of every comparison and is never written to a bank.
export function foldKey(s, norm) {
    const n = (norm ? norm(String(s || '')) : String(s || '').trim());
    return n.split(/\s+/)
        .map(w => w.replace(/^ال(?=.{3,})/, ''))
        .join(' ')
        .trim();
}

/**
 * Drop anything the bank already holds.
 *
 * Compares on the folded key, so «القهوة» does not slip past «قهوة». This is
 * a cheap pre-filter, not the authority: checks.mjs still runs the real reuse
 * window against the database afterwards.
 */
export function dedupeAgainst(game, items, existing, norm) {
    const spec = AUTHORABLE[game];
    if (!spec) return { fresh: [], dropped: [] };
    const key = it => foldKey(spec.key(it), norm);
    const have = new Set((existing || []).map(key).filter(Boolean));
    const fresh = [], dropped = [];
    for (const it of items || []) {
        const k = key(it);
        if (have.has(k)) { dropped.push(spec.key(it)); continue; }
        have.add(k);
        fresh.push(it);
    }
    return { fresh, dropped };
}

/**
 * Which band is starving, given a bank.
 *
 * The point of the whole pipeline: authoring into a bucket that already holds 30
 * items while another holds 8 makes the rotation no better. Returns the bands
 * sorted by need, so `/author` can default to the one that actually helps.
 */
export function bandNeeds(items, target = 20) {
    const count = [0, 0, 0];
    for (const it of items || []) {
        const d = it && it.difficulty;
        if (d === 0 || d === 1 || d === 2) count[d]++;
    }
    return count
        .map((have, band) => ({ band, have, need: Math.max(0, target - have) }))
        .sort((a, b) => b.need - a.need || a.band - b.band);
}
