/**
 * Product FAQ panel tests (seo-aeo-agent-surfaces 2.1, design D4).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would (ProductPriceContextLine.test.tsx precedent), pinning the
 * deterministic-Q&A contract:
 *
 *   1. A resolved price-context payload renders three template-composed
 *      pairs in the panel's stable order — price, ABV, package size —
 *      with the money figure through formatMoney and the attribute
 *      values exactly as the master-data rows render them.
 *   2. A payload the page's fetch degraded to null drops ONLY the price
 *      pair; the attribute pairs still render (the spec's
 *      absent-input-drops-its-question rule — absent, never a
 *      placeholder).
 *   3. INSUFFICIENT_HISTORY still answers the price question: the
 *      current-best figure exists on that branch, and no window
 *      statistic leaks into the answer.
 *   4. A product with no parseable ABV or volume and a null payload
 *      renders NOTHING — no empty shell, no heading.
 *   5. Both locales render from the real catalogs, and every rendered
 *      string passes the content-policy vocabulary lint (asserted with
 *      the same scanner that polices the source and catalogs — an inline
 *      banned-word list would itself trip that lint in this file).
 *   6. The exported composeProductFaqPairs is the task-2.2 seam: pure,
 *      deterministic, and the source of exactly the pairs the panel
 *      renders, so the FAQPage JSON-LD can mirror the visible block
 *      one-to-one by calling it with the same inputs.
 *   7. The FAQPage mirror itself (task 2.2): the panel's ld+json script
 *      parses to the SAME pairs composeProductFaqPairs returns —
 *      one-to-one, order included, same locale — the degraded block's
 *      schema drops the price pair with it, and a zero-pair block
 *      emits no script at all. The script streams inside the panel's
 *      Suspense boundary (it renders beside the section in the same
 *      awaited output, the structured-data.test.tsx stub lineage).
 *
 * @module ProductFaqPanelTest
 */
// @vitest-environment jsdom

import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductFaqPanel, {
  composeProductFaqPairs,
  type ProductFaqTranslator,
} from './ProductFaqPanel';
import type { ProductPriceContextResponse } from '../price-context';
import type { ProductDetail } from '@/lib/types';
import { checkContent } from '@/lib/content-policy';

/**
 * Test-scoped locale for the mocked next-intl lookup and the `locale`
 * prop (money form). Reset to FI before each.
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

beforeEach(() => {
  testLocale = 'fi';
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function productFixture(
  overrides: Partial<ProductDetail> = {},
): ProductDetail {
  return {
    id: 42,
    name: 'Kotikalja 0.5 l',
    manufacturer: 'Panimo A',
    brand: 'Panimo A',
    category: 'beer',
    alcoholByVolume: 0.047,
    unitVolume: '0.5',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: false,
    ean: null,
    ...overrides,
  };
}

function computedPayload(): ProductPriceContextResponse {
  return {
    productId: 42,
    currentBestPriceCents: 1999,
    context: {
      status: 'computed',
      medianCents: 1800,
      minCents: 1750,
      maxCents: 2100,
      deltaVsMedianCents: 199,
      deltaVsMedianBasisPoints: 1106,
      percentileRankBasisPoints: 2857,
      isWindowLow: false,
      windowDays: 90,
      bucketCount: 90,
      asOf: '2026-09-08',
    },
  } as ProductPriceContextResponse;
}

function insufficientHistoryPayload(): ProductPriceContextResponse {
  return {
    productId: 42,
    currentBestPriceCents: 1999,
    context: {
      status: 'unavailable',
      reason: 'INSUFFICIENT_HISTORY',
      percentileRankBasisPoints: null,
      isWindowLow: null,
      windowDays: 90,
      bucketCount: 4,
      asOf: '2026-09-08',
    },
  } as unknown as ProductPriceContextResponse;
}

/**
 * Straight renderToString — the component renders null or an element.
 * The page hands the payload down as a still-pending promise
 * (product-page-cold-latency 4.1); the tests pass Promise.resolve the
 * same way, and Promise.resolve(null) is the degradation case.
 */
