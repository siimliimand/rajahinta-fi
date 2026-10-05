/**
 * ResultCard tests (price-intelligence-roadmap task 4.1).
 *
 * Pins the "Result presentation" contract of the change spec:
 *   1. Answer-first: the estimated landed cost is the prominent figure
 *      and renders before the detailed breakdown.
 *   2. The Finland comparison renders explicit "cheaper/dearer" text
 *      together with the signed figure — the direction is never conveyed
 *      by color alone.
 *   3. Breakdown rows mirror the fixture result object, figures and
 *      category labels verbatim.
 *   4. Reliability statuses render through `RELIABILITY_STATUS_META`
 *      labels (LocalizedReliabilityBadge pattern) with the calculation
 *      timestamp beside the price-data status.
 *   5. The structural disclaimer text rendered is the result object's
 *      own disclaimer field.
 *   6. A result without the Finland reference renders no comparison —
 *      no placeholder, no empty container.
 *   7. A transport component with `reliability: UNAVAILABLE` renders
 *      the honest "not included — dataset pending" line with no €0.00
 *      figure and a note naming the missing input; a usable transport
 *      renders the amount exactly as before (data-quality-and-
 *      publication-trust 3.1).
 *   8. Traveller-alternative promotion (consumer-clarity-and-discovery
 *      3.4, design D4): the live-POST estimate renders as a co-equal
 *      labeled block beside the hero total — the same treatment the
 *      record-page card got in 3.2, amounts byte-identical; the
 *      delivery-only presentation is unchanged when the field is
 *      absent.
 *
 * @module ResultCardTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ResultCard from './ResultCard';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type {
  CalculatorResult as CalculatorResultType,
  ReliabilityStatus,
} from '@/lib/types';

// The traveller-alternative callout (task 2.2) renders its /trip link
// through the i18n navigation Link; stub it with the plain-anchor shape
// the other view tests use.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid result — only the fields the card reads. */
function baseResult(): CalculatorResultType {
  return {
    itemizedCosts: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 4000,
        reliability: 'VERIFIED',
      },
      {
        label: 'Transport',
        category: 'transportCost',
        cents: 500,
        reliability: 'STALE',
      },
      {
        label: 'Alcohol excise',
        category: 'alcoholExciseEstimate',
        cents: 650,
        reliability: 'ESTIMATED',
      },
    ],
    excludedOffers: [],
    foreignRetailPrice: 4000,
    transportCost: 500,
    alcoholExciseEstimate: 650,
    containerDutyEstimate: 0,
    totalCents: 5150,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: {
      text: 'Testirakennevastuuvapautus',
      language: 'fi',
      version: 'test',
    },
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

/** Benchmark shape as the API emits it — key present only when available. */
interface BenchmarkFixture {
  readonly referencePriceCents: number;
  readonly differenceCents: number;
  readonly differencePercent: number;
  readonly reliabilityStatus: ReliabilityStatus;
  readonly observedAt: string;
}

function resultWithBenchmark(
  benchmark: BenchmarkFixture,
): CalculatorResultType {
  return {
    ...baseResult(),
    alkoBenchmark: { status: 'available' as const, ...benchmark },
  } as CalculatorResultType;
}

/**
 * Result whose plausibility sanity rail tripped (task 2.1): overall
 * confidence LOW, machine-readable notes naming the breach. The key is
 * absent on plausible results — the block must render nothing then.
 */
function resultWithSanityNotes(): CalculatorResultType {
  return {
    ...baseResult(),
    confidence: 'LOW',
    sanityNotes: [
      {
        code: 'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY',
        component: 'alcoholExciseEstimate',
        detail:
          'Line alcohol excise 65000 cents exceeds 5× the line retail ' +
          'price 4000 cents — a genuine Finnish duty outcome never does.',
        figures: {
          lineComponentCents: 65000,
          lineRetailPriceCents: 4000,
          thresholdMultiple: 5,
        },
      },
    ],
  };
}

/** The breakdown section heading, for order assertions. */
function breakdownHeading() {
  return screen.getByText('Kustannuserittely');
}

