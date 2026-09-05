'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useFeatureFlags } from '@/lib/feature-flags';
import { ApiFetchError } from '@/lib/api';
import { Button } from '@/components/ui';
import {
  createGroupOrderSession,
  type CreateSessionResponse,
} from './api';
import { formatTimestamp } from './money';

/**
 * Group order create/manage entry (task 9.4, change
 * product-roadmap-phases-1-4) at /group-order.
 *
 * Gating: renders NOTHING unless the inlined GROUP_ORDER_LEDGER flag is
 * on (absent key counts as off — the narrow-lookup contract). A 403 from
 * the API — the flag flipped off server-side mid-session — degrades to
 * the same absent UI (alerts precedent, design R13).
 *
 * Auth UI state: session create is owner-authenticated server-side; a 401
 * (no usable account session) is answered with a sign-in prompt, not a
 * retry loop. The request wrapper's anonymous-session minting does not
 * apply here — /api/v1/group-orders is outside the account-scope prefix.
 *
 * On success the owner gets the shareable link — the URL participants
 * open under /group-order/[token]. The link is shown for copying and as
 * a plain anchor; there is deliberately no session-list endpoint in the
 * 9.3 contract, so "manage" is exactly this entry point.
 *
 * @module CreateGroupOrderView
 */
export default function CreateGroupOrderView() {
  const t = useTranslations('GroupOrder');
  const locale = useLocale();
  // Flag state arrives inlined with the initial HTML payload — the
  // visibility is correct on the first render, no late appearance.
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.GROUP_ORDER_LEDGER === true;

  const [created, setCreated] = useState<CreateSessionResponse | null>(null);
  const [creating, setCreating] = useState(false);
  // 'signin' (401) | 'forbidden' (403 flag flipped) | 'error' | null
  const [failure, setFailure] = useState<
    'signin' | 'forbidden' | 'error' | null
  >(null);
  const [copied, setCopied] = useState(false);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setFailure(null);
    setCopied(false);
    try {
      setCreated(await createGroupOrderSession());
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 401) {
        setFailure('signin');
      } else if (err instanceof ApiFetchError && err.status === 403) {
        setFailure('forbidden');
      } else {
        setFailure('error');
      }
    } finally {
      setCreating(false);
    }
  }, [creating]);

  // Clear a stale success panel if a new create supersedes it — handled
  // by replacing `created` above; nothing else to clean up on unmount.
  useEffect(() => {
    return () => setCopied(false);
  }, []);

  // ── Hidden state: flag off in the inlined payload (or flipped off
  //    server-side mid-session) — render nothing, fetch nothing. ──
  if (!flagEnabled || failure === 'forbidden') {
    return null;
  }

  const shareUrl =
    created === null
      ? ''
      : `${window.location.origin}${locale === 'en' ? '/en' : ''}/group-order/${created.shareToken}`;

  return (
    <main
      data-testid="group-order-create-page"
      className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {t('title')}
      </h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Sign-in prompt (401 — owner authentication required) ── */}
      {failure === 'signin' && (
        <section
          data-testid="group-order-signin-prompt"
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

      {/* ── Generic failure (retry re-runs the same create) ── */}
      {failure === 'error' && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t('createFailed')}
          <button
            type="button"
            onClick={() => void create()}
            className="ml-3 font-medium underline hover:no-underline"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {created === null ? (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('createTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">{t('createBody')}</p>
          <div className="mt-4">
            <Button
              type="button"
              onClick={() => void create()}
              disabled={creating}
              data-testid="group-order-create-button"
            >
              {creating ? t('creating') : t('createAction')}
            </Button>
          </div>
        </section>
      ) : (
        <section
          data-testid="group-order-share-panel"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            {t('shareLinkTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('shareLinkBody', {
              date: formatTimestamp(created.expiresAt, locale),
            })}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              data-testid="group-order-share-link"
              aria-label={t('shareLinkTitle')}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
            />
            <Button
              type="button"
              variant="secondary"
              data-testid="group-order-copy-button"
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? t('copied') : t('copyLink')}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
