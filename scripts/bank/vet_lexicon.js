// scripts/bank/vet_lexicon.js — turn the corpus dump into an actual word list.
//
// THE PROBLEM THIS SOLVES, MEASURED. bank/words_ar.json holds 175,627 entries
// and is a raw text dump, not a lexicon: clitic-attached forms («ولعبة»،
// «للفائف»، «فقلبي»), transliterated names («هتلر»، «سانيو»، «جوبتير»), verb
// conjugations («يطعنوك»، «نخذله») and expansion artefacts («فقطط»، «بنفنن»).
// Stripping clitics programmatically leaves 93,492 — and a random sample of THAT
// is still mostly junk, so no heuristic rescues it. Meanwhile the genuinely
// curated words in the repo number 405, which yields exactly ONE bee board.
//
// WHAT RUNS HERE, AND WHY IT IS NOT «AI WRITES THE CONTENT». Code narrows
// 175,627 → a few thousand candidates by rules that can be read and argued with.
// Groq then answers ONE question per word — «is this an ordinary Arabic word a
// player would know?» — which is classification, not generation. And the reply is
// INTERSECTED with what we sent, so a word the model invents cannot enter the
// lexicon even if it invents one: it was not in the batch, so it is dropped. That
// is the structural reason this does not repeat the Round-4 bug.
//
//   node scripts/bank/vet_lexicon.js --plan          how many words, how many calls
//   node scripts/bank/vet_lexicon.js --run [--limit N]   vet, resumable, writes cache
//
// Output: bank/lexicon_ar.json — a vetted list every game can use, not just نحلة.
// The cache means an interrupted run resumes instead of paying twice.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "bank/lexicon_ar.json");
const CACHE = path.join(ROOT, "bank/.lexicon_vet_cache.json");

// Same loader bot.js uses, same reason: the admin secret lives in a git-ignored
// .env on the operator's machine, never in a shell the operator must re-export.
// Real environment variables still win.
(function loadDotEnv(file) {
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); } catch { return; }
    for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
})(path.join(ROOT, ".env"));

const RUN = process.argv.includes("--run");
const LIMIT = (() => {
    const i = process.argv.indexOf("--limit");
    return i > 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

const BATCH = 60;   // words per call. Not a prompt-size limit — a RATE limit:
                    // max_tokens counts against Groq tokens-per-minute, so a big
                    // batch needing a big ceiling earns a 413 long before the
                    // prompt gets anywhere near MAX_USER.
const ALPHA = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];
const IN = new Set(ALPHA);

const norm = s => String(s || "").normalize("NFC")
    .replace(/[ً-ْٰـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").trim();

// ---------------------------------------------------------------------------
// 1. Narrow by rule. Every line here is a rule a human can dispute; none of it
//    is a model's opinion.
// ---------------------------------------------------------------------------
const PREFIX = ["وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ك", "ل", "س"];
const SUFFIX = ["هم", "هن", "كم", "كن", "ها", "نا", "ني", "ه", "ك", "ي"];

function candidates() {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "bank/words_ar.json"), "utf8"));
    const all = new Set(raw.map(norm));
    const out = [];
    for (const w of all) {
        const n = [...w].length;
        if (n < 4 || n > 6) continue;                     // bee words are 4–6
        if (![...w].every(c => IN.has(c))) continue;       // no ة/ء/carriers
        if (/(.)\1\1/u.test(w)) continue;                  // ثلاثة أحرفٍ متتالية
        if (/^(.)\1/u.test(w)) continue;                   // «اامل»، «اانا»
        // The definite article, unconditionally. The rule below only strips it
        // when the bare stem is itself in the file, and that let «الال»، «الار»،
        // «المر» straight through — their stems are two letters, so the ≥3 guard
        // skipped them and they ranked at the very TOP of the bigram prior,
        // because «ال» is the commonest opening in curated Arabic. A word worth
        // having appears in its bare form anyway.
        if (/^ال/u.test(w)) continue;
        // A form whose stem is itself a word is an inflection of that word, and
        // the stem is the entry we want. Both ends, because «وكتابهم» is neither.
        if (PREFIX.some(p => w.startsWith(p) && [...w].length - [...p].length >= 3 && all.has(w.slice(p.length)))) continue;
        if (SUFFIX.some(s => w.endsWith(s) && [...w].length - [...s].length >= 3 && all.has(w.slice(0, w.length - s.length)))) continue;
        out.push(w);
    }
    return out;
}

