/**
 * Detail-page extractor — markup tiering plus the record assembly
 * (task 1.2, change sitemap-crawl-merchants; design D3).
 *
 * Tiering: JSON-LD `Product` → schema.org microdata → OG/meta. The
 * first reader yielding a USABLE product wins — usable means a non-
 * empty name and an offer with a parsable price — so a thin JSON-LD
 * cannot starve a richer lower tier of its price, while structured
 * data with a real price is never silently patched from a weaker tier
 * (a non-EUR price is structured drift → correction error, not a
 * fallback opportunity; the Posti precedent).
 *
 * Record assembly reuses the Store API parser's heuristics and
 * contracts (exported from `alks.parser.ts`, design D3/D7): ABV/volume
 * from the product name (multipack-aware, per-unit litres rule),
 * container tokens into the product_master vocabulary, the ABV-guarded
 * name-token category mapping so a zero/unparseable-ABV row lands as
 * non-alcoholic with the same review hold, and bundle names held for
 * review. Per-source knobs (store-brand override, description ABV)
 * come from the {@link ExtractorConfig}.
 *
 * Minimization: the record carries no images and no description —
 * those exist only as reader inputs, and no record field could hold
 * them. EAN is captured only from an explicit GTIN field: a 13-digit
 * SKU is never promoted to an EAN (the araxes internal-code lesson).
 *
 * Per-row failures drop the row with a correction error naming it,
 * exactly like the Store API parser; extraction itself never throws.
 *
 * @module ExtractPage
 */

import type { RawFeedRecord } from '../../interfaces/feed-adapter.interface';
import {
  containerTypeFromName,
  isMultiProductBundleName,
  nameImpliedMapping,
  parseAbvPercent,
  parseVolume,
  readEanFromSku,
} from '../../adapters/alks.parser';
import { NONALCOHOLIC_HOLD_REASON } from '@rajahinta/core-domain';
import type { ExtractorConfig } from './extractor-config';
import { readJsonLdProduct } from './json-ld.reader';
import { readMicrodataProduct } from './microdata.reader';
import { readOgMetaProduct } from './og-meta.reader';
import {
  normalizeAvailability,
  type StructuredProduct,
} from './structured-product';

export interface PageExtraction {
  readonly record: RawFeedRecord | null;
  readonly errors: readonly string[];
}

// licorea "-en-p-1234.html" / viinarannasta "fi/viskit/1718-jameson.html"
// carry a stable shop id in the URL; the remaining sources fall back to
// their slug — the page's own stable address, never a derived guess.
const TRAILING_ID_PATTERN = /-p-(\d+)\.html?$/i;
const LEADING_ID_PATTERN = /\/(\d+)-[^/]+\.html?$/i;

function urlProductId(url: string): string | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the raw string — a malformed URL still ends in its slug
  }
  const id = TRAILING_ID_PATTERN.exec(path) ?? LEADING_ID_PATTERN.exec(path);
  if (id !== null) return id[1];
  const lastSegment = path.split('/').filter((s) => s !== '').pop();
  return lastSegment === undefined
    ? null
    : lastSegment.replace(/\.html?$/i, '');
}

function isUsable(product: StructuredProduct | null): boolean {
  return (
    product !== null &&
    product.name !== '' &&
    product.offer !== null &&
    product.offer.priceCents !== null
  );
}

function extractWithTiering(html: string): {
  product: StructuredProduct | null;
  sawAnyProduct: boolean;
} {
  let sawAnyProduct = false;
  for (const read of [
    readJsonLdProduct,
    readMicrodataProduct,
    readOgMetaProduct,
  ]) {
    const product = read(html);
    if (product === null) continue;
    sawAnyProduct = true;
    // Structured but priceless: fall through so a complete lower tier
    // can still produce a record.
    if (isUsable(product)) return { product, sawAnyProduct: true };
  }
  return { product: null, sawAnyProduct };
}

/**
 * Extract zero or one canonical record from a detail page under the
 * source's normalizer config. Collected errors name the row — the
 * caller merges them into the walk's `errors[]`.
 */
