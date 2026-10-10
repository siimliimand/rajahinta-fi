/**
 * FavoritesPage (account product favorites) tests (task 4.2, change
 * add-product-favorites).
 *
 * Verifies the page semantics against the read model (design D4):
 *   1. List render: resolved product names (fetchProductsByIds, alerts-page
 *      row-resolution pattern), saved price, current price, and the Δ
 *      column in all three states — down (green), up (red), no fresh
 *      current price (explicit state, delta dash).
 *   2. Remove flow: deleteFavorite by productId, row leaves the list;
 *      failure degrades to an inline row error, the row stays.
 *   3. Empty state via the EmptyState primitive.
 *   4. 401 → sign-in prompt; generic failure → retry banner; 403 → the
 *      view degrades to nothing.
 *
 * Translation harness: the `Favorites` catalog namespace ships with task
 * 5.1 (messages/*.json are that task's files), so this suite providers an
 * ad-hoc Finnish fixture namespace over the real catalog — the same
 * NextIntlClientProvider pattern the ranking/value page tests use — and
 * asserts that fixture copy. `Common` resolves from the real fi catalog
 * (Poista / Sulje / Yritä uudelleen). Once 5.1 lands, the fixture
 * namespace shadows the real one and the assertions stay deterministic.
 *
 * @module FavoritesPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FavoritesPage from './page';
import fiMessages from '@/messages/fi.json';
import {
  ApiFetchError,
  deleteFavorite,
  fetchProductsByIds,
  listFavorites,
} from '@/lib/api';
import type { ApiError, Favorite, ProductSearchResult } from '@/lib/types';

// The page links through next-intl navigation, which needs a Next.js
// router context that unit tests do not have (alerts-page test
// precedent); the stub flattens the typed object href so product links
// are assertable as plain anchors.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: {
    href?: string | { pathname: string; params?: Record<string, unknown> };
  } & Record<string, unknown>) => {
    const { href, ...rest } = props;
    const target =
      typeof href === 'string'
        ? href
        : href?.pathname.replace(/\[id\]/, String(href?.params?.id ?? ''));
    return React.createElement('a', { ...rest, href: target });
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    listFavorites: vi.fn(),
    deleteFavorite: vi.fn(),
    fetchProductsByIds: vi.fn(),
  };
});

const mockedListFavorites = vi.mocked(listFavorites);
const mockedDeleteFavorite = vi.mocked(deleteFavorite);
const mockedFetchProductsByIds = vi.mocked(fetchProductsByIds);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Ad-hoc `Favorites` namespace until task 5.1 lands the catalog copy. */
const FAVORITES_MESSAGES = {
  title: 'Suosikit',
  subtitle: 'Tallentamasi tuotteet ja hintojen muutos tallennuksen jälkeen.',
  loading: 'Ladataan suosikkeja…',
  loadFailed: 'Suosikkien lataaminen epäonnistui.',
  signInTitle: 'Kirjautuminen vaaditaan',
  signInBody: 'Kirjaudu sisään nähdäksesi tallentamasi tuotteet.',
  signInLink: 'Kirjaudu sisään',
  emptyTitle: 'Ei vielä suosikkeja',
  emptyBody: 'Seuramasi tuotteet näkyvät täällä.',
  emptyAction: 'Selaa tuotteita',
  product: 'Tuote #{id}',
  savedPrice: 'Tallennushinta {price} €',
  noSavedPrice: 'Tallennushintaa ei tiedetty',
  currentPrice: 'Nykyhinta {price} €',
  noFreshPrice: 'Ei tuoretta hintaa',
  savedAt: 'Tallennettu {date}',
  deltaLabel: 'Muutos',
  removing: 'Poistetaan…',
  removeFailed: 'Poistaminen epäonnistui.',
};

function apiError(status: number, message: string): ApiError {
  return {
    statusCode: status,
    message,
    error: 'Error',
    timestamp: '2026-10-08T10:00:00.000Z',
    path: '/api/v1/account/favorites',
  };
}

function favorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: 1,
    productId: 42,
    savedPriceCents: 1000,
    currentPriceCents: 900,
    deltaCents: -100,
    createdAt: '2026-08-01T12:00:00.000Z',
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

function searchResult(items: typeof SEARCH_ITEM[]): ProductSearchResult {
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1 };
}

function renderPage() {
  return render(
    <NextIntlClientProvider
      locale="fi"
      messages={{ ...fiMessages, Favorites: FAVORITES_MESSAGES }}
    >
      <FavoritesPage />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListFavorites.mockResolvedValue([]);
  mockedDeleteFavorite.mockResolvedValue(undefined);
  mockedFetchProductsByIds.mockResolvedValue(searchResult([]));
});

// ---------------------------------------------------------------------------
// List rendering (Δ column in all three states)
// ---------------------------------------------------------------------------

