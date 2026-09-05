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
  apiFetch,
  fetchProductsByIds,
  request,
  searchProducts,
} from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { Button, Input } from '@/components/ui';
import type { PriceAlert, ProductSearchItem } from '@/lib/types';
import ProductSearch from '../../calculator/components/ProductSearch';
import ProductSelector from '../../calculator/components/ProductSelector';
import { eurosToCents, formatCents } from './threshold';

/** Why the initial list load failed; drives the whole-page degradation. */
type LoadFailure = 'signin' | 'forbidden' | 'error' | null;

/** Why a create submission failed; each state maps to one i18n message. */
type CreateFailure = 'invalid' | 'duplicate' | 'missing' | 'generic' | null;

/** Which row mutation failed most recently (banner text selection). */
type ActionFailure = 'update' | 'delete' | null;

/** In-flight row mutation, keyed by alert id (per-row button disabling). */
type BusyAction = 'pause' | 'resume' | 'delete';

/** Render an ISO timestamp with the fi-FI conventions used across the account area. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('fi-FI', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/**
 * Account price-alerts management view (task 2.4, change
 * product-roadmap-phases-1-4): list, create, pause/resume, delete.
 *
 * Gating: the whole view renders nothing unless the bootstrapped
 * PRICE_ALERTS flag is on (absent key counts as off). A 403 from the API —
 * the flag having flipped off server-side mid-session — degrades to the
 * same absent UI, so the section never shows dead controls (design R13).
 *
 * Auth: paths under /api/v1/account/ ride the httpOnly session cookie via
 * request(), which mints a session and replays once on the first 401. A
 * 401 surfacing here therefore means no usable session could be
 * established and is answered with a sign-in prompt, not a retry loop.
 *
 * Units: the UI works in euros and converts to integer euro cents at the
 * boundary (see ./threshold) — the API contract stays cents-only.
 *
 * @module AlertsPage
 */
