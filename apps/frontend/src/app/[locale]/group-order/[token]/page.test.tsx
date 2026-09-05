/**
 * Group order share-link session page tests (task 9.4, change
 * product-roadmap-phases-1-4).
 *
 * Pins the committed 9.3 contract wiring and the R12 states:
 *   1. Flag off (absent = off) → renders nothing, never requests.
 *   2. Settlement note present on the FIRST render (join state) — the
 *      mandatory accounting-only boundary note is persistent, never
 *      gated behind a computation, and names Swish/MobilePay/bank
 *      transfer strictly as user-side examples.
 *   3. Join flow → POST …/join with the nickname; the join response is
 *      the session state (participants + items render).
 *   4. Item add → POST …/items with nickname/productId/quantity, then a
 *      state refresh re-joins.
 *   5. Ledger COMPUTED → the who-owes-whom table and the minimal
 *      transfers render with euro-formatted cents.
 *   6. 410 → the calm expired state ("contact the owner"), never a raw
 *      error; 404 → the same family of treatment.
 *   7. Payment-field rejection → the API's named-field 400 surfaces
 *      verbatim (the page never sends such fields — guardrail).
 *   8. Value states: EMPTY_SESSION and NO_ITEM_VALUE render as explained
 *      states; a `unitValueCents: null` valuation renders as a stated
 *      gap badge, never an error.
 *
 * @module GroupOrderSessionPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GroupOrderSessionView from '../session-view';
import {
  ALL_FLAGS_OFF,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import { ApiFetchError, fetchProductsByIds, request, searchProducts } from '@/lib/api';
import type {
  ApiError,
  FeatureFlagsResponse,
  ProductSearchResult,
} from '@/lib/types';
import type { JoinResponse, LedgerResponse } from '../api';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
    searchProducts: vi.fn(),
    fetchProductsByIds: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);
const mockedSearchProducts = vi.mocked(searchProducts);
const mockedFetchProductsByIds = vi.mocked(fetchProductsByIds);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FLAGS_ON: FeatureFlagsResponse = {
  flags: { ...ALL_FLAGS_OFF.flags, GROUP_ORDER_LEDGER: true },
};

function apiError(
  status: number,
  message: string,
  error: string,
  path = '/api/v1/group-orders/tok/join',
): ApiError {
  return {
    statusCode: status,
    message,
    error,
    timestamp: '2026-09-05T10:00:00.000Z',
    path,
  };
}

function joinState(): JoinResponse {
  return {
    session: {
      id: 'session-1',
      createdAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-09-08T10:00:00.000Z',
    },
    joinedAs: 'Matti',
    participants: [
      {
        nickname: 'Matti',
        itemCount: 1,
        firstAddedAt: '2026-09-01T10:05:00.000Z',
        lastAddedAt: '2026-09-01T10:05:00.000Z',
      },
      {
        nickname: 'Kalle',
        itemCount: 2,
        firstAddedAt: '2026-09-01T10:06:00.000Z',
        lastAddedAt: '2026-09-01T10:07:00.000Z',
      },
    ],
    items: [
      {
        id: 'item-1',
        participantNickname: 'Matti',
        productId: 42,
        quantity: 1,
        addedAt: '2026-09-01T10:05:00.000Z',
      },
    ],
  };
}

const SEARCH_ITEM = {
  id: 42,
  name: 'Kahvi 500 g',
  brand: 'Roastery',
  category: 'Coffee',
  alcoholByVolume: null,
  unitVolume: '500 g',
  containerType: 'bag',
  lowestPriceCents: 1190,
  merchantCount: 3,
};

const SEARCH_RESULT: ProductSearchResult = {
  items: [SEARCH_ITEM],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

function computedLedgerResponse(): LedgerResponse {
  return {
    session: joinState().session,
    valuationRule: 'CHEAPEST_VERIFIED_EUR_OFFER',
    itemValuations: [
      { productId: 42, quantity: 1, unitValueCents: 1200, itemValueCents: 1200 },
    ],
    ledger: {
      status: 'COMPUTED',
      totalItemValueCents: 2000,
      totalSharedCostCents: 1000,
      note: 'Settlement happens outside Rajahinta.',
      sharedCosts: [
        {
          label: 'Toimitus',
          sharedCostCents: 1000,
          frontedByParticipantId: 'Kalle',
          perParticipant: [],
        },
      ],
      participants: [
        {
          participantId: 'Matti',
          itemValueCents: 1200,
          allocatedSharedCostCents: 600,
          frontedSharedCostCents: 0,
          totalOwedCents: 1800,
          netBalanceCents: -600,
        },
        {
          participantId: 'Kalle',
          itemValueCents: 800,
          allocatedSharedCostCents: 400,
          frontedSharedCostCents: 1000,
          totalOwedCents: 1200,
          netBalanceCents: 600,
        },
      ],
      transfers: [{ fromParticipantId: 'Matti', toParticipantId: 'Kalle', cents: 600 }],
    },
  };
}

// ---------------------------------------------------------------------------
// Request routing — the client speaks through request(path, init)
// ---------------------------------------------------------------------------

function mockRoutes(handlers: {
  join?: () => Promise<unknown>;
  items?: (init?: RequestInit) => Promise<unknown>;
  ledger?: (init?: RequestInit) => Promise<unknown>;
}): void {
  const impl = async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path.endsWith('/join')) {
      return handlers.join ? handlers.join() : joinState();
    }
    if (path.endsWith('/items')) {
      if (!handlers.items) throw new Error(`unexpected items call: ${path}`);
      return handlers.items(init);
    }
    if (path.endsWith('/ledger')) {
      if (!handlers.ledger) throw new Error(`unexpected ledger call: ${path}`);
      return handlers.ledger(init);
    }
    throw new Error(`unexpected path: ${path}`);
  };
  mockedRequest.mockImplementation(
    impl as unknown as typeof request,
  );
}

/** Render, join as Matti, and wait for the active session view. */
async function joinAndActivate(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  mockRoutes({ join: async () => joinState() });
  renderWithIntl(<GroupOrderSessionView token="tok" />, {
    featureFlags: FLAGS_ON,
  });
  await user.type(screen.getByLabelText('Lempinimi'), 'Matti');
  await user.click(screen.getByRole('button', { name: 'Liity' }));
  await screen.findByTestId('group-order-participants');
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedSearchProducts.mockReset();
  mockedFetchProductsByIds.mockReset();
  mockedFetchProductsByIds.mockResolvedValue({
    items: [SEARCH_ITEM],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  } as ProductSearchResult);
});

