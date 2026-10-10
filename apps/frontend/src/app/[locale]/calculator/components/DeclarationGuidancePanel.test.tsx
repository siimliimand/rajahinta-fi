/**
 * DeclarationGuidancePanel tests (task 4.4; dated walkthrough added by
 * import-filing-assistant task 2.4).
 *
 * Verifies the guidance contract:
 *   1. Response without `guidance` → renders nothing.
 *   2. With guidance → renders the derivation (facts + applied rates
 *      with provenance), deadline, checklist and caveats verbatim from
 *      the API, official sources, and the standing disclaimer.
 *   3. Entitlement rejection → controlled message, no crash.
 *   4. Other failures (404) → hidden panel.
 *   5. Dated walkthrough (2.4): a complete dispatch date refetches with
 *      the `dispatchDate` param and renders the dated state, cited steps
 *      (incl. the reference-number step), the guarantee line, and the
 *      return-due estimate; a past date renders the hedged post-deadline
 *      copy verbatim; no date renders the undated checklist without any
 *      deadline figures; an unavailable guarantee renders no line; an
 *      uncited step renders nothing; a payload predating
 *      `datedChecklist` renders nothing new; the /guides cross-link
 *      points at the localized guides index.
 *
 * @module DeclarationGuidancePanelTest
 */
// @vitest-environment jsdom

import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeclarationGuidancePanel from './DeclarationGuidancePanel';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, getDeclarationSummary } from '@/lib/api';
import type {
  DeclarationDatedChecklist,
  DeclarationFilingStep,
  DeclarationSummaryResponse,
} from '@/lib/types';

// Real classifyReportError/ApiFetchError are kept; only the network
// functions are mocked.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getDeclarationSummary: vi.fn(),
  };
});

// The i18n Link double serializes typed hrefs through the real routing
// vocabulary (the shared testing double).
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

const mockedGetDeclarationSummary = vi.mocked(getDeclarationSummary);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FI_CITATION = {
  sourceId: 'S1',
  title: 'Ennakkoilmoitus – Yksityishenkilö',
  url: 'https://www.vero.fi/henkiloasiakkaat/ennakkoilmoitus/',
} as const;

function filingStepFixture(
  kind: DeclarationFilingStep['kind'],
  overrides: Partial<DeclarationFilingStep> = {},
): DeclarationFilingStep {
  return {
    kind,
    description: `Havaittu vaihe: ${kind}.`,
    datedFor: null,
    citations: [FI_CITATION],
    ...overrides,
  };
}

function datedChecklistFixture(
  overrides: Partial<DeclarationDatedChecklist> = {},
): DeclarationDatedChecklist {
  return {
    state: 'UNDATED',
    plannedDate: null,
    deadlineSemantics: null,
    steps: [
      filingStepFixture('noticeAlcohol'),
      filingStepFixture('noticePackaging'),
      filingStepFixture('guarantee'),
      filingStepFixture('referenceNumber'),
      filingStepFixture('carrierHandoff'),
    ],
    // Honest default: no recorded rule provenance → the figure is
    // unavailable and NO guarantee line may render.
    guarantee: { available: false, amountCents: null, status: 'UNAVAILABLE' },
    returnDueEstimate: null,
    postDeadline: null,
    ...overrides,
  };
}

