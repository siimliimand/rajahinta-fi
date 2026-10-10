/**
 * Group order create/manage entry tests (task 9.4, change
 * product-roadmap-phases-1-4).
 *
 * Pins the 9.3 contract wiring and the degradation states:
 *   1. Create → POST /api/v1/group-orders (no body fields — the owner
 *      and the 7-day TTL are server-derived) → the shareable link panel
 *      with the expiry date.
 *   2. 401 → the sign-in prompt (create is owner-authenticated; no
 *      retry loop), linking to /login like the alerts view.
 *   3. 403 (backend rejects) → renders nothing.
 *
 * @module GroupOrderCreatePageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateGroupOrderView from './create-view';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, request } from '@/lib/api';
import type { CreateSessionResponse } from './api';
import type { ApiError } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

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


function apiError(status: number, message: string, error: string): ApiError {
  return {
    statusCode: status,
    message,
    error,
    timestamp: '2026-09-05T10:00:00.000Z',
    path: '/api/v1/group-orders',
  };
}

const CREATED: CreateSessionResponse = {
  id: 'session-1',
  createdAt: '2026-09-05T10:00:00.000Z',
  expiresAt: '2026-09-12T10:00:00.000Z',
  shareToken: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
};

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  // Deep-link tests rewrite the jsdom URL; restore the bare one.
  window.history.replaceState(null, '', '/group-order');
});

describe('CreateGroupOrderView', () => {
  it('renders the create entry by default', () => {
    const { container } = renderWithIntl(<CreateGroupOrderView />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('group-order-create-page')).toBeInTheDocument();
  });

  it('create → POST /api/v1/group-orders without body fields, then the share-link panel with the expiry', async () => {
    const user = userEvent.setup();
    mockedRequest.mockResolvedValue(CREATED);

    renderWithIntl(<CreateGroupOrderView />);

    await user.click(screen.getByTestId('group-order-create-button'));

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/group-orders', {
        method: 'POST',
      });
    });

    const link = await screen.findByTestId('group-order-share-link');
    // The shareable link targets the [token] route (fi serves bare paths).
    expect((link as HTMLInputElement).value).toContain(
      '/group-order/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
    // The server-set 7-day expiry is stated so the owner knows the window.
    expect(screen.getByTestId('group-order-share-panel')).toHaveTextContent(
      /2026/,
    );
  });

  it('401 → the sign-in prompt (create is owner-gated), no retry loop', async () => {
    const user = userEvent.setup();
    mockedRequest.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'Session required', 'SessionRequired')),
    );

    renderWithIntl(<CreateGroupOrderView />);

    await user.click(screen.getByTestId('group-order-create-button'));

    const prompt = await screen.findByTestId('group-order-signin-prompt');
    expect(prompt).toHaveTextContent('Kirjautuminen vaaditaan');
    const link = prompt.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/login');
    expect(screen.queryByTestId('group-order-share-panel')).not.toBeInTheDocument();
  });

  it('403 (backend rejects) → renders nothing', async () => {
    const user = userEvent.setup();
    mockedRequest.mockRejectedValue(
      new ApiFetchError(403, apiError(403, 'Forbidden', 'Forbidden')),
    );

    const { container } = renderWithIntl(<CreateGroupOrderView />);

    await user.click(screen.getByTestId('group-order-create-button'));

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Estimate prefill intake (change seasonal-occasion-templates, task 3.1)
// ---------------------------------------------------------------------------

describe('CreateGroupOrderView — estimate prefill intake (3.1)', () => {
  it('populates editable rows from a valid ?items= prefill', async () => {
    window.history.replaceState(null, '', '/group-order?items=beer:24,wine_sparkling:2');
    renderWithIntl(<CreateGroupOrderView />);

    const section = await screen.findByTestId('group-order-prefill-rows');
    expect(section).toHaveTextContent('Arvioitu ostoslista');
    // Canonical keys resolve to the consumer labels; quantities pass through.
    expect(
      (document.getElementById('group-order-prefill-name-0') as HTMLInputElement)
        .value,
    ).toBe('Olut');
    expect(
      (document.getElementById('group-order-prefill-quantity-0') as HTMLInputElement)
        .value,
    ).toBe('24');
    expect(
      (document.getElementById('group-order-prefill-name-1') as HTMLInputElement)
        .value,
    ).toBe('Kuohuviini');
    expect(
      (document.getElementById('group-order-prefill-quantity-1') as HTMLInputElement)
        .value,
    ).toBe('2');

    // The standard creation entry is untouched beneath the rows.
    expect(screen.getByTestId('group-order-create-button')).toBeInTheDocument();
  });

  it('treats prefill rows as ordinary rows: editable, removable, extendable', async () => {
    window.history.replaceState(null, '', '/group-order?items=beer:24,wine_sparkling:2');
    const user = userEvent.setup();
    renderWithIntl(<CreateGroupOrderView />);
    await screen.findByTestId('group-order-prefill-rows');

    // Edit the first row's name and quantity freely.
    const name = document.getElementById(
      'group-order-prefill-name-0',
    ) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'Saunaolut');
    expect(name.value).toBe('Saunaolut');
    const quantity = document.getElementById(
      'group-order-prefill-quantity-0',
    ) as HTMLInputElement;
    await user.clear(quantity);
    await user.type(quantity, '30');
    expect(quantity.value).toBe('30');

    // Remove the first row — the second survives with its values.
    await user.click(screen.getByTestId('group-order-prefill-remove-0'));
    expect(
      document.getElementById('group-order-prefill-name-0'),
    ).not.toBeNull();
    expect(
      (document.getElementById('group-order-prefill-name-0') as HTMLInputElement)
        .value,
    ).toBe('Kuohuviini');

    // Extend with an empty row, exactly like a hand-added one.
    await user.click(screen.getByTestId('group-order-prefill-add'));
    expect(
      (document.getElementById('group-order-prefill-name-1') as HTMLInputElement)
        .value,
    ).toBe('');
    expect(
      (document.getElementById('group-order-prefill-quantity-1') as HTMLInputElement)
        .value,
    ).toBe('1');
  });

  it('creates the session exactly as without a prefill (nothing transmitted)', async () => {
    window.history.replaceState(null, '', '/group-order?items=beer:24');
    const user = userEvent.setup();
    mockedRequest.mockResolvedValue(CREATED);
    renderWithIntl(<CreateGroupOrderView />);
    await screen.findByTestId('group-order-prefill-rows');

    await user.click(screen.getByTestId('group-order-create-button'));
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith('/api/v1/group-orders', {
        method: 'POST',
      });
    });
    expect(await screen.findByTestId('group-order-share-panel')).toBeInTheDocument();
  });

  it('degrades a malformed prefill silently to the standard empty creation state', async () => {
    window.history.replaceState(null, '', '/group-order?items=garbage');
    renderWithIntl(<CreateGroupOrderView />);

    expect(screen.queryByTestId('group-order-prefill-rows')).not.toBeInTheDocument();
    expect(screen.getByTestId('group-order-create-button')).toBeInTheDocument();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders the standard state with no items parameter at all', async () => {
    renderWithIntl(<CreateGroupOrderView />);

    expect(screen.queryByTestId('group-order-prefill-rows')).not.toBeInTheDocument();
    expect(screen.getByTestId('group-order-create-button')).toBeInTheDocument();
  });
});
