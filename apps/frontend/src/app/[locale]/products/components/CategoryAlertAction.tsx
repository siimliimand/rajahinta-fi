'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiFetchError, apiFetch, request } from '@/lib/api';
import { Button, Input } from '@/components/ui';
import type { PriceAlert } from '@/lib/types';
import { eurosToCents, formatCents } from '@/app/[locale]/account/alerts/threshold';

/** Whole-panel state after (or during) the existence check. */
type Phase = 'loading' | 'create' | 'manage';

/** Why the existence check failed; drives the whole-panel degradation. */
type LoadFailure = 'signin' | 'forbidden' | 'error' | null;

/** In-flight row mutation (button labels + disabling). */
type BusyAction = 'pause' | 'resume' | 'delete';

interface CategoryAlertActionProps {
  /** The browsed page's canonical category (the watch target). */
  readonly category: string;
  /** The page's localized label for the category, resolved server-side. */
  readonly categoryLabel: string;
}

/**
 * Category-browse set-alert entry (task 5.1, change
 * expand-alerts-accuracy-breakdowns): the CATEGORY kind of the product
 * page's alert panel (ProductAlertAction, same structure and failure
 * handling). The watch targets the browsed canonical category — the POST
 * carries `kind: 'category'` + `category` + a positive threshold and no
 * productId, which the API's create matrix requires (a productId would
 * 400). Duplicate CATEGORY rows are not deduped by the API's
 * (account, product, kind) index (NULL product_id), so the 409 path is
 * only defensive: the list re-read lands in the manage view.
 *
 * The manage view lists every CATEGORY row watching this category, each
 * with its threshold and status; CATEGORY rows carry no product, so no
 * product reference renders anywhere in the panel.
 *
 * Units: euros in the UI, integer euro cents at the API boundary (see
 * account/alerts/threshold).
 *
 * @module CategoryAlertAction
 */
