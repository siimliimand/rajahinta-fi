/**
 * Structured-product shape shared by the three readers (task 1.2,
 * change sitemap-crawl-merchants; design D3).
 *
 * Each reader (JSON-LD, schema.org microdata, OG/meta) normalizes the
 * page's markup into one {@link StructuredProduct}; the extractor
 * (extract-page) turns the first usable one into a RawFeedRecord. The
 * description is carried ONLY as input for per-source ABV fallbacks —
 * data minimization keeps it (and images) out of the record; no field
 * exists for either.
 *
 * @module StructuredProduct
 */

/** The one offer the extractor needs: price, currency, availability. */
export interface StructuredOffer {
  /** Integer cents; null when the source's price is absent/unusable. */
  readonly priceCents: number | null;
  readonly currency: string | null;
  /** Verbatim schema.org availability token (URL or bare), or null. */
  readonly availability: string | null;
}

export interface StructuredProduct {
  readonly name: string;
  readonly brand: string | null;
  /** Verbatim GTIN value (typically `gtin13` / itemprop GTIN13). */
  readonly gtin: string | null;
  readonly sku: string | null;
  /** Prose used only by per-source ABV fallbacks — never ingested. */
  readonly description: string | null;
  readonly offer: StructuredOffer | null;
}

/**
 * "https://schema.org/InStock" | "InStock" → the Store API availability
 * vocabulary the pipeline already consumes. Only explicit in/out states
 * are resolved; everything else stays honestly 'unknown'.
 */
export function normalizeAvailability(
  raw: string | null,
): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (raw === null) return 'unknown';
  const token = raw.split(/[/#]/).pop()?.trim().toLowerCase() ?? '';
  if (token === 'instock' || token === 'limitedavailability') return 'in_stock';
  if (token === 'outofstock' || token === 'soldout') return 'out_of_stock';
  return 'unknown';
}

/**
 * JSON-LD / OG price ("18.80", 18.8, "18,80") → integer cents. Null for
 * anything that does not parse into a non-negative amount.
 */
export function priceToCents(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return null;
  return Math.round(Number.parseFloat(trimmed.replace(',', '.')) * 100);
}

/**
 * Verbatim GTIN coercion ("5011013100156" or its numeric JSON form);
 * null for absent values. The digits are NOT validated here — a
 * malformed value must reach record assembly so the correction error
 * can name it (the parser's readEanFromSku validates there).
 */
export function readGtinRaw(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * schema.org brand values arrive as a plain string (drinkonline), a
 * Brand/Organization node (licorea), or an array of either. First
 * resolvable name wins; null when none does.
 */
export function coerceBrand(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const brand = coerceBrand(entry);
      if (brand !== null) return brand;
    }
    return null;
  }
  if (typeof value === 'object' && value !== null) {
    const name = (value as Record<string, unknown>)['name'];
    if (typeof name === 'string') {
      const trimmed = name.trim();
      return trimmed === '' ? null : trimmed;
    }
  }
  return null;
}
