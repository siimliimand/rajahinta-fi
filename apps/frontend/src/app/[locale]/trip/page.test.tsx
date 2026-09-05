/**
 * TripPage (trip feasibility calculator) tests (task 5.4, change
 * product-roadmap-phases-1-4).
 *
 * Mirrors the event page test's contract, adapted to the task-5.3 API:
 *   1. Flag off in the inlined payload (absent key or explicit false)
 *      → renders nothing on the FIRST render and never fires the request.
 *   2. Flag on → submit posts /api/v1/trip-feasibility with today's ISO
 *      date (the form has no date input) and the form values parsed to
 *      integer cents.
 *   3. COMPUTED → per-line break-even/cap figures with fi number
 *      formatting, the allowance dataset version cited, the CAPPED cap
 *      visualization (uncapped figure beside the cap), NO_BREAK_EVEN as
 *      an explained value state, and the structural disclaimer rendered.
 *   4. Partner block (design R8): rendered in its own labeled container
 *      with links through the redirect path when populated, absent when
 *      empty — with the results section identical in both cases.
 *   5. 403 (flag flipped off server-side mid-session) → friendly
 *      unavailable message; 409 (no published allowances) → calm empty
 *      state, not a red error.
 *
 * @module TripPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TripPage from './page';
import {
  ALL_FLAGS_OFF,
  ALL_FLAGS_ON,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import { ApiFetchError, request } from '@/lib/api';
import type { FeatureFlagsResponse } from '@/lib/types';
import type { TripFeasibilityResponse } from './trip.types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// TRIP_CALCULATOR is deliberately absent from the shared client type —
// the cast mirrors the runtime payload, which keys every flag by its
// backend enum name (event page test precedent).
const FLAGS_ON: FeatureFlagsResponse = {
  flags: { ...ALL_FLAGS_ON.flags, TRIP_CALCULATOR: true },
} as FeatureFlagsResponse;

const DISCLAIMER = {
  text: 'Määrärajat ovat viranomaisen indikatiivisia rajoja.',
  language: 'fi' as const,
  version: '1.0',
};

const BASE_RESULT: TripFeasibilityResponse = {
  status: 'COMPUTED',
  travelDate: '2026-09-05',
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
    {
      status: 'BREAK_EVEN',
      category: 'wine_still',
      domesticPriceCentsPerLitre: 1000,
      foreignPriceCentsPerLitre: 800,
      priceDifferenceCentsPerLitre: 200,
      breakEvenLitres: 75,
      capLitres: 90,
      capStatus: 'CAPPED',
      cappedBreakEvenLitres: 90,
    },
    {
      status: 'NO_BREAK_EVEN',
      category: 'spirits',
      domesticPriceCentsPerLitre: 3800,
      foreignPriceCentsPerLitre: 4000,
      priceDifferenceCentsPerLitre: -200,
    },
  ],
  disclaimer: DISCLAIMER,
  ferryOffers: [],
};

const COMPUTED_WITH_OFFERS: TripFeasibilityResponse = {
  ...BASE_RESULT,
  ferryOffers: [
    { id: 7, operator: 'Viking Line', routeLabel: 'Helsinki–Tallinna', redirectPath: '/api/v1/outbound/ferry/7' },
    { id: 9, operator: 'Eckerö Line', routeLabel: 'Helsinki–Maarianhamina', redirectPath: '/api/v1/outbound/ferry/9' },
  ],
};

/** Today in the user's local calendar — what the page sends as travelDate. */
function expectedTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Fill the minimal valid form (costs + one fully priced beer row); the
 * passengers default of 2 is already valid. The submit button stays
 * disabled until every started row carries both price bases, so every
 * submitting test goes through this. Queries are scoped to the rendered
 * container: a test may mount more than one page instance.
 */
