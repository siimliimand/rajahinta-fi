/**
 * Compliance test: empirical-margin meter honesty (task 5.1, change
 * hedge-dedup-confidence-meter; designs D3/D4).
 *
 * The meter is an honest signal or it is nothing. At or below the
 * N ≥ 10 calibration floor the margin is NULL — the field is absent
 * from the payload — and the honest UI state is NO meter output at all.
 * The component suite pins the component in isolation; this compliance
 * layer pins the four WIRED views plus the share page end to end (REAL
 * components, react-dom/server, node environment):
 *
 * 1. **Below/at the floor (margin absent): no meter anywhere.** Across
 *    the calculator result, basket results, trip fill, event shopping
 *    list, and the share page (legacy snapshot), the rendered document
 *    contains no meter markup, no ± figure, no percentage, no sample
 *    count, no quantile vocabulary — the cold-start state shows nothing,
 *    never a placeholder.
 * 2. **When present, the figure is honest arithmetic.** The rendered
 *    ± € equals round(quantile × the view's own total) with
 *    hand-computed fixtures per view — including a rounding half case —
 *    and the basis (relative percent, sample count, as-of) always
 *    renders beside it.
 * 3. **A corrupt or non-finite margin fabricates nothing.** The share
 *    page's corrupt frozen value degrades BYTE-IDENTICALLY to the
 *    legacy output (the REAL parse + REAL meter here — the page suite
 *    pins the same through a stub), and a non-finite quantile reaching
 *    a wired view renders no meter output.
 * 4. **Display-only at the view layer.** For every wired view, the
 *    margin-present document minus the meter element is byte-identical
 *    to the margin-absent document — the figures never move.
 *
 * @module MarginMeterHonestyComplianceTest
 */

// @vitest-environment node

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CalculatorResult from '@/app/[locale]/calculator/components/CalculatorResult';
import BasketResults from '@/app/[locale]/basket/components/BasketResults';
import TripFillResult from '@/app/[locale]/trip/components/TripFillResult';
import EventShoppingListResult from '@/app/[locale]/event/components/EventShoppingListResult';
import SharePage from '@/app/[locale]/share/[publicId]/page';
import type { CalculatorResult as CalculatorResultType, EmpiricalMargin } from '@/lib/types';
import type { BasketOptimizationResult, BasketShipment } from '@/lib/basket.types';
import type { ItemizedCost } from '@/lib/types';
import type { TripFillResponse } from '@/app/[locale]/trip/trip.types';
import type { EventCalcResponse } from '@/app/[locale]/event/event.types';
import fiMessages from '@/messages/fi.json';

// ---------------------------------------------------------------------------
// Mocks — identical to the single-render compliance suite (Link stub keeps
// next-intl/navigation out of the graph; share plumbing mocked around the
// REAL ConfidenceMeter, which is exactly what this file must observe).
// ---------------------------------------------------------------------------

vi.mock('@/i18n/navigation', () => ({
  Link: (props: Record<string, unknown>) =>
    React.createElement(
      'a',
      props as React.AnchorHTMLAttributes<HTMLAnchorElement>,
    ),
}));

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    const lookup = (key: string): string => {
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          table[ns],
        );
      return typeof value === 'string' ? value : `__MISSING_${ns}.${key}__`;
    };
    const interpolate = (
      template: string,
      values?: Record<string, unknown>,
    ): string =>
      values === undefined
        ? template
        : template.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    return Object.assign(
      (key: string, values?: Record<string, unknown>) =>
        interpolate(lookup(key), values),
      {
        rich: (
          key: string,
          values: Record<string, unknown> & {
            link?: (chunks: string) => unknown;
          },
        ) => {
          const template = lookup(key);
          const inner = /<link>([\s\S]*?)<\/link>/.exec(template)?.[1] ?? '';
          const [before, after] = template.split(/<link>[\s\S]*?<\/link>/);
          if (values.link === undefined) return interpolate(template, values);
          return [before, values.link(inner), after];
        },
      },
    );
  },
}));

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

