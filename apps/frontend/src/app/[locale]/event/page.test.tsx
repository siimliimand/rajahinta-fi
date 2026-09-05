/**
 * EventPage (event calculator MVP simple mode) tests (task 4.4, change
 * product-roadmap-phases-1-4).
 *
 * Verifies the flag-gated contract and the endpoint wiring:
 *   1. Flag off in the inlined payload (absent key — a payload from a
 *      backend predating the flag) → renders nothing on the FIRST render
 *      and never fires the request.
 *   2. Flag on → submit posts /api/v1/event-calc with today's ISO date
 *      (the simple mode has no date input) and the form values.
 *   3. COMPUTED → per-line need/purchase/surplus with fi number
 *      formatting, norms version named, structural disclaimer rendered.
 *   4. NO_PUBLISHED_NORMS → the explicit empty state is explained, and
 *      the disclaimer still renders (it is part of the 200 response).
 *   5. 403 (flag flipped off server-side mid-session) → friendly
 *      unavailable message, no crash.
 *
 * @module EventPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventPage from './page';
import {
  ALL_FLAGS_OFF,
  ALL_FLAGS_ON,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import { ApiFetchError, request } from '@/lib/api';
import type { FeatureFlagsResponse } from '@/lib/types';
import type { EventCalcResponse } from './event.types';

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

// EVENT_CALCULATOR is deliberately absent from the shared client type (the
// task touch set excludes lib/types.ts) — the cast mirrors the runtime
// payload, which keys every flag by its backend enum name.
const FLAGS_ON: FeatureFlagsResponse = {
  flags: { ...ALL_FLAGS_ON.flags, EVENT_CALCULATOR: true },
} as FeatureFlagsResponse;

const DISCLAIMER = {
  text: 'Ostoslista perustuu yleisiin kulutusnormeihin.',
  language: 'fi' as const,
  version: '1.0',
};

const COMPUTED: EventCalcResponse = {
  status: 'COMPUTED',
  eventDate: '2026-09-05',
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
        {
          sizeMl: 330,
          sizeLitres: 0.33,
          description: '0.33 l can',
          quantity: 6,
        },
      ],
      totalUnits: 6,
      purchasedMl: 1980,
      surplusMl: 100,
      surplusLitres: 0.1,
      versionLabel: 'standard-drink-fi-2026.1',
    },
  ],
  disclaimer: DISCLAIMER,
};

const NO_NORMS: EventCalcResponse = {
  status: 'NO_PUBLISHED_NORMS',
  eventDate: '2026-09-05',
  eventProfile: 'casual_gathering',
  guests: 10,
  durationHours: 4,
  disclaimer: DISCLAIMER,
};

/** Today in the user's local calendar — what the page sends as eventDate. */
function expectedTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventPage', () => {
  it('renders nothing on the first render when the flag is absent (off), and fires no request', () => {
    const { container } = renderWithIntl(<EventPage />, {
      featureFlags: ALL_FLAGS_OFF,
    });

    expect(container).toBeEmptyDOMElement();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('submits the form values with today as the event date', async () => {
    mockedRequest.mockResolvedValueOnce(COMPUTED);

    const user = userEvent.setup();
    renderWithIntl(<EventPage />, { featureFlags: FLAGS_ON });

    const guests = screen.getByLabelText('Vieraiden määrä (kpl)');
    await user.clear(guests);
    await user.type(guests, '12');

    await user.click(
      screen.getByRole('button', { name: 'Laske ostoslista' }),
    );

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockedRequest).toHaveBeenCalledWith('/api/v1/event-calc', {
      method: 'POST',
      body: JSON.stringify({
        guests: 12,
        durationHours: 4,
        eventProfile: 'casual_gathering',
        eventDate: expectedTodayIso(),
      }),
    });
  });

  it('renders the COMPUTED shopping list with per-line figures, norms version, and the structural disclaimer', async () => {
    mockedRequest.mockResolvedValueOnce(COMPUTED);

    const user = userEvent.setup();
    renderWithIntl(<EventPage />, { featureFlags: FLAGS_ON });

    await user.click(
      screen.getByRole('button', { name: 'Laske ostoslista' }),
    );

    // Drink-type line with need, purchase, and surplus figures — fi-FI
    // comma decimals, exactly the returned litre values. The purchase
    // row renders "quantity × unit description (size)".
    expect(await screen.findByTestId('event-result')).toBeInTheDocument();
    expect(screen.getByText('Olut')).toBeInTheDocument();
    expect(screen.getByText('1,88 l')).toBeInTheDocument();
    expect(screen.getByText(/6 × 0\.33 l can/)).toBeInTheDocument();
    expect(screen.getByText('0,1 l')).toBeInTheDocument();

    // R5 provenance: the norms version is named in the result view.
    expect(
      screen.getByText('Kulutusnormien versio: standard-drink-fi-2026.1'),
    ).toBeInTheDocument();

    // Structural disclaimer — rendered from the response, never a UI string.
    expect(screen.getByText(DISCLAIMER.text)).toBeInTheDocument();
  });

  it('explains NO_PUBLISHED_NORMS as a result state and still renders the disclaimer', async () => {
    mockedRequest.mockResolvedValueOnce(NO_NORMS);

    const user = userEvent.setup();
    renderWithIntl(<EventPage />, { featureFlags: FLAGS_ON });

    await user.click(
      screen.getByRole('button', { name: 'Laske ostoslista' }),
    );

    expect(
      await screen.findByText('Ei julkaistuja kulutusnormeja'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Valitulle tilaisuustyypille ja päivälle ei löydy julkaistua kulutusnormiversiota, joten ostoslistaa ei voida laskea. Kokeile uudelleen myöhemmin.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER.text)).toBeInTheDocument();
  });

  it('degrades a 403 (flag flipped off server-side mid-session) to an unavailable message', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiFetchError(403, {
        statusCode: 403,
        message: 'Feature flag is off',
        error: 'Forbidden',
        timestamp: '2026-09-05T10:00:00.000Z',
        path: '/api/v1/event-calc',
      }),
    );

    const user = userEvent.setup();
    renderWithIntl(<EventPage />, { featureFlags: FLAGS_ON });

    await user.click(
      screen.getByRole('button', { name: 'Laske ostoslista' }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Tilaisuuslaskuri ei ole käytettävissä.');
  });

  it('renders nothing when the flag is explicitly false', () => {
    const flagExplicitlyOff = {
      flags: { ...FLAGS_ON.flags, EVENT_CALCULATOR: false },
    } as FeatureFlagsResponse;

    const { container } = renderWithIntl(<EventPage />, {
      featureFlags: flagExplicitlyOff,
    });

    expect(container).toBeEmptyDOMElement();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// V2 cross-border sourcing (task 4.5)
// ---------------------------------------------------------------------------

/** A COMPUTED response carrying the sourcing plan and the packing section. */
const COMPUTED_WITH_PLAN: EventCalcResponse = {
  ...COMPUTED,
  plan: {
    lines: [
      {
        drinkType: 'beer',
        sourceCountry: 'EE',
        sourceKind: 'FOREIGN',
        totalCents: 5054,
        components: {
          retailCents: 4000,
          exciseCents: 34,
          containerDutyCents: 1020,
          transportCents: 0,
        },
        statuses: {
          retail: 'ESTIMATED',
          excise: 'ESTIMATED',
          containerDuty: 'ESTIMATED',
          transport: 'UNAVAILABLE',
        },
        confidenceOverall: 'MEDIUM',
        datasetVersions: ['excise-2026.1', 'duty-2026.1'],
        domesticTotalCents: 10000,
        savingsVsDomesticCents: 4946,
      },
    ],
    unpricedDrinkTypes: [],
    totalCents: 5054,
    budget: { limitCents: 4000, totalCents: 5054, met: false, overrunCents: 1054 },
  },
  packing: {
    suggestion: {
      status: 'ESTIMATED',
      boxes: [],
      excludedItems: [{ productId: 1, quantity: 6, reason: 'MISSING_DIMENSIONS' }],
      mixingWarning: null,
    },
    lines: [{ productId: 1, drinkType: 'beer' }],
  },
} as EventCalcResponse;

/** A COMPUTED plan response where the domestic store won and no budget was set. */
const COMPUTED_DOMESTIC_PLAN: EventCalcResponse = {
  ...COMPUTED,
  plan: {
    lines: [
      {
        drinkType: 'beer',
        sourceCountry: 'FI',
        sourceKind: 'DOMESTIC',
        totalCents: 10000,
        components: { retailCents: 10000, exciseCents: 0, containerDutyCents: 0, transportCents: 0 },
        statuses: {
          retail: 'ESTIMATED',
          excise: 'UNAVAILABLE',
          containerDuty: 'UNAVAILABLE',
          transport: 'UNAVAILABLE',
        },
        confidenceOverall: 'LOW',
        datasetVersions: [],
        domesticTotalCents: 10000,
        savingsVsDomesticCents: 0,
      },
    ],
    unpricedDrinkTypes: ['wine_still'],
    totalCents: 10000,
    budget: { limitCents: 20000, totalCents: 10000, met: true, overrunCents: 0 },
  },
} as EventCalcResponse;

describe('EventPage — V2 sourcing', () => {
  async function enableSourcingAndSubmit(
    user: ReturnType<typeof userEvent.setup>,
    response: EventCalcResponse,
    flags: FeatureFlagsResponse = FLAGS_ON,
  ): Promise<void> {
    mockedRequest.mockResolvedValueOnce(response);
    const { container } = renderWithIntl(<EventPage />, { featureFlags: flags });

    await user.click(screen.getByTestId('event-sourcing-toggle'));
    await user.type(screen.getByLabelText('Olut — Suomi (€/l)'), '5,00');
    // The foreign-basis label is shared by all six rows — select by id.
    await user.type(
      container.querySelector('#price-foreign-beer') as HTMLElement,
      '2,00',
    );
    await user.click(screen.getByRole('button', { name: 'Laske ostoslista' }));
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });
  }

  it('posts the sourcing section when the mode is enabled (prices parsed to cents/l)', async () => {
    const user = userEvent.setup();
    await enableSourcingAndSubmit(user, COMPUTED_WITH_PLAN);

    const body = JSON.parse(
      (mockedRequest.mock.calls[0]![1] as { body: string }).body,
    ) as { sourcing?: { lines: unknown[]; packing?: boolean } };
    expect(body.sourcing).toBeDefined();
    expect(body.sourcing!.lines).toHaveLength(1);
    expect(body.sourcing!.lines[0]).toMatchObject({
      drinkType: 'beer',
      domesticPricePerLitreCents: 500,
      foreign: [{ country: 'EE', pricePerLitreCents: 200 }],
    });
    expect(body.sourcing!.packing).toBeUndefined(); // flag off in FLAGS_ON fixture
  });

  it('renders the plan view: source assignment, figures, budget state, packing panel', async () => {
    const user = userEvent.setup();
    await enableSourcingAndSubmit(user, COMPUTED_WITH_PLAN);

    // Plan heading and total rendered from the response.
    expect(await screen.findByTestId('event-plan')).toBeInTheDocument();
    expect(screen.getByTestId('event-plan-source')).toHaveTextContent('Tuo maasta: Viro');
    expect(screen.getByTestId('event-plan-savings')).toHaveTextContent('€49.46');

    // Explicit budget degradation — never a silently truncated plan.
    expect(screen.getByTestId('event-plan-budget-exceeded')).toHaveTextContent('Budjetti ylittyy');

    // Packing panel with the module's own MISSING_DIMENSIONS degradation.
    expect(screen.getByTestId('event-plan-packing')).toHaveTextContent('mitat puuttuvat');

    // The structural disclaimer still renders with the result.
    expect(screen.getByText(DISCLAIMER.text)).toBeInTheDocument();
  });

  it('renders the domestic assignment, unpriced hint, and met budget', async () => {
    const user = userEvent.setup();
    await enableSourcingAndSubmit(user, COMPUTED_DOMESTIC_PLAN);

    expect(await screen.findByTestId('event-plan')).toBeInTheDocument();
    expect(screen.getByTestId('event-plan-source')).toHaveTextContent('Osta Suomesta');
    expect(screen.getByTestId('event-plan-unpriced')).toHaveTextContent('Makuuviini');
    expect(screen.getByTestId('event-plan-budget-met')).toHaveTextContent('Budjetti riittää');
    expect(screen.queryByTestId('event-plan-packing')).not.toBeInTheDocument();
  });

  it('offers the packing opt-in only while PACKING_OPTIMIZER is on', async () => {
    const user = userEvent.setup();
    const flags = {
      flags: { ...FLAGS_ON.flags, PACKING_OPTIMIZER: true },
    } as FeatureFlagsResponse;
    mockedRequest.mockResolvedValueOnce(COMPUTED_WITH_PLAN);
    const { container } = renderWithIntl(<EventPage />, { featureFlags: flags });

    await user.click(screen.getByTestId('event-sourcing-toggle'));
    await user.type(screen.getByLabelText('Olut — Suomi (€/l)'), '5,00');
    await user.type(
      container.querySelector('#price-foreign-beer') as HTMLElement,
      '2,00',
    );
    await user.click(screen.getByTestId('event-packing-toggle'));
    await user.click(screen.getByRole('button', { name: 'Laske ostoslista' }));
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse(
      (mockedRequest.mock.calls[0]![1] as { body: string }).body,
    ) as { sourcing?: { packing?: boolean } };
    expect(body.sourcing!.packing).toBe(true);
  });
});
