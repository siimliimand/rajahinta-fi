/**
 * CalculatorResult Alko benchmark line tests (task 4.3,
 * change drop-sweden-eur-only-alko-benchmark).
 *
 * Pins the web-application "Calculator UI" contract:
 *   1. A result carrying `alkoBenchmark` renders a factual line BELOW the
 *      itemized breakdown — reference price, signed difference in euros
 *      and percent, reliability badge, observation timestamp — visibly
 *      separate from the total row, with the plain statement for each
 *      price posture.
 *   2. A result without the field (no reference, or a pre-change record)
 *      renders nothing — no placeholder, no empty container.
 *
 * @module CalculatorResultTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorResult from './CalculatorResult';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ensureSession } from '@/lib/api';
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

// The outcome nudge (task 3.3) probes the session on mount; the probe is
// mocked so the render stays offline and steerable per test. Default is
// a pending probe — the nudge renders nothing and no state update fires
// in the tests that do not exercise it.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ensureSession: vi.fn(() => new Promise<never>(() => undefined)),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid result — only the fields the component reads. */
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
        label: 'Alcohol excise',
        category: 'alcoholExciseEstimate',
        cents: 650,
        reliability: 'ESTIMATED',
      },
    ],
    excludedOffers: [],
    foreignRetailPrice: 4000,
    transportCost: 0,
    alcoholExciseEstimate: 650,
    containerDutyEstimate: 0,
    totalCents: 4650,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: { text: 'Testidisclaimer', language: 'fi', version: 'test' },
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

// ---------------------------------------------------------------------------
// Benchmark present → factual line below the breakdown
// ---------------------------------------------------------------------------

describe('CalculatorResult alkoBenchmark line (task 4.3)', () => {
  it('renders the factual benchmark line below the total when the field is present', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 850,
          differencePercent: 27,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const line = screen.getByTestId('alko-benchmark');
    expect(line).toBeVisible();

    // Reference price reuses the view's EUR helper; difference is signed
    // in euros and percent at one decimal, matching the API's rounding.
    expect(line.textContent).toContain('Alkon hinta: €31.50');
    expect(line.textContent).toContain('Ero: +€8.50 (+27.0 %)');
    // Positive difference → the plain, non-recommendation statement.
    expect(line.textContent).toContain('Alko on edullisempi');
    // Self-consistent expected timestamp: the same locale formatting the
    // component applies to the ISO observation timestamp.
    expect(line.textContent).toContain(
      `Havainto: ${new Date('2026-08-30T09:30:00.000Z').toLocaleString('fi-FI')}`,
    );
    // The reference's own reliability badge rides on the line.
    expect(within(line).getByText('Vahvistettu')).toBeInTheDocument();

    // Below the itemized breakdown — after the total row, and never
    // inside it (display-only enrichment, not a cost component).
    const total = screen.getByText('Yhteensä');
    expect(
      total.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(line.contains(total)).toBe(false);
  });

  it('states plainly that importing is cheaper on a negative difference', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: -450,
          differencePercent: -14.3,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const line = screen.getByTestId('alko-benchmark');
    expect(line.textContent).toContain('Ero: -€4.50 (-14.3 %)');
    expect(line.textContent).toContain('Tuonti on edullisempaa');
    expect(line.textContent).not.toContain('Alko on edullisempi');
  });

  it('uses the equal-price statement at a zero difference', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 0,
          differencePercent: 0,
          reliabilityStatus: 'STALE',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const line = screen.getByTestId('alko-benchmark');
    expect(line.textContent).toContain('Ero: €0.00 (0.0 %)');
    expect(line.textContent).toContain('Hinta on sama');
  });
});

// ---------------------------------------------------------------------------
// Sanity-note degraded state — visible only when notes are present
// ---------------------------------------------------------------------------

