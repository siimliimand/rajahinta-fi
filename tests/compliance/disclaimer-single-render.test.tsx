/**
 * Compliance test: single-disclaimer render count per result view (task
 * 5.1, change hedge-dedup-confidence-meter; design D1 + D5).
 *
 * The heap this change fixed was one idea rendered 4–8 times per view.
 * The component suites pin each view in isolation; this compliance layer
 * renders the REAL views (react-dom/server, node environment — the
 * async-server-component precedent share/[publicId]/page.test.tsx uses)
 * and counts BYTE-LEVEL occurrences of the payload disclaimer text in
 * the whole rendered document:
 *
 *   - every result-bearing view renders its OWN structural disclaimer
 *     exactly ONCE — calculator result, result card, basket (once per
 *     combination, each from its own payload), trip fill, trip
 *     break-even, event shopping list (COMPUTED and the degraded
 *     NO_PUBLISHED_NORMS state alike), share snapshot (and its corrupt-
 *     disclaimer fallback), what-if (its prominent HYPOTHETICAL
 *     disclaimer IS that view's one render, design D5), and the embed
 *     document (its own banner, spec "disclaimers intact");
 *   - the text comes from the result object — no UI-only restatement
 *     anywhere in the document.
 *
 * Deliberately independent of the per-component suites (the compliance
 * layer's second-opinion role): it re-renders with its own fixtures and
 * counts bytes, not React internals.
 *
 * @module DisclaimerSingleRenderComplianceTest
 */

// @vitest-environment node

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CalculatorResult from '@/app/[locale]/calculator/components/CalculatorResult';
import ResultCard from '@/app/[locale]/calculator/components/ResultCard';
import BasketResults from '@/app/[locale]/basket/components/BasketResults';
import TripFillResult from '@/app/[locale]/trip/components/TripFillResult';
import TripBreakEvenResult from '@/app/[locale]/trip/components/TripBreakEvenResult';
import EventShoppingListResult from '@/app/[locale]/event/components/EventShoppingListResult';
import WhatIfResult from '@/app/[locale]/what-if/components/WhatIfResult';
import SharePage from '@/app/[locale]/share/[publicId]/page';
import { renderEmbedCalculatorHtml } from '@/app/[locale]/embed/calculator/view';
import type { CalculatorResult as CalculatorResultType } from '@/lib/types';
import type { BasketOptimizationResult, BasketShipment } from '@/lib/basket.types';
import type { ItemizedCost } from '@/lib/types';
import type { TripFillResponse, TripFeasibilityResponse } from '@/app/[locale]/trip/trip.types';
import type { EventCalcResponse } from '@/app/[locale]/event/event.types';
import type { WhatIfResponse } from '@/app/[locale]/what-if/what-if.types';
import fiMessages from '@/messages/fi.json';

// ---------------------------------------------------------------------------
// Mocks — the same stubs the component/server suites use. The Link stub
// keeps next-intl/navigation out of the graph; the share page's Next
// server plumbing is mocked around the REAL DisclaimerBanner/ConfidenceMeter.
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

/** Render a view through the real fi catalog and return the document. */
function renderViewHtml(node: React.ReactElement): string {
  return renderToString(
    React.createElement(
      NextIntlClientProvider,
      { locale: 'fi', messages: fiMessages },
      node,
    ),
  );
}

/** Occurrences of `needle` in `haystack` — the byte-level count. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The one payload disclaimer this file counts, per view fixture. */
const DISCLAIMER = (text: string) => ({ text, language: 'fi' as const, version: '1.0' });

/** Banner markup occurrences — the DOM-level count. */
function bannerCount(html: string): number {
  return count(html, 'data-testid="disclaimer-banner"');
}

// ---------------------------------------------------------------------------
// Fixtures — the serialized 200 shapes (the component-test fixtures)
// ---------------------------------------------------------------------------

const CALC_DISCLAIMER = DISCLAIMER(
  'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
);

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
    disclaimer: CALC_DISCLAIMER,
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

function basketResult(
  disclaimer: ReturnType<typeof DISCLAIMER>,
): BasketOptimizationResult {
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
    totalCents: 5000,
    itemizedTotals: 4000,
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer,
    alternatives: [],
    metadata: {
      input: { items: [{ productId: 101, quantity: 1 }], destination: 'FI' },
      calculationTimestamp: '2026-10-04T12:00:00.000Z',
      datasetVersions: [],
      calculationRecordId: null,
    },
  } as BasketOptimizationResult;
}

const TRIP_DISCLAIMER = DISCLAIMER(
  'Määrärajat ovat viranomaisen indikatiivisia rajoja.',
);

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
      valueContributionCents: 3600,
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
  categoryHeadroom: [
    {
      category: 'beer',
      capLitres: 110,
      capUnits: null,
      usedLitres: 12,
      usedUnits: 24,
      remainingLitres: 98,
      remainingUnits: null,
    },
  ],
  disclaimer: TRIP_DISCLAIMER,
  ferryOffers: [],
};

