'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  ApiFetchError,
  deleteFavorite,
  fetchProductsByIds,
  listFavorites,
} from '@/lib/api';
import { Button, EmptyState, LoadingSkeleton } from '@/components/ui';
import type { Favorite } from '@/lib/types';
import { formatCents } from '../alerts/threshold';

/** Why the initial list load failed; drives the whole-page degradation. */
type LoadFailure = 'signin' | 'forbidden' | 'error' | null;

/** Render an ISO timestamp with the fi-FI conventions used across the account area. */
function formatSavedDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('fi-FI', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
}

/**
 * Δ presentation (design D4): a lower price since saving is the good
 * direction (green), a higher one is the bad direction (red), zero stays
 * in the good class. The sign character rides the value, so color is
 * never the sole carrier of the direction.
 */
function deltaPresentation(deltaCents: number): {
  display: string;
  className: string;
} {
  const amount = `${formatCents(Math.abs(deltaCents))} €`;
  if (deltaCents > 0) {
    return { display: `+${amount}`, className: 'text-red-700' };
  }
  if (deltaCents < 0) {
    return { display: `−${amount}`, className: 'text-green-700' };
  }
  return { display: `±${amount}`, className: 'text-green-700' };
}

/**
 * Account product-favorites view (task 4.2, change add-product-favorites):
 * the saved list with each row's shelf price at save time beside the
 * product's current fresh daily price and the read-time Δ (design D4 —
 * the row semantics the API's read model serves; see {@link Favorite}
 * for the null states).
 *
 * Gating: none — the view renders unconditionally. A 403 from the API
 * degrades the whole view to nothing, so the section never shows dead
 * controls (alerts-page precedent).
 *
 * Auth: paths under /api/v1/account/ ride the httpOnly session cookie via
 * the api helpers, which mint and replay once on the first 401. A 401
 * surfacing here therefore means no usable session could be established
 * and is answered with a sign-in prompt, not a retry loop.
 *
 * @module FavoritesPage
 */
