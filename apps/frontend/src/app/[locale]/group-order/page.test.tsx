/**
 * Group order create/manage entry tests (task 9.4, change
 * product-roadmap-phases-1-4).
 *
 * Pins the 9.3 contract wiring and the gating states:
 *   1. GROUP_ORDER_LEDGER off (absent key or explicit false) → renders
 *      nothing on the FIRST render and never fires the create request.
 *   2. Flag on → create → POST /api/v1/group-orders (no body fields —
 *      the owner and the 7-day TTL are server-derived) → the shareable
 *      link panel with the expiry date.
 *   3. 401 → the sign-in prompt (create is owner-authenticated; no
 *      retry loop), linking to /account/create like the alerts view.
 *   4. 403 (flag flipped off server-side mid-session) → renders nothing.
 *
 * @module GroupOrderCreatePageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateGroupOrderView from './create-view';
import {
  ALL_FLAGS_OFF,
  renderWithIntl,
} from '@/lib/testing/test-intl';
import { ApiFetchError, request } from '@/lib/api';
import type { CreateSessionResponse } from './api';
import type { ApiError, FeatureFlagsResponse } from '@/lib/types';

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

const FLAGS_ON: FeatureFlagsResponse = {
  flags: { ...ALL_FLAGS_OFF.flags, GROUP_ORDER_LEDGER: true },
};

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

describe('CreateGroupOrderView', () => {
  it('renders nothing when the flag is absent (absent = off) and never requests', () => {
    const { container } = renderWithIntl(<CreateGroupOrderView />, {
      featureFlags: ALL_FLAGS_OFF,
    });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('group-order-create-page')).not.toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders nothing when the flag is explicitly false', () => {
    const { container } = renderWithIntl(<CreateGroupOrderView />, {
      featureFlags: {
        flags: { ...ALL_FLAGS_OFF.flags, GROUP_ORDER_LEDGER: false },
      },
    });
    expect(container.firstChild).toBeNull();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('create → POST /api/v1/group-orders without body fields, then the share-link panel with the expiry', async () => {
    const user = userEvent.setup();
    mockedRequest.mockResolvedValue(CREATED);

    renderWithIntl(<CreateGroupOrderView />, { featureFlags: FLAGS_ON });

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

    renderWithIntl(<CreateGroupOrderView />, { featureFlags: FLAGS_ON });

    await user.click(screen.getByTestId('group-order-create-button'));

    const prompt = await screen.findByTestId('group-order-signin-prompt');
    expect(prompt).toHaveTextContent('Kirjautuminen vaaditaan');
    const link = prompt.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/account/create');
    expect(screen.queryByTestId('group-order-share-panel')).not.toBeInTheDocument();
  });

  it('403 (flag flipped off server-side) → renders nothing', async () => {
    const user = userEvent.setup();
    mockedRequest.mockRejectedValue(
      new ApiFetchError(403, apiError(403, 'Feature disabled', 'FeatureDisabled')),
    );

    const { container } = renderWithIntl(<CreateGroupOrderView />, {
      featureFlags: FLAGS_ON,
    });

    await user.click(screen.getByTestId('group-order-create-button'));

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
