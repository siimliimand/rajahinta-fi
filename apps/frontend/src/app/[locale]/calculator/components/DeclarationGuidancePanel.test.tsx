/**
 * DeclarationGuidancePanel tests (task 4.4).
 *
 * Verifies the flag-gated guidance contract:
 *   1. Flag off in the inlined payload → the panel renders nothing on the
 *      FIRST render and NEVER fires the declaration request.
 *   2. Response without `guidance` (flag flipped off server-side) →
 *      renders nothing.
 *   3. With guidance → renders the derivation (facts + applied rates
 *      with provenance), deadline, checklist and caveats verbatim from
 *      the API, official sources, and the standing disclaimer.
 *   4. Entitlement rejection → controlled message, no crash.
 *   5. Other failures (404) → hidden panel.
 *
 * @module DeclarationGuidancePanelTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeclarationGuidancePanel from './DeclarationGuidancePanel';
import { ALL_FLAGS_OFF, renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, getDeclarationSummary } from '@/lib/api';
import type { DeclarationSummaryResponse } from '@/lib/types';

// Real classifyReportError/ApiFetchError are kept; only the network
// functions are mocked.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getDeclarationSummary: vi.fn(),
  };
});

const mockedGetDeclarationSummary = vi.mocked(getDeclarationSummary);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetDeclarationSummary.mockResolvedValue(summaryFixture());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeclarationGuidancePanel', () => {
  it('hides the panel on the first render and never fetches the declaration when the flag is off', () => {
    const { container } = renderWithIntl(
      <DeclarationGuidancePanel recordId={55} />,
      { featureFlags: ALL_FLAGS_OFF },
    );

    // Synchronous first-render assertion: the inlined flag state hides the
    // panel with no client-side flag round-trip (task 9.4).
    expect(container.firstChild).toBeNull();

    expect(mockedGetDeclarationSummary).not.toHaveBeenCalled();
  });

  it('renders nothing when the response omits guidance (flag off server-side)', async () => {
    const { guidance: _omitted, ...withoutGuidance } = summaryFixture();
    mockedGetDeclarationSummary.mockResolvedValue(withoutGuidance);

    const { container } = renderWithIntl(<DeclarationGuidancePanel recordId={55} />);

    await waitFor(() =>
      expect(mockedGetDeclarationSummary).toHaveBeenCalledWith(55),
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
});