// ---------------------------------------------------------------------------
// 2. Rank by how ARABIC the word looks, before spending a call on it.
//
//    The obvious ranking — «made of common letters, so it lands on many
//    boards» — is actively wrong: it puts «يايا»، «تاتا»، «تييا» at the very
//    top, because those are built from the four commonest letters and nothing
//    else. Every one of them would burn a slot in a batch to be rejected.
//
//    So the prior is a character bigram model trained on the CURATED Arabic in
//    this repo (connections words, wordle answers, proverbs, the hand-made bee
//    boards) — a few thousand words a human already approved. It has no opinion
//    about meaning; it only knows which letter pairs occur in real words of this
//    language. «مدرسة» scores high, «تييا» scores near the floor, and Groq is
//    only asked about words that already look like words.
// ---------------------------------------------------------------------------
function bigramModel() {
    const seen = new Set();
    const eat = s => {
        for (const tok of String(s).split(/[^ء-ي]+/)) {
            const w = norm(tok);
            if ([...w].length >= 3 && [...w].every(c => IN.has(c))) seen.add(w);
        }
    };
    const walk = o => {
        if (typeof o === "string") eat(o);
        else if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === "object") Object.values(o).forEach(walk);
    };
    // Both the JSON banks and the inline ones. letterboxed/spelling_bee are
    // excluded: they were generated FROM words_ar.json, so training on them
    // would teach the model that the junk is normal.
    (function rec(d) {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) rec(p);
            else if (f.name.endsWith(".json") && !["words_ar.json", "letterboxed.json", "spelling_bee.json"].includes(f.name)) {
                try { walk(JSON.parse(fs.readFileSync(p, "utf8"))); } catch { /* not a bank */ }
            }
        }
    })(path.join(ROOT, "bank"));
    for (const m of fs.readFileSync(path.join(ROOT, "src/core/banks.mjs"), "utf8").matchAll(/'([ء-ي]+)'/g)) eat(m[1]);

    const bi = new Map(), uni = new Map();
    for (const w of seen) {
        const c = ["^", ...w, "$"];
        for (let i = 0; i < c.length - 1; i++) {
            uni.set(c[i], (uni.get(c[i]) || 0) + 1);
            const k = c[i] + c[i + 1];
            bi.set(k, (bi.get(k) || 0) + 1);
        }
    }
    const V = ALPHA.length + 2;
    return { words: seen.size, score(w) {
        const c = ["^", ...w, "$"];
        let s = 0;
        for (let i = 0; i < c.length - 1; i++) {
            // Add-one smoothing: an unseen pair is improbable, never impossible —
            // 2,500 training words cannot have covered every legitimate pair.
            s += Math.log((bi.get(c[i] + c[i + 1]) || 0) + 1) - Math.log((uni.get(c[i]) || 0) + V);
        }
        return s / (c.length - 1);
    } };
}

// 2b. Spread the budget across the ALPHABET, not just down the score.
//
// A plain global sort is the obvious thing and it fails in a way that only shows
// up later: the top of the list is «انال، امال، اموال، انوار، انهال» — real
// words, every one, and all built from ا ل م ن ر و. Vetting two thousand of
// those buys a lexicon that can only ever produce boards on the same six
// letters, which is the repetition problem we started with, wearing a new hat.
// So each letter gets its own quota, taken in score order, and the union is
// vetted. Rare letters simply run out early; they are not padded with junk.
function rank(words) {
    const m = bigramModel();
    console.log(`مُرجِّح ثنائيّات مدرَّبٌ على ${m.words} كلمةً مُحرَّرة`);
    const scored = words.map(w => ({ w, s: m.score(w) })).sort((a, b) => b.s - a.s);
    const PER_LETTER = 900;
    const out = [], taken = new Set(), quota = {};
    for (const { w } of scored) {
        // A word counts against its RAREST letter's quota, so a word carrying ظ
        // is admitted on ظ's budget rather than being crowded out by ا's.
        const rarest = [...new Set(w)].sort((a, b) => (quota[a] || 0) - (quota[b] || 0))[0];
        if ((quota[rarest] || 0) >= PER_LETTER) continue;
        if (taken.has(w)) continue;
        taken.add(w); out.push(w);
        for (const c of new Set(w)) quota[c] = (quota[c] || 0) + 1;
    }
    return out;
}

// ---------------------------------------------------------------------------
// 3. Ask. One question, a JSON object back, and the answer is intersected.
// ---------------------------------------------------------------------------
const SYSTEM = [
    "أنت مُصنِّف معجميّ عربيّ. لا تؤلّف ولا تقترح ولا تصحّح — تصنّف فقط.",
    "تصلح الكلمة إذا كانت اسمًا أو فعلًا أو صفةً عربيّةً فصيحةً أو دارجةً معروفة،",
    "يعرفها متحدّثٌ عاديّ ويستطيع كتابتها من ذاكرته.",
    "",
    "ولا تصلح إذا كانت: اسم عَلَمٍ أو مكانٍ أو علامةٍ تجاريّة، أو منقولةً عن لغةٍ أجنبيّة،",
    "أو صيغةً مصرّفةً نادرة، أو ركاكةً لا معنى لها، أو جمعًا لحروفٍ لا تُكوّن كلمة.",
    "",
    "أعِد JSON فقط بهذا الشكل: {\"ok\":[\"كلمة\",\"كلمة\"]}",
    "ضع في ok الكلمات الصالحة **من القائمة المُعطاة حرفيًّا** ولا تضف شيئًا من عندك.",
    "إن شككت في كلمة فاتركها خارج القائمة — الحذف أرخص من كلمةٍ تُحرج اللاعب.",
].join("\n");

