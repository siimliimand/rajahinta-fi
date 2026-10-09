'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ApiFetchError,
  createFavorite,
  deleteFavorite,
  listFavorites,
} from '@/lib/api';
import LoginModal from '@/app/[locale]/components/LoginModal';

/** Whole-control state after (or during) the membership check. */
type Phase = 'loading' | 'ready';

/** Why the membership check failed; drives the whole-panel degradation. */
type LoadFailure = 'forbidden' | 'error' | null;

interface ProductFavoriteActionProps {
  /** The product page's resolved product id. */
  readonly productId: number;
}

/** Decorative heart glyph — the visible state lives on `aria-pressed` and
 *  the button's localized label (inline-SVG precedent: no icon library,
 *  ContentSafetyBadge/MerchantWarningNotice). */
function HeartIcon({ filled }: { readonly filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={filled ? 'h-6 w-6 text-red-600' : 'h-6 w-6 text-gray-400'}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

/**
 * Product-page favorite action (task 4.3, change
 * add-product-favorites).
 *
 * Behaviour: the heart checks the account's favorite list on mount
 * (mirroring ProductAlertAction's ladder — hidden while loading, nothing
 * on a 403, error + retry otherwise) and starts pressed when this
 * product is already favorited. Toggling flips the heart optimistically
 * and reconciles the membership with a list refetch on completion
 * (design D6); a failed mutation reverts the flip and surfaces the
 * inline error. A 409 on create means the product is favorited after
 * all (the per-account unique rule), so it re-reads instead of
 * erroring — the alerts-create 409 precedent.
 *
 * Signed-out visitors are the modal funnel's entry point (spec:
 * sign-in gating): the 401 after the session-mint retry keeps the heart
 * up but untoggled, and a tap holds the pending `productId` in state
 * while `LoginModal` opens. A successful sign-in completes the held
 * create without further user action; closing the modal discards the
 * intent and leaves the heart unchanged.
 *
 * @module ProductFavoriteAction
 */
export default function ProductFavoriteAction({
  productId,
}: ProductFavoriteActionProps) {
  const t = useTranslations('Favorites');
  const tCommon = useTranslations('Common');

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadFailure, setLoadFailure] = useState<LoadFailure>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [pendingFavorite, setPendingFavorite] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  /** True-up membership from the server list (design D6 reconcile). */
  const reconcile = useCallback(async () => {
    try {
      const rows = await listFavorites();
      setFavorited(rows.some((row) => row.productId === productId));
    } catch {
      // Keep the optimistic value — the failed create/delete already
      // surfaced its error, and a second banner would only stack noise.
      // The next toggle or mount re-syncs.
    }
  }, [productId]);

  const load = useCallback(async () => {
    setLoadFailure(null);
    try {
      const rows = await listFavorites();
      setFavorited(rows.some((row) => row.productId === productId));
      setSignedOut(false);
      setPhase('ready');
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 401) {
        // request() already minted a session and replayed once — no
        // usable session exists. The heart stays up: the signed-out tap
        // is the login-modal funnel's entry point.
        setSignedOut(true);
        setFavorited(false);
        setPhase('ready');
      } else if (err instanceof ApiFetchError && err.status === 403) {
        setLoadFailure('forbidden');
      } else {
        setLoadFailure('error');
      }
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Optimistic flip → mutate → reconcile (design D6). */
  const toggleFavorite = useCallback(
    async (next: boolean, targetId: number) => {
      if (busy) return;
      setBusy(true);
      setActionFailed(false);
      setFavorited(next);
      try {
        if (next) {
          await createFavorite(targetId);
        } else {
          await deleteFavorite(targetId);
        }
        await reconcile();
      } catch (err) {
        if (next && err instanceof ApiFetchError && err.status === 409) {
          // Favorited after all (another tab won the race) — membership
          // is true, so re-read instead of surfacing a duplicate error.
          await reconcile();
        } else {
          setFavorited(!next);
          setActionFailed(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, reconcile],
  );

  const handleHeartTap = useCallback(() => {
    if (busy) return;
    if (signedOut && !favorited) {
      // Hold the intent; the modal's success completes it (spec:
      // successful login completes the favorite).
      setPendingFavorite(productId);
      setModalOpen(true);
      return;
    }
    void toggleFavorite(!favorited, productId);
  }, [busy, favorited, productId, signedOut, toggleFavorite]);

  const handleModalSuccess = useCallback(() => {
    const target = pendingFavorite;
    setModalOpen(false);
    setPendingFavorite(null);
    setSignedOut(false);
    if (target !== null) void toggleFavorite(true, target);
  }, [pendingFavorite, toggleFavorite]);

  const handleModalClose = useCallback(() => {
    // Dismissal without success: drop the held intent, heart unchanged.
    setModalOpen(false);
    setPendingFavorite(null);
  }, []);

  // ── Hidden states: the membership check is still running, or the API
  //    rejected the read (403) — render nothing, no dead controls, no
  //    layout shift. A read error renders its retry prompt instead. ──
  if (
    loadFailure === 'forbidden' ||
    (phase === 'loading' && loadFailure === null)
  ) {
    return null;
  }

  return (
    <section
      data-testid="product-favorite-action"
      className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">
        {t('productHeading')}
      </h2>

      {/* ── Existence-check failure ── */}
      {loadFailure === 'error' ? (
        <div
          data-testid="product-favorite-load-error"
          className="mt-4 text-sm text-red-600"
        >
          {t('loadFailed')}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-3 font-medium underline hover:no-underline"
          >
            {tCommon('retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              data-testid="product-favorite-toggle"
              aria-pressed={favorited}
              aria-label={
                busy
                  ? favorited
                    ? t('removingLabel')
                    : t('addingLabel')
                  : favorited
                    ? t('removeLabel')
                    : t('addLabel')
              }
              onClick={handleHeartTap}
              disabled={busy}
              className="rounded-full p-1.5 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <HeartIcon filled={favorited} />
            </button>
            {signedOut && (
              <p className="text-sm text-gray-600">{t('signInHint')}</p>
            )}
          </div>

          {actionFailed && (
            <p
              data-testid="product-favorite-error"
              role="alert"
              className="mt-3 text-sm text-red-600"
            >
              {t('actionFailed')}
            </p>
          )}
        </>
      )}

      <LoginModal
        open={modalOpen}
        onClose={handleModalClose}
        onSuccess={handleModalSuccess}
      />
    </section>
  );
}
