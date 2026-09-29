/**
 * Product price-context line tests (insight-surfaces task 3.3; the
 * window-low and percentile rendering is task 2.3 of change
 * funnel-evidence-and-value-surfaces, spec price-context).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would (blog-page test precedent), pinning the committed API contract:
 *
 *   1. A computed context renders the factual median sentence carrying
 *      the current price, the median, the delta in cents, the bucket
 *      count, and the as-of date — plus the two window facts: the
 *      window-low sentence when `isWindowLow` is true, and the
 *      percentile rank displayed as an integer percent rounded half up
 *      from basis points (a 0 % result renders as-is — degenerate
 *      figures are stated plainly here, never softened). The delta
 *      stays in cents; the only % on this surface is the window-day
 *      share.
 *   2. INSUFFICIENT_HISTORY renders the honest "not enough history"
 *      state, still explainable (bucket count + as-of), with the two
 *      window sentences absent — the fields arrive null there and are
 *      never fabricated.
 *   3. A failed fetch, or a computed shape missing the window-fact
 *      fields (e.g. a stale cached response), keeps the line absent
 *      from the HTML entirely.
 *   4. Both locales render from the real catalogs (FI and EN).
 *
 * @module ProductPriceContextLineTest
 */
// @vitest-environment jsdom

import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductPriceContextLine from './ProductPriceContextLine';
import { request } from '@/lib/api';

/**
 * Test-scoped locale for the mocked next-intl lookup — the component
 * resolves its namespace through the request locale in production, so
 * the test picks the catalog here instead. Reset to FI before each test.
 */
let testLocale: 'fi' | 'en' = 'fi';

vi.mock('next-intl/server', () => ({
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const requested = typeof opts === 'string' ? undefined : opts?.locale;
    const locale = requested ?? testLocale;
    const table = (
      await import(locale === 'en' ? '@/messages/en.json' : '@/messages/fi.json')
    ).default as Record<string, unknown>;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

beforeEach(() => {
  mockedRequest.mockReset();
  testLocale = 'fi';
});

/** Straight renderToString — the component renders null or an element. */
async function renderLine(productId: number): Promise<string> {
  const element = await ProductPriceContextLine({ productId });
  return renderToString(element);
}

function computedPayload(
  contextOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    productId: 7,
    currentBestPriceCents: 1234,
    context: {
      status: 'computed',
      medianCents: 1100,
      minCents: 999,
      maxCents: 1500,
      deltaVsMedianCents: 134,
      deltaVsMedianBasisPoints: 1218,
      percentileRankBasisPoints: 2857,
      isWindowLow: false,
      windowDays: 90,
      bucketCount: 90,
      asOf: '2026-09-08',
      ...contextOverrides,
    },
  };
}

describe('ProductPriceContextLine', () => {
  it('renders the factual median sentence plus the percentile fact, and no window-low claim when false', async () => {
    mockedRequest.mockResolvedValue(computedPayload());

    const html = await renderLine(7);

    expect(html).toContain('product-price-context');
    expect(html).toContain('Nykyhinta ja 90 päivän mediaani');
    expect(html).toContain('12.34 €'); // current best
    expect(html).toContain('11.00 €'); // median
    expect(html).toContain('1.34 €'); // delta in cents
    expect(html).toContain('90 päivältä'); // window bucket count
    expect(html).toContain('2026-09-08'); // as-of
    // Percentile fact (task 2.3): 2857 bps → integer percent 29
    // (Math.round(28.57)), a statistic about the window's days.
    expect(html).toContain('halvempi kuin 29 % 90 päivän aikavälin päivistä');
    // isWindowLow is false — the window-low sentence stays absent.
    expect(html).not.toContain('alhaisin');
    // Content law (proposal D3): no advice, no urging, no superlatives.
    expect(html).not.toMatch(
      /paras|edullisin|osta nyt|best deal|good time to buy|buy now|cheapest|bargain/i,
    );
  });

  it('rounds basis points half up to a whole percent (2849 bps → 28 %)', async () => {
    mockedRequest.mockResolvedValue(
      computedPayload({ percentileRankBasisPoints: 2849 }),
    );

    const html = await renderLine(7);

    expect(html).toContain('halvempi kuin 28 %');
    expect(html).not.toContain('29 %');
    expect(html).not.toContain('28.57'); // never the raw ratio
  });

  it('renders the window-low sentence when the current price equals the window minimum', async () => {
    mockedRequest.mockResolvedValue(
      computedPayload({ isWindowLow: true, percentileRankBasisPoints: 7500 }),
    );

    const html = await renderLine(7);

    expect(html).toContain('data-state="computed"');
    expect(html).toContain(
      'Matalin nykyinen myyntihinta on alhaisin 90 päivän aikavälillä havaittu hinta.',
    );
    expect(html).toContain('halvempi kuin 75 %');
  });

  it('renders both window facts in English from the EN catalog', async () => {
    testLocale = 'en';
    mockedRequest.mockResolvedValue(
      computedPayload({ isWindowLow: true, percentileRankBasisPoints: 2857 }),
    );

    const html = await renderLine(7);

    expect(html).toContain('data-state="computed"');
    expect(html).toContain(
      'The lowest current offer price is the lowest observed price in this 90-day window.',
    );
    // 2857 bps → 29 %, same half-up integer rule in both locales.
    expect(html).toContain(
      'The lowest current offer price is cheaper than 29% of the days in this 90-day window.',
    );
    expect(html).not.toContain('halvempi'); // the FI catalog is not bled in
  });

  it('renders the honest insufficient-history state with the figures that explain it, and none of the window facts', async () => {
    mockedRequest.mockResolvedValue({
      productId: 7,
      currentBestPriceCents: 1234,
      context: {
        status: 'unavailable',
        reason: 'INSUFFICIENT_HISTORY',
        medianCents: null,
        minCents: null,
        maxCents: null,
        deltaVsMedianCents: null,
        deltaVsMedianBasisPoints: null,
        percentileRankBasisPoints: null,
        isWindowLow: null,
        windowDays: 90,
        bucketCount: 4,
        asOf: '2026-09-08',
      },
    });

    const html = await renderLine(7);

    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('ei ole riittävästi');
    expect(html).toContain('4 päivältä');
    expect(html).toContain('2026-09-08');
    expect(html).not.toContain('€'); // no delta figure exists to show
    // The window facts arrive null on this branch and are never fabricated.
    expect(html).not.toContain('halvempi kuin');
    expect(html).not.toContain('alhaisin');
  });

  it('renders nothing when the context is unavailable (backend down / no offers / bad shape / stale shape)', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));
    expect(await renderLine(7)).toBe('');

    mockedRequest.mockResolvedValue({ unexpected: true });
    expect(await renderLine(7)).toBe('');

    // A computed shape missing the window-fact fields (e.g. a stale
    // cached response from before task 2.2) degrades to an absent line —
    // the strict guard never renders a partial context.
    const stale = computedPayload();
    const staleContext = { ...(stale.context as Record<string, unknown>) };
    delete staleContext.percentileRankBasisPoints;
    delete staleContext.isWindowLow;
    mockedRequest.mockResolvedValue({ ...stale, context: staleContext });
    expect(await renderLine(7)).toBe('');
  });
});
