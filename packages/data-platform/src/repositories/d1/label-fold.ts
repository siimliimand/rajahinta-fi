/**
 * Label-fold — the diacritic normalizer for OCR-extracted label text
 * (task 1.1, change label-scan-product-lookup; design D3).
 *
 * The scan-label funnel queries `product_master_fts` with the tokens an
 * OCR pass read off a bottle label, while the catalog itself stores
 * ASCII-folded forms (`Zoladkowa`, not `Żołądkowa`): FTS5's unicode61
 * tokenizer splits words but does NOT fold diacritics, so an unfolded
 * query token can never reach the row it names (spike finding, design
 * D3 — "diacritic folding is explicit"). Both sides therefore meet in a
 * folded ASCII space: every extracted token runs through
 * {@link foldToken} before it enters a MATCH term.
 *
 * Pure functions, zero dependencies, no I/O — composition with the
 * candidate repository happens at its call site (task 1.2), the same
 * route-composes-repositories discipline the search surface follows.
 *
 * The fold is deliberately conservative: Latin-1 and Latin Extended-A
 * only (the label universe is Finnish/Estonian/Polish/Baltic/Western
 * European spirits), leaving non-Latin letters untouched rather than
 * guessing a transliteration. An unfolded exotic token misses by
 * retrieval, never by fabrication.
 *
 * @module LabelFold
 */

/**
 * The letters NFD cannot decompose — "singletons" in Unicode terms: the
 * stroke, lash, eth, thorn, ligatures, sharp-s, and dotless-i have no
 * base+combining-mark form, so NFD + combining-mark stripping leaves
 * them untouched and they must map explicitly. Keys are lowercase
 * because {@link foldToken} lowercases before folding; the expansion to
 * multiple letters (`ß`→`ss`, `æ`→`ae`, `þ`→`th`, `œ`→`oe`) follows the
 * conventional ASCII fold (unidecode semantics), keeping both sides of
 * a German or Nordic label comparable.
 */
const SINGLETON_FOLDS: Readonly<Record<string, string>> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ı: 'i',
};

/** The {@link SINGLETON_FOLDS} keys as one regex — built once per module load. */
const SINGLETON_FOLD_PATTERN = /[łøđðþæœßı]/g;

/**
 * The search form of one already-isolated token: lowercased, folded to
 * ASCII (NFD decomposition strips the composed Latin-1/Latin Extended-A
 * diacritics; {@link SINGLETON_FOLDS} covers the letters NFD cannot),
 * punctuation removed.
 *
 * Input contract: ONE token — internal punctuation is stripped (not
 * split), so standalone callers pass pre-split tokens; word splitting
 * is {@link foldToSearchTokens}'s job. A punctuation-only input folds
 * to the empty string, which is how "drop the token" composes: the
 * caller filters empties rather than this function throwing.
 */
export function foldToken(token: string): string {
  const marked = token
    .toLowerCase()
    .normalize('NFD')
    // NFD re-expresses composed diacritics as base letter + combining
    // mark; dropping the marks leaves the bare ASCII letter.
    .replace(/\p{M}/gu, '');
  const folded = marked.replace(SINGLETON_FOLD_PATTERN, (c) => SINGLETON_FOLDS[c]);
  // Post-strip, not pre-strip: only now is every separator-class
  // character genuinely punctuation (the letter folds above are done).
  return folded.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The search tokens of OCR-extracted label text (e.g. the transcription
 * of "Żołądkowa de Luxe 37,5% 0.5L"): split into word tokens, each
 * folded through {@link foldToken}, empties dropped.
 *
 * The split deliberately keeps combining marks INSIDE a word
 * (`[^\p{L}\p{N}\p{M}]` separates, unlike the sibling `tokenize()`
 * which uses `[^\p{L}\p{N}]`): a mark belongs to its base letter, and
 * some OCR pipelines emit NFD text — split-first-then-strip there would
 * shred one word into fragments at every mark (`żo\u0307…` → `zo` +
 * `…`) and the fragments could never match the catalog. Precomposed
 * input is unaffected, so the wider class only ever helps.
 *
 * Punctuation is never a token: separators absorb it, mirroring the
 * unicode61 tokenizer's behavior on the catalog side — `37,5` splits
 * exactly as the indexed `37,5 %` row text did.
 */
export function foldToSearchTokens(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((t) => t.length > 0)
    .map(foldToken)
    .filter((t) => t.length > 0);
}