const shareSnapshotMock = vi.hoisted(() => ({
  outcome: { kind: 'unavailable' } as unknown,
}));

vi.mock('@/app/[locale]/share/share.server', () => ({
  getServerShareSnapshot: vi.fn(async () => shareSnapshotMock.outcome),
}));

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderViewHtml(node: React.ReactElement): string {
  return renderToString(
    React.createElement(
      NextIntlClientProvider,
      { locale: 'fi', messages: fiMessages },
      node,
    ),
  );
}

/** SSR comment separators removed — text nodes read contiguously. */
function flatten(html: string): string {
  return html.replace(/<!-- -->/g, '');
}

/** The meter element is a flat <p> (spans + one link, never nested <p>). */
function stripMeter(html: string): string {
  return html.replace(
    /<p data-testid="confidence-meter"[\s\S]*?<\/p>/,
    '',
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DISCLAIMER = {
  text: 'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
  language: 'fi' as const,
  version: '1.0',
};

const MARGIN_AS_OF = '2026-09-28T12:00:00.000Z';

/** Hand-computed honesty fixtures: ± € = round(quantile × total). */
const MARGIN_CALculator = {
  quantile: 0.05,
  sampleCount: 16,
  cell: { dimension: 'category_carrier', key: 'beer|posti' },
  asOf: MARGIN_AS_OF,
} as const;
// 0.05 × 6789 ¢ = 339.45 ¢ → 339 ¢ → "±3,39 €"

const MARGIN_BASKET = {
  quantile: 0.01,
  sampleCount: 16,
  cell: { dimension: 'global', key: 'global' },
  asOf: MARGIN_AS_OF,
} as const;
// 0.01 × 12345 ¢ = 123.45 ¢ → 123 ¢ → "±1,23 €"

const MARGIN_TRIP = {
  quantile: 0.05,
  sampleCount: 16,
  cell: { dimension: 'global', key: 'global' },
  asOf: MARGIN_AS_OF,
} as const;
// 0.05 × 3650 ¢ = 182.5 ¢ → Math.round → 183 ¢ → "±1,83 €" (half case)

const MARGIN_EVENT = {
  quantile: 0.08,
  sampleCount: 16,
  cell: { dimension: 'global', key: 'global' },
  asOf: MARGIN_AS_OF,
} as const;
// 0.08 × 8000 ¢ = 640 ¢ exactly → "±6,40 €"

const MARGIN_SHARE = {
  quantile: 0.07,
  sampleCount: 16,
  cell: { dimension: 'global', key: 'global' },
  asOf: MARGIN_AS_OF,
} as const;
// 0.07 × 4560 ¢ = 319.2 ¢ → 319 ¢ → "±3,19 €"

function baseResult(): CalculatorResultType {
  return {
    itemizedCosts: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 6000, reliability: 'VERIFIED' },
      { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 789, reliability: 'ESTIMATED' },
    ],
    excludedOffers: [],
    foreignRetailPrice: 6000,
    transportCost: 0,
    alcoholExciseEstimate: 789,
    containerDutyEstimate: 0,
    totalCents: 6789,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: DISCLAIMER,
    classification: {
      classification: 'NotPersisted',
      confidence: 'LOW',
      evidence: [],
      evidenceSummary: 'Ei tallennettu',
    },
    metadata: {
      input: { productId: 1, quantity: 1, destination: 'FI' },
      calculationTimestamp: '2026-08-31T12:00:00.000Z',
      productMasterId: 1,
      retailOfferIds: [10],
      quantity: 1,
      destination: 'FI',
      productName: 'Testituote',
      volumeLitres: 0.5,
      alcoholByVolume: 5.5,
      category: 'beer',
      datasetVersions: [],
      transportOfferId: null,
    },
    calculationRecordId: 42,
  };
}