async function vet(batch) {
    const url = process.env.SUPABASE_URL || "https://uqgndtsfrbgmgpqhuaeh.supabase.co";
    const secret = process.env.SURA_ADMIN_SECRET;
    if (!secret) throw new Error("SURA_ADMIN_SECRET غير مضبوط في .env");
    const res = await fetch(`${url}/functions/v1/groq-author`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sura-admin-secret": secret },
        body: JSON.stringify({
            game: "spelling_bee",
            mode: "vet",
            system: SYSTEM,
            user: "صنّف هذه الكلمات:\n" + batch.join("، "),
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        // 429 is a TOKENS-PER-MINUTE ceiling, not a failure: the request was
        // well-formed and will succeed shortly. Groq states the wait in the
        // message («try again in 8.5s»), so honour the number it gives rather
        // than guessing a constant — guessing either wastes minutes or spends
        // the whole run bouncing off the same wall.
        const m = /try again in ([\d.]+)s/i.exec(body);
        if (res.status === 502 && /groq_429/.test(body)) {
            const wait = Math.min(90, Math.max(5, Number(m && m[1]) || 20));
            const e = new Error(`RATE:${wait}`);
            e.retryAfter = wait;
            throw e;
        }
        throw new Error(`groq-author ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    let parsed;
    // A parse failure returned [] before, which is INDISTINGUISHABLE from «the
    // model rejected all sixty» — and the caller then cached those sixty as
    // classified, so sixty real words were lost silently and never asked about
    // again. Two batches scored exactly 0/60 in the first run, which is what
    // that failure looks like. Throw instead, so the batch is retried.
    try { parsed = JSON.parse(data.raw || ""); } catch {
        throw new Error("ردٌّ غير صالح (JSON) — " + String(data.raw || "").slice(0, 80));
    }
    if (!Array.isArray(parsed.ok)) throw new Error("الردّ بلا حقل ok");
    const sent = new Set(batch);
    // THE INTERSECTION. Without this line the model could contribute vocabulary,
    // and «نحلة» would be authored by an AI after all.
    return (parsed.ok || []).map(norm).filter(w => sent.has(w));
}

(async () => {
    const cand = rank(candidates());
    const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : { ok: [], seen: [] };
    const seen = new Set(cache.seen);
    const todo = cand.filter(w => !seen.has(w));
    const budget = LIMIT || todo.length;
    const calls = Math.ceil(Math.min(budget, todo.length) / BATCH);

    console.log(`مرشَّحون بعد القواعد: ${cand.length} من 175,627`);
    console.log(`مُصنَّفٌ سلفًا: ${seen.size} · مقبول: ${cache.ok.length}`);
    console.log(`المتبقّي: ${todo.length} · سيُصنَّف الآن: ${Math.min(budget, todo.length)} في ${calls} نداءً`);

    if (!RUN) {
        console.log("\nعيّنة من المرشّحين (الأعلى ترتيبًا):");
        console.log("  " + cand.slice(0, 24).join("، "));
        console.log("\nلم يُنادَ شيء. أضف --run.");
        return;
    }

    let done = 0;
    for (let i = 0; i < todo.length && done < budget; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        let kept = [], failed = false;
        // Retry only the rate limit, and only a few times. Anything else is a
        // real fault and looping on it would burn the budget on the same error.
        for (let attempt = 0; attempt < 6; attempt++) {
            try { kept = await vet(batch); failed = false; break; }
            catch (e) {
                failed = true;
                // A malformed reply is retryable too — it is usually one truncated
                // answer, not a broken prompt — but it must not retry forever.
                const soft = e.retryAfter || /JSON|حقل ok/.test(e.message);
                if (!soft) { console.error(`\n  ✗ ${e.message}`); break; }
                const wait = e.retryAfter || 3;
                process.stdout.write(`  ⏳ ${e.retryAfter ? "حدّ المعدّل" : "ردٌّ معطوب"} — أنتظر ${wait}ث\r`);
                await new Promise(r => setTimeout(r, (wait + 1) * 1000));
            }
        }
        if (failed) { console.error("\n  ✗ تعذّر إكمال الدفعة"); break; }
        cache.ok.push(...kept);
        cache.seen.push(...batch);
        done += batch.length;
        fs.writeFileSync(CACHE, JSON.stringify(cache), "utf8");
        // The lexicon itself is rewritten every batch, not only at the end. A run
        // of 259 calls WILL be interrupted sooner or later — one already was — and
        // an asset that only exists if the last call succeeds is an asset you keep
        // paying for. The cache alone is not enough: nothing else reads it.
        fs.writeFileSync(OUT, JSON.stringify([...new Set(cache.ok)].sort(), null, 0), "utf8");
        process.stdout.write(`  ${done}/${budget} · قُبل ${kept.length}/${batch.length}\r`);
    }
    const ok = [...new Set(cache.ok)].sort();
    fs.writeFileSync(OUT, JSON.stringify(ok, null, 0), "utf8");
    console.log(`\nVET_OK ${path.basename(OUT)} — ${ok.length} كلمة مقبولة من ${cache.seen.length} مُصنَّفة`
        + ` (${Math.round(100 * ok.length / Math.max(1, cache.seen.length))}٪)`);
})();
