/**
 * Product price-context line tests (insight-surfaces task 3.3, spec
 * price-context).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would (blog-page test precedent), pinning the committed 3.2 API
 * contract:
 *
 *   1. A computed context renders ONE factual sentence carrying the
 *      current price, the median, the delta in cents, the bucket count,
 *      and the as-of date — never a percentage.
 *   2. INSUFFICIENT_HISTORY renders the honest "not enough history"
 *      state, still explainable (bucket count + as-of).
 *   3. A failed fetch keeps the line absent from the HTML entirely.
 *
 * @module ProductPriceContextLineTest
 */
// @vitest-environment jsdom

import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductPriceContextLine from './ProductPriceContextLine';
import { request } from '@/lib/api';

vi.mock('next-intl/server', () => ({
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
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
});

/** Straight renderToString — the component renders null or an element. */
async function renderLine(productId: number): Promise<string> {
  const element = await ProductPriceContextLine({ productId });
  return renderToString(element);
}

function computedPayload() {
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
      windowDays: 90,
      bucketCount: 90,
      asOf: '2026-09-08',
    },
  };
}

describe('ProductPriceContextLine', () => {
  it('renders one factual sentence: current vs median, cents delta, window count, as-of', async () => {
    mockedRequest.mockResolvedValue(computedPayload());

    const html = await renderLine(7);

    expect(html).toContain('product-price-context');
    expect(html).toContain('Nykyhinta ja 90 päivän mediaani');
    expect(html).toContain('12.34 €'); // current best
    expect(html).toContain('11.00 €'); // median
    expect(html).toContain('1.34 €'); // delta in cents
    expect(html).toContain('90 päivältä'); // window bucket count
    expect(html).toContain('2026-09-08'); // as-of
    // Cents only — the spec forbids a percentage on this surface.
    expect(html).not.toContain('%');
  });

  it('renders the honest insufficient-history state with the figures that explain it', async () => {
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
  });

  it('renders nothing when the context is unavailable (backend down / no offers / bad shape)', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));
    expect(await renderLine(7)).toBe('');

    mockedRequest.mockResolvedValue({ unexpected: true });
    expect(await renderLine(7)).toBe('');
  });
});
