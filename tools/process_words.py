# Builds bank/words_ar.json — the shared Arabic dictionary used by the word
# games (Wordle, Letter Boxed, Spelling Bee) via window.__sura.dict.
#
# Round 3: enlarged + cleaned. Source is the FULL hermitdave Arabic frequency
# list (_ar_full.txt, ~2.5M lines, frequency-ordered). We keep 3–6 letter
# words above a frequency floor (drops the long tail of typos), apply a noise
# filter (kills tokens like "اااه" / single-letter repeats), normalize to match
# the game's normalizeArabic(), then union in every puzzle/bank answer so each
# game's own content always validates.
#
# Rebuild:  python tools/process_words.py      (run from the repo root)
# Source download (once), into archive/data/ where the corpus is kept:
#   curl -o archive/data/_ar_full.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ar/ar_full.txt
# Falls back to _ar_50k.txt, then to the existing words_ar.json, if _ar_full.txt
# is absent (offline) so the build never hard-fails.
import re, json, os, unicodedata

# Repo root — one level up, because this script lives in tools/. Every path
# below (bank/, the corpus, the puzzle banks) is resolved against it.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIACRITICS = re.compile("[ً-ْٰؐ-ؚۖ-ۭـ]")
ALEF = re.compile("[أإآٱ]")              # أ إ آ ٱ -> ا
ARABIC_LETTER = re.compile("^[ء-ي]+$")    # hamza..ya (covers ة ؤ ئ ء ه و ي)
LENGTHS = {3, 4, 5, 6}
MIN_FREQ = 8        # frequency floor — clean-but-broad (~170k words)
REPEAT3 = re.compile(r"(.)\1\1")          # 3+ identical letters in a row


def normalize(s):
    r = unicodedata.normalize("NFC", s)
    r = DIACRITICS.sub("", r)
    r = ALEF.sub("ا", r)
    r = r.replace("ى", "ي")               # ى -> ي
    return r.strip()


def is_noise(w):
    # gibberish guards (curated bank words bypass this)
    if len(set(w)) < 2:                    # e.g. "ككك"
        return True
    if REPEAT3.search(w):                  # e.g. "اااه"
        return True
    return False


words = set()

# 1) frequency list (prefer the full list; fall back gracefully)
src = None
for cand in ("archive/data/_ar_full.txt", "archive/data/_ar_50k.txt"):
    p = os.path.join(ROOT, cand)
    if os.path.exists(p):
        src = p
        break

if src:
    kept = 0
    with open(src, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                freq = int(parts[1])
            except ValueError:
                continue
            if freq < MIN_FREQ:
                # list is frequency-ordered; once we cross the floor we can stop
                break
            w = normalize(parts[0])
            if len(w) in LENGTHS and ARABIC_LETTER.match(w) and not is_noise(w):
                words.add(w)
                kept += 1
    print(f"source: {os.path.basename(src)}  kept(freq>={MIN_FREQ}): {kept}")
else:
    # last resort: keep whatever is already shipped
    existing = os.path.join(ROOT, "bank", "words_ar.json")
    if os.path.exists(existing):
        for w in json.load(open(existing, encoding="utf-8")):
            words.add(normalize(w))
    print("source: (none found — reused existing words_ar.json)")

before_bank = len(words)


# 2) union EVERY puzzle/bank answer so each game's own content always validates.
#    Bank words bypass the noise filter (they are curated/authoritative).
def add_words(iterable):
    for w in iterable:
        n = normalize(w)
        # bank words still must be Arabic, right length, and non-gibberish —
        # the auto-generated Saudi bee bank contains junk like "اااه".
        if len(n) in LENGTHS and ARABIC_LETTER.match(n) and not is_noise(n):
            words.add(n)


def load(path):
    p = os.path.join(ROOT, path)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []


def from_list(path, picker):
    for item in load(path):
        try:
            add_words(picker(item))
        except (KeyError, TypeError):
            pass


# core banks
from_list("bank/wordle.json", lambda it: [it["word"]])
from_list("bank/connections.json", lambda it: [w for g in it["groups"] for w in g["words"]])
from_list("bank/spelling_bee.json", lambda it: it["words"])
from_list("bank/letterboxed.json", lambda it: it.get("solution", []))
from_list("bank/strands.json", lambda it: [it["spangram"], *it["words"]])
# Saudi-culture banks
from_list("bank/saudi/wordle.json", lambda it: [it["word"]])
from_list("bank/saudi/words.json", lambda it: [it["word"]])
from_list("bank/saudi/connections.json", lambda it: [w for g in it["groups"] for w in g["words"]])
from_list("bank/saudi/spelling_bee.json", lambda it: it["words"])
from_list("bank/saudi/strands_themes.json", lambda it: [it["spangram"], *it["words"]])

print(f"bank words added: {len(words) - before_bank}")

out = sorted(words)
json.dump(out, open(os.path.join(ROOT, "bank", "words_ar.json"), "w", encoding="utf-8"), ensure_ascii=False)
by_len = {}
for w in out:
    by_len[len(w)] = by_len.get(len(w), 0) + 1
print("total:", len(out), "by length:", dict(sorted(by_len.items())))
print("size KB:", round(os.path.getsize(os.path.join(ROOT, "bank", "words_ar.json")) / 1024))

# sanity: real words (incl. inflected forms) present, gibberish absent
present = ["كتاب", "مدرسة", "ثقافة", "سيارة", "كتابة", "سيارات", "معلمون", "مدارس", "كبسة", "الرياض"]
for chk in present:
    print(" present?", chk, "->", normalize(chk) in words)
for bad in ["ككككك", "اااه", "زصضثق"]:
    print(" gibberish?", bad, "->", normalize(bad) in words)