function summaryFixture(
  overrides: Partial<DeclarationSummaryResponse> = {},
): DeclarationSummaryResponse {
  return {
    product: {
      name: 'Test beer',
      brand: 'Brand',
      category: 'Beer',
      abv: 4.5,
      volumeLitres: 0.33,
    },
    units: 6,
    container: { type: 'can', volumeLitres: 0.33, depositSystemStatus: true },
    transport: { carrier: null, origin: 'SE', destination: 'FI' },
    estimatedExcise: {
      alcoholExciseCents: 1234,
      containerDutyCents: 396,
      totalCents: 1630,
      confidence: 'HIGH',
    },
    advanceNoticeInfo: { required: true, deadlineDays: 14 },
    myTaxLink: 'https://www.vero.fi/mytax',
    declarationDate: '2026-08-27',
    disclaimer: {
      text: 'Estimates are informational and based on stored rate datasets.',
      language: 'en',
      version: '1.0.0',
    },
    guidance: {
      derivation: {
        category: 'Beer',
        abvPercent: 4.5,
        volumePerUnitLitres: 0.33,
        quantity: 6,
        totalVolumeLitres: 1.98,
        appliedRates: [
          {
            kind: 'alcoholExcise',
            amountCents: 1234,
            ratePerUnit: 0.5218,
            rateUnit: 'litre of pure alcohol',
            ruleVersionLabel: '2025.1',
            formulaReference: 'PER_LITRE_OF_ALCOHOL',
            formulaExpression: 'excise = rate × litres of pure alcohol',
          },
          {
            kind: 'containerDuty',
            amountCents: 396,
            ratePerUnit: 0.2,
            rateUnit: 'litre of product',
            ruleVersionLabel: '2025.1',
            formulaReference: 'FLAT_PER_LITRE',
            formulaExpression: 'container duty = rate × litres of product',
          },
        ],
      },
      deadline: {
        required: true,
        deadlineDays: 14,
        calculatedFrom: '2026-08-27T10:00:00.000Z',
        dueDate: '2026-09-10',
      },
      liabilityNotice: {
        classification: 'DistanceBuying',
        buyerMustFileAdvanceNotice: true,
        buyerJointlyLiable: false,
        ruleSetVersion: '2.0-2026.1',
      },
      checklist: [
        'Sign in to MyTax with your bank credentials.',
        'Select the alcohol excise declaration form.',
      ],
      caveats: [
        'The alcohol excise estimate is derived from ESTIMATED price data.',
      ],
      officialSources: [
        {
          title: 'Alcohol excise duty (vero.fi)',
          url: 'https://www.vero.fi/en/individuals/',
          description: 'Official Tax Administration guidance',
        },
      ],
      datedChecklist: datedChecklistFixture(),
    },
    ...overrides,
  };
}

/** Summary fixture with the guidance's dated checklist replaced. */
function summaryWithDated(
  dated: DeclarationDatedChecklist,
): DeclarationSummaryResponse {
  const fixture = summaryFixture();
  return {
    ...fixture,
    guidance: { ...fixture.guidance!, datedChecklist: dated },
  };
}

/**
 * Mock keyed on the dispatch-date argument: null → UNDATED,
 * '2099-01-01' → DATED, '2020-01-01' → POST_DEADLINE.
 */
