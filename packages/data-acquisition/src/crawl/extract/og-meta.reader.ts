/**
 * OG/meta fallback reader (task 1.2, change sitemap-crawl-merchants;
 * design D3 — extraction tiering, last tier).
 *
 * Bounded best-effort: none of the four v1 sources needs it (licorea
 * and drinkonline are complete JSON-LD, viinarannasta microdata,
 * viinikauppa thin JSON-LD), but markup drift on those pages must
 * degrade to a scarcer record instead of nothing. Only head meta tags
 * are consulted — OpenGraph product annotations and the `itemprop`
 * meta variants:
 *
 *   og:title / name            → name
 *   og:description / description → description (fallback input only)
 *   product:price:amount, itemprop=price   → price
 *   product:price:currency, itemprop=priceCurrency → currency
 *
 * No brand, GTIN, or SKU is ever guessed from OG tags.
 *
 * @module OgMetaReader
 */

import { parseHtmlAttributes } from './html-attrs';
import {
  priceToCents,
  type StructuredOffer,
  type StructuredProduct,
} from './structured-product';

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;

const TITLE_KEYS = ['og:title', 'name'];
const DESCRIPTION_KEYS = ['og:description', 'description'];
const PRICE_KEYS = ['product:price:amount', 'price'];
const CURRENCY_KEYS = ['product:price:currency', 'pricecurrency'];

function readMetaMap(html: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of html.matchAll(META_TAG_PATTERN)) {
    const attrs = parseHtmlAttributes(match[0].replace(/^<meta\b/i, '').replace(/>$/, ''));
    const key = (attrs['property'] ?? attrs['itemprop'] ?? '').toLowerCase();
    const content = attrs['content'];
    if (key === '' || content === undefined || content === '') continue;
    if (!values.has(key)) values.set(key, content.trim());
  }
  return values;
}

function firstValue(metas: Map<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = metas.get(key);
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

export function readOgMetaProduct(html: string): StructuredProduct | null {
  const metas = readMetaMap(html);

  const name = firstValue(metas, TITLE_KEYS);
  const priceCents = priceToCents(firstValue(metas, PRICE_KEYS));
  // A page carrying neither a title nor a price read nothing — null,
  // so the tiering error stays honest about what the page contained.
  if (name === null && priceCents === null) return null;

  const offer: StructuredOffer | null =
    priceCents === null
      ? null
      : {
          priceCents,
          currency: firstValue(metas, CURRENCY_KEYS),
          availability: null,
        };

  return {
    name: name ?? '',
    brand: null,
    gtin: null,
    sku: null,
    description: firstValue(metas, DESCRIPTION_KEYS),
    offer,
  };
}