async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
): Promise<void> {
  const scope = within(container);
  await user.type(scope.getByLabelText('Matkaliput yhteensä (€)'), '150,00');
  await user.type(scope.getByLabelText('Polttoaine yhteensä (€)'), '75,00');
  // The foreign-basis label is shared by all six rows — select by id.
  await user.type(scope.getByLabelText('Olut — Suomi (€/l)'), '5,00');
  await user.type(
    container.querySelector('#trip-price-foreign-beer') as HTMLElement,
    '2,50',
  );
}

/** Render, fill the valid form, and submit. */
async function submitForm(
  response: TripFeasibilityResponse | Error,
): Promise<{ container: HTMLElement }> {
  if (response instanceof Error) {
    mockedRequest.mockRejectedValueOnce(response);
  } else {
    mockedRequest.mockResolvedValueOnce(response);
  }
  const user = userEvent.setup();
  const { container } = renderWithIntl(<TripPage />, { featureFlags: FLAGS_ON });
  await fillValidForm(user, container);
  await user.click(
    within(container).getByRole('button', {
      name: 'Laske kannattava tuontimäärä',
    }),
  );
  return { container };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TripPage', () => {
  it('renders nothing on the first render when the flag is absent (off), and fires no request', () => {
    const { container } = renderWithIntl(<TripPage />, {
      featureFlags: ALL_FLAGS_OFF,
    });

    expect(container).toBeEmptyDOMElement();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders nothing when the flag is explicitly false', () => {
    const flagExplicitlyOff = {
      flags: { ...FLAGS_ON.flags, TRIP_CALCULATOR: false },
    } as FeatureFlagsResponse;

    const { container } = renderWithIntl(<TripPage />, {
      featureFlags: flagExplicitlyOff,
    });

    expect(container).toBeEmptyDOMElement();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('submits the form values parsed to integer cents, with today as the travel date', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />, { featureFlags: FLAGS_ON });
    await fillValidForm(user, container);

    const scope = within(container);
    const passengers = scope.getByLabelText('Matkustajat (kpl)');
    await user.clear(passengers);
    await user.type(passengers, '4');

    await user.click(
      scope.getByRole('button', { name: 'Laske kannattava tuontimäärä' }),
    );

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockedRequest.mock.calls[0]![0]).toBe('/api/v1/trip-feasibility');
    expect(
      JSON.parse((mockedRequest.mock.calls[0]![1] as { body: string }).body),
    ).toEqual({
      travelDate: expectedTodayIso(),
      vehicleType: 'car',
      passengers: 4,
      ticketCostCents: 15000,
      fuelCostCents: 7500,
      prices: [
        {
          category: 'beer',
          domesticPriceCentsPerLitre: 500,
          foreignPriceCentsPerLitre: 250,
        },
      ],
    });
  });

  it('renders the COMPUTED lines with figures, the dataset citation, and the structural disclaimer', async () => {
    await submitForm(BASE_RESULT);

    expect(await screen.findByTestId('trip-result')).toBeInTheDocument();

    // Travel-cost derivation, echoed from the response.
    expect(screen.getByText('Matkakustannus yhteensä: €300.00')).toBeInTheDocument();
    expect(screen.getByText('Matkustajaa kohden: €150.00 (2 matkustajaa)')).toBeInTheDocument();

    // R5/R7 provenance: the allowance dataset version is named.
    expect(
      screen.getByText('Tullimäärärajojen aineistoversio: allowances-trip-2026.1'),
    ).toBeInTheDocument();

    // WITHIN_ALLOWANCE line: break-even figure and the cap, fi-FI format.
    expect(screen.getByText('Olut')).toBeInTheDocument();
    expect(screen.getByText('60 l')).toBeInTheDocument();
    expect(screen.getByText('Sopii määrärajaan')).toBeInTheDocument();
    expect(screen.getByText('110 l')).toBeInTheDocument();

    // Structural disclaimer — rendered from the response, never a UI string.
    expect(screen.getByText(DISCLAIMER.text)).toBeInTheDocument();
  });

  it('visualizes the CAPPED line: suggested cap with the uncapped figure beside it', async () => {
    await submitForm(BASE_RESULT);

    expect(await screen.findByTestId('trip-line-wine_still')).toBeInTheDocument();
    // The uncapped break-even stays visible next to the exceeded-cap badge…
    expect(screen.getByText('75 l')).toBeInTheDocument();
    expect(screen.getByText('Raja ylittyy')).toBeInTheDocument();
    // …and the suggested volume states the cap with the uncapped figure.
    expect(
      screen.getByText('90 l (ilman määrärajaa 75 l)'),
    ).toBeInTheDocument();
  });

  it('renders NO_BREAK_EVEN as an explained value state, never an error', async () => {
    await submitForm(BASE_RESULT);

    expect(await screen.findByTestId('trip-line-spirits')).toBeInTheDocument();
    expect(screen.getByText('Tuonti ei säästä rahaa')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ulkomainen hinta ei ole alempi kuin kotimainen vertailuhinta, joten kannattavaa tuontimäärää ei ole.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the partner block only when populated, with links through the redirect path', async () => {
    await submitForm(COMPUTED_WITH_OFFERS);

    const partners = await screen.findByTestId('trip-partners');
    // Visually distinct labeled container (design R8).
    expect(partners).toHaveTextContent('Kumppanilinkit');
    // Links go through the redirect path — never a raw url.
    expect(
      partners.querySelector('a[href="/api/v1/outbound/ferry/7"]'),
    ).toHaveTextContent('Viking Line — Helsinki–Tallinna');
    expect(
      partners.querySelector('a[href="/api/v1/outbound/ferry/9"]'),
    ).toHaveTextContent('Eckerö Line — Helsinki–Maarianhamina');
  });

  it('renders the results section identically whether the partner block is empty or populated', async () => {
    // One page mounted at a time: duplicate input ids across two live
    // renders would break jsdom's document-wide label↔control lookup.
    async function renderSubmitAndCapture(
      response: TripFeasibilityResponse,
    ): Promise<string> {
      mockedRequest.mockResolvedValueOnce(response);
      const user = userEvent.setup();
      const view = renderWithIntl(<TripPage />, { featureFlags: FLAGS_ON });
      await fillValidForm(user, view.container);
      await user.click(
        within(view.container).getByRole('button', {
          name: 'Laske kannattava tuontimäärä',
        }),
      );
      await within(view.container).findByTestId('trip-result');
      const html = within(view.container).getByTestId('trip-result').outerHTML;
      view.unmount();
      return html;
    }

    const emptyOffersHtml = await renderSubmitAndCapture(BASE_RESULT);
    const populatedOffersHtml =
      await renderSubmitAndCapture(COMPUTED_WITH_OFFERS);

    // Design R8: the partner block never leaks into the results markup.
    expect(populatedOffersHtml).toBe(emptyOffersHtml);
  });

  it('degrades a 403 (flag flipped off server-side mid-session) to an unavailable message', async () => {
    await submitForm(
      new ApiFetchError(403, {
        statusCode: 403,
        message: 'Feature flag is off',
        error: 'Forbidden',
        timestamp: '2026-09-05T10:00:00.000Z',
        path: '/api/v1/trip-feasibility',
      }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Matkalaskuri ei ole käytettävissä.');
  });

  it('renders the 409 no-published-allowances state as a calm empty state', async () => {
    await submitForm(
      new ApiFetchError(409, {
        statusCode: 409,
        message:
          'No published traveller allowance dataset is effective on 2026-09-05',
        error: 'NoPublishedAllowances',
        timestamp: '2026-09-05T10:00:00.000Z',
        path: '/api/v1/trip-feasibility',
      }),
    );

    expect(
      await screen.findByText('Ei julkaistuja tullimäärärajoja'),
    ).toBeInTheDocument();
    // The empty state is role="status", not an alert — a data state, not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
