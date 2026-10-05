/**
 * Alko feed adapter — the real storefront catalog API (change
 * data-quality-and-publication-trust; deviation from the original
 * placeholder contract approved by the owner, decision D3 documented by
 * the lead).
 *
 * The domestic reference merchant: Alko's live assortment through the
 * shared feed-adapter interface and governance gate. The source is the
 * storefront's own search API (`POST {feedUrl}` — the registry passes
 * `https://www.alko.fi/api/search/product?lang=fi`), the same endpoint
 * alko.fi's product listing calls. Payload contract, verified live
 * 2026-09-30 against the full catalog (11,307 rows):
 *
 * - Request body `{"filters":[],"skip":N,"top":M}`; response
 *   `{"@odata.count":<total>,"value":[...]}`. The walk pages with
 *   `top = 200`, `skip += 200`, until `skip >= @odata.count`.
 * - Rows carry NO `ean`, NO `manufacturer`, NO `currency` field —
 *   records are EAN-less (mydrink precedent; the savings hit-rate
 *   consequence is documented by the lead) and brand/manufacturer stay
 *   empty strings. EUR-native by contract: the storefront is Alko's
 *   Finnish retail list, priced EUR including VAT by definition; the
 *   payload has no currency field to check, so there is nothing to
 *   reject — a non-EUR Alko list would be a different storefront, not
 *   a conversion opportunity (Posti precedent). `originalPriceCents`
 *   equals `priceCents` and no `fxDatasetVersion` is recorded (its
 *   absence is the no-conversion provenance).
 * - `abv` is a PERCENT number → `alcoholByVolume` fraction; `volume`
 *   is LITRES → `volumeMl` (package size — no `packCount`, the
 *   storefront carries no multipack names).
 * - Category: the storefront's PLURAL group arrays (e.g.
 *   `productGroupName: ["punaviinit"]`) map through the module-local
 *   token table to the historical SINGULAR tokens `mapSourceCategory`
 *   already accepts ("punaviinit" → "viini" → wine_still). The table
 *   below was built from the probed distinct vocabulary, never guessed;
 *   values without a confident beverage meaning (gift wrap, drink
 *   accessories) stay unmapped and land in the correction queue by
 *   design.
 * - Whole-page failures (HTTP !2xx, network, non-JSON, missing
 *   `value` array) are errors[] entries, never throws; per-row
 *   validation failures are per-row errors — the correction-queue
 *   surface shared across feed adapters.
 *
 * @module AlkoFeedAdapter
 */

import { mapSourceCategory, NONALCOHOLIC_HOLD_REASON } from '@rajahinta/core-domain';
import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface AlkoProductRow {
  /** Storefront product id, string ("700439"). */
  id?: unknown;
  name?: unknown;
  /** ABV in PERCENT (6.2 = 6.2 %); null on non-beverage rows. */
  abv?: unknown;
  /** Retail price in EUR including VAT. */
  price?: unknown;
  /** Package volume in LITRES (0.5). */
  volume?: unknown;
  /** Plural storefront groups, leaf-first ("oluet"). */
  productGroupName?: unknown;
  /** Coarse storefront department ("panimotuotteet"). */
  mainGroupName?: unknown;
  /** Pipe-coded packages ("packageTypeId|packageType_pullo|lasipullo"). */
  packageTypes?: unknown;
  /** Webshop stock count; > 0 means orderable online. */
  webshopStock?: unknown;
}

interface AlkoSearchPage {
  '@odata.count'?: unknown;
  value?: unknown;
}

// ---------------------------------------------------------------------------
// Group-token tables — data-driven, from the probed full-catalog
// vocabulary (2026-09-30 sweep, 11,307 rows: 83 distinct productGroup,
// 6 distinct mainGroup values). Storefront groups are PLURAL; the
// targets are the HISTORICAL SINGULAR tokens mapSourceCategory accepts.
// Keys are matched lowercase/trimmed (the storefront mixes case:
// "Tequilat", "tumma rommi").
// ---------------------------------------------------------------------------