describe('GroupOrderSessionView', () => {
  it('renders nothing when the flag is absent (absent = off) and never requests', () => {
    const { container } = renderWithIntl(<GroupOrderSessionView token="tok" />, {
      featureFlags: ALL_FLAGS_OFF,
    });
    expect(container.firstChild).toBeNull();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('shows the mandatory settlement note on the first render, before any join or compute', () => {
    renderWithIntl(<GroupOrderSessionView token="tok" />, {
      featureFlags: FLAGS_ON,
    });

    // Persistent, not buried: present in the join state with its own card.
    const note = screen.getByTestId('group-order-settlement-note');
    expect(note).toHaveTextContent('Suoritus tapahtuu Rajahinnan ulkopuolella');
    // User-side examples only; the boundary statement is explicit.
    expect(note).toHaveTextContent(/Swish/);
    expect(note).toHaveTextContent(/MobilePay/);
    expect(note).toHaveTextContent(/pankkisiirrolla/);
    expect(note).toHaveTextContent(/ei käsittele, välitä eikä mahdollista maksuja/);
    // No payment affordances of any kind on the page.
    expect(
      screen.queryByRole('button', { name: /maksa|pay now|betala/i }),
    ).not.toBeInTheDocument();
  });

  it('join flow → POST …/join with the nickname; participants and items render', async () => {
    const user = userEvent.setup();
    let joinBody: unknown = null;
    let joinPath = '';
    mockedRequest.mockImplementation(((path: string, init?: RequestInit) => {
      joinPath = path;
      joinBody = init?.body;
      return Promise.resolve(joinState());
    }) as unknown as typeof request);

    renderWithIntl(<GroupOrderSessionView token="tok" />, {
      featureFlags: FLAGS_ON,
    });

    await user.type(screen.getByLabelText('Lempinimi'), 'Matti');
    await user.click(screen.getByRole('button', { name: 'Liity' }));

    expect(joinPath).toBe('/api/v1/group-orders/tok/join');
    expect(joinBody).toBe(JSON.stringify({ nickname: 'Matti' }));

    const participants = await screen.findByTestId('group-order-participants');
    expect(participants).toHaveTextContent('Matti');
    expect(participants).toHaveTextContent('Kalle');

    // Product names resolve through the batched lookup; the item row
    // shows the product, the quantity, and who added it.
    expect(mockedFetchProductsByIds).toHaveBeenCalledWith([42]);
    const items = await screen.findByTestId('group-order-items');
    await waitFor(() => expect(items).toHaveTextContent('Kahvi 500 g'));
    expect(items).toHaveTextContent('lisäsi Matti');

    // The server-set expiry is stated on the active view.
    expect(screen.getByTestId('group-order-session-page')).toHaveTextContent(
      /2026/,
    );
  });

  it('item add → POST …/items with nickname/productId/quantity, then a state refresh', async () => {
    const user = userEvent.setup();
    await joinAndActivate(user);

    mockedSearchProducts.mockResolvedValue(SEARCH_RESULT);
    const addedItem = {
      id: 'item-2',
      participantNickname: 'Matti',
      productId: 42,
      quantity: 2,
      addedAt: '2026-09-01T10:10:00.000Z',
    };
    let itemsBody: unknown = null;
    mockRoutes({
      join: async () => joinState(),
      items: async (init) => {
        itemsBody = init?.body;
        return addedItem;
      },
    });

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kahvi');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    await user.click(await screen.findByRole('button', { name: /Kahvi 500 g/ }));
    const quantity = screen.getByLabelText('Määrä');
    await user.clear(quantity);
    await user.type(quantity, '2');
    await user.click(screen.getByRole('button', { name: 'Lisää tuote' }));

    expect(itemsBody).toBe(
      JSON.stringify({ nickname: 'Matti', productId: 42, quantity: 2 }),
    );
    // The request only ever carries accounting fields — never payment data.
    expect(String(itemsBody)).not.toMatch(/payment|iban|card|checkout/i);
  });

  it('COMPUTED ledger renders the who-owes-whom table and the minimal transfers', async () => {
    const user = userEvent.setup();
    await joinAndActivate(user);

    let ledgerBody: unknown = null;
    let ledgerPath = '';
    mockRoutes({
      join: async () => joinState(),
      ledger: async (init) => {
        ledgerPath = 'called';
        ledgerBody = init?.body;
        return computedLedgerResponse();
      },
    });

    // Stage one shared-cost line: Toimitus 10 € fronted by Kalle.
    await user.type(screen.getByLabelText('Kulun nimi'), 'Toimitus');
    await user.type(screen.getByLabelText('Summa (€)'), '10');
    await user.selectOptions(screen.getByLabelText('Etukäteen maksanut'), 'Kalle');
    await user.click(screen.getByRole('button', { name: 'Lisää rivi' }));
    const lines = screen.getByTestId('group-order-cost-lines');
    expect(lines).toHaveTextContent('Toimitus');
    expect(lines).toHaveTextContent(/10,00/);

    await user.click(screen.getByTestId('group-order-compute-button'));

    expect(ledgerPath).toBe('called');
    expect(ledgerBody).toBe(
      JSON.stringify({
        sharedCosts: [
          { label: 'Toimitus', cents: 1000, frontedByParticipantId: 'Kalle' },
        ],
      }),
    );

    const result = await screen.findByTestId('group-order-ledger-result');
    // Participant lines with the balance direction (euro cents formatted).
    expect(result).toHaveTextContent('Matti');
    expect(result).toHaveTextContent(/velkaa ryhmälle/);
    expect(result).toHaveTextContent(/6,00/);
    expect(result).toHaveTextContent(/ryhmä velaa/);
    // The minimal who-owes-whom transfer set.
    const transfers = within(result).getByTestId('group-order-transfers');
    expect(transfers).toHaveTextContent('Matti velaa Kalle:lle');
    expect(transfers).toHaveTextContent(/6,00/);
    // The valuation rule echoes the API's answer.
    expect(result).toHaveTextContent('CHEAPEST_VERIFIED_EUR_OFFER');
  });

  it('410 → the calm expired state (contact the owner), never a raw error', async () => {
    const user = userEvent.setup();
    mockRoutes({
      join: async () => {
        throw new ApiFetchError(
          410,
          apiError(410, 'Share link has expired', 'SessionExpired'),
        );
      },
    });

    renderWithIntl(<GroupOrderSessionView token="tok" />, {
      featureFlags: FLAGS_ON,
    });
    await user.type(screen.getByLabelText('Lempinimi'), 'Matti');
    await user.click(screen.getByRole('button', { name: 'Liity' }));

    const expired = await screen.findByTestId('group-order-expired');
    expect(expired).toHaveTextContent('Sessio on vanhentunut');
    expect(expired).toHaveTextContent('Pyydä tilauksen omistajalta uusi linkki');
    // No raw HTTP/error vocabulary leaks into the calm state.
    expect(expired).not.toHaveTextContent(/410|Gone|error/i);
    // The settlement note persists in the expired state too.
    expect(
      screen.getByTestId('group-order-settlement-note'),
    ).toBeInTheDocument();
  });

  it('404 unknown token → the same family of calm treatment', async () => {
    const user = userEvent.setup();
    mockRoutes({
      join: async () => {
        throw new ApiFetchError(
          404,
          apiError(404, 'Share token not found', 'ShareTokenNotFound'),
        );
      },
    });

    renderWithIntl(<GroupOrderSessionView token="tok" />, {
      featureFlags: FLAGS_ON,
    });
    await user.type(screen.getByLabelText('Lempinimi'), 'Matti');
    await user.click(screen.getByRole('button', { name: 'Liity' }));

    const unknown = await screen.findByTestId('group-order-unknown');
    expect(unknown).toHaveTextContent('Linkkiä ei löytynyt');
    expect(unknown).not.toHaveTextContent(/404|error/i);
  });

  it('surfaces the API payment-field rejection verbatim with the named field', async () => {
    const user = userEvent.setup();
    await joinAndActivate(user);

    mockRoutes({
      join: async () => joinState(),
      ledger: async () => {
        throw new ApiFetchError(
          400,
          apiError(
            400,
            "field 'sharedCosts[0].paymentMethod' is not accepted",
            'ValidationError',
            '/api/v1/group-orders/tok/ledger',
          ),
        );
      },
    });

    await user.type(screen.getByLabelText('Kulun nimi'), 'Toimitus');
    await user.type(screen.getByLabelText('Summa (€)'), '10');
    await user.selectOptions(screen.getByLabelText('Etukäteen maksanut'), 'Kalle');
    await user.click(screen.getByRole('button', { name: 'Lisää rivi' }));
    await user.click(screen.getByTestId('group-order-compute-button'));

    const surfaced = await screen.findByTestId('group-order-payment-error');
    expect(surfaced).toHaveTextContent(
      "field 'sharedCosts[0].paymentMethod' is not accepted",
    );
    // The surfaced error restates the boundary instead of offering a retry.
    expect(surfaced).toHaveTextContent(
      'suoritus tapahtuu Rajahinnan ulkopuolella',
    );
  });

  it('EMPTY_SESSION renders as an explained state, not an error', async () => {
    const user = userEvent.setup();
    await joinAndActivate(user);

    mockRoutes({
      join: async () => joinState(),
      ledger: async () => ({
        session: joinState().session,
        valuationRule: 'CHEAPEST_VERIFIED_EUR_OFFER',
        itemValuations: [],
        ledger: {
          status: 'EMPTY_SESSION',
          totalItemValueCents: 0,
          totalSharedCostCents: 0,
          note: 'Settlement happens outside Rajahinta.',
          sharedCosts: [],
          participants: [],
          transfers: [],
        },
      }),
    });

    await user.click(screen.getByTestId('group-order-compute-button'));

    expect(await screen.findByText('Sessio on vielä tyhjä')).toBeInTheDocument();
  });

  it('NO_ITEM_VALUE renders as an explained state and an unvalued item shows the stated gap', async () => {
    const user = userEvent.setup();
    await joinAndActivate(user);

    mockRoutes({
      join: async () => joinState(),
      ledger: async () => ({
        session: joinState().session,
        valuationRule: 'CHEAPEST_VERIFIED_EUR_OFFER',
        itemValuations: [
          // unitValueCents: null — no VERIFIED EUR offer; a stated gap.
          { productId: 42, quantity: 1, unitValueCents: null, itemValueCents: 0 },
        ],
        ledger: {
          status: 'NO_ITEM_VALUE',
          totalItemValueCents: 0,
          totalSharedCostCents: 1000,
          note: 'Settlement happens outside Rajahinta.',
          sharedCosts: [],
          participants: [
            { participantId: 'Matti', itemValueCents: 0 },
            { participantId: 'Kalle', itemValueCents: 0 },
          ],
          transfers: [],
        },
      }),
    });

    await user.click(screen.getByTestId('group-order-compute-button'));

    expect(
      await screen.findByText('Tuote-arvoja ei voida määrittää'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('group-order-unvalued-item'),
    ).toHaveTextContent('Arvoa ei tiedossa');
  });
});
