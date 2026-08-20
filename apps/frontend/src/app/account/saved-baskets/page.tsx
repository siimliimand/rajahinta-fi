'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSessionUserId, request } from '../../../lib/api';
import type { Basket } from '../../../lib/types';

/**
 * Saved baskets page.
 *
 * Lists the current session's saved baskets with delete support.
 * Uses the anonymous session ID (x-user-id header) to identify the user.
 *
 * @module SavedBasketsPage
 */
export default function SavedBasketsPage() {
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchBaskets = useCallback(async () => {
    setError(null);
    try {
      // getSessionUserId ensures the session cookie exists so the
      // x-user-id header injected by request() will be recognised
      getSessionUserId();
      const data = await request<Basket[]>('/api/v1/account/baskets');
      setBaskets(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load saved baskets',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBaskets();
  }, [fetchBaskets]);

  const handleDelete = useCallback(
    async (basketId: string) => {
      setDeleting(basketId);
      try {
        await request<void>(`/api/v1/account/baskets/${basketId}`, {
          method: 'DELETE',
        });
        setBaskets((prev) => prev.filter((b) => b.id !== basketId));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to delete basket',
        );
      } finally {
        setDeleting(null);
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6">
        <Link
          href="/account"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; My account
        </Link>
      </nav>

      <h1 className="mb-1 text-2xl font-bold text-primary-700">Saved baskets</h1>
      <p className="mb-8 text-sm text-gray-500">
        Save product selections to quickly re-run landed-cost calculations.
      </p>

      {/* ── Error banner ── */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 font-medium underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Loading saved baskets…</p>
        </section>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && baskets.length === 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            No saved baskets yet
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Use the calculator to save product selections. Saved baskets
            appear here for quick re-calculation.
          </p>
          <div className="mt-4">
            <Link
              href="/calculator"
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Go to calculator
            </Link>
          </div>
        </section>
      )}

      {/* ── Basket list ── */}
      {!loading && baskets.length > 0 && (
        <ul className="space-y-4">
          {baskets.map((basket) => (
            <li
              key={basket.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {basket.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Created{' '}
                    {new Date(basket.createdAt).toLocaleDateString('fi-FI', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    {' · '}
                    {basket.items.length}{' '}
                    {basket.items.length === 1 ? 'item' : 'items'}
                  </p>

                  {/* Basket items */}
                  <ul className="mt-3 space-y-1">
                    {basket.items.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 text-sm text-gray-600"
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-xs font-medium text-primary-700">
                          {item.quantity}
                        </span>
                        <span className="truncate">{item.productName}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => handleDelete(basket.id)}
                  disabled={deleting === basket.id}
                  className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting === basket.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}