async function renderPanel(
  product: ProductDetail,
  payload: ProductPriceContextResponse | null,
): Promise<string> {
  const element = await ProductFaqPanel({
    product,
    payload: Promise.resolve(payload),
    locale: testLocale,
  });
  return renderToString(element);
}

/** Pair count via the panel's own pair marker. */
function pairCount(html: string): number {
  return html.split('product-faq-pair').length - 1;
}

/** Every FAQPage JSON-LD graph in the rendered HTML, parsed. */
function faqGraphs(html: string): Array<Record<string, unknown>> {
  return [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/g,
    ),
  ]
    .map((m) => JSON.parse(m[1]) as Record<string, unknown>)
    .filter((graph) => graph['@type'] === 'FAQPage');
}

/** The one expected FAQPage graph, or a loud failure. */
function theFaqGraph(html: string): Record<string, unknown> {
  const graphs = faqGraphs(html);
  expect(graphs, 'expected exactly one FAQPage script beside the block').toHaveLength(1);
  return graphs[0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The rendered block
// ---------------------------------------------------------------------------

describe('ProductFaqPanel', () => {
  it('renders three template-composed pairs — price, ABV, package size — from the page payloads', async () => {
    const html = await renderPanel(productFixture(), computedPayload());

    expect(html).toContain('product-faq-section');
    expect(pairCount(html)).toBe(3);

    // Price pair: the context payload's current-best figure through
    // formatMoney (fi form), stated with the same term the context line
    // uses — the two surfaces cannot contradict.
    expect(html).toContain('Paljonko Kotikalja 0.5 l maksaa?');
    expect(html).toContain('Matalin nykyinen myyntihinta on 19,99\u00a0€.');
    // ABV pair through formatAbv, never the raw fraction.
    expect(html).toContain('Kuinka paljon alkoholia Kotikalja 0.5 l sisältää?');
    expect(html).toContain('Alkoholipitoisuus on 4.7 %.');
    expect(html).not.toContain('0.047');
    // Package-size pair through formatVolume.
    expect(html).toContain('Minkäkokoinen pakkaus tuotteella on?');
    expect(html).toContain('Pakkauskoko on 50 cl.');

    // Stable composition order: price, ABV, volume.
    const priceAt = html.indexOf('Paljonko');
    const abvAt = html.indexOf('Kuinka paljon');
    const volumeAt = html.indexOf('Minkäkokoinen');
    expect(priceAt).toBeLessThan(abvAt);
    expect(abvAt).toBeLessThan(volumeAt);

    // Content law: no advice, no promotional vocabulary — the same
    // scanner that polices the source and catalogs.
    expect(checkContent(html)).toEqual([]);
  });

  it('drops ONLY the price pair when the context payload resolves null; the attribute pairs still render', async () => {
    const html = await renderPanel(productFixture(), null);

    expect(html).toContain('product-faq-section');
    expect(pairCount(html)).toBe(2);
    // The price question is absent — never a placeholder answer.
    expect(html).not.toContain('Paljonko');
    expect(html).not.toContain('19,99');
    // The attribute questions survive the degradation.
    expect(html).toContain('Kuinka paljon alkoholia Kotikalja 0.5 l sisältää?');
    expect(html).toContain('Pakkauskoko on 50 cl.');
    expect(checkContent(html)).toEqual([]);
  });

  it('still answers the price question when the context is INSUFFICIENT_HISTORY — the price figure exists on that branch', async () => {
    const html = await renderPanel(
      productFixture(),
      insufficientHistoryPayload(),
    );

    expect(html).toContain('Paljonko Kotikalja 0.5 l maksaa?');
    expect(html).toContain('Matalin nykyinen myyntihinta on 19,99\u00a0€.');
    // No window statistic leaks into the answer — the payload carries none.
    expect(html).not.toContain('mediaani');
  });

  it('renders NOTHING when every input is absent (null payload, no parseable ABV or volume)', async () => {
    const html = await renderPanel(
      productFixture({ alcoholByVolume: null, unitVolume: 'not-a-number' }),
      null,
    );

    expect(html).toBe('');
  });

  it('renders localized pairs from the EN catalog with the EN money form, and no FI bleed', async () => {
    testLocale = 'en';
    const html = await renderPanel(productFixture(), computedPayload());

    expect(html).toContain('Questions and answers');
    expect(html).toContain('How much does Kotikalja 0.5 l cost?');
    expect(html).toContain('The lowest current offer price is €19.99.');
    expect(html).toContain('How much alcohol does Kotikalja 0.5 l contain?');
    expect(html).toContain('The alcohol content is 4.7 %.');
    expect(html).toContain('What package size does the product have?');
    expect(html).toContain('The package size is 50 cl.');
    expect(html).not.toContain('Paljonko');
    expect(html).not.toContain('Matalin');
    expect(checkContent(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The compose seam — task 2.2's FAQPage JSON-LD must call this with the
// same inputs the panel passes, so the schema equals the rendered pairs.
// ---------------------------------------------------------------------------

describe('composeProductFaqPairs (the task-2.2 seam)', () => {
  /** FI translator resolved the same way the panel resolves its own. */
  async function fiTranslator(): Promise<ProductFaqTranslator> {
    const { getTranslations } = await import('next-intl/server');
    return getTranslations({ locale: 'fi', namespace: 'ProductPage' });
  }

  it('returns exactly the pairs the panel renders, price pair first, absent inputs dropped', async () => {
    const t = await fiTranslator();

    const full = composeProductFaqPairs(
      { product: productFixture(), currentBestPriceCents: 1999, locale: 'fi' },
      t,
    );
    expect(full).toHaveLength(3);
    expect(full[0]?.question).toBe('Paljonko Kotikalja 0.5 l maksaa?');
    expect(full[0]?.answer).toBe('Matalin nykyinen myyntihinta on 19,99\u00a0€.');
    expect(full[1]?.question).toBe(
      'Kuinka paljon alkoholia Kotikalja 0.5 l sisältää?',
    );
    expect(full[1]?.answer).toBe('Alkoholipitoisuus on 4.7 %.');
    expect(full[2]?.question).toBe('Minkäkokoinen pakkaus tuotteella on?');
    expect(full[2]?.answer).toBe('Pakkauskoko on 50 cl.');

    // Degraded price context: only the attribute pairs survive — the
    // mirror of the panel's null-payload degradation above.
    const degraded = composeProductFaqPairs(
      { product: productFixture(), currentBestPriceCents: null, locale: 'fi' },
      t,
    );
    expect(degraded).toHaveLength(2);
    expect(degraded.map((pair) => pair.question)).toEqual([
      'Kuinka paljon alkoholia Kotikalja 0.5 l sisältää?',
      'Minkäkokoinen pakkaus tuotteella on?',
    ]);
  });

  it('is deterministic — identical inputs compose identical pairs', async () => {
    const t = await fiTranslator();
    const input = {
      product: productFixture(),
      currentBestPriceCents: 1999,
      locale: 'fi',
    } as const;

    expect(composeProductFaqPairs(input, t)).toEqual(
      composeProductFaqPairs(input, t),
    );
  });
});

// ---------------------------------------------------------------------------
// The FAQPage mirror — task 2.2. The spec scenario: the schema's pairs
// match one-to-one the questions and answers rendered in the visible
// block, in the same language. Asserted here structurally: the script's
// parsed graph equals composeProductFaqPairs' output for the SAME
// inputs the panel renders — no invisible or extra schema content.
// ---------------------------------------------------------------------------

describe('ProductFaqPanel — the FAQPage JSON-LD mirror (task 2.2)', () => {
  /** The translator the panel itself resolves, at the current testLocale. */
  async function panelTranslator(): Promise<ProductFaqTranslator> {
    const { getTranslations } = await import('next-intl/server');
    return getTranslations({ locale: testLocale, namespace: 'ProductPage' });
  }

  it('FI: the script parses to exactly the rendered pairs — one-to-one, order included', async () => {
    const html = await renderPanel(productFixture(), computedPayload());

    const graph = theFaqGraph(html);
    expect(graph['@context']).toBe('https://schema.org');

    const t = await panelTranslator();
    const rendered = composeProductFaqPairs(
      {
        product: productFixture(),
        currentBestPriceCents: computedPayload().currentBestPriceCents,
        locale: testLocale,
      },
      t,
    );
    expect(graph.mainEntity).toEqual(
      rendered.map((pair) => ({
        '@type': 'Question',
        name: pair.question,
        acceptedAnswer: { '@type': 'Answer', text: pair.answer },
      })),
    );
    // Order IS the mirror — index by index against the visible block's
    // composition order (price, ABV, package size).
    const questions = graph.mainEntity as Array<{ name: string }>;
    expect(questions.map((q) => q.name)).toEqual(
      rendered.map((pair) => pair.question),
    );
    // The script streams inside the boundary: same chunk as the section.
    expect(html.indexOf('product-faq-section')).toBeGreaterThan(-1);
    expect(html.indexOf('application/ld+json')).toBeGreaterThan(
      html.indexOf('product-faq-section'),
    );
  });

  it('EN: the schema pairs are the EN block verbatim — same language, no locale bleed', async () => {
    testLocale = 'en';
    const html = await renderPanel(productFixture(), computedPayload());

    const t = await panelTranslator();
    const rendered = composeProductFaqPairs(
      {
        product: productFixture(),
        currentBestPriceCents: computedPayload().currentBestPriceCents,
        locale: testLocale,
      },
      t,
    );
    const questions = theFaqGraph(html).mainEntity as Array<{
      name: string;
      acceptedAnswer: { text: string };
    }>;

    expect(questions.map((q) => q.name)).toEqual(
      rendered.map((pair) => pair.question),
    );
    expect(questions.map((q) => q.acceptedAnswer.text)).toEqual(
      rendered.map((pair) => pair.answer),
    );
    // Every schema string is an EN rendered string — no FI copy leaks.
    const serialized = JSON.stringify(theFaqGraph(html));
    for (const question of questions) {
      expect(serialized).toContain(question.name);
      expect(serialized).toContain(question.acceptedAnswer.text);
    }
    expect(serialized).not.toContain('Paljonko');
    expect(serialized).not.toContain('Matalin');
  });

  it('the degraded block (null payload) mirrors its TWO rendered pairs — the price pair absent from the schema too', async () => {
    const html = await renderPanel(productFixture(), null);

    const t = await panelTranslator();
    const rendered = composeProductFaqPairs(
      { product: productFixture(), currentBestPriceCents: null, locale: testLocale },
      t,
    );
    expect(rendered).toHaveLength(2);

    const questions = theFaqGraph(html).mainEntity as Array<{ name: string }>;
    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.name)).toEqual(
      rendered.map((pair) => pair.question),
    );
    // The price question is absent from the schema — never a placeholder.
    expect(JSON.stringify(questions)).not.toContain('Paljonko');
  });

  it('a zero-pair block emits NO FAQPage script at all — absent, never an empty shell', async () => {
    const html = await renderPanel(
      productFixture({ alcoholByVolume: null, unitVolume: 'not-a-number' }),
      null,
    );

    // No section, no heading, and no ld+json script whatsoever.
    expect(html).toBe('');
    expect(faqGraphs(html)).toHaveLength(0);
  });
});
