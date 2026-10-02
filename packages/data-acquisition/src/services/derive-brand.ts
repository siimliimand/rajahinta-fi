/**
 * Conservative brand derivation from the feed product display name.
 *
 * No live feed carries a brand (verified 2026-10: the alks Store API
 * returns `brands: []`, the alko adapter pins `brand: ''`, and the
 * WooCommerce mirrors map the same empty shape), so `product_master.brand`
 * would stay empty on every row. This module populates it with a derived
 * value: a pure, deterministic, deliberately CONSERVATIVE lexical
 * extractor over the already-HTML-decoded product name.
 *
 * The values feed an ADVISORY surface only — the did-you-mean brand
 * vocabulary (task 3.2) and bm25 brand ranking in search — never product
 * identity. The compound identity key implications are handled by the
 * lead-sequenced production backfill (scripts/backfill-brand.mts) BEFORE
 * this lands; the upsert repository is untouched by this module.
 *
 * Algorithm (v1):
 *   1. Tokenize on whitespace (possessives, hyphens and dots stay glued
 *      inside their token: `Daniel's`, `Bürklin-Wolf`, `M.CHAPOUTIER`).
 *   2. The brand is the leading run of tokens BEFORE the first stop
 *      token, capped at 3 tokens. Stop tokens: ABV percentages,
 *      volumes/multipacks/containers, years, a curated beverage-type +
 *      qualifier + grape/appellation + descriptor stoplist (FI/EN/SV),
 *      and the article "the" mid-name.
 *   3. A run also CLOSES after a structurally "brand-final" token: one
 *      containing a digit (`1+1=3`), an apostrophe (`Daniel's`), a
 *      hyphen (`Bürklin-Wolf`), or a long dotted abbreviation
 *      (`M.CHAPOUTIER`; short dotted initials — `Dr.`, `J.P.` — glue
 *      onward instead). Nothing after the close belongs to the brand.
 *   4. Return '' when the run is empty OR no stop token is ever found —
 *      unknown is never guessed to the end of the name, and a
 *      beverage-type word can never be returned as the brand.
 *
 * Known v1 limitations (accepted — advisory vocabulary, not identity;
 * the compound-identity-key change is out of scope):
 *   - Expression/line names over-capture within the 3-token cap when
 *     they carry no stop word: "Bacardi Carta Blanca Rum" derives
 *     "Bacardi Carta Blanca". Qualifier stops ("Triple", "Reserve", …)
 *     reduce but never eliminate this class.
 *   - Lexically unmarked variant names over-capture: "Tuborg Sunsæt
 *     4.6% …" derives "Tuborg Sunsæt" (the brand is Tuborg). The
 *     pre-flight pin was adjusted to the derived value for exactly this
 *     reason — no lexical rule can separate Sunsæt from the brand.
 *   - "The" mid-name stops the run ("Robert Mondavi The Reserve …" →
 *     "Robert Mondavi"); a "The"-prefixed brand survives only when
 *     "The" opens the name ("The Macallan" is preserved, a hypothetical
 *     mid-name "The" brand position is not).
 *   - "balsam" is deliberately NOT a stop: "Riga Black Balsam" IS the
 *     brand — stopping on it would yield the worse value "Riga Black".
 *     The flavor word ("Currant") is the stop instead.
 *   - Dotted initials glue onward until the next stop/close, which is
 *     right for "A. le Coq" and "J.P. Chenet" but would glue a
 *     non-brand word after such an initial when no stop intervenes.
 *
 * @module derive-brand
 */

/** Maximum tokens carried into the derived brand. */
const MAX_BRAND_TOKENS = 3;

/**
 * Beverage-type + qualifier + grape/appellation + descriptor stoplist
 * (case-insensitive, matched on the diacritic-folded lowercase token:
 * "Crémant" → "cremant", "Tölkki" → "tolkki"). Curated FI/EN/SV (+ the
 * ET/DE stray forms the catalogs carry) — a stop here means "everything
 * before me may be the brand; I am never part of it", which is also what
 * guarantees a beverage-type word can never BE the brand.
 *
 * Groups are kept separate purely for curation readability; matching is
 * one flat set.
 */
