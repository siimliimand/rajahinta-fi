/**
 * Tests for the Systembolaget feed adapter's source-category
 * normalization (task 7.1).
 *
 * Pins the ingestion contract of the product-normalization spec delta:
 * Swedish category strings map to canonical tax-rule category keys, and
 * unmappable categories are flagged (per-item error) instead of silently
 * assigned a fallback.
 *
 * @module SystembolagetFeedAdapterTests
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SystembolagetFeedAdapter } from '../adapters/systembolaget.adapter';

const CONFIG = {
  feedUrl: 'https://www.systembolaget.se/api/assortment',
  feedFormat: 'json' as const,
};

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

    const { records } = await new SystembolagetFeedAdapter().fetch(CONFIG);

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

    const { records } = await new SystembolagetFeedAdapter().fetch(CONFIG);

    expect(records[0].regulatoryClassification).toBe(taxKey);
  });

  it('never writes the "unknown" placeholder classification', async () => {
    stubFetch([product()]);

    const { records } = await new SystembolagetFeedAdapter().fetch(CONFIG);

    expect(records[0].regulatoryClassification).not.toBe('unknown');
  });

  it('flags an unmappable category as a per-item error and skips the record', async () => {
    stubFetch([product({ category: 'Kaffe' }), product({ productId: '99', category: 'Vin' })]);

    const { records, errors } = await new SystembolagetFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].productId).toBe('99');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Kaffe');
    expect(errors[0]).toContain('correction queue');
  });

  it('flags a missing category instead of guessing', async () => {
    stubFetch([product({ category: undefined })]);

    const { records, errors } = await new SystembolagetFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(errors[0]).toContain('no canonical mapping');
  });
});