/** Storefront productGroupName tokens → historical singular category. */
export const ALKO_PRODUCT_GROUP_CATEGORY: Readonly<Record<string, string>> = {
  // Beer family ("olut" singular already maps).
  'oluet': 'olut',
  // Ciders.
  'siiderit': 'siideri',
  // Still wines — color groups and the catch-alls map to plain wine.
  'punaviinit': 'viini',
  'valkoviinit': 'viini',
  'roseeviinit': 'viini',
  'jälkiruokaviinit': 'viini', // probed 10–13 %, unfortified wine range
  'muut viinit': 'viini',
  'viinijuomat': 'viini', // low-ABV wine drinks, Alko files them under the wine department
  'muut viinijuomat': 'viini',
  'hedelmä- ja aromatisoidut viinit': 'viini', // probed 9–11.5 %, wine department
  'hanapakkaukset': 'viini', // bag-in-box packages; probed rows are all red/white wine boxes
  // Sparkling — still vs sparkling split is excise-meaningful.
  'kuohuviinit': 'kuohuviini',
  'kuohuviinit ja samppanjat': 'kuohuviini',
  'samppanjat': 'samppanja',
  'roseekuohuviini': 'kuohuviini',
  'roseesamppanja': 'samppanja',
  'hedelmäkuohuviinit': 'kuohuviini',
  // Fortified / aromatised (→ intermediate_products tax key).
  'portviinit': 'portviini',
  'väkevät viinit': 'portviini',
  'vermutit': 'vermouth',
  'sherryt': 'sherry',
  'madeirat': 'madeira',
  'glögit': 'vermouth', // aromatised wine family; probed rows 15 %, välituotteet department
  // Spirits by type noun.
  'viina': 'viina',
  'maustetut viinat': 'viina',
  'vodkat ja viinat': 'viina',
  'vodka': 'vodka',
  'maustetut vodkat': 'vodka',
  'viskit': 'whisky',
  'mallasviskit': 'whisky',
  'blended-viskit': 'whisky',
  'amerikkalaiset viskit': 'whisky',
  'muut viskit': 'whisky',
  'ginit': 'gin',
  'ginit ja maustetut viinat': 'gin',
  'rommit': 'rum',
  'tumma rommi': 'rum',
  'vaalea rommi': 'rum',
  'konjakit': 'cognac',
  'muut konjakit': 'cognac',
  'vs-konjakit': 'cognac',
  'vsop-konjakit': 'cognac',
  'xo-konjakit': 'cognac',
  'brandyt': 'brandy',
  'armanjakit': 'brandy',
  'calvadosit': 'brandy',
  'brandyt, armanjakit ja calvadosit': 'brandy',
  'tequilat': 'tequila',
  'akvaviitit': 'akvaviitti',
  'anistisleet': 'viina', // anis spirits (pastis/ouzo family)
  'hedelmätisleet': 'viina', // fruit spirit distillates
  // Bitters.
  'katkerot': 'bitters',
  'grogikatkerot': 'bitters',
  'maha- ja maustekatkerot': 'bitters',
  // Liqueurs.
  'liköörit': 'likööri',
  'liköörit ja katkerot': 'likööri',
  'hedelmäliköörit': 'likööri',
  'kahviliköörit': 'likööri',
  'kermaliköörit': 'likööri',
  'marjaliköörit': 'likööri',
  'mausteliköörit': 'likööri',
  'salmiakkiliköörit': 'likööri',
  'yrttiliköörit': 'likööri',
  // Long drink / RTD family.
  'long drink': 'long drink',
  'maustettu long drink': 'long drink',
  'juomasekoitukset': 'long drink', // premixed drinks, same family as core-domain's juomasekoitus
  'ready to drink': 'rtd',
  // Sake.
  'saket': 'sake',
  // Non-alcoholic — honest non-alcoholic, never their alcoholic cousins.
  'alkoholittomat': 'alkoholiton',
  'alkoholittomat oluet': 'alkoholiton',
  'alkoholittomat kuohuviinit': 'alkoholiton',
  'alkoholittomat punaviinit': 'alkoholiton',
  'alkoholittomat siiderit': 'alkoholiton',
  'alkoholittomat valko- ja roseeviinit': 'alkoholiton',
  'mikserit': 'alkoholiton', // probed abv 0 mixers; matches kippis 'virvoitusjuomat ja mikserit'
  'vedet, mehut ja muut alkoholittomat': 'alkoholiton',

  // Deliberately NOT mapped (probed, unconfident) — rows land in the
  // correction queue, never in a guessed category:
  // - 'jälkiruokaviinit, väkevöidyt ja muut viinit': a merged bucket
  //   spanning still dessert wines AND fortified wines (different excise
  //   keys); probed rows always co-carry a precise leaf ("sherryt",
  //   "muut viinit", "glögit") that resolves first.
  // - 'grapat': pomace spirit, no accepted historical token; probed rows
  //   co-carry 'ginit ja maustetut viinat'.
  // - 'aromatisoidut viinit': probed rows are 5.5 % aromatised
  //   sparklings; the sibling 'kuohuviinit ja samppanjat' resolves them.
  // - 'juomatarvikkeet' / 'lahjapakkaaminen' / 'ostospakkaaminen':
  //   glassware and wrapping services, not beverages (probed abv null).
  // - 'alkoholipitoiset makeiset ja muut alkoholituotteet': alcoholic
  //   confectionery, not a beverage category.
};