const BREAK_EVEN_RESULT: TripFeasibilityResponse = {
  status: 'COMPUTED',
  travelDate: '2026-10-06',
  vehicleType: 'car',
  passengers: 2,
  ticketCostCents: 20000,
  fuelCostCents: 10000,
  travelCostCents: 30000,
  travelCostPerTravellerCents: 15000,
  allowanceDatasetVersion: 'allowances-trip-2026.1',
  lines: [
    {
      status: 'BREAK_EVEN',
      category: 'beer',
      domesticPriceCentsPerLitre: 500,
      foreignPriceCentsPerLitre: 250,
      priceDifferenceCentsPerLitre: 250,
      breakEvenLitres: 60,
      capLitres: 110,
      capStatus: 'WITHIN_ALLOWANCE',
      cappedBreakEvenLitres: 60,
    },
  ],
  disclaimer: TRIP_DISCLAIMER,
  ferryOffers: [],
};

const EVENT_DISCLAIMER = DISCLAIMER(
  'Kulutusnormit ovat arvioita, ei lopullisia määriä.',
);

const EVENT_COMPUTED = {
  status: 'COMPUTED',
  eventDate: '2026-10-06',
  eventProfile: 'casual_gathering',
  guests: 10,
  durationHours: 4,
  normsVersion: 'standard-drink-fi-2026.1',
  lines: [
    {
      drinkType: 'beer',
      needMl: 1880,
      needLitres: 1.88,
      plannedUnits: [
        { sizeMl: 330, sizeLitres: 0.33, description: '0.33 l can', quantity: 6 },
      ],
      totalUnits: 6,
      purchasedMl: 1980,
      surplusMl: 100,
      surplusLitres: 0.1,
      versionLabel: 'standard-drink-fi-2026.1',
    },
  ],
  disclaimer: EVENT_DISCLAIMER,
} as EventCalcResponse;

const EVENT_NO_NORMS = {
  status: 'NO_PUBLISHED_NORMS',
  eventDate: '2026-10-06',
  eventProfile: 'casual_gathering',
  guests: 10,
  durationHours: 4,
  disclaimer: EVENT_DISCLAIMER,
} as EventCalcResponse;

const WHATIF_DISCLAIMER = DISCLAIMER(
  'Tämä on hypoteettinen laskelma: korvattu valmisteverokanta on kuvitteellinen.',
);

const WHATIF_RESULT: WhatIfResponse = {
  hypotheticalRate: 0.6,
  baselineTaxDatasetVersion: 'excise-2026.1',
  disclaimer: WHATIF_DISCLAIMER,
  shareToken: 'token',
  totals: {
    baselineExciseCents: 3400,
    hypotheticalExciseCents: 3000,
    gapBaselineCents: 600,
    gapHypotheticalCents: 200,
  },
  lines: [
    {
      id: 'lager',
      category: 'beer',
      importTotalBaselineCents: 3400,
      importTotalHypotheticalCents: 3000,
      gapBaselineCents: 600,
      gapHypotheticalCents: 200,
      gapDeltaCents: -400,
      baseline: {
        formulaRef: 'beer',
        rateApplied: 0.35,
        taxCents: 3400,
        taxDatasetVersion: 'excise-2026.1',
        ruleId: 1,
        reliability: 'VERIFIED',
      },
      hypothetical: { formulaRef: 'beer', rate: 0.3, rateApplied: 0.3, taxCents: 3000 },
    },
  ],
};

// Share snapshot fixtures (the page test's shapes; legacy = no margin key).
const SHARE_LEGACY = {
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
      { label: 'Transport', category: 'transportCost', cents: 500, reliability: 'ESTIMATED' },
    ],
    confidence: 'MEDIUM',
    destination: 'FI',
    disclaimer: DISCLAIMER(
      'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
    ),
    calculatedAt: '2026-09-08T11:55:00.000Z',
  },
};

async function renderSharePage(
  outcome: unknown,
): Promise<string> {
  shareSnapshotMock.outcome = outcome;
  const element = await SharePage({
    params: Promise.resolve({ locale: 'fi', publicId: 'abc123def456ghi789jklm' }),
  });
  return renderViewHtml(element);
}

/** Minimal embed result — the pure view reads only these faces. */
const EMBED_RESULT = {
  itemizedCosts: [
    { label: 'Retail price', category: 'foreignRetailPrice', cents: 250, reliability: 'VERIFIED' },
  ],
  totalCents: 6480,
  currency: 'EUR',
  confidence: 'MEDIUM',
  disclaimer: CALC_DISCLAIMER,
  metadata: {
    productName: 'Testituote',
    quantity: 1,
    datasetVersions: [],
    input: { productId: 1, quantity: 1, destination: 'FI' },
  },
} as unknown as CalculatorResultType;

