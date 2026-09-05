'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiFetchError, apiFetch, request } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { Button, Input } from '@/components/ui';
import type { PriceAlert } from '@/lib/types';
import { eurosToCents, formatCents } from '@/app/[locale]/account/alerts/threshold';

/** Whole-panel state after (or during) the existence check. */
type Phase = 'loading' | 'create' | 'manage';

/** Why the existence check failed; drives the whole-panel degradation. */
type LoadFailure = 'signin' | 'forbidden' | 'error' | null;

/** In-flight row mutation (button labels + disabling). */
type BusyAction = 'pause' | 'resume' | 'delete';

interface ProductAlertActionProps {
  /** The product page's resolved product id. */
  readonly productId: number;
}

/**
 * Product-page set-alert action (task 2.4, change
 * product-roadmap-phases-1-4).
 *
 * Gating: renders nothing unless the bootstrapped PRICE_ALERTS flag is on
 * (absent key counts as off), and a 403 — the flag having flipped off
 * server-side mid-session — degrades to the same nothing (design R13).
 * While rendering is gated client-side, the flag state is already inline
 * with the initial HTML, so nothing appears late.
 *
 * Existence: the panel checks the account's alert list on mount and
 * switches between create and manage views. A 409 on create (duplicate
 * account/product pair, or a race with another tab) re-reads the list and
 * lands in the manage view instead of surfacing an error.
 *
 * Units: euros in the UI, integer euro cents at the API boundary (see
 * account/alerts/threshold).
 *
 * @module ProductAlertAction
 */
export default function ProductAlertAction({
  productId,
}: ProductAlertActionProps) {
  const t = useTranslations('PriceAlerts');
  const tCommon = useTranslations('Common');
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.PRICE_ALERTS === true;

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadFailure, setLoadFailure] = useState<LoadFailure>(null);
  const [existing, setExisting] = useState<PriceAlert | null>(null);
  const [threshold, setThreshold] = useState('');
  const [creating, setCreating] = useState(false);
  const [thresholdInvalid, setThresholdInvalid] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [actionFailed, setActionFailed] = useState<'update' | 'delete' | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoadFailure(null);
    try {
      const rows = await request<PriceAlert[]>('/api/v1/account/alerts');
      const mine = rows.find((row) => row.productId === productId) ?? null;
      setExisting(mine);
      setPhase(mine === null ? 'create' : 'manage');
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
  }, [productId]);

  useEffect(() => {
    if (!flagEnabled) return;
    void load();
  }, [flagEnabled, load]);

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
      const created = await request<PriceAlert>('/api/v1/account/alerts', {
        method: 'POST',
        body: JSON.stringify({ productId, thresholdCents }),
      });
      setExisting(created);
      setThreshold('');
      setPhase('manage');
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 409) {
        // An alert for this product exists after all — switch to managing
        // it instead of showing a duplicate error.
        await load();
      } else {
        setCreateFailed(true);
      }
    } finally {
      setCreating(false);
    }
  }, [creating, load, productId, threshold]);

  const handleToggle = useCallback(async () => {
    if (existing === null || busy !== null) return;
    const next = existing.status === 'active' ? 'paused' : 'active';
    setBusy(next === 'paused' ? 'pause' : 'resume');
    setActionFailed(null);
    try {
      const updated = await request<PriceAlert>(
        `/api/v1/account/alerts/${existing.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setExisting(updated);
    } catch {
      setActionFailed('update');
    } finally {
      setBusy(null);
    }
  }, [busy, existing]);

  const handleDelete = useCallback(async () => {
    if (existing === null || busy !== null) return;
    setBusy('delete');
    setActionFailed(null);
    try {
      // The alerts DELETE answers 200 with an EMPTY body; request() would
      // throw parsing it, so this call uses the shared low-level client
      // (ops-client precedent) and translates the status itself.
      const res = await apiFetch(`/api/v1/account/alerts/${existing.id}`, {
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
      setExisting(null);
      setPhase('create');
    } catch {
      setActionFailed('delete');
    } finally {
      setBusy(null);
    }
  }, [busy, existing]);

  // ── Hidden state: flag off (or flipped off mid-session) — render
  //    nothing, fetch nothing, no dead controls, no layout shift. The
  //    loading check keeps the panel absent until the existence check
  //    resolves; a sign-in/error failure renders its prompt instead. ──
  if (
    !flagEnabled ||
    loadFailure === 'forbidden' ||
    (phase === 'loading' && loadFailure === null)
  ) {
    return null;
  }

  return (
    <section
      data-testid="product-alert-action"
      className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">
        {t('productTitle')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('productBody')}</p>

      {/* ── Sign-in prompt (401 after the session-mint retry) ── */}
      {loadFailure === 'signin' && (
        <div data-testid="alert-signin-prompt" className="mt-4">
          <p className="text-sm text-gray-600">{t('signInBody')}</p>
          <Link
            href="/account/create"
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

      {/* ── Existing alert: manage ── */}
      {loadFailure === null && phase === 'manage' && existing !== null && (
        <div className="mt-4" data-testid="product-alert-manage">
          <p className="text-sm text-gray-700">
            <span className="font-medium">
              {t('thresholdValue', { euros: formatCents(existing.thresholdCents) })}
            </span>
            {' · '}
            <span
              className={
                existing.status === 'active'
                  ? 'text-green-700'
                  : 'text-gray-400'
              }
            >
              {existing.status === 'active'
                ? t('statusActive')
                : t('statusPaused')}
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-400">{t('existingAlert')}</p>

          {actionFailed !== null && (
            <p className="mt-2 text-sm text-red-600">
              {actionFailed === 'update'
                ? t('updateFailed')
                : t('deleteFailed')}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggle()}
              disabled={busy !== null}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'pause'
                ? t('pausing')
                : busy === 'resume'
                  ? t('resuming')
                  : existing.status === 'active'
                    ? t('pause')
                    : t('resume')}
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy !== null}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'delete' ? t('deleting') : t('delete')}
            </button>
          </div>
        </div>
      )}

      {/* ── No alert yet: create ── */}
      {loadFailure === null && phase === 'create' && (
        <div className="mt-4 max-w-xs" data-testid="product-alert-create">
          <Input
            id="product-alert-threshold"
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