export default function AlertsPage() {
  const t = useTranslations('PriceAlerts');
  const tCommon = useTranslations('Common');
  // Flag state arrives inlined with the initial HTML payload — the
  // visibility is correct on the first render, no late appearance.
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.PRICE_ALERTS === true;

  // ── List state ──
  const [alerts, setAlerts] = useState<readonly PriceAlert[]>([]);
  const [productNames, setProductNames] = useState<
    Readonly<Record<number, string>>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure>(null);

  // ── Create-form state ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selected, setSelected] = useState<ProductSearchItem | null>(null);
  const [threshold, setThreshold] = useState('');
  const [creating, setCreating] = useState(false);
  const [createFailure, setCreateFailure] = useState<CreateFailure>(null);

  // ── Row-mutation state ──
  const [busy, setBusy] = useState<{ id: number; action: BusyAction } | null>(
    null,
  );
  const [actionFailure, setActionFailure] = useState<ActionFailure>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailure(null);
    try {
      const rows = await request<PriceAlert[]>('/api/v1/account/alerts');
      setAlerts(rows);

      // Resolve product names in one request; unresolved ids degrade to
      // the "#id" label. A failed name lookup must not discard the list.
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
    if (!flagEnabled) return;
    void load();
  }, [flagEnabled, load]);

  const handleSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2 || searching) return;
      setSearching(true);
      setSearchFailed(false);
      try {
        const res = await searchProducts(trimmed);
        setResults(res.items);
      } catch {
        setSearchFailed(true);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searching],
  );

  const handleCreate = useCallback(async () => {
    if (selected === null || creating) return;
    const thresholdCents = eurosToCents(threshold);
    if (thresholdCents === null) {
      setCreateFailure('invalid');
      return;
    }
    setCreating(true);
    setCreateFailure(null);
    try {
      const created = await request<PriceAlert>('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({
          productId: selected.id,
          thresholdCents,
        }),
      });
      setAlerts((prev) => [created, ...prev]);
      setProductNames((prev) => ({
        ...prev,
        [created.productId]: selected.name,
      }));
      setSelected(null);
      setQuery('');
      setResults([]);
      setThreshold('');
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 409) {
        setCreateFailure('duplicate');
      } else if (err instanceof ApiFetchError && err.status === 404) {
        setCreateFailure('missing');
      } else {
        setCreateFailure('generic');
      }
    } finally {
      setCreating(false);
    }
  }, [creating, selected, threshold]);

  const handleToggle = useCallback(async (alert: PriceAlert) => {
    const next = alert.status === 'active' ? 'paused' : 'active';
    setBusy({
      id: alert.id,
      action: next === 'paused' ? 'pause' : 'resume',
    });
    setActionFailure(null);
    try {
      const updated = await request<PriceAlert>(
        `/api/v1/account/alerts/${alert.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch {
      setActionFailure('update');
    } finally {
      setBusy(null);
    }
  }, []);

  const handleDelete = useCallback(async (alert: PriceAlert) => {
    setBusy({ id: alert.id, action: 'delete' });
    setActionFailure(null);
    try {
      // The alerts DELETE answers 200 with an EMPTY body; request() would
      // throw parsing it, so this one call uses the shared low-level
      // client (ops-client precedent) and translates the status itself.
      const res = await apiFetch(`/api/v1/account/alerts/${alert.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new ApiFetchError(
          res.status,
          null,
          res.headers.get('x-request-id'),
        );
      }
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch {
      setActionFailure('delete');
    } finally {
      setBusy(null);
    }
  }, []);

  // ── Hidden state: flag off in the inlined payload (or flipped off
  //    server-side mid-session) — render nothing, fetch nothing. ──
  if (!flagEnabled || loadFailure === 'forbidden') {
    return null;
  }

  return (
    <main
      data-testid="price-alerts-page"
      className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Sign-in prompt (401 after the session-mint retry) ── */}
      {loadFailure === 'signin' && (
        <section
          data-testid="alert-signin-prompt"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            {t('signInTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">{t('signInBody')}</p>
          <div className="mt-4">
            <Link
              href="/account/create"
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
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">{t('loading')}</p>
        </section>
      )}

      {!loading && loadFailure === null && (
        <>
          {/* ── Alert list ── */}
          <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            {actionFailure !== null && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {actionFailure === 'update'
                  ? t('updateFailed')
                  : t('deleteFailed')}
                <button
                  type="button"
                  onClick={() => setActionFailure(null)}
                  className="ml-3 font-medium underline hover:no-underline"
                >
                  {tCommon('dismiss')}
                </button>
              </div>
            )}

            {alerts.length === 0 ? (
              <div className="rounded-md bg-gray-50 p-4 text-center text-sm text-gray-500">
                <p className="font-medium">{t('emptyTitle')}</p>
                <p className="mt-1">{t('emptyBody')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {alerts.map((alert) => {
                  const rowBusy =
                    busy?.id === alert.id ? busy.action : null;
                  return (
                    <li
                      key={alert.id}
                      data-testid="price-alert-row"
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {productNames[alert.productId] ??
                            t('product', { id: alert.productId })}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t('thresholdValue', {
                            euros: formatCents(alert.thresholdCents),
                          })}
                          {' · '}
                          <span
                            className={
                              alert.status === 'active'
                                ? 'text-green-700'
                                : 'text-gray-400'
                            }
                          >
                            {alert.status === 'active'
                              ? t('statusActive')
                              : t('statusPaused')}
                          </span>
                        </p>
                        <p className="text-xs text-gray-400">
                          {t('updated', {
                            date: formatTimestamp(alert.updatedAt),
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggle(alert)}
                          disabled={busy !== null}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {rowBusy === 'pause'
                            ? t('pausing')
                            : rowBusy === 'resume'
                              ? t('resuming')
                              : alert.status === 'active'
                                ? t('pause')
                                : t('resume')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(alert)}
                          disabled={busy !== null}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {rowBusy === 'delete' ? t('deleting') : t('delete')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Create form ── */}
          <section
            data-testid="create-alert-form"
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-gray-900">
              {t('createTitle')}
            </h2>

            <div className="mt-4">
              <ProductSearch
                value={query}
                onChange={setQuery}
                onSubmit={handleSearch}
                loading={searching}
                error={searchFailed ? t('searchFailed') : null}
              />
            </div>

            <div className="mt-3">
              <ProductSelector
                items={results}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                loading={searching}
                query={query}
              />
            </div>

            {selected !== null && (
              <div className="mt-4 max-w-xs">
                <p className="mb-2 text-xs text-gray-500">
                  {t('selectedProduct')}
                  {': '}
                  <span className="font-medium text-gray-700">
                    {selected.name}
                  </span>
                </p>
                <Input
                  id="alert-threshold"
                  label={t('thresholdLabel')}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t('thresholdPlaceholder')}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  error={
                    createFailure === 'invalid'
                      ? t('thresholdInvalid')
                      : undefined
                  }
                />
                <div className="mt-3">
                  <Button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={creating || threshold.trim().length === 0}
                  >
                    {creating ? t('creating') : t('createButton')}
                  </Button>
                </div>
              </div>
            )}

            {createFailure === 'duplicate' && (
              <p className="mt-3 text-sm text-red-600">{t('duplicateAlert')}</p>
            )}
            {createFailure === 'missing' && (
              <p className="mt-3 text-sm text-red-600">{t('productMissing')}</p>
            )}
            {createFailure === 'generic' && (
              <p className="mt-3 text-sm text-red-600">{t('createFailed')}</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