export default function FavoritesPage() {
  const t = useTranslations('Favorites');
  const tCommon = useTranslations('Common');

  const [favorites, setFavorites] = useState<readonly Favorite[]>([]);
  const [productNames, setProductNames] = useState<
    Readonly<Record<number, string>>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure>(null);

  // ── Row-mutation state ──
  const [removingId, setRemovingId] = useState<number | null>(null);
  // The product id whose removal failed most recently — the inline error
  // renders on that row only (degradation, no toast infra to assume).
  const [removeErrorId, setRemoveErrorId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailure(null);
    try {
      const rows = await listFavorites();
      setFavorites(rows);

      // Resolve product names in one request; unresolved ids degrade to
      // the "#id" label (alerts-page row-resolution pattern). A failed
      // name lookup must not discard the list.
      const ids = [...new Set(rows.map((row) => row.productId))];
      if (ids.length > 0) {
        try {
          const search = await fetchProductsByIds(ids);
          const names: Record<number, string> = {};
          for (const item of search.items) {
            names[item.id] = item.name;
          }
          setProductNames(names);
        } catch {
          // Keep previously resolved names; rows fall back to "#id".
        }
      }
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 401) {
        setLoadFailure('signin');
      } else if (err instanceof ApiFetchError && err.status === 403) {
        setLoadFailure('forbidden');
      } else {
        setLoadFailure('error');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = useCallback(async (favorite: Favorite) => {
    setRemovingId(favorite.productId);
    setRemoveErrorId(null);
    try {
      await deleteFavorite(favorite.productId);
      setFavorites((prev) =>
        prev.filter((row) => row.productId !== favorite.productId),
      );
    } catch {
      setRemoveErrorId(favorite.productId);
    } finally {
      setRemovingId(null);
    }
  }, []);

  // ── Hidden state: the API rejected the list read (403) — render
  //    nothing, no dead controls. ──
  if (loadFailure === 'forbidden') {
    return null;
  }

  return (
    <main
      data-testid="favorites-page"
      className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Sign-in prompt (account-scoped 401; sign-in happens on
              /login, design D8) ── */}
      {loadFailure === 'signin' && (
        <section
          data-testid="favorites-signin-prompt"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            {t('signInTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">{t('signInBody')}</p>
          <div className="mt-4">
            <Link
              href="/login"
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('signInLink')}
            </Link>
          </div>
        </section>
      )}

      {/* ── Generic load failure (retry re-runs the same load) ── */}
      {loadFailure === 'error' && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t('loadFailed')}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-3 font-medium underline hover:no-underline"
          >
            {tCommon('retry')}
          </button>
        </div>
      )}

      {/* ── Loading state ── */}
      {loadFailure === null && loading && (
        <section
          aria-busy="true"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <p role="status" className="mb-4 text-sm text-gray-500">
            {t('loading')}
          </p>
          <LoadingSkeleton variant="text" count={3} />
        </section>
      )}

      {!loading && loadFailure === null && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {favorites.length === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              description={t('emptyBody')}
              action={
                <Link
                  href="/products"
                  data-testid="favorites-empty-action"
                  className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  {t('emptyAction')}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {favorites.map((favorite) => {
                const delta =
                  favorite.deltaCents !== null
                    ? deltaPresentation(favorite.deltaCents)
                    : null;
                return (
                  <li
                    key={favorite.id}
                    data-testid="favorite-row"
                    className="py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={{
                            pathname: '/products/[id]',
                            params: { id: favorite.productId },
                          }}
                          data-testid={`favorite-product-link-${favorite.productId}`}
                          className="truncate text-sm font-medium text-gray-900 hover:text-primary-700"
                        >
                          {productNames[favorite.productId] ??
                            t('product', { id: favorite.productId })}
                        </Link>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {favorite.savedPriceCents !== null
                            ? t('savedPrice', {
                                price: formatCents(favorite.savedPriceCents),
                              })
                            : t('noSavedPrice')}
                          {' · '}
                          {favorite.currentPriceCents !== null
                            ? t('currentPrice', {
                                price: formatCents(favorite.currentPriceCents),
                              })
                            : (
                                // Explicit no-fresh-price state (design D4):
                                // a stale or missing summary is a real row
                                // state, never rendered as a zero or blank.
                                <span
                                  data-testid={`favorite-no-fresh-price-${favorite.productId}`}
                                  className="text-gray-400"
                                >
                                  {t('noFreshPrice')}
                                </span>
                              )}
                          {' · '}
                          {t('savedAt', {
                            date: formatSavedDate(favorite.createdAt),
                          })}
                        </p>
                        <p className="mt-1 text-xs">
                          <span className="text-gray-400">
                            {t('deltaLabel')}
                            {': '}
                          </span>
                          {delta !== null ? (
                            <span
                              data-testid={`favorite-delta-${favorite.productId}`}
                              className={`font-medium ${delta.className}`}
                            >
                              {delta.display}
                            </span>
                          ) : (
                            // No delta without BOTH prices (read-model
                            // contract) — an explicit dash, not a zero.
                            <span
                              data-testid={`favorite-delta-${favorite.productId}`}
                              className="text-gray-400"
                            >
                              –
                            </span>
                          )}
                        </p>
                        {removeErrorId === favorite.productId && (
                          <p
                            role="alert"
                            data-testid={`favorite-remove-error-${favorite.productId}`}
                            className="mt-2 text-xs font-medium text-error"
                          >
                            {t('removeFailed')}{' '}
                            <button
                              type="button"
                              onClick={() => setRemoveErrorId(null)}
                              className="font-medium underline hover:no-underline"
                            >
                              {tCommon('dismiss')}
                            </button>
                          </p>
                        )}
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        data-testid={`favorite-remove-${favorite.productId}`}
                        onClick={() => void handleRemove(favorite)}
                        disabled={removingId !== null}
                      >
                        {removingId === favorite.productId
                          ? t('removing')
                          : tCommon('remove')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