const BEVERAGE_TYPE_STOPS: readonly string[] = [
  // Spirits / viinata
  'vodka', 'viina', 'viin', 'whisky', 'whiskey', 'viski', 'gin', 'rommi',
  'rum', 'brandy', 'konjakki', 'cognac', 'armagnac', 'weinbrand',
  'likoori', 'liqueur', 'likor', 'liquor', 'tequila', 'mezcal', 'calvados',
  'snaps', 'snapsi', 'aquavit', 'akvavit', 'brannvin',
  // Beer / cider / lonkero
  'olut', 'oluet', 'olu', 'kalja', 'beer', 'bier', 'biere', 'pilsner',
  'lager', 'stout', 'porter', 'portter', 'ale', 'ipa', 'lonkero',
  'siideri', 'siider', 'cider',
  // Wine family / sparkling / fortified
  'viini', 'vein', 'wine', 'vin', 'wein', 'cava', 'cremant', 'champagne',
  'prosecco', 'sekt', 'spritz', 'mosel', 'chablis', 'sangria', 'sherry',
  'port', 'porto', 'glogi', 'vermut', 'vermouth', 'juoma', 'drink', 'long',
];

const GRAPE_APPELLATION_STOPS: readonly string[] = [
  'cabernet', 'sauvignon', 'merlot', 'shiraz', 'syrah', 'grenache',
  'garnacha', 'tempranillo', 'malbec', 'pinot', 'noir', 'gris', 'grigio',
  'grigia', 'chardonnay', 'chenin', 'nebbiolo', 'barbera', 'sangiovese',
  'chianti', 'rioja', 'soave', 'verdejo', 'albarino', 'riesling',
  'blanc', 'blanco', 'bianco', 'rouge', 'rose', 'brut', 'cotes', 'cru',
];

const QUALIFIER_STOPS: readonly string[] = [
  'single', 'malt', 'blended', 'edition', 'limited', 'reserve', 'riserva',
  'reserva', 'seleccion', 'selection', 'organic', 'bio', 'eko',
  'ekologisk', 'alkoholiton', 'alkoholfri', 'tammat', 'premium', 'classic',
  'original', 'originaal', 'originaali', 'special', 'curated', 'triple',
  'double', 'dry', 'tennessee', 'small', 'batch', 'vintage', 'year',
  'years', 'vuosi', 'vuotta', 'jahrgang', 'xo', 'vsop',
];

const DESCRIPTOR_STOPS: readonly string[] = [
  // Task-listed descriptors
  'bitter', 'dram', 'herbal', 'botanical', 'spirit', 'spirits', 'punch',
  'mix', 'mixer', 'juice', 'mehu',
  // Cream / coffee class (Baileys Espresso Créme, Irish Cream, …)
  'espresso', 'creme', 'cream', 'kerma', 'coffee', 'kahvi', 'chocolate',
  'suklaa', 'caramel', 'karamelli',
  // Curated fruit/flavor class (Riga Black Balsam Currant, …).
  // Deliberately ABSENT: "balsam" — see the module-header limitation.
  'currant', 'herukka', 'mustikka', 'apple', 'omena', 'pear', 'paaryna',
  'cherry', 'kirsikka', 'lemon', 'sitruuna', 'orange', 'appelsiini',
  'grapefruit', 'lime', 'vanilla', 'vanilja', 'honey', 'hunaja', 'mint',
  'minttu', 'salmiakki', 'peach', 'persikka', 'mango', 'ginger',
  'inkivaari', 'tonic', 'water', 'vesi', 'cola', 'soda',
];

const CONTAINER_MEASURE_STOPS: readonly string[] = [
  'pet', 'bib', 'vol', 'l', 'cl', 'ml', 'dl', 'litra', 'litraa', 'mini',
  'magnum', 'pullo', 'muovipullo', 'tolkki', 'tlk', 'purkki',
];

