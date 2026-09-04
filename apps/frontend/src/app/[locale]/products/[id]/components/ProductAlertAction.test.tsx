/**
 * ProductAlertAction (product-page set-alert action) tests (task 2.4,
 * change product-roadmap-phases-1-4).
 *
 * Verifies the flag-gated contract and the create/manage switching:
 *   1. Flag off in the inlined payload → renders nothing on the FIRST
 *      render and never fires the account request.
 *   2. Flag on, no existing alert → create form; submit → POST
 *      /api/v1/account/alerts with integer euro cents → manage view.
 *   3. Flag on, existing alert → manage controls (pause/resume, delete),
 *      no create form.
 *   4. 409 on create → the list is re-read and the manage view renders
 *      instead of a duplicate error.
 *   5. 401 → sign-in prompt; 403 → renders nothing.
 *
 * @module ProductAlertActionTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductAlertAction from './ProductAlertAction';
import {
  ALL_FLAGS_OFF,
  ALL_FLAGS_ON,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import { ApiFetchError, apiFetch, request } from '@/lib/api';
import type { ApiError, FeatureFlagsResponse, PriceAlert } from '@/lib/types';

// The panel links through next-intl navigation, which needs a Next.js
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
  };
});

const mockedRequest = vi.mocked(request);
const mockedApiFetch = vi.mocked(apiFetch);

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

const PRODUCT_ID = 42;

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 7,
    productId: PRODUCT_ID,
    thresholdCents: 1250,
    status: 'active',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequest.mockResolvedValue([]);
  mockedApiFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
  } as unknown as Response);
});

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

describe('ProductAlertAction', () => {
  it('renders nothing and never fires the account request when the flag is off', () => {
    const { container } = renderWithIntl(
      <ProductAlertAction productId={PRODUCT_ID} />,
      { featureFlags: ALL_FLAGS_OFF },
    );

    expect(container.firstChild).toBeNull();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('product-alert-action'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when the flag key is absent (older payload)', () => {
    const { container } = renderWithIntl(
      <ProductAlertAction productId={PRODUCT_ID} />,
      { featureFlags: ALL_FLAGS_ON },
    );

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

    const { container } = renderWithIntl(
      <ProductAlertAction productId={PRODUCT_ID} />,
      { featureFlags: FLAGS_ON },
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('prompts sign-in on 401 after the session-mint retry', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const prompt = await screen.findByTestId('alert-signin-prompt');
    expect(prompt).toHaveTextContent('Hintaherätysten hallinta vaatii istunnon.');
  });

  // ---------------------------------------------------------------------------
  // Create flow
  // ---------------------------------------------------------------------------

  it('offers the create form when no alert exists and POSTs integer cents', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        return alert({ thresholdCents: 2000 });
      }
      if (path === '/api/v1/account/alerts') return [];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const input = await screen.findByLabelText('Hintaraja (€)');
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({ productId: PRODUCT_ID, thresholdCents: 2000 }),
      }),
    );

    // Successful creation switches the panel to the manage view.
    await screen.findByTestId('product-alert-manage');
    expect(screen.getByText('Hintaraja 20.00 €')).toBeInTheDocument();
  });

  it('rejects an invalid threshold locally without calling the API', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const input = await screen.findByLabelText('Hintaraja (€)');
    await user.type(input, '0,00');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    expect(
      await screen.findByText(/enintään kaksi desimaalia/),
    ).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalledWith(
      '/api/v1/account/alerts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('switches to the manage view on a 409 duplicate create', async () => {
    const user = userEvent.setup();
    // First GET (mount) finds nothing; the GET after the 409 conflict
    // finds the alert another tab created in the meantime.
    let listReads = 0;
    mockedRequest.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        throw new ApiFetchError(409, apiError(409, 'exists'));
      }
      if (path === '/api/v1/account/alerts') {
        listReads += 1;
        return listReads === 1 ? [] : [alert({ thresholdCents: 900 })];
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const input = await screen.findByLabelText('Hintaraja (€)');
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    const manage = await screen.findByTestId('product-alert-manage');
    expect(manage).toHaveTextContent('Hintaraja 9.00 €');
    expect(
      screen.queryByRole('button', { name: 'Lisää herätys' }),
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Manage flow
  // ---------------------------------------------------------------------------

  it('offers pause/resume/delete (no create form) when an alert already exists', async () => {
    mockedRequest.mockResolvedValue([alert()]);

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const manage = await screen.findByTestId('product-alert-manage');
    expect(manage).toHaveTextContent('Hintaraja 12.50 €');
    expect(manage).toHaveTextContent('Aktiivinen');
    expect(
      within(manage).getByRole('button', { name: 'Keskeytä' }),
    ).toBeInTheDocument();
    expect(
      within(manage).getByRole('button', { name: 'Poista' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Hintaraja (€)')).not.toBeInTheDocument();
  });

  it('pauses the existing alert via PATCH', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/api/v1/account/alerts/7' && init?.method === 'PATCH') {
        return alert({ status: 'paused' });
      }
      if (path === '/api/v1/account/alerts') return [alert()];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const manage = await screen.findByTestId('product-alert-manage');
    await user.click(
      within(manage).getByRole('button', { name: 'Keskeytä' }),
    );

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts/7', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paused' }),
      }),
    );
    await waitFor(() =>
      expect(within(manage).getByText('Keskeytetty')).toBeInTheDocument(),
    );
  });

  it('deletes the alert via the raw client and returns to the create form', async () => {
    const user = userEvent.setup();
    mockedRequest.mockResolvedValue([alert()]);

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />, {
      featureFlags: FLAGS_ON,
    });

    const manage = await screen.findByTestId('product-alert-manage');
    await user.click(within(manage).getByRole('button', { name: 'Poista' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/api/v1/account/alerts/7', {
        method: 'DELETE',
        credentials: 'include',
      }),
    );
    // After deletion the panel offers creating a new alert again.
    expect(await screen.findByTestId('product-alert-create')).toBeInTheDocument();
  });
});