// ---------------------------------------------------------------------------
// Answer-first primary figure
// ---------------------------------------------------------------------------

describe('ResultCard answer-first total (task 4.1)', () => {
  it('renders the estimated landed cost as the prominent figure before the breakdown', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const total = screen.getByTestId('landed-cost-total');
    expect(total).toBeVisible();
    // The figure is the result object's totalCents, verbatim — fi money
    // form (comma decimals, suffix symbol; fi-locale-surface-hardening 2.4).
    expect(total).toHaveTextContent('51,50 €');
    // It carries the total label, so its origin is obvious.
    expect(screen.getByText('Yhteensä')).toBeInTheDocument();

    // Answer before breakdown: the total renders earlier in document
    // order than the breakdown heading, and the breakdown is not part
    // of the answer block.
    expect(
      total.compareDocumentPosition(breakdownHeading()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(breakdownHeading().contains(total)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finland comparison — explicit cheaper/dearer text WITH the figure
// ---------------------------------------------------------------------------

describe('ResultCard Finland comparison (task 4.1)', () => {
  it('pairs the explicit cheaper statement with the signed figure', () => {
    renderWithIntl(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: -450,
          differencePercent: -14.3,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const comparison = screen.getByTestId('finland-comparison');
    // Never color-alone: the direction is stated as text, not just tone.
    expect(
      within(comparison).getByText('Tuonti on edullisempaa'),
    ).toBeInTheDocument();
    // The figure rides with the statement, signed in euros and percent.
    expect(comparison.textContent).toContain('Alkon hinta: 31,50\u00a0€');
    expect(
      within(comparison).getByText('Ero: -4,50 € (-14.3 %)'),
    ).toBeInTheDocument();
    // Reference observation timestamp stays traceable.
    expect(comparison.textContent).toContain(
      `Havainto: ${new Date('2026-08-30T09:30:00.000Z').toLocaleString('fi-FI')}`,
    );

    // Comparison renders before the breakdown (spec scenario order).
    expect(
      screen
        .getByTestId('comparison-posture')
        .compareDocumentPosition(breakdownHeading()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('pairs the explicit dearer statement with the signed figure', () => {
    renderWithIntl(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 850,
          differencePercent: 27,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const comparison = screen.getByTestId('finland-comparison');
    expect(
      within(comparison).getByText('Alko on edullisempi'),
    ).toBeInTheDocument();
    expect(comparison.textContent).toContain('Ero: +8,50\u00a0€ (+27.0 %)');
    expect(comparison.textContent).not.toContain('Tuonti on edullisempaa');
  });

  it('uses the equal-price statement at a zero difference', () => {
    renderWithIntl(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 0,
          differencePercent: 0,
          reliabilityStatus: 'STALE',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const comparison = screen.getByTestId('finland-comparison');
    expect(within(comparison).getByText('Hinta on sama')).toBeInTheDocument();
    expect(comparison.textContent).toContain('Ero: 0,00\u00a0€ (0.0 %)');
  });

  it('renders no comparison block when the result carries no Finland reference', () => {
    const { container } = renderWithIntl(<ResultCard result={baseResult()} />);

    expect(screen.queryByTestId('finland-comparison')).toBeNull();
    expect(container.textContent).not.toContain('Alko-vertailu');
    expect(container.textContent).not.toContain('Alkon hinta');
  });
});

// ---------------------------------------------------------------------------
// Breakdown beneath — rows mirror the result object
// ---------------------------------------------------------------------------

describe('ResultCard breakdown rows (task 4.1)', () => {
  it('renders one labeled row per itemized cost, figures verbatim', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const rows = [
      { label: 'Ulkomainen vähittäishinta', amount: '40,00\u00a0€' },
      { label: 'Kuljetuskustannus', amount: '5,00\u00a0€' },
      { label: 'Arvio alkoholin valmisteverosta', amount: '6,50\u00a0€' },
    ];
    for (const row of rows) {
      const label = screen.getByText(row.label);
      expect(label).toBeInTheDocument();
      // Each amount sits in the same row as its label — traceable.
      expect(label.closest('div')?.textContent).toContain(row.amount);
    }
  });

  it('renders per-line reliability badges through the status meta labels', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    // Fixture: retail VERIFIED, transport STALE, excise ESTIMATED. The
    // retail status legitimately renders twice — once on the answer's
    // price-reliability line, once on its breakdown row.
    expect(screen.getAllByText('Vahvistettu')).toHaveLength(2);
    expect(screen.getByText('Vanhentunut')).toBeInTheDocument();
    expect(screen.getByText('Arvioitu')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Transport-unavailable honest state (data-quality-and-publication-trust 3.1)
// ---------------------------------------------------------------------------

/**
 * The base fixture with the transport line switched to the shape the
 * API emits while the transport dataset is empty: 0 cents, UNAVAILABLE,
 * and a total that consequently carries no transport contribution.
 */
function resultWithTransportUnavailable(): CalculatorResultType {
  const base = baseResult();
  return {
    ...base,
    itemizedCosts: base.itemizedCosts.map((cost) =>
      cost.category === 'transportCost'
        ? { ...cost, cents: 0, reliability: 'UNAVAILABLE' }
        : cost,
    ),
    transportCost: 0,
    totalCents: 4650,
  };
}

describe('ResultCard transport-unavailable honest state (3.1)', () => {
  it('renders the not-included line with no €0.00 figure and the UNAVAILABLE badge', () => {
    renderWithIntl(<ResultCard result={resultWithTransportUnavailable()} />);

    const transportLabel = screen.getByText('Kuljetuskustannus');
    const row = transportLabel.closest('div');
    expect(row).not.toBeNull();
    // The honest line replaces the amount — no €0.00 transport figure
    // (fi money form: 0,00 €).
    expect(
      within(row!).getByTestId('transport-not-included').textContent,
    ).toBe('Ei sisällytetty – tietoaineisto odottaa');
    expect(row!.textContent).not.toContain('0,00\u00a0€');
    // The status stays visible through the canonical badge label.
    expect(within(row!).getByText('Ei saatavilla')).toBeInTheDocument();
  });

  it('explains the downgraded confidence by naming the missing input (the transport dataset)', () => {
    renderWithIntl(<ResultCard result={resultWithTransportUnavailable()} />);

    const note = screen.getByTestId('transport-pending-note');
    expect(note).toBeVisible();
    expect(note.textContent).toBe(
      'Kuljetuskustannuksen tietoaineisto ei ole vielä saatavilla, joten kuljetusta ei ole sisällytetty arvioon.',
    );
  });

  it('renders every other figure verbatim — honesty never alters amounts', () => {
    renderWithIntl(<ResultCard result={resultWithTransportUnavailable()} />);

    // The API total (4650 cents without transport) is shown unchanged.
    expect(screen.getByTestId('landed-cost-total')).toHaveTextContent(
      '46,50 €',
    );
    // The non-transport rows keep their amounts.
    expect(screen.getByText('Ulkomainen vähittäishinta').closest('div'))
      .toHaveTextContent('40,00 €');
    expect(screen.getByText('Arvio alkoholin valmisteverosta').closest('div'))
      .toHaveTextContent('6,50 €');
  });

  it('renders no pending state when transport is usable', () => {
    const { container } = renderWithIntl(<ResultCard result={baseResult()} />);

    // The base fixture's transport line (STALE, 500 cents) renders the
    // amount exactly as before — zero pending-state copy anywhere.
    expect(
      screen.getByText('Kuljetuskustannus').closest('div'),
    ).toHaveTextContent('5,00 €');
    expect(screen.queryByTestId('transport-not-included')).toBeNull();
    expect(screen.queryByTestId('transport-pending-note')).toBeNull();
    expect(container.textContent).not.toContain('Ei sisällytetty');
  });
});

// ---------------------------------------------------------------------------
// Price-data reliability + timestamp via RELIABILITY_STATUS_META
// ---------------------------------------------------------------------------

describe('ResultCard price-data reliability and timestamp (task 4.1)', () => {
  it('shows the retail-price reliability status with the calculation timestamp', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const reliability = screen.getByTestId('price-reliability');
    // Label from RELIABILITY_STATUS_META.foreignRetailPrice-status
    // ('VERIFIED' → Common.reliability.VERIFIED), not an invented score.
    expect(within(reliability).getByText('Vahvistettu')).toBeInTheDocument();
    // Same locale formatting the component applies to the ISO timestamp.
    expect(reliability.textContent).toContain(
      `Laskettu ${new Date('2026-08-31T12:00:00.000Z').toLocaleString('fi-FI')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity-note degraded state — visible only when notes are present
// ---------------------------------------------------------------------------

describe('ResultCard sanity-note degraded state (task 2.2)', () => {
  it('renders the visible LOW-confidence note block when the result carries sanityNotes', () => {
    renderWithIntl(<ResultCard result={resultWithSanityNotes()} />);

    const note = screen.getByTestId('sanity-note');
    expect(note).toBeVisible();
    // The heading states the degradation factually — confidence downgraded,
    // the result is an estimate.
    expect(
      within(note).getByText('Luotettavuus alennettu: tulos on arvio'),
    ).toBeInTheDocument();
    // Each note lists the affected component via the shared category
    // label, plus the API's own detail string naming the breach —
    // figures verbatim, never reworded UI copy.
    expect(
      within(note).getByText('Arvio alkoholin valmisteverosta'),
    ).toBeInTheDocument();
    expect(note.textContent).toContain(
      'Line alcohol excise 65000 cents exceeds 5× the line retail price 4000 cents',
    );
  });

  it('renders no note block when the result carries no sanityNotes', () => {
    const { container } = renderWithIntl(<ResultCard result={baseResult()} />);

    expect(screen.queryByTestId('sanity-note')).toBeNull();
    expect(container.textContent).not.toContain('Luotettavuus alennettu');
  });
});

// ---------------------------------------------------------------------------
// Structural disclaimer — consumed from the result object
// ---------------------------------------------------------------------------

describe('ResultCard disclaimer (task 4.1)', () => {
  it('renders the result object disclaimer text verbatim', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    // The fixture's own disclaimer string appears; the card never
    // restates disclaimer copy as a UI string of its own.
    expect(screen.getByText('Testirakennevastuuvapautus')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Traveller-mode PERSONAL rendering (task 2.1, change
// finnish-first-client-experience): metadata.allowanceDatasetVersion is
// present exactly on PERSONAL results, and the taxed lines arrive split
// — the dataset-fact zero (within allowance, VERIFIED) before the taxed
// surplus line of the same canonical category.
// ---------------------------------------------------------------------------

/** A PERSONAL result with the full split: retail + within/surplus pairs. */
function personalSplitResult(): CalculatorResultType {
  const base = baseResult();
  return {
    ...base,
    itemizedCosts: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 4000,
        reliability: 'VERIFIED',
      },
      {
        label: 'Alcohol excise (within traveller allowance)',
        category: 'alcoholExciseEstimate',
        cents: 0,
        reliability: 'VERIFIED',
      },
      {
        label: 'Container duty (within traveller allowance)',
        category: 'containerDutyEstimate',
        cents: 0,
        reliability: 'VERIFIED',
      },
      {
        label: 'Alcohol excise (over-allowance surplus)',
        category: 'alcoholExciseEstimate',
        cents: 1200,
        reliability: 'ESTIMATED',
      },
      {
        label: 'Container duty (over-allowance surplus)',
        category: 'containerDutyEstimate',
        cents: 300,
        reliability: 'ESTIMATED',
      },
    ],
    metadata: {
      ...base.metadata,
      allowanceDatasetVersion: 'allowances-trip-2026.1',
    },
  } as CalculatorResultType;
}

describe('ResultCard traveller-mode split labels (task 2.1)', () => {
  it('labels the within-allowance zero lines as the untaxed allowance portion', () => {
    renderWithIntl(<ResultCard result={personalSplitResult()} />);

    expect(
      screen.getByText(
        'Arvio alkoholin valmisteverosta (sallitun määrän sisällä, veroton)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Arvio pakkausverosta (sallitun määrän sisällä, veroton)',
      ),
    ).toBeInTheDocument();
    // The dataset-fact zeros render as 0,00 € amounts — honest dataset
    // facts, not missing figures.
    const zeroLine = screen
      .getByText(
        'Arvio alkoholin valmisteverosta (sallitun määrän sisällä, veroton)',
      )
      .closest('div');
    expect(zeroLine).toHaveTextContent('0,00 €');
  });

  it('labels the taxed lines as the over-allowance surplus with the engine figures', () => {
    renderWithIntl(<ResultCard result={personalSplitResult()} />);

    const surplusExcise = screen
      .getByText('Arvio alkoholin valmisteverosta (sallitun määrän ylittävä osa)')
      .closest('div');
    expect(surplusExcise).toHaveTextContent('12,00 €');
    const surplusDuty = screen
      .getByText('Arvio pakkausverosta (sallitun määrän ylittävä osa)')
      .closest('div');
    expect(surplusDuty).toHaveTextContent('3,00 €');
  });

  it('states the single-traveller assumption and cites the allowance dataset version', () => {
    renderWithIntl(<ResultCard result={personalSplitResult()} />);

    const note = screen.getByTestId('single-traveller-note');
    // The one-traveller assumption is explicit, never implied.
    expect(note.textContent).toContain('yhden matkustajan määräaikoja');
    expect(screen.getByTestId('allowance-dataset-version')).toHaveTextContent(
      'Matkustajamäärien tietoaineisto: allowances-trip-2026.1',
    );
  });

  it('keeps plain category labels on a PERSONAL result without a cap split (no cap row for the category)', () => {
    const result = personalSplitResult();
    renderWithIntl(
      <ResultCard
        result={{
          ...result,
          itemizedCosts: [
            result.itemizedCosts[0]!,
            {
              label: 'Alcohol excise',
              category: 'alcoholExciseEstimate',
              cents: 1200,
              reliability: 'ESTIMATED',
            },
          ],
        }}
      />,
    );

    // The single taxed line is the ordinary category label — no within/
    // surplus copy is invented for an unsplit line.
    expect(
      screen.getByText('Arvio alkoholin valmisteverosta'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Arvio alkoholin valmisteverosta (sallitun määrän sisällä, veroton)',
      ),
    ).toBeNull();
  });

  it('renders delivery results without any allowance copy', () => {
    const { container } = renderWithIntl(<ResultCard result={baseResult()} />);

    expect(screen.queryByTestId('traveller-mode-notes')).toBeNull();
    expect(screen.queryByTestId('single-traveller-note')).toBeNull();
    expect(screen.queryByTestId('allowance-dataset-version')).toBeNull();
    expect(container.textContent).not.toContain('sallitun määrän');
  });
});

// ---------------------------------------------------------------------------
// Traveller-alternative callout (task 2.2): display-only estimate on
// delivery results, rendered from the live POST payload only. Promoted
// beside the hero total as a co-equal block (task 3.4, design D4) —
// the record-card treatment from 3.2, amounts byte-identical.
// ---------------------------------------------------------------------------

describe('ResultCard travellerAlternative callout (task 2.2)', () => {
  it('renders the labeled estimate, dataset version, and the /trip handshake link', () => {
    const base = baseResult();
    renderWithIntl(
      <ResultCard
        result={
          {
            ...base,
            travellerAlternative: {
              estimatedTotalCents: 4000,
              withinAllowance: true,
              allowanceDatasetVersion: 'allowances-trip-2026.1',
              categoryKey: 'beer',
            },
          } as CalculatorResultType
        }
      />,
    );

    const callout = screen.getByTestId('traveller-alternative');
    expect(
      within(callout).getByText('Matkalaskurin arvio'),
    ).toBeInTheDocument();
    expect(callout.textContent).toContain(
      'Yksi matkustaja, sama määrä — arvio yhteensä 40,00\u00a0€.',
    );
    expect(callout.textContent).toContain(
      'Matkustajamäärien tietoaineisto: allowances-trip-2026.1',
    );
    const link = within(callout).getByTestId('traveller-alternative-link');
    // Seeds the trip fill form with the result's product and quantity.
    expect(link.getAttribute('href')).toBe('/trip?product=1&quantity=1');
  });

  it('places the estimate beside the hero total as a co-equal block (3.4, design D4)', () => {
    renderWithIntl(
      <ResultCard
        result={
          {
            ...baseResult(),
            travellerAlternative: {
              estimatedTotalCents: 4000,
              withinAllowance: true,
              allowanceDatasetVersion: 'allowances-trip-2026.1',
              categoryKey: 'beer',
            },
          } as CalculatorResultType
        }
      />,
    );

    const hero = screen.getByTestId('landed-cost-total').closest('div')!;
    const callout = screen.getByTestId('traveller-alternative');
    // Same wrapper, callout after the hero — adjacent, at the same rank,
    // both before the breakdown the estimate used to trail.
    expect(hero.parentElement).not.toBeNull();
    expect(hero.parentElement).toBe(callout.parentElement);
    expect(
      hero.compareDocumentPosition(callout) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      callout.compareDocumentPosition(breakdownHeading()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The delivery amount is byte-identical and stays the hero's figure.
    expect(within(hero).getByText('51,50 €')).toBeInTheDocument();
    // The traveller estimate never enters the delivery hero.
    expect(hero.textContent).not.toContain('Matkalaskurin arvio');
    // The estimate keeps its own amount — 40,00 € lives in the callout,
    // never beside the delivery total.
    expect(callout.textContent).toContain('40,00\u00a0€');
    expect(hero.textContent).not.toContain('40,00\u00a0€');
  });

  it('keeps the delivery-only hero presentation when no callout is present', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const hero = screen.getByTestId('landed-cost-total').closest('div')!;
    // Without travellerAlternative the hero wrapper is the plain block —
    // exactly the pre-promotion presentation.
    expect(hero.parentElement!.className).not.toContain('grid');
    expect(screen.queryByTestId('traveller-alternative')).toBeNull();
  });

  it('says the estimate covers only the allowance-bounded portion when withinAllowance is false', () => {
    renderWithIntl(
      <ResultCard
        result={
          {
            ...baseResult(),
            travellerAlternative: {
              estimatedTotalCents: 4000,
              withinAllowance: false,
              allowanceDatasetVersion: 'allowances-trip-2026.1',
              categoryKey: 'beer',
            },
          } as CalculatorResultType
        }
      />,
    );

    expect(screen.getByTestId('traveller-alternative').textContent).toContain(
      'kattaa vain sallitun määrän osuuden',
    );
  });

  it('renders nothing when the result carries no callout', () => {
    const { container } = renderWithIntl(<ResultCard result={baseResult()} />);

    expect(screen.queryByTestId('traveller-alternative')).toBeNull();
    expect(container.textContent).not.toContain('Matkalaskurin arvio');
  });
});

// ---------------------------------------------------------------------------
// Explicit-'en' rendering (fi-locale-surface-hardening 2.4): the money
// pins the fi tests replaced move here — the EN convention is
// symbol-first dot decimals, unchanged from the pre-helper form.
// ---------------------------------------------------------------------------

import { NextIntlClientProvider } from 'next-intl';
import { render as rtlRender } from '@testing-library/react';
import enMessages from '@/messages/en.json';

function renderWithEn(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('ResultCard explicit-en money rendering (2.4)', () => {
  it('keeps the EN convention: symbol-first dot decimals and signed figures', () => {
    renderWithEn(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 850,
          differencePercent: 27,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    expect(screen.getByTestId('landed-cost-total')).toHaveTextContent('€51.50');
    const comparison = screen.getByTestId('finland-comparison');
    expect(comparison.textContent).toContain('Alko price: €31.50');
    expect(comparison.textContent).toContain('Difference: +€8.50 (+27.0 %)');
  });
});