/** Flat folded stop set — the single matching surface. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  ...BEVERAGE_TYPE_STOPS,
  ...GRAPE_APPELLATION_STOPS,
  ...QUALIFIER_STOPS,
  ...DESCRIPTOR_STOPS,
  ...CONTAINER_MEASURE_STOPS,
]);

/**
 * Measurement-shaped tokens are always stops: bare numbers (age
 * statements "12", sizes "0,7", dates "19.04.2026"), number+unit
 * ("75CL", "0.5l"), and multipacks ("24×0,33", "18x33").
 */
const PURE_NUMBER = /^\d+([.,]\d+)*$/;
const NUMBER_WITH_UNIT = /^\d+([.,]\d+)*(l|cl|ml|dl)$/;
const MULTIPACK = /^\d+([.,]\d+)*[x×]\d+([.,]\d+)*(l|cl|ml|dl)?$/;
/** `´21`-style vintage marks. */
const MARKED_YEAR = /^['´`]+\d{1,4}$/;

/**
 * A token that CLOSES the candidate brand run after being included:
 * digits (measurement-adjacent or `1+1=3`), apostrophes
 * (`Daniel's`), hyphens (`Bürklin-Wolf`), or a long dotted form
 * (`M.CHAPOUTIER`). Short dotted initials ("Dr.", "J.P.", "A.",
 * "P.C.") are glue and let the run continue.
 */
const CLOSE_CHARS = /[\d'\u2019-]/;
/** Longest folded dotted token still treated as gluing initials. */
const GLUING_INITIAL_MAX = 4;

/** Fold a token for matching only: diacritics stripped, lowercased. Output values keep their original characters. */
function foldToken(token: string): string {
  return token
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('å', 'a')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** True when the token at `index` is a stop (the brand run ends before it). */
function isStopToken(token: string, index: number): boolean {
  const folded = foldToken(token);
  // "The" stops the run mid-name ("Robert Mondavi The Reserve …") but
  // may open it ("The Macallan").
  if (index > 0 && folded === 'the') {
    return true;
  }
  if (STOP_WORDS.has(folded)) {
    return true;
  }
  if (token.includes('%')) {
    return true;
  }
  if (PURE_NUMBER.test(folded)) {
    return true;
  }
  if (NUMBER_WITH_UNIT.test(folded)) {
    return true;
  }
  if (MULTIPACK.test(folded)) {
    return true;
  }
  if (MARKED_YEAR.test(folded)) {
    return true;
  }
  return false;
}

/** True when the just-included token ends the brand run after itself. */
function closesBrandRun(token: string): boolean {
  if (CLOSE_CHARS.test(token)) {
    return true;
  }
  const folded = foldToken(token);
  return folded.includes('.') && folded.length > GLUING_INITIAL_MAX;
}

/**
 * Derive the brand from a (already HTML-decoded) feed product name.
 *
 * Pure and deterministic: the same input always yields the same value —
 * the backfill's UPDATE statements are idempotent for exactly this
 * reason. Returns '' whenever the derivation is not confident: empty
 * input, no leading brand run, or no stop token anywhere in the name.
 * The returned value, when non-empty, is a verbatim substring of the
 * input's leading tokens (original casing, whitespace-joined).
 *
 * @param productName Feed product display name, already decoded via
 *                    {@link decodeHtmlEntities} — entity text must not
 *                    be able to split tokens.
 */
export function deriveBrand(productName: string): string {
  if (typeof productName !== 'string') {
    return '';
  }
  const trimmed = productName.trim();
  if (trimmed === '') {
    return '';
  }
  const tokens = trimmed.split(/\s+/);

  // No stop token anywhere → unknown. Never guess to the end of the
  // name (the run would just be the name's head, and "unknown" is the
  // honest value for an advisory vocabulary).
  let firstStop = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (isStopToken(tokens[i], i)) {
      firstStop = i;
      break;
    }
  }
  if (firstStop === -1) {
    return '';
  }

  const run: string[] = [];
  for (let i = 0; i < firstStop && run.length < MAX_BRAND_TOKENS; i++) {
    run.push(tokens[i]);
    if (closesBrandRun(tokens[i])) {
      break;
    }
  }
  return run.join(' ');
}