describe('FavoritesPage list render', () => {
  it('renders rows with resolved names, prices, and the Δ states', async () => {
    mockedListFavorites.mockResolvedValue([
      favorite(), // down 1.00 € → green
      favorite({
        id: 2,
        productId: 43,
        savedPriceCents: 500,
        currentPriceCents: 625,
        deltaCents: 125, // up 1.25 € → red
      }),
      favorite({
        id: 3,
        productId: 44,
        savedPriceCents: 800,
        currentPriceCents: null, // no fresh summary → explicit state
        deltaCents: null,
      }),
    ]);
    mockedFetchProductsByIds.mockResolvedValue(
      searchResult([
        SEARCH_ITEM,
        { ...SEARCH_ITEM, id: 43, name: 'Tee 100 g' },
        // 44 unresolved → "#44" label fallback
      ]),
    );

    renderPage();

    const rows = await screen.findAllByTestId('favorite-row');
    expect(rows).toHaveLength(3);
    expect(mockedFetchProductsByIds).toHaveBeenCalledWith([42, 43, 44]);

    // Names resolve; the unresolved id degrades to the "#id" label.
    expect(within(rows[0]).getByTestId('favorite-product-link-42')).toHaveTextContent(
      'Kahvi 500 g',
    );
    expect(within(rows[1]).getByTestId('favorite-product-link-43')).toHaveTextContent(
      'Tee 100 g',
    );
    expect(within(rows[2]).getByTestId('favorite-product-link-44')).toHaveTextContent(
      'Tuote #44',
    );

    // Product links point at the product pages.
    expect(within(rows[0]).getByTestId('favorite-product-link-42')).toHaveAttribute(
      'href',
      '/products/42',
    );

    // Down delta: signed value, green (the good direction).
    const down = within(rows[0]).getByTestId('favorite-delta-42');
    expect(down).toHaveTextContent('−1.00 €');
    expect(down.className).toContain('text-green-700');

    // Up delta: signed value, red.
    const up = within(rows[1]).getByTestId('favorite-delta-43');
    expect(up).toHaveTextContent('+1.25 €');
    expect(up.className).toContain('text-red-700');

    // No fresh current price: the explicit state, and the Δ is a dash —
    // never a fabricated zero.
    expect(
      within(rows[2]).getByTestId('favorite-no-fresh-price-44'),
    ).toHaveTextContent('Ei tuoretta hintaa');
    expect(within(rows[2]).getByTestId('favorite-delta-44')).toHaveTextContent('–');
    expect(rows[2]).toHaveTextContent('Tallennushinta 8.00 €');
  });
});

// ---------------------------------------------------------------------------
// Remove flow
// ---------------------------------------------------------------------------

describe('FavoritesPage remove flow', () => {
  it('removes a row via deleteFavorite and drops it from the list', async () => {
    const user = userEvent.setup();
    mockedListFavorites.mockResolvedValue([
      favorite(),
      favorite({ id: 2, productId: 43 }),
    ]);

    renderPage();

    const rows = await screen.findAllByTestId('favorite-row');
    await user.click(
      within(rows[0]).getByRole('button', { name: 'Poista' }),
    );

    await waitFor(() =>
      expect(mockedDeleteFavorite).toHaveBeenCalledWith(42),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('favorite-row')).toHaveLength(1),
    );
    // The surviving row is the untouched one.
    expect(
      screen.getByTestId('favorite-product-link-43'),
    ).toBeInTheDocument();
  });

  it('degrades to an inline row error when removal fails', async () => {
    const user = userEvent.setup();
    mockedDeleteFavorite.mockRejectedValue(
      new ApiFetchError(404, apiError(404, 'not found')),
    );
    mockedListFavorites.mockResolvedValue([favorite()]);

    renderPage();

    const row = await screen.findByTestId('favorite-row');
    await user.click(within(row).getByRole('button', { name: 'Poista' }));

    const error = await screen.findByTestId('favorite-remove-error-42');
    expect(error).toHaveTextContent('Poistaminen epäonnistui.');
    // The row stays — a failed removal must not drop it locally.
    expect(screen.getByTestId('favorite-row')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('FavoritesPage empty state', () => {
  it('renders the EmptyState primitive with a browse-products action', async () => {
    renderPage();

    const emptyTitle = await screen.findByText('Ei vielä suosikkeja');
    expect(emptyTitle.closest('[data-state="empty"]')).toBeInTheDocument();
    expect(screen.getByTestId('favorites-empty-action')).toHaveAttribute(
      'href',
      '/products',
    );
    expect(screen.queryByTestId('favorite-row')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Whole-page degradation ladder
// ---------------------------------------------------------------------------

describe('FavoritesPage degradation', () => {
  it('prompts sign-in on 401', async () => {
    mockedListFavorites.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderPage();

    const prompt = await screen.findByTestId('favorites-signin-prompt');
    expect(prompt).toHaveTextContent('Kirjautuminen vaaditaan');
    expect(screen.getByRole('link', { name: 'Kirjaudu sisään' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('degrades to nothing when the API rejects the list read (403)', async () => {
    mockedListFavorites.mockRejectedValue(
      new ApiFetchError(403, apiError(403, 'Forbidden')),
    );

    const { container } = renderPage();

    await waitFor(() => expect(mockedListFavorites).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('offers retry on a generic load failure and reloads on click', async () => {
    const user = userEvent.setup();
    mockedListFavorites
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([favorite()]);

    renderPage();

    expect(
      await screen.findByText('Suosikkien lataaminen epäonnistui.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yritä uudelleen' }));

    expect(await screen.findByTestId('favorite-row')).toBeInTheDocument();
    expect(mockedListFavorites).toHaveBeenCalledTimes(2);
  });
});
