/**
 * Alko feed adapter (task 7.5, change technical-assessment-remediation;
 * design D7/D6).
 *
 * The domestic reference merchant: Alko's assortment through the same
 * adapter interface and governance gate as Systembolaget. No live API
 * entitlement exists yet — the payload contract below is pinned by the
 * golden-dataset fixture (adapters/__fixtures__/alko-assortment.fixture.ts)
 * exactly like the Posti carrier source, so when a real feed is wired
 * (registry feedUrl), any contract drift surfaces as a test failure
 * instead of a silent data outage.
 *
 * Payload contract: a top-level object with `source` ("alko"),
 * `currency` ("EUR" — the domestic reference list is EUR by definition;
 * a non-EUR list is rejected per the Posti precedent), and a `products`
 * array. Each row names the product, its Finnish assortment group
 * ("Olut", "Viini", … — mapped through the same source-category
 * normalization as the Swedish groups), ABV, volume, and the price
 * including VAT. Rows failing validation are reported per-row, never
 * guessed around.
 *
 * EUR-native: no FX conversion — `originalPriceCents` equals
 * `priceCents` and no `fxDatasetVersion` is recorded (its absence is
 * the no-conversion provenance).
 *
 * @module AlkoFeedAdapter
 */

import { mapSourceCategory } from '@rajahinta/core-domain';
import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface AlkoProductRow {
  productId?: unknown;
  name?: unknown;
  manufacturer?: unknown;
  /** Finnish assortment group (e.g. "Olut", "Viini", "Viina"). */
  productGroup?: unknown;
  alcoholPercentage?: unknown;
  volumeMl?: unknown;
  /** Retail price in EUR including VAT — required on the reference feed. */
  price?: unknown;
  packagingType?: unknown;
  ean?: unknown;
}

interface AlkoAssortment {
  source?: unknown;
  currency?: unknown;
  products?: unknown;
}

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

/** The domestic reference list is EUR — anything else is another contract. */
const SUPPORTED_CURRENCY = 'EUR';

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** ABV may legitimately be 0.0 (alcohol-free reference products). */
function readAbv(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Parse an Alko assortment payload into canonical feed records.
 *
 * Pure: no I/O, deterministic on its input. A non-alko source, a
 * non-EUR list, or a missing products array is a payload-level error;
 * individual invalid rows (unmappable category, missing or invalid
 * price) are reported per-row and skipped — the correction-queue
 * surface shared with the Systembolaget adapter.
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
  const assortment = payload as AlkoAssortment;

  const source = readNonEmptyString(assortment.source);
  if (source === null || source.toLowerCase() !== 'alko') {
    errors.push(`Unexpected payload source "${String(assortment.source)}" — expected "alko"`);
    return { records, errors };
  }

  const currency = readNonEmptyString(assortment.currency);
  if (currency === null || currency.toUpperCase() !== SUPPORTED_CURRENCY) {
    errors.push(
      `Alko price list currency "${String(assortment.currency)}" is not ${SUPPORTED_CURRENCY}; ` +
        'non-EUR merchant feeds require FX conversion at ingestion (task 1.4) and are rejected here',
    );
    return { records, errors };
  }

  if (!Array.isArray(assortment.products)) {
    errors.push('Alko payload has no products array');
    return { records, errors };
  }

  const rows = assortment.products as AlkoProductRow[];
  rows.forEach((row) => {
    const label = `product ${String(row.productId ?? '(unknown)')}`;

    const mapping = mapSourceCategory(readNonEmptyString(row.productGroup) ?? '');
    if (mapping === null) {
      errors.push(
        `Failed to map ${label}: Finnish category "${String(row.productGroup)}" has no ` +
          'canonical mapping — flagged for the correction queue',
      );
      return;
    }

    // The reference feed must carry a price: a reference offer without
    // an amount is unusable for comparison, unlike a not-yet-priced
    // item on a foreign assortment snapshot.
    const price = readPositiveNumber(row.price);
    if (price === null) {
      errors.push(`Failed to map ${label}: missing or invalid price "${String(row.price)}"`);
      return;
    }

    const alcoholPercentage = readAbv(row.alcoholPercentage);
    const volumeMl = readPositiveNumber(row.volumeMl);

    records.push({
      productId: readNonEmptyString(row.productId) ?? '',
      productName: readNonEmptyString(row.name) ?? '',
      manufacturer: readNonEmptyString(row.manufacturer)
        ?? readNonEmptyString(row.name)
        ?? '',
      brand: readNonEmptyString(row.name) ?? '',
      category: mapping.taxCategory,
      alcoholByVolume:
        alcoholPercentage !== null ? alcoholPercentage / 100 : null,
      volumeMl: volumeMl ?? 0,
      containerType: readNonEmptyString(row.packagingType) ?? 'unknown',
      regulatoryClassification: mapping.taxCategory,
      depositSystem: true, // Finnish pantti applies to Alko containers
      ean: readNonEmptyString(row.ean),
      // EUR-native: canonical and original amounts are the same cents;
      // no fxDatasetVersion — absence marks the no-conversion path.
      priceCents: Math.round(price * 100),
      currency: 'EUR',
      originalPriceCents: Math.round(price * 100),
      originalCurrency: SUPPORTED_CURRENCY,
      availability: 'in_stock',
      sourceUrl: null,
    });
  });

  return { records, errors };
}

// ---------------------------------------------------------------------------
// Feed adapter
// ---------------------------------------------------------------------------

export class AlkoFeedAdapter implements IFeedAdapter {
  readonly merchantId = 'alko';

  /**
   * Fetch the latest assortment from the configured Alko feed URL and
   * map it to canonical records. Errors are collected per-item (and
   * per-payload for structural failures); never thrown for recoverable
   * failures.
   */
  async fetch(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    try {
      const response = await fetch(config.feedUrl);

      if (!response.ok) {
        return {
          records: [],
          errors: [
            `Alko API returned HTTP ${response.status}: ${response.statusText}`,
          ],
        };
      }

      return parseAlkoAssortment(await response.json());
    } catch (err) {
      return {
        records: [],
        errors: [
          `Alko fetch failed: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        ],
      };
    }
  }
}
