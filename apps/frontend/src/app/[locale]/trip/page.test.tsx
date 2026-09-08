/**
 * TripPage (trip feasibility calculator) tests (task 5.4, change
 * product-roadmap-phases-1-4; fill mode added by task 8.3, change
 * trust-and-reach-roadmap).
 *
 * Mirrors the event page test's contract, adapted to the task-5.3 API:
 *   1. Submit posts /api/v1/trip-feasibility with today's ISO date (the
 *      form has no date input) and the form values parsed to integer
 *      cents.
 *   2. COMPUTED → per-line break-even/cap figures with fi number
 *      formatting, the allowance dataset version cited, the CAPPED cap
 *      visualization (uncapped figure beside the cap), NO_BREAK_EVEN as
 *      an explained value state, and the structural disclaimer rendered.
 *   3. Partner block (design R8): rendered in its own labeled container
 *      with links through the redirect path when populated, absent when
 *      empty — with the results section identical in both cases.
 *   4. 403 (backend rejection) → friendly unavailable message;
 *      409 (no published allowances) → calm empty state, not a red error.
 *
 * Fill mode (task 8.3): the mode toggle reveals the candidate-selection
 * form; search → click a candidate → per-line quantity bounds → submit
 * posts /api/v1/trip/fill; the 200 body renders as the itemization with
 * per-line contributions and headroom; 401 degrades to a sign-in note.
 *
 * @module TripPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TripPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, request, searchProducts } from '@/lib/api';
import type { ProductSearchResult } from '@/lib/types';
import type { TripFeasibilityResponse, TripFillResponse } from './trip.types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
    // Mocked directly: the original searchProducts closes over the
    // original module's request, so overriding `request` alone cannot
    // intercept it (alerts page test precedent).
    searchProducts: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);
const mockedSearchProducts = vi.mocked(searchProducts);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fill-mode fixtures (task 8.3)
// ---------------------------------------------------------------------------

const SEARCH_RESULT: ProductSearchResult = {
  items: [
    {
      id: 42,
      name: 'Saku Originaal',
      brand: 'Saku',
      category: 'beer',
      alcoholByVolume: 4.7,
      unitVolume: '0,5 l',
      containerType: 'CAN',
      lowestPriceCents: 150,
      merchantCount: 2,
    },
    {
      id: 43,
      name: 'Castellum Valkoviini',
      brand: 'Castellum',
      category: 'wine_still',
      alcoholByVolume: 12,
      unitVolume: '0,75 l',
      containerType: 'BOTTLE',
      lowestPriceCents: 700,
      merchantCount: 1,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const FILL_RESULT: TripFillResponse = {
  status: 'FILLED',
  travelDate: '2026-09-05',
  allowanceDatasetVersion: 'allowances-trip-2026.1',
  filledValueCents: 3600,
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
    {
      productId: 43,
      category: 'wine_still',
      merchant: 'Toinen Kauppa',
      unitPriceCents: 700,
      unitVolumeLitres: 0.75,
      maxQuantity: 6,
      filledQuantity: 0,
      valueContributionCents: 0,
      consumedVolumeLitres: 0,
      status: 'NOT_SELECTED',
      headroomAfter: {
        category: 'wine_still',
        capLitres: 90,
        capUnits: null,
        remainingLitres: 90,
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
    {
      category: 'wine_still',
      capLitres: 90,
      capUnits: null,
      usedLitres: 0,
      usedUnits: 0,
      remainingLitres: 90,
      remainingUnits: null,
    },
  ],
  disclaimer: DISCLAIMER,
  ferryOffers: [
    { id: 7, operator: 'Viking Line', routeLabel: 'Helsinki–Tallinna', redirectPath: '/api/v1/outbound/ferry/7' },
  ],
};

const FILL_BOUND_EXHAUSTED: TripFillResponse = {
  ...FILL_RESULT,
  status: 'BOUND_EXHAUSTED',
  filledValueCents: 0,
  filledUnits: 0,
  ferryOffers: [],
};

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
  const { container } = renderWithIntl(<TripPage />);
  await fillValidForm(user, container);
  await user.click(
    within(container).getByRole('button', {
      name: 'Laske kannattava tuontimäärä',
    }),
  );
  return { container };
}

/**
 * Stub the fill exchange: the candidate search returns the fixture
 * products, the fill POST resolves (or throws) with the declared
 * outcome.
 */
function mockFillExchange(response: TripFillResponse | Error): void {
  mockedSearchProducts.mockResolvedValue(SEARCH_RESULT);
  if (response instanceof Error) {
    mockedRequest.mockRejectedValue(response);
  } else {
    mockedRequest.mockResolvedValue(response);
  }
}