export default function CategoryAlertAction({
  category,
  categoryLabel,
}: CategoryAlertActionProps) {
  const t = useTranslations('PriceAlerts');
  const tCommon = useTranslations('Common');

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadFailure, setLoadFailure] = useState<LoadFailure>(null);
  const [existing, setExisting] = useState<readonly PriceAlert[]>([]);
  const [threshold, setThreshold] = useState('');
  const [creating, setCreating] = useState(false);
  const [thresholdInvalid, setThresholdInvalid] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [busy, setBusy] = useState<{ id: number; action: BusyAction } | null>(
    null,
  );
  const [actionFailed, setActionFailed] = useState<'update' | 'delete' | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoadFailure(null);
    try {
      const rows = await request<PriceAlert[]>('/api/v1/account/alerts');
      const mine = rows.filter(
        (row) => row.kind === 'CATEGORY' && row.category === category,
      );
      setExisting(mine);
      setPhase(mine.length === 0 ? 'create' : 'manage');
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 401) {
        // request() already minted a session and replayed once — no usable
        // session could be established; prompt for one.
        setLoadFailure('signin');
      } else if (err instanceof ApiFetchError && err.status === 403) {
        setLoadFailure('forbidden');
      } else {
        setLoadFailure('error');
      }
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    const thresholdCents = eurosToCents(threshold);
    if (thresholdCents === null) {
      setThresholdInvalid(true);
      return;
    }
    setCreating(true);
    setThresholdInvalid(false);
    setCreateFailed(false);
    try {
      // Category kind: category + threshold, never a productId (the API's
      // create matrix rejects the combination).
      const created = await request<PriceAlert>('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({ kind: 'category', category, thresholdCents }),
      });
      setExisting((prev) => [...prev, created]);
      setThreshold('');
      setPhase('manage');
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 409) {
        // Defensive (the index does not dedupe CATEGORY rows) — re-read
        // and manage whatever the account holds for this category.
        await load();
      } else {
        setCreateFailed(true);
      }
    } finally {
      setCreating(false);
    }
  }, [category, creating, load, threshold]);

  const handleToggle = useCallback(async (alert: PriceAlert) => {
    if (busy !== null) return;
    const next = alert.status === 'active' ? 'paused' : 'active';
    setBusy({
      id: alert.id,
      action: next === 'paused' ? 'pause' : 'resume',
    });
    setActionFailed(null);
    try {
      const updated = await request<PriceAlert>(
        `/api/v1/account/alerts/${alert.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setExisting((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch {
      setActionFailed('update');
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const handleDelete = useCallback(async (alert: PriceAlert) => {
    if (busy !== null) return;
    setBusy({ id: alert.id, action: 'delete' });
    setActionFailed(null);
    try {
      // The alerts DELETE answers 200 with an EMPTY body; request() would
      // throw parsing it, so this call uses the shared low-level client
      // (ops-client precedent) and translates the status itself.
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
      setExisting((prev) => prev.filter((a) => a.id !== alert.id));
      if (existing.length === 1) {
        setPhase('create');
      }
    } catch {
      setActionFailed('delete');
    } finally {
      setBusy(null);
    }
  }, [busy, existing.length]);

  // ── Hidden states: the existence check is still running, or the API
  //    rejected the read (403) — render nothing, no dead controls, no
  //    layout shift. A sign-in/error failure renders its prompt instead. ──
  if (
    loadFailure === 'forbidden' ||
    (phase === 'loading' && loadFailure === null)
  ) {
    return null;
  }

  return (
    <section
      data-testid="category-alert-action"
      className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">
        {t('categoryAlertTitle')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('categoryAlertBody')}</p>
      <p
        className="mt-1 text-xs font-medium text-gray-500"
        data-testid="category-alert-category"
      >
        {t('categoryValue', { category: categoryLabel })}
      </p>

      {/* ── Sign-in prompt (401 after the session-mint retry) ── */}
      {loadFailure === 'signin' && (
        <div data-testid="alert-signin-prompt" className="mt-4">
          <p className="text-sm text-gray-600">{t('signInBody')}</p>
          <Link
            href="/login"
            className="mt-2 inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
          >
            {t('signInLink')}
          </Link>
        </div>
      )}

      {/* ── Existence-check failure ── */}
      {loadFailure === 'error' && (
        <div className="mt-4 text-sm text-red-600">
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

      {/* ── Existing watches: manage ── */}
      {loadFailure === null && phase === 'manage' && existing.length > 0 && (
        <div className="mt-4 space-y-4" data-testid="category-alert-manage">
          {/* Panel-level failure state — one banner above the rows. */}
          {actionFailed !== null && (
            <p className="text-sm text-red-600">
              {actionFailed === 'update'
                ? t('updateFailed')
                : t('deleteFailed')}
            </p>
          )}
          {existing.map((alert) => {
            const rowBusy = busy?.id === alert.id ? busy.action : null;
            return (
              <div
                key={alert.id}
                data-testid="category-alert-row"
                className="rounded-md border border-gray-100 p-3"
              >
                <p className="text-sm text-gray-700">
                  <span
                    data-testid="category-alert-kind-label"
                    className="font-medium text-gray-900"
                  >
                    {t('kindCategory')}
                  </span>
                  {' · '}
                  <span className="font-medium text-gray-900">
                    {t('categoryValue', { category: categoryLabel })}
                  </span>
                  {' · '}
                  {/* Threshold kinds carry a threshold by contract;
                      `?? 0` only satisfies the nullable union. */}
                  <span className="font-medium text-gray-900">
                    {t('thresholdValue', {
                      euros: formatCents(alert.thresholdCents ?? 0),
                    })}
                  </span>
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
                <p className="mt-1 text-xs text-gray-400">
                  {t('existingCategoryAlert')}
                </p>

                <div className="mt-3 flex items-center gap-2">
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
              </div>
            );
          })}
        </div>
      )}

      {/* ── No watch yet: create ── */}
      {loadFailure === null && phase === 'create' && (
        <div className="mt-4 max-w-xs" data-testid="category-alert-create">
          <Input
            id="category-alert-threshold"
            label={t('thresholdLabel')}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={t('thresholdPlaceholder')}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            error={thresholdInvalid ? t('thresholdInvalid') : undefined}
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
          {createFailed && (
            <p className="mt-3 text-sm text-red-600">{t('createFailed')}</p>
          )}
        </div>
      )}
    </section>
  );
}
