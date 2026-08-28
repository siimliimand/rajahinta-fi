/**
 * Tests for the Systembolaget feed adapter's source-category
 * normalization (task 7.1) and SEK→EUR conversion at ingestion
 * (task 1.4, change technical-assessment-remediation; design D2).
 *
 * Pins the ingestion contracts of the product-normalization and
 * fx-rate-dataset spec deltas:
 * - Swedish category strings map to canonical tax-rule category keys,
 *   and unmappable categories are flagged (per-item error) instead of
 *   silently assigned a fallback.
 * - SEK prices convert to EUR cents through the rate effective on the
 *   observation date, carrying the original SEK amount for display and
 *   the FX dataset version as provenance.
 * - Offers with no effective SEK/EUR rate are rejected per-item with a
 *   recorded reason — never stored as a foreign amount.
 *
 * @module SystembolagetFeedAdapterTests
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SystembolagetFeedAdapter } from '../adapters/systembolaget.adapter';
import type {
  FxRateDatasetService,
  ResolvedFxDatasetRate,
} from '@rajahinta/core-domain';

const CONFIG = {
  feedUrl: 'https://www.systembolaget.se/api/assortment',
  feedFormat: 'json' as const,
};

/** EUR per 1 SEK — an ECB-style EUR/SEK quote of 11.29, inverted. */
const SEK_TO_EUR_RATE = 1 / 11.29;
const FX_VERSION = 'ecb-2026-08-27';

function resolvedRate(rate = SEK_TO_EUR_RATE): ResolvedFxDatasetRate {
  return {
    dataset: {
      id: 7,
      versionLabel: FX_VERSION,
      sourceName: 'ecb-reference-rates',
      sourceUrl: null,
      referenceDate: '2026-08-27',
      status: 'PUBLISHED',
      effectiveFrom: new Date('2026-08-27T00:00:00.000Z'),
      effectiveTo: null,
      confirmedBy: 'ops@example.invalid',
      confirmedAt: new Date(),
      createdAt: new Date(),
    },
    baseCurrency: 'SEK',
    quoteCurrency: 'EUR',
    rate,
    inverted: true,
  };
}

/** FX service stub resolving a fixed SEK→EUR rate (the batch constant). */
function fxWithRate(rate: number | null = SEK_TO_EUR_RATE): FxRateDatasetService {
  return {
    resolveRate: vi.fn().mockResolvedValue(rate === null ? null : resolvedRate(rate)),
  } as unknown as FxRateDatasetService;
}

function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: '12345',
    productNameBold: 'Norrlands Guld Export',
    productNameThin: '',
    category: 'Öl',
    alcoholPercentage: 5.2,
    bottleVolume: 500,
    bottleText: 'Burk',
    price: 15.9,
    apk: 'FL',
    ...overrides,
  };
}

function stubFetch(payload: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystembolagetFeedAdapter — SE category normalization at ingestion', () => {
  it('maps the Swedish category to the canonical tax-rule category key', async () => {
    stubFetch([product({ category: 'Öl' })]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('beer');
    expect(records[0].regulatoryClassification).toBe('beer');
  });

  it.each([
    ['Vin', 'wine_still'],
    ['Mousserande vin', 'wine_sparkling'],
    ['Sprit', 'spirits'],
    ['Cider och blanddrycker', 'other_fermented'],
    ['Starkvin', 'intermediate_products'],
  ])('maps "%s" → %s', async (swedish, taxKey) => {
    stubFetch([product({ category: swedish })]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records[0].regulatoryClassification).toBe(taxKey);
  });

  it('never writes the "unknown" placeholder classification', async () => {
    stubFetch([product()]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records[0].regulatoryClassification).not.toBe('unknown');
  });

  it('flags an unmappable category as a per-item error and skips the record', async () => {
    stubFetch([product({ category: 'Kaffe' }), product({ productId: '99', category: 'Vin' })]);

    const { records, errors } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].productId).toBe('99');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Kaffe');
    expect(errors[0]).toContain('correction queue');
  });

  it('flags a missing category instead of guessing', async () => {
    stubFetch([product({ category: undefined })]);

    const { records, errors } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(errors[0]).toContain('no canonical mapping');
  });
});

describe('SystembolagetFeedAdapter — SEK→EUR conversion at ingestion (task 1.4)', () => {
  it('converts SEK to EUR cents via the rate effective on the observation date', async () => {
    stubFetch([product({ price: 15.9 })]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records).toHaveLength(1);
    // 15.90 SEK × (1/11.29 EUR/SEK) × 100 — rounded half-up to cents.
    expect(records[0].priceCents).toBe(Math.round(15.9 * SEK_TO_EUR_RATE * 100));
    expect(records[0].currency).toBe('EUR');
  });

  it('keeps the original SEK amount and currency for display', async () => {
    stubFetch([product({ price: 15.9 })]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records[0].originalPriceCents).toBe(1590);
    expect(records[0].originalCurrency).toBe('SEK');
  });

  it('records the FX dataset version as conversion provenance', async () => {
    stubFetch([product()]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate()).fetch(CONFIG);

    expect(records[0].fxDatasetVersion).toBe(FX_VERSION);
  });

  it('resolves the rate once per fetch with the observation date', async () => {
    stubFetch([product(), product({ productId: '2' })]);

    const fx = fxWithRate();
    const before = Date.now();
    await new SystembolagetFeedAdapter(fx).fetch(CONFIG);
    const after = Date.now();

    expect(fx.resolveRate).toHaveBeenCalledTimes(1);
    expect(fx.resolveRate).toHaveBeenCalledWith('SEK', 'EUR', expect.any(Date));
    const calledWith = (fx.resolveRate as ReturnType<typeof vi.fn>).mock.calls[0][2] as Date;
    expect(calledWith.getTime()).toBeGreaterThanOrEqual(before);
    expect(calledWith.getTime()).toBeLessThanOrEqual(after);
  });

  it('rejects every priced offer per-item when no effective rate exists', async () => {
    stubFetch([product({ price: 15.9 }), product({ productId: '2', price: 89 })]);

    const { records, errors } = await new SystembolagetFeedAdapter(fxWithRate(null)).fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toContain('no effective SEK/EUR rate');
      expect(error).toContain('offer rejected');
    }
  });

  it('fails closed when no FX service is wired at all', async () => {
    stubFetch([product()]);

    const { records, errors } = await new SystembolagetFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(errors).toEqual([
      expect.stringContaining('No FX rate dataset service available'),
      expect.stringContaining('no effective SEK/EUR rate'),
    ]);
  });

  it('surfaces FX resolution failures as fetch errors without throwing', async () => {
    stubFetch([product()]);
    const fx = {
      resolveRate: vi.fn().mockRejectedValue(new Error('FX repository outage')),
    } as unknown as FxRateDatasetService;

    const { records, errors } = await new SystembolagetFeedAdapter(fx).fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(errors[0]).toContain('FX repository outage');
    expect(errors[1]).toContain('no effective SEK/EUR rate');
  });

  it('keeps unpriced items mapped without conversion provenance', async () => {
    stubFetch([product({ price: undefined })]);

    const { records } = await new SystembolagetFeedAdapter(fxWithRate(null)).fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].priceCents).toBe(0);
    expect(records[0].originalPriceCents).toBe(0);
    expect(records[0].fxDatasetVersion).toBeUndefined();
  });
});