/** Storefront mainGroupName fallback, used when no productGroup maps. */
export const ALKO_MAIN_GROUP_CATEGORY: Readonly<Record<string, string>> = {
  'alkoholittomat': 'alkoholiton',
  'viinit': 'viini',
  'väkevät': 'viina', // core-domain precedent: 'väkevä' → spirits
  'välituotteet': 'portviini', // intermediate products → fortified-wine family
  // Deliberately NOT mapped: 'panimotuotteet' spans beer AND cider AND
  // long drink (different excise keys), and 'lahja- ja juomatarvikkeet'
  // is gifts/accessories, not a beverage.
};

/**
 * Probed distinct productGroupName + mainGroupName values that are
 * intentionally unmapped — exported so the test suite can prove the
 * token table covers the full live vocabulary minus this documented
 * set (drift from a new storefront group shows up as a test failure).
 */
export const ALKO_UNMAPPED_GROUPS: readonly string[] = [
  'jälkiruokaviinit, väkevöidyt ja muut viinit',
  'grapat',
  'aromatisoidut viinit',
  'juomatarvikkeet',
  'lahjapakkaaminen',
  'ostospakkaaminen',
  'alkoholipitoiset makeiset ja muut alkoholituotteet',
  // mainGroup-level:
  'panimotuotteet',
  'lahja- ja juomatarvikkeet',
];

// ---------------------------------------------------------------------------
// Container mapping — storefront packageTypes segments → the
// product_master vocabulary (migration 0002 CHECK: 'glass', 'plastic',
// 'metal', 'carton', 'other', 'can', 'bottle'). The raw segment
// ("lasipullo") is NOT schema-valid, and neither is '' — a value outside
// the CHECK bounces every INSERT of the run (staging incident
// 2026-09-11, alks.parser precedent). Segment vocabulary from the full
// catalog sweep (11 distinct segments).
// ---------------------------------------------------------------------------

export const ALKO_PACKAGE_CONTAINER: Readonly<Record<string, string>> = {
  'lasipullo': 'bottle',
  'pullo': 'bottle',
  'keraaminen pullo': 'bottle',
  'muovipullo': 'plastic',
  'tölkki': 'can',
  'kartonkitölkki': 'carton',
  'hanapakkaus': 'carton', // bag-in-box
  'paperipullo': 'carton',
  'lasipurkki': 'glass',
  'viinipussi': 'plastic', // BIB inner pouch, plastic laminate
  'muu': 'other',
};