function mockSummaryPerDispatchDate(): void {
  const undated = datedChecklistFixture();
  const dated = datedChecklistFixture({
    state: 'DATED',
    plannedDate: '2099-01-01',
    deadlineSemantics: 'BEFORE_DISPATCH',
    steps: [
      filingStepFixture('noticeAlcohol', { datedFor: '2099-01-01' }),
      filingStepFixture('noticePackaging', { datedFor: '2099-01-01' }),
      filingStepFixture('guarantee', { datedFor: '2099-01-01' }),
      filingStepFixture('referenceNumber', { datedFor: '2099-01-01' }),
      filingStepFixture('carrierHandoff', { datedFor: '2099-01-01' }),
    ],
    guarantee: { available: true, amountCents: 1234, status: 'ESTIMATED' },
    returnDueEstimate: {
      estimatedArrivalDate: '2099-01-01',
      dueDate: '2099-02-12',
      status: 'ESTIMATED',
      citations: [
        {
          sourceId: 'S3',
          title: 'Ilmoitus- ja maksuohjeet alkoholi- ja tupakkatuotteille',
          url: 'https://www.vero.fi/henkiloasiakkaat/ilmoitus--ja-maksuohjeet/',
        },
      ],
    },
    postDeadline: null,
  });
  const postDeadline = datedChecklistFixture({
    state: 'POST_DEADLINE',
    plannedDate: '2020-01-01',
    deadlineSemantics: 'BEFORE_DISPATCH',
    steps: [
      filingStepFixture('noticeAlcohol', { datedFor: '2020-01-01' }),
      filingStepFixture('noticePackaging', { datedFor: '2020-01-01' }),
      filingStepFixture('guarantee', { datedFor: '2020-01-01' }),
      filingStepFixture('referenceNumber', { datedFor: '2020-01-01' }),
      filingStepFixture('carrierHandoff', { datedFor: '2020-01-01' }),
    ],
    guarantee: { available: true, amountCents: 1234, status: 'ESTIMATED' },
    returnDueEstimate: {
      estimatedArrivalDate: '2020-01-01',
      dueDate: '2020-02-12',
      status: 'ESTIMATED',
      citations: [
        {
          sourceId: 'S3',
          title: 'Ilmoitus- ja maksuohjeet alkoholi- ja tupakkatuotteille',
          url: 'https://www.vero.fi/henkiloasiakkaat/ilmoitus--ja-maksuohjeet/',
        },
      ],
    },
    postDeadline: {
      deadlinePassed: true,
      description:
        'The planned dispatch date is in the past; the before-dispatch filing window described in vero.fi guidance has passed.',
      citations: [FI_CITATION],
    },
  });

  mockedGetDeclarationSummary.mockImplementation(
    async (_recordId: number, dispatchDate?: string | null) => {
      if (dispatchDate === '2099-01-01') return summaryWithDated(dated);
      if (dispatchDate === '2020-01-01') return summaryWithDated(postDeadline);
      return summaryWithDated(undated);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetDeclarationSummary.mockResolvedValue(summaryFixture());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeclarationGuidancePanel', () => {
  it('renders nothing when the response omits guidance', async () => {
    const { guidance: _omitted, ...withoutGuidance } = summaryFixture();
    mockedGetDeclarationSummary.mockResolvedValue(withoutGuidance);

    const { container } = renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    await waitFor(() =>
      expect(mockedGetDeclarationSummary).toHaveBeenCalledWith(55, null),
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders derivation, deadline, checklist, caveats, sources, and the disclaimer', async () => {
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    // Collapsed by default; expand via the summary element.
    const panel = await screen.findByTestId('declaration-guidance-panel');
    expect(panel).toBeInTheDocument();

    // The collapsed panel still renders its content in the DOM (details);
    // assert on the content presence.
    const derivation = screen.getByTestId('guidance-derivation');
    expect(derivation).toHaveTextContent('Beer');
    expect(derivation).toHaveTextContent('4.5%');
    expect(derivation).toHaveTextContent('1.980 L');

    // Applied rates carry amount + provenance.
    const rates = screen.getAllByTestId('guidance-applied-rate');
    expect(rates).toHaveLength(2);
    expect(rates[0]).toHaveTextContent('Alkoholin valmistevero');
    expect(rates[0]).toHaveTextContent('€12.34');
    expect(rates[0]).toHaveTextContent('€0.5218 / litre of pure alcohol');
    expect(rates[0]).toHaveTextContent('Sääntöversio 2025.1');
    expect(rates[0]).toHaveTextContent(
      'excise = rate × litres of pure alcohol',
    );

    // Deadline.
    const deadline = screen.getByTestId('guidance-deadline');
    expect(deadline).toHaveTextContent(
      'Tämä luokittelu edellyttää ennakkilmoituksen tekemistä.',
    );
    expect(deadline).toHaveTextContent('Määräaika 2026-09-10');
    expect(deadline).toHaveTextContent('14 päivää hetkestä');

    // Statutory obligations block — counsel-approved wording for the
    // DistanceBuying classification in the fixture.
    const obligations = screen.getByTestId('guidance-obligations');
    expect(obligations).toHaveTextContent('Velvoitteet ja verovastuu');
    expect(obligations).toHaveTextContent('Ennakkoilmoitus');
    expect(obligations).toHaveTextContent('Pakollinen ostajalle.');
    expect(obligations).toHaveTextContent('Verovastuu');
    expect(obligations).toHaveTextContent(
      'Järjestäessäsi kuljetuksen itsenäisesti vastaat valmisteveroista yksin.',
    );

    // Checklist and caveats verbatim from the API.
    const checklist = screen.getByTestId('guidance-checklist');
    expect(checklist).toHaveTextContent(
      'Sign in to MyTax with your bank credentials.',
    );
    const caveats = screen.getByTestId('guidance-caveats');
    expect(caveats).toHaveTextContent(
      'The alcohol excise estimate is derived from ESTIMATED price data.',
    );

    // Official source link and the standing disclaimer.
    const sources = screen.getByTestId('guidance-sources');
    expect(
      sources.querySelector('a[href="https://www.vero.fi/en/individuals/"]'),
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Estimates are informational and based on stored rate datasets.',
      ),
    ).toBeInTheDocument();
  });

  it('states that advance notice is not required when the deadline says so', async () => {
    const fixture = summaryFixture();
    mockedGetDeclarationSummary.mockResolvedValue({
      ...fixture,
      guidance: {
        ...fixture.guidance!,
        deadline: {
          required: false,
          deadlineDays: null,
          calculatedFrom: '2026-08-27T10:00:00.000Z',
          dueDate: null,
        },
      },
    });

    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    expect(
      await screen.findByTestId('declaration-guidance-panel'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('guidance-deadline')).toHaveTextContent(
      'Tämä luokittelu ei edellytä ennakkilmoitusta.',
    );
  });

  it('renders the joint-liability disclosure for DistanceSelling', async () => {
    const fixture = summaryFixture();
    mockedGetDeclarationSummary.mockResolvedValue({
      ...fixture,
      guidance: {
        ...fixture.guidance!,
        liabilityNotice: {
          classification: 'DistanceSelling',
          buyerMustFileAdvanceNotice: false,
          buyerJointlyLiable: true,
          ruleSetVersion: '2.0-2026.1',
        },
      },
    });

    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const obligations = await screen.findByTestId('guidance-obligations');
    expect(obligations).toHaveTextContent(
      'Verovastuu ja yhteisvastuu (1.9.2024 alkaen)',
    );
    expect(obligations).toHaveTextContent('Myyjän vastuulla ennen lähetystä.');
    expect(obligations).toHaveTextContent(
      'vastaat ostajana veroista yhteisvastuullisesti.',
    );
  });

  it('shows the pre-reform note instead of statutory obligations when liabilityNotice is null', async () => {
    const fixture = summaryFixture();
    mockedGetDeclarationSummary.mockResolvedValue({
      ...fixture,
      guidance: {
        ...fixture.guidance!,
        liabilityNotice: null,
      },
    });

    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const obligations = await screen.findByTestId('guidance-obligations');
    expect(obligations).toHaveTextContent(
      'Tämä laskenta on tehty ennen 1.9.2024 alkanutta yhteisvastuu-uudistusta',
    );
    expect(obligations).not.toHaveTextContent('Pakollinen ostajalle.');
  });

  it('surfaces a controlled message on an entitlement rejection (no crash)', async () => {
    mockedGetDeclarationSummary.mockRejectedValue(
      new ApiFetchError(403, {
        statusCode: 403,
        message: 'Access denied',
        error: 'InsufficientEntitlement',
        timestamp: '2026-08-27T12:00:00Z',
        path: '/api/v1/declaration/55',
      }),
    );

    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    expect(
      await screen.findByTestId('declaration-guidance-locked'),
    ).toHaveTextContent(
      'Tulli-ilmoitusohje vaatii laajennetun tilauksen.',
    );
  });

  it('hides the panel on other failures (e.g. record not found)', async () => {
    mockedGetDeclarationSummary.mockRejectedValue(
      new ApiFetchError(404, {
        statusCode: 404,
        message: 'Calculation record 55 not found',
        error: 'NotFound',
        timestamp: '2026-08-27T12:00:00Z',
        path: '/api/v1/declaration/55',
      }),
    );

    const { container } = renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    await waitFor(() =>
      expect(mockedGetDeclarationSummary).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  // -------------------------------------------------------------------------
  // Dated pre-dispatch walkthrough (import-filing-assistant task 2.4)
  // -------------------------------------------------------------------------

  it('renders the undated checklist with cited steps and NO deadline figures when no date is set', async () => {
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const section = await screen.findByTestId('guidance-dated-checklist');
    // All five cited steps render, undated — including the
    // reference-number step at its verified lifecycle point.
    const steps = within(section).getAllByTestId('guidance-filing-step');
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.getAttribute('data-step-kind'))).toEqual([
      'noticeAlcohol',
      'noticePackaging',
      'guarantee',
      'referenceNumber',
      'carrierHandoff',
    ]);
    expect(within(section).getByText('Havaittu vaihe: referenceNumber.'))
      .toBeInTheDocument();
    // Every step carries its citation link(s) to the official pages.
    expect(
      within(section).getAllByText('Ennakkoilmoitus – Yksityishenkilö'),
    ).toHaveLength(5);

    // No date → no planned-date line, no deadline semantics, no
    // return-due estimate, no countdown.
    expect(within(section).queryByTestId('guidance-dated-state')).toBeNull();
    expect(within(section).queryByTestId('guidance-return-due')).toBeNull();
    expect(within(section).queryByTestId('guidance-post-deadline')).toBeNull();
    expect(section.textContent).not.toContain('2099');
    expect(section.textContent).not.toContain('Viimeistään');
  });

  it('renders nothing new when the payload predates the datedChecklist field', async () => {
    const fixture = summaryFixture();
    mockedGetDeclarationSummary.mockResolvedValue({
      ...fixture,
      guidance: { ...fixture.guidance!, datedChecklist: undefined },
    });

    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    await screen.findByTestId('declaration-guidance-panel');
    expect(
      screen.queryByTestId('guidance-dated-checklist'),
    ).toBeNull();
    expect(screen.queryByTestId('guidance-dispatch-date')).toBeNull();
  });

  it('refetches with the dispatchDate param and renders the dated state, guarantee line, and return-due estimate', async () => {
    mockSummaryPerDispatchDate();
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const input = await screen.findByTestId('guidance-dispatch-date');
    fireEvent.change(input, { target: { value: '2099-01-01' } });

    await waitFor(() =>
      expect(mockedGetDeclarationSummary).toHaveBeenCalledWith(
        55,
        '2099-01-01',
      ),
    );

    const section = screen.getByTestId('guidance-dated-checklist');
    const stateLine = await within(section).findByTestId(
      'guidance-dated-state',
    );
    expect(stateLine).toHaveTextContent('Suunniteltu lähetyspäivä: 2099-01-01');
    expect(stateLine).toHaveTextContent('Vaiheet ennen lähetyksen alkua');

    // Every step is anchored to the planned date.
    const steps = within(section).getAllByTestId('guidance-filing-step');
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      expect(step).toHaveTextContent('Viimeistään 2099-01-01');
    }

    // Guarantee line with the figure and its ESTIMATED reliability status.
    const guarantee = await within(section).findByTestId(
      'guidance-guarantee-line',
    );
    expect(guarantee).toHaveTextContent('Vakuuden määrä');
    expect(guarantee).toHaveTextContent('€12.34');
    expect(guarantee).toHaveTextContent('Arvioitu');

    // Return-due estimate — 12th of the following month, marked ESTIMATED.
    const returnDue = await within(section).findByTestId(
      'guidance-return-due',
    );
    expect(returnDue).toHaveTextContent(
      'Veroilmoitus ja valmisteverot viimeistään 2099-02-12',
    );
    expect(returnDue).toHaveTextContent('Arvioitu');
  });

  it('renders the post-deadline state copy verbatim from the payload — never locally invented penalty text', async () => {
    mockSummaryPerDispatchDate();
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const input = await screen.findByTestId('guidance-dispatch-date');
    fireEvent.change(input, { target: { value: '2020-01-01' } });

    const section = await screen.findByTestId('guidance-dated-checklist');
    const postDeadline = await within(section).findByTestId(
      'guidance-post-deadline',
    );
    expect(postDeadline).toHaveTextContent('Valittu päivä on menneisyydessä');
    // The hedged description is the API payload's own text, verbatim.
    expect(postDeadline).toHaveTextContent(
      'The planned dispatch date is in the past; the before-dispatch filing window described in vero.fi guidance has passed.',
    );
    // Citation link accompanies the state.
    expect(
      within(postDeadline).getByText('Ennakkoilmoitus – Yksityishenkilö'),
    ).toBeInTheDocument();
    // No penalty vocabulary beyond what the payload carries (D5).
    expect(postDeadline.textContent).not.toContain('laiminlyöntimaksu');
    expect(postDeadline.textContent).not.toContain('myöhästymismaksu');
    expect(postDeadline.textContent).not.toContain('sakko');
  });

  it('renders NO guarantee line when the figure is unavailable', async () => {
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const section = await screen.findByTestId('guidance-dated-checklist');
    expect(
      within(section).queryByTestId('guidance-guarantee-line'),
    ).toBeNull();
    // No placeholder or substituted number anywhere in the section.
    expect(section.textContent).not.toMatch(/€\s?\d/);
  });

  it('omits an uncited step entirely', async () => {
    mockedGetDeclarationSummary.mockResolvedValue(
      summaryWithDated(
        datedChecklistFixture({
          steps: [
            filingStepFixture('noticeAlcohol'),
            // An uncited fact never renders (spec: honest degraded states).
            filingStepFixture('referenceNumber', { citations: [] }),
          ],
        }),
      ),
    );

    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const section = await screen.findByTestId('guidance-dated-checklist');
    const steps = within(section).getAllByTestId('guidance-filing-step');
    expect(steps).toHaveLength(1);
    expect(steps[0].getAttribute('data-step-kind')).toBe('noticeAlcohol');
    expect(section.textContent).not.toContain('referenceNumber');
  });

  it('does not refetch while the date input holds an incomplete value', async () => {
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const input = await screen.findByTestId('guidance-dispatch-date');
    fireEvent.change(input, { target: { value: '2099-01' } });

    // The partial value is treated as absent: only the initial undated
    // fetch has happened.
    await waitFor(() =>
      expect(mockedGetDeclarationSummary).toHaveBeenCalledWith(55, null),
    );
    expect(mockedGetDeclarationSummary).toHaveBeenCalledTimes(1);
  });

  it('cross-links the localized guides index', async () => {
    renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    const link = await screen.findByTestId('guidance-guides-link');
    // fi (default locale, localePrefix 'as-needed') renders the localized
    // guides path from the routing vocabulary.
    expect(link.getAttribute('href')).toBe('/oppaat');
    expect(link.textContent).toBe('Lisää aiheesta oppaissa');
  });

  it('renders the EN dated copy under an explicit en provider (fi/en parity)', async () => {
    const { NextIntlClientProvider } = await import('next-intl');
    const { render } = await import('@testing-library/react');
    const { default: enMessages } = await import('@/messages/en.json');

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DeclarationGuidancePanel recordId={55} />
      </NextIntlClientProvider>,
    );

    const section = await screen.findByTestId('guidance-dated-checklist');
    expect(
      within(section).getByLabelText('Planned dispatch date'),
    ).toBeInTheDocument();
    expect(section.textContent).toContain(
      'Without a date the steps render undated.',
    );
    const link = within(section).getByTestId('guidance-guides-link');
    expect(link.textContent).toBe('More on this in the guides');
  });
});
