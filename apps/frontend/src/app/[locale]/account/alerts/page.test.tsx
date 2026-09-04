/**
 * AlertsPage (account price-alerts management) tests (task 2.4, change
 * product-roadmap-phases-1-4).
 *
 * Verifies the flag-gated contract and the endpoint wiring:
 *   1. Flag off in the inlined payload → renders nothing on the FIRST
 *      render and never fires the account request.
 *   2. Flag on → renders the list (product name, euro threshold, status)
 *      and the create form.
 *   3. Create → POST /api/v1/account/alerts with integer euro cents.
 *   4. Pause/resume → PATCH with the status field.
 *   5. Delete → DELETE via apiFetch (the endpoint answers 200 with an
 *      empty body, which request() cannot parse) and row removal.
 *   6. 401 → sign-in prompt; 403 → the whole view degrades to nothing.
 *
 * @module AlertsPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlertsPage from './page';
import {
  ALL_FLAGS_OFF,
  ALL_FLAGS_ON,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import {
  ApiFetchError,
  apiFetch,
  fetchProductsByIds,
  request,
  searchProducts,
} from '@/lib/api';
import type {
  ApiError,
  FeatureFlagsResponse,
  PriceAlert,
  ProductSearchResult,
} from '@/lib/types';

// The page links through next-intl navigation, which needs a Next.js
// router context that unit tests do not have (AgeGate.test.tsx precedent).
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
    apiFetch: vi.fn(),
    searchProducts: vi.fn(),
    fetchProductsByIds: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);
const mockedApiFetch = vi.mocked(apiFetch);
const mockedSearchProducts = vi.mocked(searchProducts);
const mockedFetchProductsByIds = vi.mocked(fetchProductsByIds);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FLAGS_ON: FeatureFlagsResponse = {
  flags: { ...ALL_FLAGS_ON.flags, PRICE_ALERTS: true },
};

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, message: string): ApiError {
  return {
    statusCode: status,
    message,
    error: 'Error',
    timestamp: '2026-08-02T10:00:00.000Z',
    path: '/api/v1/account/alerts',
  };
}

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 7,
    productId: 42,
    thresholdCents: 1250,
    status: 'active',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty watchlist; product-name resolution returns the item.
  mockedRequest.mockResolvedValue([]);
  mockedApiFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
  } as unknown as Response);
  mockedSearchProducts.mockResolvedValue(SEARCH_RESULT);
  mockedFetchProductsByIds.mockResolvedValue(SEARCH_RESULT);
});

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

describe('AlertsPage', () => {
  it('renders nothing and never fires the account request when the flag is off', () => {
    const { container } = renderWithIntl(<AlertsPage />, {
      featureFlags: ALL_FLAGS_OFF,
    });

    expect(container.firstChild).toBeNull();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.queryByTestId('price-alerts-page')).not.toBeInTheDocument();
  });

  it('renders nothing when the flag key is absent (older payload)', () => {
    const { container } = renderWithIntl(<AlertsPage />, {
      featureFlags: ALL_FLAGS_ON,
    });

    expect(container.firstChild).toBeNull();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('degrades to nothing when the API reports the flag off (403)', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(
        403,
        apiError(403, 'Feature "PRICE_ALERTS" is not enabled'),
      ),
    );

    const { container } = renderWithIntl(<AlertsPage />, {
      featureFlags: FLAGS_ON,
    });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('prompts sign-in on 401 after the session-mint retry', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    const prompt = await screen.findByTestId('alert-signin-prompt');
    expect(prompt).toHaveTextContent('Kirjautuminen vaaditaan');
  });

  // ---------------------------------------------------------------------------
  // List rendering
  // ---------------------------------------------------------------------------

  it('renders the alert list with product name, threshold and status', async () => {
    mockedRequest.mockResolvedValue([
      alert(),
      alert({ id: 9, productId: 43, status: 'paused', thresholdCents: 100 }),
    ]);
    mockedFetchProductsByIds.mockResolvedValue({
      items: [
        SEARCH_ITEM,
        { ...SEARCH_ITEM, id: 43, name: 'Teä 100 g' },
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    const rows = await screen.findAllByTestId('price-alert-row');
    expect(rows).toHaveLength(2);
    expect(mockedFetchProductsByIds).toHaveBeenCalledWith([42, 43]);

    expect(rows[0]).toHaveTextContent('Kahvi 500 g');
    expect(rows[0]).toHaveTextContent('Hintaraja 12.50 €');
    expect(rows[0]).toHaveTextContent('Aktiivinen');
    expect(rows[1]).toHaveTextContent('Teä 100 g');
    expect(rows[1]).toHaveTextContent('Hintaraja 1.00 €');
    expect(rows[1]).toHaveTextContent('Keskeytetty');
  });

  it('falls back to the product id label when a name does not resolve', async () => {
    mockedRequest.mockResolvedValue([alert()]);
    mockedFetchProductsByIds.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    const row = await screen.findByTestId('price-alert-row');
    expect(row).toHaveTextContent('Tuote #42');
  });

  it('renders the empty state when no alerts exist', async () => {
    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    expect(await screen.findByText('Ei vielä hintaherätyksiä')).toBeInTheDocument();
    expect(screen.queryByTestId('price-alert-row')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Create flow
  // ---------------------------------------------------------------------------

  it('creates an alert: search, select, euro threshold → POST in cents', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/api/v1/account/alerts' && init?.method === 'POST') {
        return alert();
      }
      if (path === '/api/v1/account/alerts') return [];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    // Search for the product and select it from the results.
    await screen.findByText('Ei vielä hintaherätyksiä');
    await user.type(
      screen.getByPlaceholderText('Hae tuotteita…'),
      'kahvi',
    );
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    await user.click(await screen.findByRole('button', { name: /Kahvi 500 g/ }));

    // Enter the threshold in euros (comma decimal form) and submit.
    await user.type(screen.getByLabelText('Hintaraja (€)'), '12,50');
    await user.click(
      screen.getByRole('button', { name: 'Lisää herätys' }),
    );

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({ productId: 42, thresholdCents: 1250 }),
      }),
    );

    // The created alert appears in the list.
    const row = await screen.findByTestId('price-alert-row');
    expect(row).toHaveTextContent('Kahvi 500 g');
  });

  it('rejects an invalid threshold locally without calling the API', async () => {
    const user = userEvent.setup();
    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    await screen.findByText('Ei vielä hintaherätyksiä');
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kahvi');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    await user.click(await screen.findByRole('button', { name: /Kahvi 500 g/ }));

    await user.type(screen.getByLabelText('Hintaraja (€)'), '12,505');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    expect(
      await screen.findByText(/enintään kaksi desimaalia/),
    ).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalledWith(
      '/api/v1/account/alerts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps a 409 create conflict to the duplicate message', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        throw new ApiFetchError(409, apiError(409, 'exists'));
      }
      return [];
    });

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    await screen.findByText('Ei vielä hintaherätyksiä');
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kahvi');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    await user.click(await screen.findByRole('button', { name: /Kahvi 500 g/ }));
    await user.type(screen.getByLabelText('Hintaraja (€)'), '12,50');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    expect(
      await screen.findByText('Tälle tuotteelle on jo hintaherätys.'),
    ).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Pause/resume + delete
  // ---------------------------------------------------------------------------

  it('pauses an active alert via PATCH and reflects the new status', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/api/v1/account/alerts/7' && init?.method === 'PATCH') {
        return alert({ status: 'paused', updatedAt: '2026-08-03T10:00:00.000Z' });
      }
      if (path === '/api/v1/account/alerts') return [alert()];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    const row = await screen.findByTestId('price-alert-row');
    await user.click(
      within(row).getByRole('button', { name: 'Keskeytä' }),
    );

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts/7', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paused' }),
      }),
    );
    await waitFor(() =>
      expect(
        within(row).getByRole('button', { name: 'Jatka' }),
      ).toBeInTheDocument(),
    );
  });

  it('deletes an alert via the raw client (empty 200 body) and removes the row', async () => {
    const user = userEvent.setup();
    mockedRequest.mockResolvedValue([alert()]);

    renderWithIntl(<AlertsPage />, { featureFlags: FLAGS_ON });

    const row = await screen.findByTestId('price-alert-row');
    await user.click(within(row).getByRole('button', { name: 'Poista' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/api/v1/account/alerts/7', {
        method: 'DELETE',
        credentials: 'include',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('price-alert-row')).not.toBeInTheDocument(),
    );
  });
});
