/**
 * CategoryAlertAction (category-browse set-alert entry) tests (task 5.1,
 * change expand-alerts-accuracy-breakdowns).
 *
 * Mirrors the ProductAlertAction test contract, scoped to the CATEGORY
 * kind:
 *   1. No existing watch → create form; submit → POST
 *      /api/v1/account/alerts with kind 'category' + the browsed
 *      canonical category + integer euro cents, and NO productId (the
 *      API's create matrix forbids the combination).
 *   2. Existing CATEGORY watches for this category → manage rows (kind
 *      label, category, threshold, status), no product reference.
 *   3. Watches of other categories do not flip the panel to manage.
 *   4. Invalid threshold → local validation, no API call.
 *   5. 401 → sign-in prompt; 403 → renders nothing.
 *
 * @module CategoryAlertActionTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryAlertAction from './CategoryAlertAction';
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

const CATEGORY = 'beer';
const CATEGORY_LABEL = 'Olut';

function categoryAlert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 31,
    productId: null,
    kind: 'CATEGORY',
    category: CATEGORY,
    thresholdCents: 1500,
    status: 'active',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <CategoryAlertAction category={CATEGORY} categoryLabel={CATEGORY_LABEL} />,
  );
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

describe('CategoryAlertAction', () => {
  it('renders the create form and names the browsed category', async () => {
    renderPanel();

    const create = await screen.findByTestId('category-alert-create');
    expect(create).toBeInTheDocument();
    expect(screen.getByTestId('category-alert-category')).toHaveTextContent(
      'Tuoteryhmä: Olut',
    );
  });

  it('degrades to nothing when the API rejects the list read (403)', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(403, apiError(403, 'Forbidden')),
    );

    const { container } = renderPanel();

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('prompts sign-in on 401 after the session-mint retry', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderPanel();

    const prompt = await screen.findByTestId('alert-signin-prompt');
    expect(prompt).toHaveTextContent('Hintaherätysten hallinta vaatii istunnon.');
  });

  it('POSTs kind "category" with the canonical category and integer cents, and no productId', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        return categoryAlert({ thresholdCents: 2000 });
      }
      if (path === '/api/v1/account/alerts') return [];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderPanel();

    const input = await screen.findByLabelText('Hintaraja (€)');
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    const call = await waitFor(() => {
      const found = mockedRequest.mock.calls.find(
        ([, init]) => init?.method === 'POST',
      );
      if (found === undefined) {
        throw new Error('no POST call recorded');
      }
      return found;
    });
    expect(call[0]).toBe('/api/v1/account/alerts');
    const body = JSON.parse(
      (call[1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toEqual({
      kind: 'category',
      category: 'beer',
      thresholdCents: 2000,
    });
    expect(body).not.toHaveProperty('productId');

    // Successful creation switches the panel to the manage view.
    await screen.findByTestId('category-alert-manage');
  });

  it('rejects an invalid threshold locally without calling the API', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = await screen.findByLabelText('Hintaraja (€)');
    await user.type(input, '10,505');
    await user.click(screen.getByRole('button', { name: 'Lisää herätys' }));

    expect(
      await screen.findByText(/enintään kaksi desimaalia/),
    ).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalledWith(
      '/api/v1/account/alerts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lists existing watches of the browsed category with kind label and threshold, and no product reference', async () => {
    mockedRequest.mockResolvedValue([
      categoryAlert(),
      categoryAlert({ id: 32, thresholdCents: 900, status: 'paused' }),
    ]);

    renderPanel();

    const manage = await screen.findByTestId('category-alert-manage');
    const rows = within(manage).getAllByTestId('category-alert-row');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]).getByTestId('category-alert-kind-label'),
    ).toHaveTextContent('Tuoteryhmäherätys');
    expect(rows[0]).toHaveTextContent('Tuoteryhmä: Olut');
    expect(rows[0]).toHaveTextContent('Hintaraja 15.00 €');
    expect(rows[0]).toHaveTextContent('Aktiivinen');
    expect(rows[1]).toHaveTextContent('Hintaraja 9.00 €');
    expect(rows[1]).toHaveTextContent('Keskeytetty');
    // CATEGORY rows watch no product — no product id fallback anywhere.
    expect(manage).not.toHaveTextContent('Tuote #');
  });

  it('stays in the create view when only other categories are watched', async () => {
    mockedRequest.mockResolvedValue([
      categoryAlert({ category: 'wine_still' }),
    ]);

    renderPanel();

    expect(await screen.findByTestId('category-alert-create')).toBeInTheDocument();
    expect(
      screen.queryByTestId('category-alert-manage'),
    ).not.toBeInTheDocument();
  });

  it('pauses a watch via PATCH', async () => {
    const user = userEvent.setup();
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/api/v1/account/alerts/31' && init?.method === 'PATCH') {
        return categoryAlert({ status: 'paused' });
      }
      if (path === '/api/v1/account/alerts') return [categoryAlert()];
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    renderPanel();

    const manage = await screen.findByTestId('category-alert-manage');
    await user.click(
      within(manage).getByRole('button', { name: 'Keskeytä' }),
    );

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/account/alerts/31', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paused' }),
      }),
    );
    await waitFor(() =>
      expect(within(manage).getByText('Keskeytetty')).toBeInTheDocument(),
    );
  });

  it('deletes a watch via the raw client and returns to the create form', async () => {
    const user = userEvent.setup();
    mockedRequest.mockResolvedValue([categoryAlert()]);

    renderPanel();

    const manage = await screen.findByTestId('category-alert-manage');
    await user.click(within(manage).getByRole('button', { name: 'Poista' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/api/v1/account/alerts/31', {
        method: 'DELETE',
        credentials: 'include',
      }),
    );
    expect(await screen.findByTestId('category-alert-create')).toBeInTheDocument();
  });
});
