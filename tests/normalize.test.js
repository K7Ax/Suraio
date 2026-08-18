// Unit tests for normalizeArabic — the Arabic folding used to MATCH guesses.
//
// This same function is duplicated, byte-for-byte, in three places that MUST
// agree or scoring diverges:
//   • bot.js                              (Node — tested here, the canonical spec)
//   • supabase/functions/submit-guess     (Deno)
//   • public.normalize_arabic()           (Postgres)
// If you change one, change all three and re-run this file as the spec.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test"; // bot.js reads it lazily
const { normalizeArabic } = require("../bot.js");

test("empty / null-ish input is safe", () => {
  assert.equal(normalizeArabic(""), "");
  assert.equal(normalizeArabic(null), "");
  assert.equal(normalizeArabic(undefined), "");
});

test("strips tashkeel (diacritics)", () => {
  assert.equal(normalizeArabic("مُحَمَّد"), "محمد");
  assert.equal(normalizeArabic("سُرَى"), "سري"); // also folds ى→ي below
});

test("removes tatweel (kashida)", () => {
  assert.equal(normalizeArabic("كــتــاب"), "كتاب");
});

test("folds alef variants → ا", () => {
  assert.equal(normalizeArabic("أإآٱ"), "اااا");
  assert.equal(normalizeArabic("أحمد"), "احمد");
});

test("folds alef maqsura ى → ي", () => {
  assert.equal(normalizeArabic("هدى"), "هدي");
});

test("converts Arabic-Indic digits → ASCII", () => {
  assert.equal(normalizeArabic("٢٠٢٦"), "2026");
});

test("collapses whitespace and trims", () => {
  assert.equal(normalizeArabic("  مرحبا    بك  "), "مرحبا بك");
});

test("is idempotent", () => {
  const s = "  أُمُّ القُرى ١٤٤٧ ";
  assert.equal(normalizeArabic(normalizeArabic(s)), normalizeArabic(s));
});

test("two spellings that should match, do", () => {
  // a guess with diacritics + a bare spelling normalize equal
  assert.equal(normalizeArabic("اَلْقَاهِرَة"), normalizeArabic("القاهرة"));
});
