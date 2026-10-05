/**
 * NewsletterConfirmPage tests (task 5.4, change
 * trust-and-reach-roadmap; fi-locale-surface-hardening task 2.7).
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
 * The /blog link is the server shell's decision (design D4, footer's
 * condition): it renders only when the request locale has published
 * posts, and a failed index fetch hides it — a new subscriber's first
 * click must never land on a 404. The REAL async server component is
 * rendered the way Next's RSC runtime would (blog-pages.test.tsx
 * precedent); only Next plumbing and the API boundary are mocked.
 *
 * @module NewsletterConfirmPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewsletterConfirmPage from './page';
import fiMessages from '@/messages/fi.json';
import { ApiFetchError, confirmNewsletterSubscription, request } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    confirmNewsletterSubscription: vi.fn(),
    request: vi.fn(),
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
const mockedRequest = vi.mocked(request);

/** Minimal valid index item — must pass blog.server's isIndexItem guard. */
const PUBLISHED_POST = {
  slug: 'veromuutos-2026-2',
  locale: 'fi',
  title: 'Veromuutus 2026-2',
  rateDatasetVersion: '2026-2',
  publishedAt: '2026-09-01T09:00:00.000Z',
};

/** jsdom keeps one URL per document — rewrite its query string. */
function setLocationSearch(query: string): void {
  window.history.replaceState(null, '', `/fi/newsletter/confirm${query}`);
}

/**
 * Awaits the real server shell (its blog-index decision resolves before
 * render), then mounts the returned client view under the intl context
 * the route layout provides in the app.
 */
/** Awaits the real server shell, then mounts its element tree. */
async function renderPage(locale: string = 'fi') {
  const element = await NewsletterConfirmPage({
    params: Promise.resolve({ locale }),
  });
  return render(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      {element}
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
  // -- Blog-link gating (fi-locale-surface-hardening task 2.7, D4) ------

  it('shows the blog link when the locale has published posts', async () => {
    setLocationSearch('?token=abc123');
    mockedRequest.mockResolvedValue({ items: [PUBLISHED_POST], total: 1 });
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    await renderPage('fi');

    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/blog/posts?locale=fi',
      expect.anything(),
    );
    expect(await screen.findByText('Tilaus vahvistettu')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Blogiin' });
    expect(link).toHaveAttribute('href', '/blog');
  });

  it('hides the blog link when nothing is published in the locale', async () => {
    setLocationSearch('?token=abc123');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    await renderPage('fi');

    // The confirmation itself still renders — only the dead link goes.
    expect(await screen.findByText('Tilaus vahvistettu')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Blogiin' })).not.toBeInTheDocument();
  });

  it('hides the blog link when the index fetch fails', async () => {
    setLocationSearch('?token=abc123');
    // A fetch failure is not evidence of zero posts — the honest
    // default still hides the link (footer precedent).
    mockedRequest.mockRejectedValue(new Error('backend down'));
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    await renderPage('fi');

    expect(await screen.findByText('Tilaus vahvistettu')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Blogiin' })).not.toBeInTheDocument();
  });

  it('fetches the blog index for the secondary locale too', async () => {
    setLocationSearch('?token=abc123');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    await renderPage('en');

    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/blog/posts?locale=en',
      expect.anything(),
    );
  });

  // -- Token outcomes (trust-and-reach-roadmap task 5.4, unchanged) ------

  it('confirms a valid token and renders the active state', async () => {
    setLocationSearch('?token=abc123');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    await renderPage();

    await screen.findByText('Tilaus vahvistettu');
    expect(screen.getByTestId('newsletter-confirm-status')).toHaveTextContent(
      'Uutiskirjeen tilaus on nyt aktiivinen',
    );
  });

  it('renders the same confirmed state for an already-active subscriber', async () => {
    setLocationSearch('?token=abc123');
    // The endpoint answers ACTIVE for a repeat confirmation too — the
    // page must not distinguish (it cannot know, and must not claim to).
    mockedRequest.mockResolvedValue({ items: [], total: 0 });
    mockedConfirm.mockResolvedValue({ status: 'ACTIVE' });

    await renderPage();

    expect(
      await screen.findByText('Tilaus vahvistettu'),
    ).toBeInTheDocument();
  });

  it('answers an UNSUBSCRIBED row with the ended state, not a confirmation', async () => {
    setLocationSearch('?token=stale');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });
    mockedConfirm.mockResolvedValue({ status: 'UNSUBSCRIBED' });

    await renderPage();

    expect(
      await screen.findByText('Tilaus on päättynyt'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Tilaus vahvistettu'),
    ).not.toBeInTheDocument();
  });

  it('renders the uniform invalid-token message on a 400', async () => {
    setLocationSearch('?token=bogus');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });
    mockedConfirm.mockRejectedValue(apiError(400, 'token is invalid or expired'));

    await renderPage();

    expect(
      await screen.findByText(
        'Vahvistustunnus on virheellinen tai jo käytetty.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a missing token without calling the API', async () => {
    setLocationSearch('');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });

    await renderPage();

    expect(
      await screen.findByText('Vahvistuslinkistä puuttuu tunnus.'),
    ).toBeInTheDocument();
    expect(mockedConfirm).not.toHaveBeenCalled();
  });
});
