/**
 * @vitest-environment jsdom
 */
/**
 * ValueRanking — the €/g ranking table of the value page (task 7.2).
 *
 * Contract under test: the API's deterministic order renders verbatim,
 * every row carries the standard reliability badge presentation, and the
 * non-happy paths are the designed empty and error states (rows are
 * never invented). The content stance is asserted too: the table renders
 * only factual cells — no editorial copy is baked into the component.
 *
 * Failure honesty (listing-failure-honesty 2.4): each failure class
 * renders its own state — a 403 the age-gate CTA, a 429 the backoff copy,
 * the transient family (timeout/server/network) the established
 * ErrorState — and a failed fetch falls back to the category's persisted
 * last-good response with its as-of label, never to another category's
 * rows and never to a corrupt entry. The success-path assertions are the
 * pre-change ones, unchanged: the fallback work leaves the happy path
 * byte-identical.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ValueRanking from './ValueRanking';
import { renderWithIntl } from '@/lib/testing/test-intl';
import fiMessages from '@/messages/fi.json';
import { ApiFetchError, request } from '@/lib/api';
import type { UnitPriceRankingItem } from '@/lib/types';

// The real API client module stays loaded — the component narrows its
// rejections with `instanceof ApiFetchError` and reads `.failureClass` —
// only `request` is replaced so each test controls the outcome.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: vi.fn() };
});

// The router-aware navigation module does not load under vitest
// (documented repo limitation); stub the Link with the plain-anchor
// double every other suite uses, so the age-gate CTA renders a real <a>.
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

const mockRequest = vi.mocked(request);

/** The component's per-category stale-while-error storage key. */
function cacheKey(category: string) {
  return `rajahinta.value-ranking.${category}`;
}

/**
 * Seed a category's persisted last-good response the way a previous
 * successful fetch would have written it.
 */
function seedCache(
  category: string,
  items: UnitPriceRankingItem[],
  fetchedAt = '2026-01-15T12:34:00.000Z',
) {
  window.localStorage.setItem(
    cacheKey(category),
    JSON.stringify({ response: rankingResponse(items), fetchedAt }),
  );
}

/**
 * Same Finnish provider as renderWithIntl, but returned so the test can
 * rerender with a new category prop while the wrapper (and its messages)
 * stay in place.
 */
