/**
 * NewsletterConfirmPage tests (task 5.4, change
 * trust-and-reach-roadmap).
 *
 * The landing page must answer every token state honestly:
 *   - ACTIVE → confirmed (the endpoint is idempotent, so a fresh
 *     confirmation and an already-active subscriber render the same
 *     state — asserted for both).
 *   - UNSUBSCRIBED → the ended state (an old link does not resurrect
 *     consent).
 *   - 400 → the uniform invalid-token message; a missing token renders
 *     its own message without calling the API.
 *
 * @module NewsletterConfirmPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewsletterConfirmPage from './page';
import fiMessages from '@/messages/fi.json';
import { ApiFetchError, confirmNewsletterSubscription } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    confirmNewsletterSubscription: vi.fn(),
  };
});

// The page links through next-intl navigation, which needs a Next.js
// router context that unit tests do not have (AlertsPage.test.tsx
// precedent).
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

const mockedConfirm = vi.mocked(confirmNewsletterSubscription);

/** jsdom keeps one URL per document — rewrite its query string. */
function setLocationSearch(query: string): void {
  window.history.replaceState(null, '', `/fi/newsletter/confirm${query}`);
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      <NewsletterConfirmPage />
    </NextIntlClientProvider>,
  );
}

function apiError(status: number, message: string) {
  return new ApiFetchError(status, {
    statusCode: status,
    message,
    error: 'InvalidToken',
    timestamp: '2026-09-08T10:00:00.000Z',
    path: '/api/v1/newsletter/confirm',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocationSearch('');
});

describe('NewsletterConfirmPage', () => {
  it('confirms a valid token and renders the active state', async () => {
    setLocationSearch('?token=abc123');
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    renderPage();

    await waitFor(() =>
      expect(mockedConfirm).toHaveBeenCalledWith('abc123'),
    );
    expect(
      await screen.findByText('Tilaus vahvistettu'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-confirm-status')).toHaveTextContent(
      'Uutiskirjeen tilaus on nyt aktiivinen',
    );
  });

  it('renders the same confirmed state for an already-active subscriber', async () => {
    setLocationSearch('?token=abc123');
    // The endpoint answers ACTIVE for a repeat confirmation too — the
    // page must not distinguish (it cannot know, and must not claim to).
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    renderPage();

    expect(
      await screen.findByText('Tilaus vahvistettu'),
    ).toBeInTheDocument();
  });

  it('answers an UNSUBSCRIBED row with the ended state, not a confirmation', async () => {
    setLocationSearch('?token=stale');
    mockedConfirm.mockResolvedValue({ status: 'UNSUBSCRIBED' });

    renderPage();

    expect(
      await screen.findByText('Tilaus on päättynyt'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Tilaus vahvistettu'),
    ).not.toBeInTheDocument();
  });

  it('renders the uniform invalid-token message on a 400', async () => {
    setLocationSearch('?token=bogus');
    mockedConfirm.mockRejectedValue(apiError(400, 'token is invalid or expired'));

    renderPage();

    expect(
      await screen.findByText(
        'Vahvistustunnus on virheellinen tai jo käytetty.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a missing token without calling the API', async () => {
    setLocationSearch('');

    renderPage();

    expect(
      await screen.findByText('Vahvistuslinkistä puuttuu tunnus.'),
    ).toBeInTheDocument();
    expect(mockedConfirm).not.toHaveBeenCalled();
  });
});