export function extractProductPage(
  url: string,
  html: string,
  config: ExtractorConfig,
): PageExtraction {
  const { product, sawAnyProduct } = extractWithTiering(html);
  if (product === null) {
    return {
      record: null,
      errors: [
        sawAnyProduct
          ? `${config.merchantId} ${url}: structured product carries no usable name+price — no record`
          : `${config.merchantId} ${url}: no readable JSON-LD Product, microdata, or OG/meta — no record`,
      ],
    };
  }

  const label = `${config.merchantId} product ${
    product.sku ?? urlProductId(url) ?? url
  }`;
  const errors: string[] = [];

  const name = product.name.trim();

  // D1 (data-quality-and-publication-trust), reused: a name that
  // concatenates a second product cannot yield one honest ABV/volume.
  if (isMultiProductBundleName(name)) {
    return {
      record: null,
      errors: [
        `Failed to map ${label}: product name indicates a multi-product bundle ("${name}") — ` +
          'held for review, flagged for the correction queue',
      ],
    };
  }

  const offer = product.offer!;
  const currency = offer.currency?.trim().toUpperCase() ?? null;
  if (currency === null || currency !== 'EUR') {
    return {
      record: null,
      errors: [
        `Failed to map ${label}: price currency "${String(offer.currency)}" is not EUR — ` +
          'non-EUR rows require FX conversion at ingestion and are rejected here',
      ],
    };
  }
  const priceCents = offer.priceCents!;

  // EAN only from an explicit GTIN claim; anything else stays EAN-less.
  let ean: string | null = null;
  if (product.gtin !== null) {
    ean = readEanFromSku(product.gtin);
    if (ean === null) {
      errors.push(
        `Failed to map ${label}: GTIN "${product.gtin}" does not match an accepted ` +
          'EAN form (13 digits, or a leading-zero GTIN-14) — record kept without an EAN, ' +
          'flagged for the correction queue',
      );
    }
  }

  // ABV: structured fields carry none on any v1 source (recon verdicts),
  // so the name percentage is the primary carrier and the description
  // prose is the configured per-source fallback — never the reverse.
  const abvPercent = parseAbvPercent(name) ??
    (config.abvFromDescription !== undefined && product.description !== null
      ? config.abvFromDescription(product.description)
      : null);
  const abvFraction = abvPercent !== null ? abvPercent / 100 : null;

  const volume = parseVolume(name);
  const brand =
    product.brand !== null &&
    config.storeBrandNames !== undefined &&
    config.storeBrandNames.includes(product.brand.trim().toLowerCase())
      ? ''
      : (product.brand ?? '');

  // The same ABV-guarded name-token mapping the Store API parser uses:
  // crawl pages expose no storefront categories, so a zero/unparseable
  // ABV re-keys to non-alcoholic with the identical review hold (D7).
  const mapping = nameImpliedMapping(name, abvFraction);
  if (mapping === null) {
    return {
      record: null,
      errors: [
        ...errors,
        `Failed to map ${label}: product name yields no canonical beverage category — ` +
          'flagged for the correction queue',
      ],
    };
  }
  const held = mapping.nonAlcoholicHold === true;
  if (held) {
    errors.push(
      `Held for review ${label}: ABV is ${abvPercent === 0 ? '0' : 'unparseable'} but the ` +
        'name resolves to an alcohol category — non-alcoholic rows are barred from alcohol ' +
        `categories, ingested as non-alcoholic with hold reason ${NONALCOHOLIC_HOLD_REASON}, ` +
        'flagged for the correction queue',
    );
  }

  const record: RawFeedRecord = {
    productId: product.sku ?? urlProductId(url) ?? ean ?? url,
    productName: name,
    manufacturer: brand,
    brand,
    category: mapping.taxCategory,
    alcoholByVolume: abvPercent !== null ? abvPercent / 100 : null,
    volumeMl: volume?.volumeMl ?? 0,
    packCount: volume?.packCount ?? null,
    containerType: containerTypeFromName(name),
    regulatoryClassification: mapping.taxCategory,
    depositSystem: false,
    ean,
    priceCents,
    currency: 'EUR',
    originalPriceCents: priceCents,
    originalCurrency: 'EUR',
    availability: normalizeAvailability(offer.availability),
    sourceUrl: url,
    reviewHoldReason: held ? NONALCOHOLIC_HOLD_REASON : null,
  };

  return { record, errors };
}