/** Absent package data → 'other' (inside the CHECK; '' is not). */
function containerFromPackageTypes(packageTypes: unknown): string {
  if (!Array.isArray(packageTypes)) return 'other';
  for (const entry of packageTypes) {
    if (typeof entry !== 'string') continue;
    // "packageTypeId|packageType_pullo|lasipullo" → "lasipullo"
    const segment = entry.split('|').pop()?.trim() ?? '';
    const mapped = ALKO_PACKAGE_CONTAINER[segment];
    if (mapped !== undefined) return mapped;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** ABV may legitimately be 0.0 (alcohol-free products) or null (accessories). */
function readAbvPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function readGroupTokens(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tokens: string[] = [];
  for (const entry of value) {
    const token = readNonEmptyString(entry);
    if (token !== null) tokens.push(token);
  }
  return tokens;
}

/**
 * First group token with a historical-singular mapping, in payload
 * order — productGroup arrays before the mainGroup fallback. The
 * storefront duplicates tokens inside a row ("punaviinit" twice) and
 * appends merged buckets ("…, väkevöidyt ja muut viinit"); the
 * first-MAPPABLE scan (alks/mydrink precedent) skips those to the
 * precise leaf instead of failing on [0].
 */
function groupImpliedCategoryToken(row: AlkoProductRow): string | null {
  for (const source of [row.productGroupName, row.mainGroupName]) {
    for (const token of readGroupTokens(source)) {
      const key = token.toLowerCase();
      const singular =
        ALKO_PRODUCT_GROUP_CATEGORY[key] ?? ALKO_MAIN_GROUP_CATEGORY[key];
      if (singular !== undefined) return singular;
    }
  }
  return null;
}

function readAvailability(webshopStock: unknown): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (typeof webshopStock === 'number' && Number.isFinite(webshopStock)) {
    return webshopStock > 0 ? 'in_stock' : 'out_of_stock';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

/**
 * Parse one storefront search page —
 * `{"@odata.count":<total>,"value":[rows]}` — into canonical feed
 * records. Pure: no I/O, deterministic on its input. A non-object
 * payload or a missing `value` array is a payload-level error;
 * individual invalid rows (unmappable category, missing or invalid
 * price) are reported per-row and skipped. Category mapping runs
 * through the ABV guard: a row above 22 % ABV never resolves to the
 * fermented duty key (first-impression-pass 1.2) — a usable ABV feeds
 * `mapSourceCategory`, an unusable one leaves the guard unkeyed.
 */
export function parseAlkoAssortment(payload: unknown): {
  records: RawFeedRecord[];
  errors: string[];
} {
  const records: RawFeedRecord[] = [];
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return { records, errors: ['Alko payload is not a JSON object'] };
  }
  const page = payload as AlkoSearchPage;

  if (!Array.isArray(page.value)) {
    errors.push('Alko payload has no value array');
    return { records, errors };
  }

  const rows = page.value as AlkoProductRow[];
  rows.forEach((row) => {
    const label = `product ${String(row.id ?? '(unknown)')}`;

    // ABV feeds the category guard (first-impression-pass 1.2), so it is
    // read before the mapping: the percent → fraction scale is the
    // mapper's 0–1 contract. An ABV above 100 is garbage in either
    // scale — the guard is left unkeyed (never rescaled) and the record
    // carries it unchanged for the existing ABV validation downstream.
    const abvPercent = readAbvPercent(row.abv);
    const abvFraction =
      abvPercent !== null && abvPercent <= 100 ? abvPercent / 100 : null;

    const singularToken = groupImpliedCategoryToken(row);
    const mapping = singularToken !== null ? mapSourceCategory(singularToken, abvFraction) : null;
    if (mapping === null) {
      errors.push(
        `Failed to map ${label}: storefront groups ${JSON.stringify([
          ...readGroupTokens(row.productGroupName),
          ...readGroupTokens(row.mainGroupName),
        ])} have no canonical mapping — flagged for the correction queue`,
      );
      return;
    }

    // A reference offer without an amount is unusable for comparison
    // (and the mapping-layer price-floor gate rejects non-positive
    // cents) — rejected here, named per-row.
    const price = readPositiveNumber(row.price);
    if (price === null) {
      errors.push(`Failed to map ${label}: missing or invalid price "${String(row.price)}"`);
      return;
    }

    const volumeLitres = readPositiveNumber(row.volume);

    // Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
    // design D3): the mapper re-keyed a typed alcohol outcome to
    // non-alcoholic because this row's ABV is 0 or unparseable. The row
    // still ingests (ESTIMATED-status contract untouched) with the hold
    // reason on the record — the correction-flag error rides the same
    // per-row error surface as every other held shape.
    const held = mapping.nonAlcoholicHold === true;
    if (held) {
      errors.push(
        `Held for review ${label}: ABV is ${abvPercent === 0 ? '0' : 'unparseable'} but the ` +
          'storefront groups resolve to an alcohol category — non-alcoholic rows are barred ' +
          `from alcohol categories, ingested as non-alcoholic with hold reason ` +
          `${NONALCOHOLIC_HOLD_REASON}, flagged for the correction queue`,
      );
    }

    records.push({
      productId: readNonEmptyString(row.id) ?? '',
      productName: readNonEmptyString(row.name) ?? '',
      // The storefront carries neither field; records stay empty
      // (mydrink no-brand-data precedent) — the upsert's compound tier
      // carries the match.
      manufacturer: '',
      brand: '',
      category: mapping.taxCategory,
      alcoholByVolume:
        abvPercent !== null ? abvPercent / 100 : null,
      volumeMl: volumeLitres !== null ? Math.round(volumeLitres * 1000) : 0,
      containerType: containerFromPackageTypes(row.packageTypes),
      regulatoryClassification: mapping.taxCategory,
      // Storefront payload carries no pantti data; Finnish deposit
      // membership is never assumed true at the feed level (alks
      // precedent).
      depositSystem: false,
      // Every catalog row is EAN-less (verified live) — null, never a
      // guessed barcode.
      ean: null,
      // EUR-native by contract (see module docblock): canonical and
      // original amounts are the same cents; no fxDatasetVersion —
      // absence marks the no-conversion path.
      priceCents: Math.round(price * 100),
      currency: 'EUR',
      originalPriceCents: Math.round(price * 100),
      originalCurrency: 'EUR',
      availability: readAvailability(row.webshopStock),
      sourceUrl: null,
      reviewHoldReason: held ? NONALCOHOLIC_HOLD_REASON : null,
    });
  });

  return { records, errors };
}

// ---------------------------------------------------------------------------
// Feed adapter
// ---------------------------------------------------------------------------

/** Page size for the skip/top walk — the storefront serves 500+; 200
 * keeps the full-catalog walk at ~57 polite POSTs. */
const PAGE_TOP = 200;

/** '11307' → 11307; anything non-numeric (WAF HTML, undefined) → null. */
function readOdataCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/** Politeness gap between catalog pages — Alko's Azure WAF challenges
 * rapid minimal-header clients; a real browser cadence (headers below +
 * a spacing delay) fetched the full catalog cleanly from a datacenter
 * egress during the 2026-09-30 wiring probe. */
const ALKO_PAGE_DELAY_MS = 400;

/** Browser-like request headers — the WAF's first-line fingerprint check
 * (a bare `content-type` POST is challenged with 403 before any JSON). */
const ALKO_FETCH_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fi-FI,fi;q=0.9,en;q=0.5',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

export class AlkoFeedAdapter implements IFeedAdapter {
  readonly merchantId = 'alko';

  /**
   * Walk the storefront catalog: sequential `POST {feedUrl}` pages of
   * {@link PAGE_TOP} rows, `skip` advancing until the first page's
   * `@odata.count` is reached. The count caps the walk exactly like the
   * WooCommerce walk's X-WP-TotalPages: a missing or unusable count
   * stops after the current page with an error — never an unbounded
   * loop. Page-level failures (HTTP errors, network failures, unusable
   * JSON) accumulate in `errors[]` per the adapter contract and never
   * abort the walk: a failed page costs one page, not the run. The
   * adapter never throws for recoverable failures.
   */
  async fetch(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    const records: RawFeedRecord[] = [];
    const errors: string[] = [];

    let total: number | null = null;

    for (let skip = 0; total === null || skip < total; skip += PAGE_TOP) {
      if (skip > 0) {
        await new Promise((resolve) => setTimeout(resolve, ALKO_PAGE_DELAY_MS));
      }
      let response: Response;
      try {
        response = await fetch(config.feedUrl, {
          method: 'POST',
          headers: ALKO_FETCH_HEADERS,
          body: JSON.stringify({ filters: [], skip, top: PAGE_TOP }),
        });
      } catch (err) {
        errors.push(`Alko page (skip ${skip}) fetch failed: ${errorOf(err)}`);
        if (total === null) break;
        continue;
      }

      // One body read per response (a Response body consumes once) —
      // the first page doubles as the count probe.
      let payload: unknown = null;
      let jsonInvalid = false;
      try {
        payload = await response.json();
      } catch {
        jsonInvalid = true;
      }

      if (total === null) {
        // The first usable @odata.count caps the walk; without it (HTTP
        // error page, WAF HTML, malformed JSON) the walk cannot continue
        // safely and stops after this page.
        const count = readOdataCount(
          typeof payload === 'object' && payload !== null
            ? (payload as AlkoSearchPage)['@odata.count']
            : undefined,
        );
        if (count === null) {
          errors.push(
            `Alko page (skip ${skip}) response has no usable @odata.count ` +
              `(HTTP ${response.status}${jsonInvalid ? ', invalid JSON' : ''}) — ` +
              'stopping after this page',
          );
          // An unparseable or failed response has no rows to lose; a
          // parseable page without a count still yields its rows (alks
          // precedent: the current page's records count).
          if (jsonInvalid || !response.ok) return { records, errors };
          const parsed = parseAlkoAssortment(payload);
          records.push(...parsed.records);
          errors.push(...parsed.errors);
          return { records, errors };
        }
        total = count;
      }

      if (!response.ok) {
        errors.push(
          `Alko page (skip ${skip}) returned HTTP ${response.status}: ${response.statusText}`,
        );
        continue;
      }

      if (jsonInvalid) {
        errors.push(`Alko page (skip ${skip}) returned invalid JSON`);
        continue;
      }

      const { records: pageRecords, errors: pageErrors } =
        parseAlkoAssortment(payload);
      records.push(...pageRecords);
      errors.push(...pageErrors);

      // Count-drift guard: an empty page while the count claims more
      // rows exist would otherwise walk on empty skips forever-bounded
      // but pointless — stop and say so.
      const rows = (payload as AlkoSearchPage).value;
      if (Array.isArray(rows) && rows.length === 0 && skip + PAGE_TOP < total) {
        errors.push(
          `Alko page (skip ${skip}) returned no rows although @odata.count ` +
            `is ${total} — stopping the walk`,
        );
        break;
      }
    }

    return { records, errors };
  }
}