// ---------------------------------------------------------------------------
// Pins — one render per view
// ---------------------------------------------------------------------------

beforeEach(() => {
  shareSnapshotMock.outcome = { kind: 'unavailable' };
});

describe('single disclaimer render per result view (hedge-dedup 5.1, design D1)', () => {
  it('calculator result renders its disclaimer exactly once', () => {
    const html = renderViewHtml(
      React.createElement(CalculatorResult, { result: baseResult() }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, CALC_DISCLAIMER.text)).toBe(1);
  });

  it('result card renders its disclaimer exactly once', () => {
    const html = renderViewHtml(
      React.createElement(ResultCard, { result: baseResult() }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, CALC_DISCLAIMER.text)).toBe(1);
  });

  it('basket results render one disclaimer per combination, each from its own payload', () => {
    const recommended = basketResult(
      DISCLAIMER('Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.'),
    );
    const html = renderViewHtml(
      React.createElement(BasketResults, { result: recommended }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, recommended.disclaimer.text)).toBe(1);
  });

  it('basket alternatives carry their own disclaimer once — the same text is never heaped', () => {
    const recommended = basketResult(
      DISCLAIMER('Suositellun yhdistelmän vastuuvapauslause.'),
    );
    const alternative = basketResult(
      DISCLAIMER('Vaihtoehtoisen yhdistelmän vastuuvapauslause.'),
    );
    const result = {
      ...recommended,
      alternatives: [{ ...alternative, alternatives: [] }],
    } as BasketOptimizationResult;

    const html = renderViewHtml(
      React.createElement(BasketResults, { result }),
    );
    expect(bannerCount(html)).toBe(2);
    expect(count(html, 'Suositellun yhdistelmän vastuuvapauslause.')).toBe(1);
    expect(count(html, 'Vaihtoehtoisen yhdistelmän vastuuvapauslause.')).toBe(1);
  });

  it('trip fill renders its disclaimer exactly once', () => {
    const html = renderViewHtml(
      React.createElement(TripFillResult, {
        result: FILL_RESULT,
        productNames: new Map([[42, 'Saku Originaal']]),
      }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, TRIP_DISCLAIMER.text)).toBe(1);
  });

  it('trip break-even renders its disclaimer exactly once', () => {
    const html = renderViewHtml(
      React.createElement(TripBreakEvenResult, { result: BREAK_EVEN_RESULT }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, TRIP_DISCLAIMER.text)).toBe(1);
  });

  it('event shopping list renders its disclaimer exactly once on the COMPUTED state', () => {
    const html = renderViewHtml(
      React.createElement(EventShoppingListResult, { result: EVENT_COMPUTED }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, EVENT_DISCLAIMER.text)).toBe(1);
  });

  it('the degraded NO_PUBLISHED_NORMS state still renders its one disclaimer', () => {
    const html = renderViewHtml(
      React.createElement(EventShoppingListResult, { result: EVENT_NO_NORMS }),
    );
    expect(bannerCount(html)).toBe(1);
    expect(count(html, EVENT_DISCLAIMER.text)).toBe(1);
  });

  it('what-if renders its prominent HYPOTHETICAL disclaimer as its one render (design D5)', () => {
    const html = renderViewHtml(
      React.createElement(WhatIfResult, { result: WHATIF_RESULT }),
    );
    expect(count(html, 'data-testid="what-if-disclaimer"')).toBe(1);
    expect(count(html, WHATIF_DISCLAIMER.text)).toBe(1);
    // The what-if view must not ALSO render the standard banner — one
    // render per view, and the HYPOTHETICAL one is it.
    expect(bannerCount(html)).toBe(0);
  });

  it('share snapshot renders the frozen disclaimer exactly once', async () => {
    const html = await renderSharePage({
      kind: 'ok',
      snapshot: SHARE_LEGACY,
    });
    expect(bannerCount(html)).toBe(1);
    expect(count(html, SHARE_LEGACY.snapshot.disclaimer.text as string)).toBe(1);
  });

  it('a corrupt frozen disclaimer degrades to the fallback copy, rendered exactly once', async () => {
    const html = await renderSharePage({
      kind: 'ok',
      snapshot: {
        ...SHARE_LEGACY,
        snapshot: {
          ...SHARE_LEGACY.snapshot,
          disclaimer: 'plain text, not the object',
        },
      },
    });
    expect(bannerCount(html)).toBe(0);
    const fallback = fiMessages.SharePage.disclaimerFallback as string;
    expect(count(html, fallback)).toBe(1);
  });

  it('the embed document renders its own banner exactly once (disclaimers intact)', () => {
    const html = renderEmbedCalculatorHtml('fi', {
      kind: 'result',
      result: EMBED_RESULT,
    });
    expect(count(html, 'class="ec-disclaimer"')).toBe(1);
    expect(count(html, CALC_DISCLAIMER.text)).toBe(1);
  });
});
