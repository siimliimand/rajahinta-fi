/**
 * JSON-LD Product reader (task 1.2, change sitemap-crawl-merchants;
 * design D3 — extraction tiering, first tier).
 *
 * Reads every `application/ld+json` script block, finds the first
 * `Product` node (top-level, inside an array, or inside `@graph`), and
 * normalizes it to a {@link StructuredProduct}. A block that fails to
 * parse is skipped — the next block or the next reader tier gets its
 * chance; nothing here throws on malformed markup.
 *
 * Offer shapes handled: a single Offer object (licorea, viinikauppa),
 * an array of Offers (drinkonline — the first offer with a usable
 * price wins), and an AggregateOffer whose nested `offers` array or
 * `lowPrice` carries the amount. `priceValidUntil`, `itemCondition`,
 * `mpn`, and `image` are read never: the record has no field for them
 * (data minimization).
 *
 * @module JsonLdReader
 */

import {
  coerceBrand,
  priceToCents,
  readGtinRaw,
  type StructuredOffer,
  type StructuredProduct,
} from './structured-product';

const SCRIPT_PATTERN =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

const GTIN_KEYS = ['gtin13', 'gtin', 'gtin14', 'gtin12'] as const;

/** CDATA comment wrappers some CMS templates put around the JSON. */
function stripJsonCommentWrappers(text: string): string {
  return text
    .replace(/\/\*\s*<!\[CDATA\[\s*\*\//g, '')
    .replace(/\/\*\s*\]\]>\s*\*\//g, '')
    .replace(/\/\/\s*<!\[CDATA\[/g, '')
    .replace(/\/\/\s*\]\]>/g, '');
}

function isProductType(type: unknown): boolean {
  if (type === 'Product') return true;
  return Array.isArray(type) && type.includes('Product');
}

function findProductNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProductNode(entry);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const node = value as Record<string, unknown>;
  if (isProductType(node['@type'])) return node;
  if ('@graph' in node) return findProductNode(node['@graph']);
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** First offer with a usable price, across every container shape. */
function readOffer(offers: unknown): StructuredOffer | null {
  if (Array.isArray(offers)) {
    for (const entry of offers) {
      const offer = readOffer(entry);
      if (offer !== null && offer.priceCents !== null) return offer;
    }
    return null;
  }
  if (typeof offers !== 'object' || offers === null) return null;

  const node = offers as Record<string, unknown>;
  if (Array.isArray(node['offers'])) return readOffer(node['offers']);

  const priceCents = priceToCents(node['price'] ?? node['lowPrice']);
  return {
    priceCents,
    currency: readNonEmptyString(node['priceCurrency']),
    availability: readNonEmptyString(node['availability']),
  };
}

export function readJsonLdProduct(html: string): StructuredProduct | null {
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonCommentWrappers(match[1]));
    } catch {
      continue;
    }

    const product = findProductNode(parsed);
    if (product === null) continue;

    let gtin: string | null = null;
    for (const key of GTIN_KEYS) {
      const raw = readGtinRaw(product[key]);
      if (raw !== null) {
        gtin = raw;
        break;
      }
    }

    return {
      name: readNonEmptyString(product['name']) ?? '',
      brand: coerceBrand(product['brand']),
      gtin,
      sku: readNonEmptyString(product['sku']),
      description: readNonEmptyString(product['description']),
      offer: readOffer(product['offers']),
    };
  }
  return null;
}