function basketShipment(items: readonly ItemizedCost[]): BasketShipment {
  return {
    merchant: 'alks',
    country: 'EE',
    items,
    consolidatedTransport: {
      totalCents: 590,
      weightTier: '0–5 kg',
      packageTier: 'parcel',
      reliability: 'EXACT',
    },
    retailSubtotalCents: 2450,
    thresholdCheck: {
      minimumOrderValueCents: null,
      meetsThreshold: true,
      termsReliability: null,
    },
  };
}

function basketResult(): BasketOptimizationResult {
  return {
    shipments: [
      basketShipment([
        {
          label: 'Retail price',
          category: 'foreignRetailPrice',
          cents: 2450,
          reliability: 'VERIFIED',
        },
      ]),
    ],
    totalCents: 12345,
    itemizedTotals: 4000,
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: DISCLAIMER,
    alternatives: [],
    metadata: {
      input: { items: [{ productId: 101, quantity: 1 }], destination: 'FI' },
      calculationTimestamp: '2026-10-04T12:00:00.000Z',
      datasetVersions: [],
      calculationRecordId: null,
    },
  } as BasketOptimizationResult;
}

const FILL_RESULT: TripFillResponse = {
  status: 'FILLED',
  travelDate: '2026-10-06',
  allowanceDatasetVersion: 'allowances-trip-2026.1',
  filledValueCents: 3650,
  filledUnits: 24,
  lines: [
    {
      productId: 42,
      category: 'beer',
      merchant: 'Tallinna Kauppa',
      unitPriceCents: 150,
      unitVolumeLitres: 0.5,
      maxQuantity: 24,
      filledQuantity: 24,
      valueContributionCents: 3650,
      consumedVolumeLitres: 12,
      status: 'FILLED',
      headroomAfter: {
        category: 'beer',
        capLitres: 110,
        capUnits: null,
        remainingLitres: 98,
        remainingUnits: null,
      },
    },
  ],
  categoryHeadroom: [],
  disclaimer: DISCLAIMER,
  ferryOffers: [],
};

const EVENT_WITH_PLAN = {
  status: 'COMPUTED',
  eventDate: '2026-10-06',
  eventProfile: 'casual_gathering',
  guests: 10,
  durationHours: 4,
  normsVersion: 'standard-drink-fi-2026.1',
  lines: [],
  plan: {
    lines: [],
    unpricedDrinkTypes: [],
    totalCents: 8000,
    budget: null,
  },
  disclaimer: DISCLAIMER,
} as unknown as EventCalcResponse;

const SHARE_RESPONSE_BASE = {
  publicId: 'abc123def456ghi789jklm',
  createdAt: '2026-09-08T12:00:00.000Z',
  snapshot: {
    type: 'landed-cost-snapshot',
    product: { name: 'Harbour Lager', brand: 'Brauerei Example', category: 'beer' },
    quantity: 2,
    totalCents: 4560,
    currency: 'EUR',
    breakdown: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 2400, reliability: 'VERIFIED' },
    ],
    confidence: 'MEDIUM',
    destination: 'FI',
    disclaimer: DISCLAIMER,
    calculatedAt: '2026-09-08T11:55:00.000Z',
  },
};

async function renderSharePage(snapshot: Record<string, unknown>): Promise<string> {
  shareSnapshotMock.outcome = {
    kind: 'ok',
    snapshot: { ...SHARE_RESPONSE_BASE, snapshot },
  };
  const element = await SharePage({
    params: Promise.resolve({ locale: 'fi', publicId: 'abc123def456ghi789jklm' }),
  });
  return renderViewHtml(element);
}

