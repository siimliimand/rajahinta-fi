/**
 * CalculatorResult component tests.
 *
 * Covers, alongside the original benchmark-line pins (task 4.3, change
 * drop-sweden-euro-only-alko-benchmark):
 *   - Traveller-alternative promotion (consumer-clarity-and-discovery
 *     3.2, design D4): the live-POST estimate renders as a co-equal
 *     labeled block beside the hero total, amounts byte-identical; the
 *     delivery-only presentation is unchanged when the field is absent.
 *   - Localized classification display (3.2, design D3): the label
 *     localizes from the ClassificationLabel enum; evidence lines
 *     compose locale sentences from the closed evidence codes, falling
 *     back to the English `observation` for evidence without a code.
 *
 * @module CalculatorResultTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorResult, { EVIDENCE_MESSAGE_KEYS } from './CalculatorResult';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ensureSession } from '@/lib/api';
import fiMessages from '@/messages/fi.json';
import enMessages from '@/messages/en.json';
import type {
  CalculatorResult as CalculatorResultType,
  EvidenceCode,
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

  it('places the estimate beside the hero total as a co-equal block (3.2, design D4)', () => {
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

    const hero = screen.getByText('Yhteensä').closest('div')!;
    const callout = screen.getByTestId('traveller-alternative');
    // Same wrapper, callout after the hero — adjacent, at the same rank.
    expect(hero.parentElement).not.toBeNull();
    expect(hero.parentElement).toBe(callout.parentElement);
    expect(
      hero.compareDocumentPosition(callout) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The delivery amount is byte-identical and stays the hero's figure.
    expect(within(hero).getByText('€46.50')).toBeInTheDocument();
    // The traveller estimate never enters the delivery hero.
    expect(hero.textContent).not.toContain('Matkalaskurin arvio');
    // The delivery result's confidence badge stays outside the traveller
    // block — the LOW badge (when present) remains the delivery hero's
    // property, never the estimate's.
    expect(within(callout).queryByText('Kohtalainen luotettavuus')).toBeNull();
    expect(screen.getAllByText('Kohtalainen luotettavuus').length).toBe(1);
  });

  it('keeps the delivery-only hero presentation when no callout is present', () => {
    renderWithIntl(<CalculatorResult result={baseResult()} />);

    const hero = screen.getByText('Yhteensä').closest('div')!;
    // Without travellerAlternative the hero wrapper is the plain block —
    // exactly the pre-promotion presentation.
    expect(hero.parentElement!.className).not.toContain('grid');
    expect(screen.queryByTestId('traveller-alternative')).toBeNull();
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
// Localized classification display (task 3.2, design D3): the label
// localizes from the ClassificationLabel enum; evidence lines compose
// locale sentences from the closed evidence codes, with the English
// `observation` as the fallback for evidence lacking a code (the
// calculator-appended traveller-allowance evidence).
// ---------------------------------------------------------------------------

describe('CalculatorResult localized classification (task 3.2)', () => {
  /** Result with a given classification + evidence, everything else base. */
  function resultWithClassification(
    classification: CalculatorResultType['classification'],
  ): CalculatorResultType {
    return { ...baseResult(), classification };
  }

  it('renders the DistanceBuying label and Finnish evidence lines composed from codes + values', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithClassification({
          classification: 'DistanceBuying',
          confidence: 'MEDIUM',
          evidence: [
            {
              code: 'BUYER_CARRIAGE',
              observation: 'Buyer arranged transport via independent carrier',
              supportingData: 'carrier: posti',
              source: 'carrierId',
            },
            {
              code: 'SELLER_NOT_INVOLVED',
              observation: 'Seller did not arrange transport',
              supportingData: 'seller country: DE, buyer country: FI',
              source: 'sellerInvolvementIndicator',
            },
            {
              code: 'SELLER_IDENTITY_UNVERIFIED',
              observation:
                'Seller identity is unverified, reducing confidence',
              supportingData: 'no seller identifier provided',
              source: 'sellerId',
            },
          ],
          evidenceSummary:
            'Buyer arranged transport via independent carrier. ' +
            'Seller did not arrange transport.',
        })}
      />,
    );

    // The label localizes from the enum value — never the raw enum string.
    expect(
      screen.getByText('Etäosto — ostaja vastaa tuonnin verotuksesta'),
    ).toBeInTheDocument();
    expect(screen.queryByText('DistanceBuying')).toBeNull();

    // Evidence lines compose the code's Finnish sentence with the
    // localized data labels; values ride as locale-neutral identifiers.
    const evidence = screen.getByTestId('classification-evidence');
    expect(
      within(evidence).getByText(
        'Ostaja on järjestänyt kuljetuksen ulkopuolisen kuljettajan kanssa (kuljetus: posti).',
      ),
    ).toBeInTheDocument();
    expect(
      within(evidence).getByText(
        'Myyjä ei osallistu tavaran kuljetukseen (myyjän maa: DE, ostajan maa: FI).',
      ),
    ).toBeInTheDocument();
    expect(
      within(evidence).getByText(
        'Myyjän tietoja ei ole vahvistettu, mikä madaltaa luokittelun luotettavuutta (myyjätunnusta ei ole annettu).',
      ),
    ).toBeInTheDocument();

    // The API's English evidenceSummary stays off the page — it is an
    // API-contract field, not UI copy.
    expect(
      screen.queryByText(/Buyer arranged transport via independent carrier/),
    ).toBeNull();
  });

  it('falls back to the English observation for evidence without a code', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithClassification({
          classification: 'TravellerImport',
          confidence: 'HIGH',
          evidence: [
            {
              code: 'BUYER_TRAVELLING',
              observation:
                'Buyer indicated they are physically carrying goods across the border',
              supportingData: 'destination: EE, buyer country: FI',
              source: 'buyerIsTravelling',
            },
            {
              // Calculator-appended traveller-allowance evidence predates
              // codes — it must render the unchanged English observation.
              observation:
                'Traveller allowance applied from the published allowance dataset — the within-allowance quantity carries no excise, container duty, or import VAT; only the surplus is taxed',
              supportingData:
                'allowance dataset: allowances-trip-2026.1; category: beer; travellers: 1',
              source: 'TravellerAllowance',
            },
          ],
          evidenceSummary: 'summary',
        })}
      />,
    );

    expect(
      screen.getByText('Matkustajatuonti — matkustajamäärät ovat voimassa'),
    ).toBeInTheDocument();
    const evidence = screen.getByTestId('classification-evidence');
    // Coded evidence composes Finnish, with the parsed values tail.
    expect(evidence.textContent).toContain(
      'Ostaja kantaa tavarat itse yli rajan (matkakohde: EE, ostajan maa: FI).',
    );
    // Uncoded evidence rides verbatim — never reworded, never dropped.
    expect(evidence.textContent).toContain(
      'Traveller allowance applied from the published allowance dataset',
    );
  });

  it('renders the notStored marker and no evidence list for persisted records without classification', () => {
    const { container } = renderWithIntl(
      <CalculatorResult result={baseResult()} />,
    );

    expect(
      screen.getByText('Ei tallennettu tämän tietueen yhteyteen'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('classification-evidence')).toBeNull();
    // The English API summary no longer renders as UI text.
    expect(container.textContent).not.toContain('not persisted');
  });
});

// ---------------------------------------------------------------------------
// Evidence-code drift guard (task 3.2, design D3): the exhaustive code →
// message-key mapping must cover exactly the closed set in BOTH catalogs —
// the compile-time Record<EvidenceCode, …> check plus this catalog test
// close the loop when a code is added in core-domain.
// ---------------------------------------------------------------------------

describe('CalculatorResult evidence message mapping (task 3.2)', () => {
  it('maps every closed-set code to a message key present in both catalogs', () => {
    const mappedCodes = Object.keys(EVIDENCE_MESSAGE_KEYS) as EvidenceCode[];
    expect(mappedCodes).toHaveLength(8);

    for (const code of mappedCodes) {
      const key = EVIDENCE_MESSAGE_KEYS[code];
      expect(
        (fiMessages.CalculatorResult.evidence as Record<string, unknown>)[code],
      ).toBeDefined();
      expect(
        (enMessages.CalculatorResult.evidence as Record<string, unknown>)[code],
      ).toBeDefined();
      expect(key.endsWith(code)).toBe(true);
    }
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