function renderRerenderable(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="fi" messages={fiMessages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

const ROWS: UnitPriceRankingItem[] = [
  {
    productId: 1,
    name: 'Nimi A',
    brand: 'Merkki A',
    offerId: 11,
    centsPerGram: 8.9,
    ethanolGrams: 15.8,
    reliabilityStatus: 'VERIFIED',
  },
  {
    productId: 2,
    name: 'Nimi B',
    brand: '',
    offerId: 22,
    centsPerGram: 12.34,
    ethanolGrams: 14,
    reliabilityStatus: 'ESTIMATED',
  },
];

function rankingResponse(items: UnitPriceRankingItem[]) {
  return { category: 'beer', items };
}

beforeEach(() => {
  mockRequest.mockReset();
  // The stale-while-error cache is browser state; isolate every test.
  window.localStorage.clear();
});

describe('ValueRanking', () => {
  it('fetches the ranking endpoint for the given category', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByRole('table');
    // The ranking fetch carries the 10 s timeout signal (design D7).
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/unitprice/ranking?category=beer',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders the API order verbatim with position numbers and values', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    const table = await screen.findByRole('table');
    expect(table).toBeInTheDocument();

    // One row per item, positions 1..n in the served order.
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(ROWS.length + 1); // + header row
    expect(screen.getByText('Nimi A')).toBeInTheDocument();
    expect(screen.getByText('Nimi B')).toBeInTheDocument();
    expect(screen.getByText('Merkki A')).toBeInTheDocument();
    // €/g presentation matches the compare view (toFixed(2) + unit).
    expect(screen.getByText('8.90 snt/g')).toBeInTheDocument();
    expect(screen.getByText('12.34 snt/g')).toBeInTheDocument();
    // Unit agreement (fi-native-copy-pass 3.2): the column header states
    // the same snt/g unit the cells render — the API transports cents per
    // gram, so the rendered figure equals the wire value verbatim.
    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells[2]).toHaveTextContent('Etanolin grammahinta (snt/g)');
    const cellUnitToken = screen
      .getByText('8.90 snt/g')
      .textContent?.trim()
      .split(' ')[1];
    expect(cellUnitToken).toBe('snt/g');
    expect(headerCells[2].textContent).toContain(cellUnitToken ?? '');
    // A missing brand simply renders no brand line — never a placeholder.
    expect(screen.queryByText('Merkki B')).not.toBeInTheDocument();
  });

  it('carries the standard reliability badge per row', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByRole('table');
    // Canonical labels via RELIABILITY_STATUS_META labelKeys (FI catalog).
    const verified = screen.getByText('Vahvistettu');
    const estimated = screen.getByText('Arvioitu');
    expect(verified.closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'verified',
    );
    expect(estimated.closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'estimated',
    );
  });

  it('renders the honest empty state when the category has no rows', async () => {
    mockRequest.mockResolvedValue(rankingResponse([]));
    renderWithIntl(<ValueRanking category="spirits" />);

    const empty = await screen.findByText('Ei näytettäviä rivejä');
    expect(empty).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the error state with a working retry', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button'));
    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('surfaces the error state when the fetch times out, and retry re-issues', async () => {
    // The abort a real 10 s AbortSignal.timeout throws: a TimeoutError
    // DOMException, not a plain Error (design D7).
    mockRequest
      .mockRejectedValueOnce(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      )
      .mockResolvedValueOnce(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // Retry re-issues the same ranking request, timeout signal included.
    await userEvent.setup().click(screen.getByRole('button'));
    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/unitprice/ranking?category=beer',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('re-fetches when the category prop changes', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    const view = renderRerenderable(<ValueRanking category="beer" />);
    await screen.findByRole('table');

    view.rerender(<ValueRanking category="wine_still" />);

    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/unitprice/ranking?category=wine_still',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('ValueRanking failure honesty (listing-failure-honesty 2.4)', () => {
  it('renders the age-gate CTA on 403 with no cache, never the backend-down copy', async () => {
    mockRequest.mockRejectedValue(new ApiFetchError(403, null));
    renderWithIntl(<ValueRanking category="beer" />);

    // The class-distinct state: the age confirmation affordance with the
    // localized link onto /age-gate.
    await screen.findByText('Ikävahvistus tarvitaan');
    const link = screen.getByRole('link', { name: 'Siirry ikävahvistukseen' });
    expect(link).toHaveAttribute('href', '/age-gate');
    // Neither the backend-unavailable copy nor a retry rides a 403 —
    // a missing confirmation is not an outage.
    expect(
      screen.queryByText('Luetteloa ei saatu haettua'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Taustajärjestelmä ei vastannut. Voit yrittää uudelleen.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the cached table with its as-of label above the age CTA on 403', async () => {
    seedCache('beer', ROWS);
    mockRequest.mockRejectedValue(new ApiFetchError(403, null));
    renderWithIntl(<ValueRanking category="beer" />);

    // The persisted last-good rows stand in above the affordance.
    await screen.findByRole('table');
    expect(screen.getByText('Nimi A')).toBeInTheDocument();
    expect(screen.getByText('Nimi B')).toBeInTheDocument();
    // Every cached render carries its visible as-of label — the spec
    // forbids persisted data without one. Year asserted instead of the
    // whole date: the formatted stamp is timezone-dependent.
    const label = screen.getByText(/^Andmatiedoilla /);
    expect(label.textContent).toContain('2026');
    // Label precedes the affordance (as-of above the CTA in the DOM).
    const cta = screen.getByText('Ikävahvistus tarvitaan');
    expect(
      label.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders backoff copy on 429, and retry recovers the table', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiFetchError(429, null))
      .mockResolvedValueOnce(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    // Backoff copy — the surface asks the visitor to retry shortly
    // instead of claiming a backend failure.
    await screen.findByText(
      'Palveluun kohdistuu juuri nyt hyvin paljon pyyntöjä. Yritä uudelleen hetken kuluttua.',
    );
    expect(
      screen.queryByText(
        'Taustajärjestelmä ei vastannut. Voit yrittää uudelleen.',
      ),
    ).not.toBeInTheDocument();

    // The retry affordance re-runs the fetch; recovery renders the table.
    await userEvent.setup().click(screen.getByRole('button'));
    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('renders the transient state with retry on a 500', async () => {
    mockRequest.mockRejectedValue(new ApiFetchError(500, null));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(
      screen.getByText(
        'Taustajärjestelmä ei vastannut. Voit yrittää uudelleen.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the transient state for a network-class ApiFetchError', async () => {
    // The shape transportFailure() produces on a dead wire: status 0,
    // no body, failureClass network.
    mockRequest.mockRejectedValue(
      new ApiFetchError(0, null, null, {
        failureClass: 'network',
        message: 'API request failed: Failed to fetch',
      }),
    );
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(
      screen.getByText(
        'Taustajärjestelmä ei vastannut. Voit yrittää uudelleen.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('treats a corrupt cache entry as no cache on failure', async () => {
    // Not parseable JSON: readCachedRanking() must swallow it — the
    // surface never crashes and never renders a half-entry.
    window.localStorage.setItem(
      cacheKey('beer'),
      '{"response":{"items": broken',
    );
    mockRequest.mockRejectedValue(new ApiFetchError(403, null));
    renderWithIntl(<ValueRanking category="beer" />);

    // The class state renders alone: no rows, no as-of label.
    await screen.findByText('Ikävahvistus tarvitaan');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Andmatiedoilla /)).not.toBeInTheDocument();
  });

  it('never serves another category cache: beer rows do not stand in for a wine_still failure', async () => {
    seedCache('beer', ROWS);
    mockRequest.mockRejectedValue(new ApiFetchError(500, null));
    renderWithIntl(<ValueRanking category="wine_still" />);

    // The category is part of the storage key, so the wine_still failure
    // renders the class state without fabricated rows.
    await screen.findByText('Luetteloa ei saatu haettua');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Nimi A')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Andmatiedoilla /)).not.toBeInTheDocument();
  });

  it('persists a successful response for the stale-while-error fallback', async () => {
    const payload = rankingResponse(ROWS);
    mockRequest.mockResolvedValue(payload);
    renderWithIntl(<ValueRanking category="beer" />);
    await screen.findByRole('table');

    // Every success writes the category's entry: the response verbatim
    // plus a real ISO as-of stamp.
    const raw = window.localStorage.getItem(cacheKey('beer'));
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw as string) as {
      response: typeof payload;
      fetchedAt: string;
    };
    expect(entry.response).toEqual(payload);
    expect(Number.isNaN(new Date(entry.fetchedAt).getTime())).toBe(false);
  });
});