/** The as-of date rendered the way AccuracyStat/the meter localize it. */
const EXPECTED_AS_OF = new Date(MARGIN_AS_OF).toLocaleDateString('fi-FI', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

beforeEach(() => {
  shareSnapshotMock.outcome = { kind: 'unavailable' };
});

describe('below the N-floor (margin absent): no meter output anywhere', () => {
  const views: Array<[string, () => string]> = [
    [
      'calculator result',
      () =>
        renderViewHtml(
          React.createElement(CalculatorResult, { result: baseResult() }),
        ),
    ],
    [
      'basket results',
      () =>
        renderViewHtml(
          React.createElement(BasketResults, { result: basketResult() }),
        ),
    ],
    [
      'trip fill',
      () =>
        renderViewHtml(
          React.createElement(TripFillResult, {
            result: FILL_RESULT,
            productNames: new Map([[42, 'Saku Originaal']]),
          }),
        ),
    ],
    [
      'event shopping list',
      () =>
        renderViewHtml(
          React.createElement(EventShoppingListResult, {
            result: EVENT_WITH_PLAN,
          }),
        ),
    ],
  ];

  for (const [name, render] of views) {
    it(`${name}: no meter markup, no ±, no percentage, no sample count, no quantile`, () => {
      const html = render();
      expect(html).not.toContain('confidence-meter');
      expect(html).not.toContain('±');
      expect(html).not.toContain('Havaittu hajonta');
      expect(html).not.toContain('n=16');
      expect(html).not.toContain('quantile');
    });
  }

  it('share page (legacy snapshot without the key): renders exactly as before — no meter', async () => {
    const html = await renderSharePage(SHARE_RESPONSE_BASE.snapshot);
    expect(html).not.toContain('confidence-meter');
    expect(html).not.toContain('±');
    expect(html).not.toContain('n=16');
  });
});

describe('when present: the rendered ± € equals round(quantile × total) — hand-computed', () => {
  it('calculator result: 0.05 × 6789 ¢ = 339.45 ¢ → ±3,39 €, basis adjacent', () => {
    const html = renderViewHtml(
      React.createElement(CalculatorResult, {
        result: { ...baseResult(), empiricalMargin: MARGIN_CALculator },
      }),
    );
    const flat = flatten(html);
    expect(flat).toContain('data-testid="confidence-meter"');
    expect(flat).toContain('±3,39\u00a0€');
    expect(flat).toContain('±5,0 %');
    expect(flat).toContain('n=16');
    expect(flat).toContain(`laskettu ${EXPECTED_AS_OF}`);
  });

  it('basket results: 0.01 × 12345 ¢ = 123.45 ¢ → ±1,23 €, basis adjacent', () => {
    const html = renderViewHtml(
      React.createElement(BasketResults, {
        result: { ...basketResult(), empiricalMargin: MARGIN_BASKET },
      }),
    );
    const flat = flatten(html);
    expect(flat).toContain('data-testid="confidence-meter"');
    expect(flat).toContain('±1,23\u00a0€');
    expect(flat).toContain('±1,0 %');
    expect(flat).toContain('n=16');
  });

  it('trip fill: 0.05 × 3650 ¢ = 182.5 ¢ → rounds to ±1,83 € — the half case, never truncated', () => {
    const html = renderViewHtml(
      React.createElement(TripFillResult, {
        result: { ...FILL_RESULT, empiricalMargin: MARGIN_TRIP },
        productNames: new Map([[42, 'Saku Originaal']]),
      }),
    );
    const flat = flatten(html);
    expect(flat).toContain('data-testid="confidence-meter"');
    expect(flat).toContain('±1,83\u00a0€');
    expect(flat).not.toContain('±1,82\u00a0€');
    expect(flat).toContain('±5,0 %');
    expect(flat).toContain('n=16');
  });

  it('event shopping list (priced plan total): 0.08 × 8000 ¢ = ±6,40 €, basis adjacent', () => {
    const html = renderViewHtml(
      React.createElement(EventShoppingListResult, {
        result: { ...EVENT_WITH_PLAN, empiricalMargin: MARGIN_EVENT },
      }),
    );
    const flat = flatten(html);
    expect(flat).toContain('data-testid="confidence-meter"');
    expect(flat).toContain('±6,40\u00a0€');
    expect(flat).toContain('±8,0 %');
    expect(flat).toContain('n=16');
  });

  it('share page (frozen margin): 0.07 × 4560 ¢ = 319.2 ¢ → ±3,19 € beside the frozen total', async () => {
    const html = await renderSharePage({
      ...SHARE_RESPONSE_BASE.snapshot,
      empiricalMargin: MARGIN_SHARE,
    });
    const flat = flatten(html);
    expect(flat).toContain('data-testid="confidence-meter"');
    expect(flat).toContain('±3,19\u00a0€');
    expect(flat).toContain('±7,0 %');
    expect(flat).toContain('n=16');
    // The frozen total itself is untouched (the page's own euro form,
    // plain-space — only the meter runs through formatMoney).
    expect(flat).toContain('45,60 €');
  });
});

describe('a corrupt or non-finite margin fabricates nothing', () => {
  it('share page: a corrupt frozen value degrades BYTE-IDENTICALLY to the legacy render (real parse + real meter)', async () => {
    const legacyHtml = await renderSharePage(SHARE_RESPONSE_BASE.snapshot);

    const corruptHtml = await renderSharePage({
      ...SHARE_RESPONSE_BASE.snapshot,
      empiricalMargin: {
        quantile: '5 %',
        sampleCount: 'sixteen',
        cell: { dimension: 3, key: null },
        asOf: 12345,
      },
    });

    expect(corruptHtml).toBe(legacyHtml);
    expect(corruptHtml).not.toContain('confidence-meter');
  });

  it('a non-finite quantile reaching a wired view renders no meter output', () => {
    const html = renderViewHtml(
      React.createElement(CalculatorResult, {
        result: {
          ...baseResult(),
          empiricalMargin: {
            ...MARGIN_CALculator,
            quantile: Number.NaN,
          } as unknown as EmpiricalMargin,
        },
      }),
    );
    expect(html).not.toContain('confidence-meter');
    expect(html).not.toContain('±');
  });
});

describe('display-only at the view layer — margin-present document minus the meter is byte-identical to the absent document', () => {
  const pairs: Array<[string, (margin?: EmpiricalMargin) => string]> = [
    [
      'calculator result',
      (margin) =>
        renderViewHtml(
          React.createElement(CalculatorResult, {
            result: margin
              ? { ...baseResult(), empiricalMargin: margin }
              : baseResult(),
          }),
        ),
    ],
    [
      'basket results',
      (margin) =>
        renderViewHtml(
          React.createElement(BasketResults, {
            result: margin
              ? { ...basketResult(), empiricalMargin: margin }
              : basketResult(),
          }),
        ),
    ],
    [
      'trip fill',
      (margin) =>
        renderViewHtml(
          React.createElement(TripFillResult, {
            result: margin ? { ...FILL_RESULT, empiricalMargin: margin } : FILL_RESULT,
            productNames: new Map([[42, 'Saku Originaal']]),
          }),
        ),
    ],
    [
      'event shopping list',
      (margin) =>
        renderViewHtml(
          React.createElement(EventShoppingListResult, {
            result: margin
              ? { ...EVENT_WITH_PLAN, empiricalMargin: margin }
              : EVENT_WITH_PLAN,
          }),
        ),
    ],
  ];

  for (const [name, render] of pairs) {
    it(`${name}: only the meter element differs`, () => {
      const margin =
        name === 'calculator result'
          ? MARGIN_CALculator
          : name === 'basket results'
            ? MARGIN_BASKET
            : name === 'trip fill'
              ? MARGIN_TRIP
              : MARGIN_EVENT;
      const withMeter = render(margin);
      const without = render(undefined);
      expect(stripMeter(withMeter)).toBe(without);
      // The meter genuinely rendered — the strip is not vacuous.
      expect(withMeter).not.toBe(without);
    });
  }

  it('share page: the legacy snapshot and the margin-present snapshot differ only by the meter element', async () => {
    const legacyHtml = await renderSharePage(SHARE_RESPONSE_BASE.snapshot);
    const withMeterHtml = await renderSharePage({
      ...SHARE_RESPONSE_BASE.snapshot,
      empiricalMargin: MARGIN_SHARE,
    });
    expect(stripMeter(withMeterHtml)).toBe(legacyHtml);
    expect(withMeterHtml).not.toBe(legacyHtml);
  });
});