describe('CalculatorResult sanity-note degraded state (task 2.2)', () => {
  it('renders the visible LOW-confidence note block when the result carries sanityNotes', () => {
    renderWithIntl(<CalculatorResult result={resultWithSanityNotes()} />);

    const note = screen.getByTestId('sanity-note');
    expect(note).toBeVisible();
    // The heading states the degradation factually — confidence downgraded,
    // the result is an estimate.
    expect(
      within(note).getByText('Luotettavuus alennettu: tulos on arvio'),
    ).toBeInTheDocument();
    // Component label via the shared category keys plus the API's own
    // detail string — figures verbatim, never reworded UI copy.
    expect(
      within(note).getByText('Arvio alkoholin valmisteverosta'),
    ).toBeInTheDocument();
    expect(note.textContent).toContain(
      'Line alcohol excise 65000 cents exceeds 5× the line retail price 4000 cents',
    );
    // The note sits beside the confidence badge it explains (before the
    // itemized breakdown it qualifies).
    const badge = screen.getByText('Yhteensä');
    expect(
      note.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders no note block when the result carries no sanityNotes', () => {
    const { container } = renderWithIntl(
      <CalculatorResult result={baseResult()} />,
    );

    expect(screen.queryByTestId('sanity-note')).toBeNull();
    expect(container.textContent).not.toContain('Luotettavuus alennettu');
  });
});

// ---------------------------------------------------------------------------
// Benchmark absent → render nothing
// ---------------------------------------------------------------------------

describe('CalculatorResult without alkoBenchmark (pre-change records)', () => {
  it('renders no benchmark line, placeholder, or empty container', () => {
    const { container } = renderWithIntl(
      <CalculatorResult result={baseResult()} />,
    );

    expect(screen.queryByTestId('alko-benchmark')).toBeNull();
    expect(container.textContent).not.toContain('Alko-vertailu');
    expect(container.textContent).not.toContain('Alkon hinta');
  });

  it('still renders the unchanged breakdown and total', () => {
    renderWithIntl(<CalculatorResult result={baseResult()} />);

    expect(screen.getByText('Yhteensä')).toBeInTheDocument();
    expect(screen.getByText('€46.50')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Traveller-alternative callout (task 2.2, change
// finnish-first-client-experience): a labeled ESTIMATE rendered from the
// live POST payload only — GET/persisted results never carry the field.
// ---------------------------------------------------------------------------

const TRAVELLER_ALTERNATIVE = {
  estimatedTotalCents: 4000,
  withinAllowance: true,
  allowanceDatasetVersion: 'allowances-trip-2026.1',
  categoryKey: 'spirits',
} as const;

describe('CalculatorResult travellerAlternative callout (task 2.2)', () => {
  it('renders the labeled estimate with the dataset version and the trip link', () => {
    renderWithIntl(
      <CalculatorResult
        result={
          {
            ...baseResult(),
            travellerAlternative: TRAVELLER_ALTERNATIVE,
          } as CalculatorResultType
        }
      />,
    );

    const callout = screen.getByTestId('traveller-alternative');
    // Labeled as the trip calculator's estimate — clearly not a cost line
    // of the delivery result.
    expect(
      within(callout).getByText('Matkalaskurin arvio'),
    ).toBeInTheDocument();
    expect(callout.textContent).toContain(
      'Yksi matkustaja, sama määrä — arvio yhteensä €40.00.',
    );
    // Allowance framing pinned to the dataset version it resolves against.
    expect(
      within(callout).getByText(
        'Matkustajamäärien tietoaineisto: allowances-trip-2026.1',
      ),
    ).toBeInTheDocument();
    // The handshake link seeds product and quantity.
    const link = within(callout).getByTestId('traveller-alternative-link');
    expect(link.getAttribute('href')).toBe('/trip?product=1&quantity=1');
    expect(link.textContent).toBe('Kokeile matkalaskuria');
  });

  it('says the estimate covers only the allowance-bounded portion when the quantity exceeds the caps', () => {
    renderWithIntl(
      <CalculatorResult
        result={
          {
            ...baseResult(),
            travellerAlternative: {
              ...TRAVELLER_ALTERNATIVE,
              withinAllowance: false,
            },
          } as CalculatorResultType
        }
      />,
    );

    const callout = screen.getByTestId('traveller-alternative');
    expect(callout.textContent).toContain(
      'Sama määrä ylittää yhden matkustajan määräajat',
    );
    expect(callout.textContent).toContain(
      'kattaa vain sallitun määrän osuuden',
    );
  });

  it('renders nothing when the result carries no callout (the persisted GET state)', () => {
    const { container } = renderWithIntl(
      <CalculatorResult result={baseResult()} />,
    );

    expect(screen.queryByTestId('traveller-alternative')).toBeNull();
    expect(container.textContent).not.toContain('Matkalaskurin arvio');
    expect(container.textContent).not.toContain('Kokeile matkalaskuria');
  });
});

// ---------------------------------------------------------------------------
// Outcome nudge (honest-trust-surfaces task 3.3): one dismissible prompt
// after a successful calculation — account deep-link with the record
// preselected when signed in, the sign-in path when anonymous,
// session-sticky dismissal, nothing on a probe failure.
// ---------------------------------------------------------------------------

const SESSION: {
  userId: string;
  email: string;
  verified: boolean;
} = {
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'kayttaja@example.fi',
  verified: true,
};

const mockedEnsureSession = vi.mocked(ensureSession);

describe('CalculatorResult outcome nudge (task 3.3)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // mockClear (not mockReset): keeps the factory's fail-closed default
    // so an unset probe never yields an undefined promise.
    mockedEnsureSession.mockClear();
  });

  it('renders the account deep-link with the record preselected when signed in', async () => {
    mockedEnsureSession.mockResolvedValue(SESSION);

    renderWithIntl(<CalculatorResult result={baseResult()} />);

    const nudge = await screen.findByTestId('outcome-nudge');
    expect(nudge).toBeVisible();
    const cta = within(nudge).getByTestId('outcome-nudge-cta');
    expect(cta.getAttribute('href')).toBe('/account?outcome=42');
    // The prompt is dismissible and sends nothing on its own — its only
    // outbound call is the session probe itself.
    expect(
      within(nudge).getByTestId('outcome-nudge-dismiss'),
    ).toBeInTheDocument();
    expect(mockedEnsureSession).toHaveBeenCalledTimes(1);
  });

  it('renders the sign-in path when the session probe answers 401', async () => {
    const { ApiFetchError } = await import('@/lib/api');
    mockedEnsureSession.mockRejectedValue(new ApiFetchError(401, null, null));

    renderWithIntl(<CalculatorResult result={baseResult()} />);

    const nudge = await screen.findByTestId('outcome-nudge');
    expect(
      within(nudge).getByTestId('outcome-nudge-cta').getAttribute('href'),
    ).toBe('/login');
  });

  it('renders nothing when the session probe fails for any other reason', async () => {
    mockedEnsureSession.mockRejectedValue(new Error('network down'));

    renderWithIntl(<CalculatorResult result={baseResult()} />);

    await waitFor(() => expect(mockedEnsureSession).toHaveBeenCalled());
    expect(screen.queryByTestId('outcome-nudge')).toBeNull();
  });

  it('dismisses for the session: hidden immediately, stays hidden on remount, never probes again', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue(SESSION);

    const { unmount } = renderWithIntl(
      <CalculatorResult result={baseResult()} />,
    );
    await user.click(await screen.findByTestId('outcome-nudge-dismiss'));
    expect(screen.queryByTestId('outcome-nudge')).toBeNull();
    expect(sessionStorage.getItem('rajahinta-outcome-nudge-dismissed')).toBe(
      '1',
    );

    // A freshly mounted result in the same session stays dismissed — and
    // the dismissal short-circuits before the session probe.
    unmount();
    renderWithIntl(<CalculatorResult result={baseResult()} />);
    expect(screen.queryByTestId('outcome-nudge')).toBeNull();
    expect(mockedEnsureSession).toHaveBeenCalledTimes(1);
  });

  it('never renders a nudge placeholder before the probe resolves', () => {
    mockedEnsureSession.mockReturnValue(new Promise(() => undefined));

    renderWithIntl(<CalculatorResult result={baseResult()} />);

    expect(screen.queryByTestId('outcome-nudge')).toBeNull();
  });
});
