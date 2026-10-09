/**
 * ProductFavoriteAction (product-page favorite heart) tests (task 4.3,
 * change add-product-favorites).
 *
 * Verifies the phase ladder and the two flows the spec names:
 *   1. Mount-time membership check — hidden while in flight, active/
 *      inactive heart per list membership, 401 → signed-out heart (no
 *      dead controls), 403 → nothing, other failures → error + retry.
 *   2. Signed-out funnel — tap holds the pending productId and opens
 *      the login modal; a successful sign-in completes the create and
 *      presses the heart; closing the modal discards the intent.
 *   3. Signed-in toggle — optimistic flip reconciled with a list
 *      refetch (design D6); failed creates/deletes (including a 404
 *      delete) revert the flip and surface the inline error; a 409
 *      create re-reads instead of erroring.
 *
 * The `Favorites` namespace lands with task 5.1, so next-intl is
 * partially stubbed: `Favorites` resolves from an in-test table with
 * the final Finnish copy, every other namespace delegates to the real
 * provider (LoginModal/LoginForm/Common render their catalog strings).
 *
 * @module ProductFavoriteActionTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductFavoriteAction from './ProductFavoriteAction';
import { renderWithIntl } from '@/lib/testing/test-intl';
import {
  ApiFetchError,
  createFavorite,
  deleteFavorite,
  listFavorites,
  loginAccount,
} from '@/lib/api';
import type { ApiError, Favorite } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    listFavorites: vi.fn(),
    createFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    loginAccount: vi.fn(),
  };
});

// Task 5.1 will add the Favorites namespace to the catalogs; until then
// the component's keys resolve from this table (final Finnish copy),
// while all real namespaces go through the genuine next-intl binding.
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const favoritesCopy: Record<string, string> = {
    productHeading: 'Suosikki',
    addLabel: 'Lisää suosikkeihin',
    removeLabel: 'Poista suosikeista',
    addingLabel: 'Lisätään…',
    removingLabel: 'Poistetaan…',
    signInHint: 'Kirjaudu sisään tallentaaksesi tuotteen suosikkeihin.',
    actionFailed: 'Suosikin päivittäminen epäonnistui. Yritä uudelleen.',
    loadFailed: 'Suosikkien tilaa ei voitu ladata.',
  };
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      if (namespace !== 'Favorites') return actual.useTranslations(namespace);
      return (key: string) => favoritesCopy[key] ?? `Favorites.${key}`;
    },
  };
});

const mockedList = vi.mocked(listFavorites);
const mockedCreate = vi.mocked(createFavorite);
const mockedDelete = vi.mocked(deleteFavorite);
const mockedLogin = vi.mocked(loginAccount);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, message: string): ApiError {
  return {
    statusCode: status,
    message,
    error: 'Error',
    timestamp: '2026-10-01T10:00:00.000Z',
    path: '/api/v1/account/favorites',
  };
}

const PRODUCT_ID = 42;

function favorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: 7,
    productId: PRODUCT_ID,
    savedPriceCents: 1999,
    currentPriceCents: 1899,
    deltaCents: -100,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const SESSION = {
  userId: '11111111-2222-4333-8444-555555555555',
  expiresAt: '2026-10-27T00:00:00.000Z',
  verified: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default signed-in account with no favorites.
  mockedList.mockResolvedValue([]);
  mockedCreate.mockResolvedValue(favorite());
  mockedDelete.mockResolvedValue(undefined);
  mockedLogin.mockResolvedValue(SESSION);
});

// ---------------------------------------------------------------------------
// Mount-time membership check (the phase ladder)
// ---------------------------------------------------------------------------

describe('ProductFavoriteAction membership check', () => {
  it('renders nothing while the membership check is in flight', () => {
    mockedList.mockReturnValue(new Promise<Favorite[]>(() => {}));

    const { container } = renderWithIntl(
      <ProductFavoriteAction productId={PRODUCT_ID} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders an inactive heart for a signed-in account without the favorite', async () => {
    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);

    const heart = await screen.findByTestId('product-favorite-toggle');
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    expect(heart).toHaveAccessibleName('Lisää suosikkeihin');
  });

  it('renders an active heart when the product is already favorited', async () => {
    mockedList.mockResolvedValue([favorite()]);

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);

    const heart = await screen.findByTestId('product-favorite-toggle');
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(heart).toHaveAccessibleName('Poista suosikeista');
  });

  it('keeps the heart up untoggled on 401 (signed-out) with the sign-in hint', async () => {
    mockedList.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);

    const heart = await screen.findByTestId('product-favorite-toggle');
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText('Kirjaudu sisään tallentaaksesi tuotteen suosikkeihin.'),
    ).toBeInTheDocument();
    // The signed-out state is a funnel entry, not a dead end: no retry.
    expect(
      screen.queryByTestId('product-favorite-load-error'),
    ).not.toBeInTheDocument();
  });

  it('degrades to nothing when the API rejects the list read (403)', async () => {
    mockedList.mockRejectedValue(
      new ApiFetchError(403, apiError(403, 'Forbidden')),
    );

    const { container } = renderWithIntl(
      <ProductFavoriteAction productId={PRODUCT_ID} />,
    );

    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('shows the error prompt on a read failure and recovers via retry', async () => {
    const user = userEvent.setup();
    mockedList.mockRejectedValueOnce(
      new ApiFetchError(500, apiError(500, 'boom')),
    );

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);

    const failure = await screen.findByTestId('product-favorite-load-error');
    expect(failure).toHaveTextContent('Suosikkien tilaa ei voitu ladata.');
    expect(failure).toHaveTextContent('Yritä uudelleen');
    expect(
      screen.queryByTestId('product-favorite-toggle'),
    ).not.toBeInTheDocument();

    // Retry re-reads with a passing mock.
    mockedList.mockResolvedValue([favorite()]);
    await user.click(screen.getByRole('button', { name: 'Yritä uudelleen' }));

    const heart = await screen.findByTestId('product-favorite-toggle');
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByTestId('product-favorite-load-error'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Signed-out funnel through the login modal
// ---------------------------------------------------------------------------

describe('ProductFavoriteAction signed-out funnel', () => {
  /** Mount signed-out: first read 401s (session-mint retry exhausted). */
  function renderSignedOut(): void {
    mockedList.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );
    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);
  }

  it('opens the login modal on tap and holds the create', async () => {
    const user = userEvent.setup();
    renderSignedOut();

    await user.click(await screen.findByTestId('product-favorite-toggle'));

    expect(screen.getByRole('dialog', { name: 'Kirjaudu sisään' }))
      .toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('completes the pending favorite after a successful modal sign-in', async () => {
    const user = userEvent.setup();
    // Mount read 401s; the reconcile refetch after the create finds the
    // row the API just stored.
    let reads = 0;
    mockedList.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) {
        throw new ApiFetchError(401, apiError(401, 'no session'));
      }
      return [favorite()];
    });

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);

    await user.click(await screen.findByTestId('product-favorite-toggle'));
    await user.type(
      screen.getByLabelText('Sähköpostiosoite'),
      'kayttaja@example.fi',
    );
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('login-submit'));

    // The held productId completes the create without further action.
    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(PRODUCT_ID),
    );
    expect(await screen.findByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves the heart unchanged when the modal closes without success', async () => {
    const user = userEvent.setup();
    renderSignedOut();

    await user.click(await screen.findByTestId('product-favorite-toggle'));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

// ---------------------------------------------------------------------------
// Signed-in optimistic toggle with refetch reconcile (design D6)
// ---------------------------------------------------------------------------

describe('ProductFavoriteAction toggle', () => {
  it('flips on optimistically, creates, and reconciles with a refetch', async () => {
    const user = userEvent.setup();
    // Mount read finds nothing; the reconcile refetch then sees the row
    // the API just stored — server truth after the optimistic flip.
    let reads = 0;
    mockedList.mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? [] : [favorite()];
    });
    // The create stays in flight so the optimistic flip is observable.
    let resolveCreate!: (row: Favorite) => void;
    mockedCreate.mockImplementation(
      () =>
        new Promise<Favorite>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);
    await user.click(await screen.findByTestId('product-favorite-toggle'));

    // Optimistic state lands before the mutation resolves.
    expect(screen.getByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(mockedCreate).toHaveBeenCalledWith(PRODUCT_ID);
    expect(mockedList).toHaveBeenCalledTimes(1);

    resolveCreate(favorite());
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('flips off optimistically, deletes, and reconciles with a refetch', async () => {
    const user = userEvent.setup();
    // Mount read finds the row; the post-delete reconcile then sees it
    // gone — server truth after the optimistic flip.
    let reads = 0;
    mockedList.mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? [favorite()] : [];
    });

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);
    await user.click(await screen.findByTestId('product-favorite-toggle'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith(PRODUCT_ID),
    );
    // The reconcile refetch runs the membership to [] — heart stays
    // inactive with no error.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.queryByTestId('product-favorite-error'),
    ).not.toBeInTheDocument();
  });

  it('reverts the flip and shows the inline error when the create fails', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValue(
      new ApiFetchError(400, apiError(400, 'cap reached')),
    );

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);
    await user.click(await screen.findByTestId('product-favorite-toggle'));

    const failure = await screen.findByTestId('product-favorite-error');
    expect(failure).toHaveTextContent(
      'Suosikin päivittäminen epäonnistui. Yritä uudelleen.',
    );
    expect(screen.getByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('re-reads instead of erroring when the create answers 409', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValue(
      new ApiFetchError(409, apiError(409, 'exists')),
    );
    // Mount read finds nothing; the post-409 reconcile finds the row the
    // other tab stored.
    let reads = 0;
    mockedList.mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? [] : [favorite()];
    });

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);
    await user.click(await screen.findByTestId('product-favorite-toggle'));

    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.queryByTestId('product-favorite-error'),
    ).not.toBeInTheDocument();
  });

  it('reverts the flip and shows the inline error when the delete fails (404)', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue([favorite()]);
    mockedDelete.mockRejectedValue(
      new ApiFetchError(404, apiError(404, 'not found')),
    );

    renderWithIntl(<ProductFavoriteAction productId={PRODUCT_ID} />);
    await user.click(await screen.findByTestId('product-favorite-toggle'));

    const failure = await screen.findByTestId('product-favorite-error');
    expect(failure).toHaveTextContent(
      'Suosikin päivittäminen epäonnistui. Yritä uudelleen.',
    );
    expect(screen.getByTestId('product-favorite-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
