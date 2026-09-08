/**
 * NewsletterUnsubscribePage tests (task 5.4, change
 * trust-and-reach-roadmap). One click ends the subscription: the API's
 * uniform UNSUBSCRIBED answer renders the ended state (fresh and
 * repeat clicks alike), a 400 renders the invalid-token message, and a
 * missing token never reaches the API.
 *
 * @module NewsletterUnsubscribePageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewsletterUnsubscribePage from './page';
import fiMessages from '@/messages/fi.json';
import { ApiFetchError, unsubscribeNewsletter } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    unsubscribeNewsletter: vi.fn(),
  };
});

// The page links through next-intl navigation, which needs a Next.js
// router context that unit tests do not have (AlertsPage.test.tsx
// precedent).
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

const mockedUnsubscribe = vi.mocked(unsubscribeNewsletter);

function setLocationSearch(query: string): void {
  window.history.replaceState(null, '', `/fi/newsletter/unsubscribe${query}`);
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      <NewsletterUnsubscribePage />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocationSearch('');
});

describe('NewsletterUnsubscribePage', () => {
  it('forwards the token and renders the immediate ended state', async () => {
    setLocationSearch('?token=deadbeef64');
    mockedUnsubscribe.mockResolvedValue({ status: 'UNSUBSCRIBED' });

    renderPage();

    await waitFor(() =>
      expect(mockedUnsubscribe).toHaveBeenCalledWith('deadbeef64'),
    );
    expect(await screen.findByText('Tilaus peruutettu')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-unsubscribe-status')).toHaveTextContent(
      'poistettu uutiskirjeen tilaajista välittömästi',
    );
  });

  it('renders the invalid-token message on a 400', async () => {
    setLocationSearch('?token=bogus');
    mockedUnsubscribe.mockRejectedValue(
      new ApiFetchError(400, {
        statusCode: 400,
        message: 'token is invalid or expired',
        error: 'InvalidToken',
        timestamp: '2026-09-08T10:00:00.000Z',
        path: '/api/v1/newsletter/unsubscribe',
      }),
    );

    renderPage();

    expect(
      await screen.findByText('Peruutustunnus on virheellinen.'),
    ).toBeInTheDocument();
  });

  it('reports a missing token without calling the API', async () => {
    setLocationSearch('');

    renderPage();

    expect(
      await screen.findByText('Peruutuslinkistä puuttuu tunnus.'),
    ).toBeInTheDocument();
    expect(mockedUnsubscribe).not.toHaveBeenCalled();
  });
});
