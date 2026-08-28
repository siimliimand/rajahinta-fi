/**
 * Posti carrier rate source (task 7.4, design D6 — Posti first).
 *
 * Fetches Posti's parcel price table (JSON) and parses it into
 * {@link CarrierRateOffer} rows for the governance-gated transport-rate
 * pipeline. The parser is a pure exported function pinned by a golden
 * fixture test — Posti changes its payload without notice, and the
 * fixture is what makes that visible as a test failure instead of a
 * silent data outage.
 *
 * Payload contract (documented here because the endpoint is not a
 * versioned public API): a top-level object with `source`, `currency`,
 * `publishedAt` (ISO-8601 timestamp — the observation time every offer
 * carries) and a `products` array. Each product row names a lane
 * (origin/destination), a package tier, a weight bracket and a price
 * including VAT. Rows failing validation are reported per-row, never
 * guessed around.
 *
 * @module PostiRateSource
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  POSTI_RATE_FEED_URL,
  type CarrierRateOffer,
  type ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface PostiWeightBracket {
  minKg?: unknown;
  maxKg?: unknown;
}

interface PostiProductRow {
  productCode?: unknown;
  originCountry?: unknown;
  destinationCountry?: unknown;
  packageTier?: unknown;
  weightBracket?: PostiWeightBracket | null;
  priceIncludingVat?: unknown;
  sellerTransportPaid?: unknown;
}

interface PostiPriceList {
  source?: unknown;
  currency?: unknown;
  publishedAt?: unknown;
  priceListVersion?: unknown;
  products?: unknown;
}

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

/** ISO-4217 code the pipeline ingests without FX conversion (task 1.4 owns conversion). */
const SUPPORTED_CURRENCY = 'EUR';

const PACKAGE_TIERS = new Set(['parcel', 'box', 'pallet']);

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readCountry(value: unknown): string | null {
  const raw = readNonEmptyString(value);
  if (raw === null) return null;
  const upper = raw.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function readWeight(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return -1;
  return value;
}

function readPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Parse a Posti price-list payload into carrier rate offers.
 *
 * Pure: no I/O, deterministic on its input. Every rejected row produces
 * an explanatory error entry; a non-EUR list or a missing publication
 * timestamp is a payload-level error (observedAt must reflect the
 * carrier's own publication time or freshness stops being honest).
 */
export function parsePostiRates(payload: unknown): {
  rates: CarrierRateOffer[];
  errors: string[];
} {
  const rates: CarrierRateOffer[] = [];
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return { rates, errors: ['Posti payload is not a JSON object'] };
  }
  const list = payload as PostiPriceList;

  const source = readNonEmptyString(list.source);
  if (source === null || source.toLowerCase() !== 'posti') {
    errors.push(`Unexpected payload source "${String(list.source)}" — expected "posti"`);
    return { rates, errors };
  }

  const currency = readNonEmptyString(list.currency);
  if (currency === null || currency.toUpperCase() !== SUPPORTED_CURRENCY) {
    errors.push(
      `Posti price list currency "${String(list.currency)}" is not ${SUPPORTED_CURRENCY}; ` +
        'non-EUR carrier rates require FX conversion at ingestion (task 1.4) and are rejected here',
    );
    return { rates, errors };
  }

  const publishedAtRaw = readNonEmptyString(list.publishedAt);
  const publishedMs = publishedAtRaw !== null ? Date.parse(publishedAtRaw) : NaN;
  if (publishedAtRaw === null || Number.isNaN(publishedMs)) {
    errors.push('Posti payload lacks a valid publishedAt timestamp — observation time is unknowable');
    return { rates, errors };
  }
  const observedAt = new Date(publishedMs);

  if (!Array.isArray(list.products)) {
    errors.push('Posti payload has no products array');
    return { rates, errors };
  }

  const rows = list.products as PostiProductRow[];
  rows.forEach((row, index) => {
    const label = `products[${index}] (${String(row.productCode ?? 'unnamed')})`;

    const origin = readCountry(row.originCountry);
    const destination = readCountry(row.destinationCountry);
    if (origin === null || destination === null) {
      errors.push(`${label}: invalid lane ${String(row.originCountry)}→${String(row.destinationCountry)}`);
      return;
    }

    const packageTier = readNonEmptyString(row.packageTier)?.toLowerCase() ?? null;
    if (packageTier === null || !PACKAGE_TIERS.has(packageTier)) {
      errors.push(`${label}: unknown package tier "${String(row.packageTier)}"`);
      return;
    }

    const bracket = row.weightBracket ?? {};
    const minKg = readWeight(bracket.minKg);
    const maxKg = readWeight(bracket.maxKg);
    if (minKg === -1 || maxKg === -1) {
      errors.push(`${label}: invalid weight bracket`);
      return;
    }
    if (minKg !== null && maxKg !== null && maxKg <= minKg) {
      errors.push(`${label}: weight bracket max ≤ min`);
      return;
    }

    const priceCents = readPrice(row.priceIncludingVat);
    if (priceCents === null) {
      errors.push(`${label}: invalid price "${String(row.priceIncludingVat)}"`);
      return;
    }

    rates.push({
      carrier: 'posti',
      originCountry: origin,
      destinationCountry: destination,
      weightMinKg: minKg,
      weightMaxKg: maxKg,
      packageTier,
      priceCents,
      currency: SUPPORTED_CURRENCY,
      sellerInvolvementIndicator: row.sellerTransportPaid === true,
      observedAt,
    });
  });

  return { rates, errors };
}

// ---------------------------------------------------------------------------
// HTTP source
// ---------------------------------------------------------------------------

/** Minimal fetcher contract so tests inject fixtures instead of the network. */
export type RateFeedFetcher = (url: string) => Promise<unknown>;

/** Default fetcher — standard fetch, JSON-decoded. */
const jsonFetcher: RateFeedFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
};

@Injectable()
export class PostiCarrierRateSource implements ICarrierRateSource {
  readonly carrierId = 'posti';

  constructor(
    // Injectable for tests/alternative hosts; the default fetches the
    // live endpoint. Live access may require entitlement — the golden
    // fixture pins parser behaviour independently of the network.
    @Optional() private readonly fetcher: RateFeedFetcher = jsonFetcher,
    @Optional() private readonly feedUrl: string = POSTI_RATE_FEED_URL,
  ) {}

  async fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }> {
    try {
      const payload = await this.fetcher(this.feedUrl);
      return parsePostiRates(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { rates: [], errors: [`Posti fetch failed: ${message}`] };
    }
  }
}
