/**
 * ProductAlertAction (product-page set-alert action) tests (task 2.4,
 * change product-roadmap-phases-1-4).
 *
 * Verifies the create/manage switching:
 *   1. No existing alert → create form; submit → POST
 *      /api/v1/account/alerts with integer euro cents → manage view.
 *   2. Existing alert → manage controls (pause/resume, delete), no
 *      create form.
 *   3. 409 on create → the list is re-read and the manage view renders
 *      instead of a duplicate error.
 *   4. 401 → sign-in prompt; 403 → renders nothing.
 *
 * @module ProductAlertActionTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductAlertAction from './ProductAlertAction';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, apiFetch, request } from '@/lib/api';
import type { ApiError, PriceAlert } from '@/lib/types';

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
    kind: 'PRICE',
    category: null,
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

describe('ProductAlertAction', () => {
  it('renders the create form by default when no alert exists', async () => {
    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    const create = await screen.findByTestId('product-alert-create');
    expect(create).toBeInTheDocument();
  });

  it('degrades to nothing when the API rejects the list read (403)', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(
        403,
        apiError(403, 'Forbidden'),
      ),
    );

    const { container } = renderWithIntl(
      <ProductAlertAction productId={PRODUCT_ID} />,
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('prompts sign-in on 401 after the session-mint retry', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

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

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    const input = await screen.findByLabelText('Hintaraja (€)');
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({
          productId: PRODUCT_ID,
          kind: 'price',
          thresholdCents: 2000,
        }),
      }),
    );

    // Successful creation switches the panel to the manage view.
    await screen.findByTestId('product-alert-manage');
    expect(screen.getByText('Hintaraja 20.00 €')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Kind choice (task 5.1): PRICE / LANDED_COST on the product page
  // ---------------------------------------------------------------------------

  it('offers exactly the PRICE and LANDED_COST kind options', async () => {
    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    const create = await screen.findByTestId('product-alert-create');
    expect(
      within(create).getByTestId('product-alert-kind-option-price'),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(create).getByTestId('product-alert-kind-option-landed_cost'),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to landed cost: label names the landed-cost threshold and the hint renders', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    await screen.findByTestId('product-alert-create');
    expect(
      screen.queryByTestId('landed-cost-hint'),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByTestId('product-alert-kind-option-landed_cost'),
    );

    expect(screen.getByLabelText('Kokonaiskustannusraja (€)')).toBeInTheDocument();
    expect(screen.getByTestId('landed-cost-hint')).toHaveTextContent(
      'kokonaiskustannusta',
    );
    expect(
      screen.queryByLabelText('Hintaraja (€)'),
    ).not.toBeInTheDocument();
  });

  it('POSTs the landed_cost kind with integer cents when that option is selected', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        return alert({ kind: 'LANDED_COST', thresholdCents: 2000 });
      }
      if (path === '/api/v1/account/alerts') return [];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    await screen.findByTestId('product-alert-create');
    await user.click(
      screen.getByTestId('product-alert-kind-option-landed_cost'),
    );
    await user.type(screen.getByLabelText('Kokonaiskustannusraja (€)'), '20');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({
          productId: PRODUCT_ID,
          kind: 'landed_cost',
          thresholdCents: 2000,
        }),
      }),
    );
  });

  it('validates a landed-cost threshold locally with the same bounds, without calling the API', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    await screen.findByTestId('product-alert-create');
    await user.click(
      screen.getByTestId('product-alert-kind-option-landed_cost'),
    );
    await user.type(screen.getByLabelText('Kokonaiskustannusraja (€)'), '0,00');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    expect(
      await screen.findByText(/enintään kaksi desimaalia/),
    ).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalledWith(
      '/api/v1/account/alerts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects an invalid threshold locally without calling the API', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

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

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

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

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    const manage = await screen.findByTestId('product-alert-manage');
    expect(manage).toHaveTextContent('Hintaherätys');
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

  it('labels a LANDED_COST row with the landed-cost kind and threshold', async () => {
    mockedRequest.mockResolvedValue([
      alert({ kind: 'LANDED_COST', thresholdCents: 3000 }),
    ]);

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    const manage = await screen.findByTestId('product-alert-manage');
    const row = within(manage).getByTestId('product-alert-row');
    expect(
      within(row).getByTestId('product-alert-kind-label'),
    ).toHaveTextContent('Kokonaiskustannusherätys');
    expect(row).toHaveTextContent('Kokonaiskustannusraja 30.00 €');
    expect(row).not.toHaveTextContent('Hintaraja');
  });

  it('renders every alert the product has, each labeled by kind', async () => {
    // The API's duplicate rule is per product+kind — a product can carry
    // one alert of each offered kind at the same time.
    mockedRequest.mockResolvedValue([
      alert(),
      alert({ id: 8, kind: 'LANDED_COST', thresholdCents: 3000 }),
    ]);

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

    const rows = await screen.findAllByTestId('product-alert-row');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]).getByTestId('product-alert-kind-label'),
    ).toHaveTextContent('Hintaherätys');
    expect(
      within(rows[1]).getByTestId('product-alert-kind-label'),
    ).toHaveTextContent('Kokonaiskustannusherätys');
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

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

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

    renderWithIntl(<ProductAlertAction productId={PRODUCT_ID} />);

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