/**
 * Switch to fill mode, search for the fixture products, select both
 * candidates, and set their quantity bounds (24 and 6). The submit is
 * left to the test — every fill-flow test asserts a different outcome
 * after it.
 */
async function selectFillCandidates(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
): Promise<HTMLElement> {
  const scope = within(container);
  await user.click(scope.getByTestId('trip-mode-fill'));

  await user.type(scope.getByPlaceholderText('Hae tuotteita…'), 'olut');
  await user.click(scope.getByRole('button', { name: 'Hae' }));

  await user.click(await scope.findByTestId('trip-fill-candidate-42'));
  await user.click(scope.getByTestId('trip-fill-candidate-43'));

  // Per-candidate quantity bounds — queried by id: the label is shared
  // by every candidate row.
  const qty42 = container.querySelector('#trip-fill-qty-42') as HTMLElement;
  const qty43 = container.querySelector('#trip-fill-qty-43') as HTMLElement;
  await user.clear(qty42);
  await user.type(qty42, '24');
  await user.clear(qty43);
  await user.type(qty43, '6');

  return scope.getByTestId('trip-fill-form');
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TripPage', () => {
  it('renders the page content by default', () => {
    const { container } = renderWithIntl(<TripPage />);

    expect(container).not.toBeEmptyDOMElement();
    expect(container.querySelector('h1')).not.toBeNull();
  });

  it('submits the form values parsed to integer cents, with today as the travel date', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);
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
      const view = renderWithIntl(<TripPage />);
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

  it('degrades a 403 (backend rejection) to an unavailable message', async () => {
    await submitForm(
      new ApiFetchError(403, {
        statusCode: 403,
        message: 'Forbidden',
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

// ---------------------------------------------------------------------------
// Fill mode (task 8.3, change trust-and-reach-roadmap)
// ---------------------------------------------------------------------------

describe('TripPage fill mode', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('shows the break-even form by default and swaps forms with the mode toggle', async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);
    const scope = within(container);

    expect(scope.getByTestId('trip-form')).toBeInTheDocument();
    expect(scope.queryByTestId('trip-fill-form')).not.toBeInTheDocument();

    await user.click(scope.getByTestId('trip-mode-fill'));
    expect(scope.getByTestId('trip-fill-form')).toBeInTheDocument();
    expect(scope.queryByTestId('trip-form')).not.toBeInTheDocument();

    await user.click(scope.getByTestId('trip-mode-breakeven'));
    expect(scope.getByTestId('trip-form')).toBeInTheDocument();
    expect(scope.queryByTestId('trip-fill-form')).not.toBeInTheDocument();
  });

  it('submits the selected candidates and quantity bounds to /api/v1/trip/fill with today as the travel date', async () => {
    mockFillExchange(FILL_RESULT);
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);

    await selectFillCandidates(user, container);
    await user.click(
      within(container).getByRole('button', { name: 'Laske täyttö' }),
    );

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockedRequest.mock.calls[0]![0]).toBe('/api/v1/trip/fill');
    expect(
      JSON.parse((mockedRequest.mock.calls[0]![1] as { body: string }).body),
    ).toEqual({
      travelDate: expectedTodayIso(),
      items: [
        { productId: 42, maxQuantity: 24 },
        { productId: 43, maxQuantity: 6 },
      ],
    });

    expect(await screen.findByTestId('trip-fill-result')).toBeInTheDocument();
  });

  it('renders the fill itemization: totals, per-line contribution and headroom, provenance, disclaimer, and the partner block', async () => {
    mockFillExchange(FILL_RESULT);
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);

    await selectFillCandidates(user, container);
    await user.click(
      within(container).getByRole('button', { name: 'Laske täyttö' }),
    );

    expect(await screen.findByTestId('trip-fill-result')).toBeInTheDocument();

    // Totals and provenance, echoed from the response.
    expect(screen.getByText('Täytetty arvo yhteensä: €36.00')).toBeInTheDocument();
    expect(screen.getByText('Yksiköitä yhteensä: 24 kpl')).toBeInTheDocument();
    expect(
      screen.getByText('Tullimäärärajojen aineistoversio: allowances-trip-2026.1'),
    ).toBeInTheDocument();

    // Filled line: candidate name, status badge, quantity, unit price,
    // merchant, contribution, consumed volume, remaining headroom.
    const beerLine = screen.getByTestId('trip-fill-line-42');
    expect(within(beerLine).getByText('Saku Originaal')).toBeInTheDocument();
    expect(within(beerLine).getByText('Mukana täytössä')).toBeInTheDocument();
    expect(within(beerLine).getByText('24 kpl')).toBeInTheDocument();
    expect(within(beerLine).getByText('€1.50')).toBeInTheDocument();
    expect(within(beerLine).getByText('Tallinna Kauppa')).toBeInTheDocument();
    expect(within(beerLine).getByText('€36.00')).toBeInTheDocument();
    expect(within(beerLine).getByText('12 l')).toBeInTheDocument();
    expect(within(beerLine).getByText('Olut: jäljellä')).toBeInTheDocument();
    expect(within(beerLine).getByText('98 l')).toBeInTheDocument();

    // Not-selected line: an explained value state, zero quantity.
    const wineLine = screen.getByTestId('trip-fill-line-43');
    expect(within(wineLine).getByText('Ei tullut valituksi')).toBeInTheDocument();
    expect(within(wineLine).getByText('0 kpl')).toBeInTheDocument();

    // Final per-category headroom.
    expect(
      within(screen.getByTestId('trip-fill-headroom-beer')).getByText('98 l'),
    ).toBeInTheDocument();

    // Structural disclaimer — rendered from the response, never a UI string.
    expect(screen.getByText(DISCLAIMER.text)).toBeInTheDocument();

    // Partner block: separate container, links through the redirect path.
    const partners = screen.getByTestId('trip-partners');
    expect(partners).toHaveTextContent('Kumppanilinkit');
    expect(
      partners.querySelector('a[href="/api/v1/outbound/ferry/7"]'),
    ).toHaveTextContent('Viking Line — Helsinki–Tallinna');
  });

  it('renders BOUND_EXHAUSTED as an explained value state, never an error', async () => {
    mockFillExchange(FILL_BOUND_EXHAUSTED);
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);

    await selectFillCandidates(user, container);
    await user.click(
      within(container).getByRole('button', { name: 'Laske täyttö' }),
    );

    expect(await screen.findByTestId('trip-fill-result')).toBeInTheDocument();
    expect(
      screen.getByText('Määräraja ei riitä yhteenkään yksikköön'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores duplicate candidate clicks, blocks the submit without candidates, and allows removal', async () => {
    mockFillExchange(FILL_RESULT);
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);
    const scope = within(container);

    await user.click(scope.getByTestId('trip-mode-fill'));

    // No candidates yet — the submit stays disabled.
    const submit = scope.getByRole('button', { name: 'Laske täyttö' });
    expect(submit).toBeDisabled();

    await user.type(scope.getByPlaceholderText('Hae tuotteita…'), 'olut');
    await user.click(scope.getByRole('button', { name: 'Hae' }));
    await user.click(await scope.findByTestId('trip-fill-candidate-42'));

    // Clicking the same candidate again must not duplicate the row.
    await user.click(scope.getByTestId('trip-fill-candidate-42'));
    expect(scope.getByTestId('trip-fill-selected-42')).toBeInTheDocument();
    expect(
      scope.queryByTestId('trip-fill-selected-43'),
    ).not.toBeInTheDocument();
    expect(submit).toBeEnabled();

    // Removing the last candidate disables the submit again.
    await user.click(
      scope.getByRole('button', { name: 'Poista Saku Originaal ehdokkaista' }),
    );
    expect(
      scope.queryByTestId('trip-fill-selected-42'),
    ).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it('degrades a 401 (the fill surface requires a signed-in user) to a sign-in note', async () => {
    mockFillExchange(
      new ApiFetchError(401, {
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
        timestamp: '2026-09-05T10:00:00.000Z',
        path: '/api/v1/trip/fill',
      }),
    );
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);

    await selectFillCandidates(user, container);
    await user.click(
      within(container).getByRole('button', { name: 'Laske täyttö' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Täyttö vaatii kirjautumisen. Kirjaudu sisään ja yritä uudelleen.',
    );
  });

  it('renders the 409 no-published-allowances state in fill mode as a calm empty state', async () => {
    mockFillExchange(
      new ApiFetchError(409, {
        statusCode: 409,
        message:
          'No published traveller allowance dataset is effective on 2026-09-05',
        error: 'NoPublishedAllowances',
        timestamp: '2026-09-05T10:00:00.000Z',
        path: '/api/v1/trip/fill',
      }),
    );
    const user = userEvent.setup();
    const { container } = renderWithIntl(<TripPage />);

    await selectFillCandidates(user, container);
    await user.click(
      within(container).getByRole('button', { name: 'Laske täyttö' }),
    );

    expect(
      await screen.findByText('Ei julkaistuja tullimäärärajoja'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
