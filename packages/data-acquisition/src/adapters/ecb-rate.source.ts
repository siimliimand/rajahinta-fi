/**
 * ECB reference-rate source (task 1.3, design D2).
 *
 * Fetches the latest ECB daily reference rates (EUR-base) through the
 * Frankfurter API and parses them into an {@link FxRateSnapshot} for
 * the FX dataset review workflow. The parser is a pure exported
 * function pinned by a fixture test — sources change payloads without
 * notice, and the fixture makes that visible as a test failure
 * instead of a silent data outage (same pattern as the Posti source).
 *
 * Payload contract (Frankfurter `/v1/latest`, ECB data): an object
 * with `base` ("EUR" — ECB reference rates are EUR-base; anything else
 * is a different contract and is rejected), `date` (ISO-8601 date of
 * the reference rates) and a `rates` object mapping ISO-4217 codes to
 * positive numbers. Nothing here publishes — the snapshot becomes a
 * PENDING_CONFIRMATION dataset at the earliest.
 *
 * @module EcbReferenceRateSource
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  FX_RATE_SOURCE_URL_DEFAULT,
  type FxRateSnapshot,
  type IFxRateSource,
} from '../interfaces/fx-rate-source.port';
import type { FxRateEntry } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface FrankfurterLatest {
  base?: unknown;
  date?: unknown;
  rates?: unknown;
}

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** ECB reference rates are quoted against EUR — the only base this dataset contract accepts. */
const EXPECTED_BASE = 'EUR';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_4217 = /^[A-Z]{3}$/;

/**
 * Parse a Frankfurter/ECB latest-rates payload into a snapshot.
 *
 * Pure: no I/O, deterministic on its input. A non-EUR base, a missing
 * or malformed date, or an empty/invalid rates object is a payload-level
 * error (null snapshot); individual invalid currency entries are
 * reported per-entry and skipped, never guessed around.
 */
export function parseEcbReferenceRates(payload: unknown): {
  snapshot: FxRateSnapshot | null;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { snapshot: null, errors: ['ECB payload is not a JSON object'] };
  }
  const body = payload as FrankfurterLatest;

  const base = readNonEmptyString(body.base);
  if (base === null || base.toUpperCase() !== EXPECTED_BASE) {
    errors.push(
      `ECB payload base "${String(body.base)}" is not ${EXPECTED_BASE}; ` +
        'ECB reference rates are EUR-base and any other base needs a different dataset contract',
    );
    return { snapshot: null, errors };
  }

  const referenceDate = readNonEmptyString(body.date);
  if (referenceDate === null || !ISO_DATE.test(referenceDate)) {
    errors.push(
      `ECB payload lacks a valid reference date — got "${String(body.date)}" (expected YYYY-MM-DD)`,
    );
    return { snapshot: null, errors };
  }

  if (typeof body.rates !== 'object' || body.rates === null || Array.isArray(body.rates)) {
    errors.push('ECB payload has no rates object');
    return { snapshot: null, errors };
  }

  const rates: FxRateEntry[] = [];
  for (const [rawCode, rawRate] of Object.entries(body.rates as Record<string, unknown>)) {
    const code = rawCode.trim().toUpperCase();
    if (!ISO_4217.test(code)) {
      errors.push(`ECB rates entry "${rawCode}" is not an ISO-4217 alpha-3 code — skipped`);
      continue;
    }
    if (code === EXPECTED_BASE) {
      errors.push('ECB rates contains a EUR/EUR self-pair — skipped');
      continue;
    }
    if (typeof rawRate !== 'number' || !Number.isFinite(rawRate) || rawRate <= 0) {
      errors.push(`ECB rate for ${code} is not a positive number — skipped`);
      continue;
    }
    rates.push({ baseCurrency: EXPECTED_BASE, quoteCurrency: code, rate: rawRate });
  }

  if (rates.length === 0) {
    errors.push('ECB payload carried no valid rate entries');
    return { snapshot: null, errors };
  }

  return {
    snapshot: {
      sourceId: 'ecb',
      sourceName: 'ecb-reference-rates',
      sourceUrl: null,
      referenceDate,
      rates,
    },
    errors,
  };
}

// ---------------------------------------------------------------------------
// HTTP source
// ---------------------------------------------------------------------------

/** Minimal fetcher contract so tests inject fixtures instead of the network. */
export type FxRateFetcher = (url: string) => Promise<unknown>;

/** Default fetcher — standard fetch, JSON-decoded. */
const jsonFetcher: FxRateFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
};

@Injectable()
export class EcbReferenceRateSource implements IFxRateSource {
  readonly sourceId = 'ecb';

  constructor(
    // Injectable for tests/alternative hosts; the default fetches the
    // live endpoint. ECB redistribution terms are an open legal-review
    // item (design.md) — the URL is config-driven for exactly that.
    @Optional() private readonly fetcher: FxRateFetcher = jsonFetcher,
    @Optional() private readonly feedUrl: string = FX_RATE_SOURCE_URL_DEFAULT,
  ) {}

  async fetchLatestRates(): Promise<{
    snapshot: FxRateSnapshot | null;
    errors: string[];
  }> {
    try {
      const payload = await this.fetcher(this.feedUrl);
      return parseEcbReferenceRates(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { snapshot: null, errors: [`ECB fetch failed: ${message}`] };
    }
  }
}
