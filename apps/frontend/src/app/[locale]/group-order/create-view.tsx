'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiFetchError } from '@/lib/api';
import { Button, Input } from '@/components/ui';
import {
  isEstimateHandoffItemName,
  parseEstimateHandoffParam,
} from '../event/estimate-handoff';
import {
  createGroupOrderSession,
  type CreateSessionResponse,
} from './api';
import { formatTimestamp } from './money';

/** One editable prefill row — raw input strings, edited freely. */
interface PrefillRow {
  readonly name: string;
  readonly quantity: string;
}

/**
 * Group order create/manage entry (task 9.4, change
 * product-roadmap-phases-1-4) at /group-order.
 *
 * Auth UI state: session create is owner-authenticated server-side; a 401
 * (no usable account session) is answered with a sign-in prompt, not a
 * retry loop. The request wrapper's anonymous-session minting does not
 * apply here — /api/v1/group-orders is outside the account-scope prefix.
 * A 403 from the API degrades the view to nothing.
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

  // Canonical drink-type keys resolve to the consumer labels; anything
  // else is shown as-is — a hand-carved URL may name any item.
  const prefillName = useCallback(
    (name: string) =>
      isEstimateHandoffItemName(name)
        ? t(`prefillItemName.${name}`)
        : name,
    [t],
  );

  const [created, setCreated] = useState<CreateSessionResponse | null>(null);
  const [creating, setCreating] = useState(false);
  // 'signin' (401) | 'forbidden' (403) | 'error' | null
  const [failure, setFailure] = useState<
    'signin' | 'forbidden' | 'error' | null
  >(null);
  const [copied, setCopied] = useState(false);

  // ── Estimate prefill intake (change seasonal-occasion-templates,
  // task 3.1): the event calculator's "Jaa kustannukset" lands here
  // with ?items=name:quantity,…. The rows are ordinary editable
  // entries — edited, removed, and extended exactly like hand-added
  // ones — and a client-side checklist only: the session-create
  // contract carries no body fields, and the group-order item contract
  // is productId-keyed, so nothing here is ever transmitted. Absent,
  // blank, and malformed values degrade silently to the standard empty
  // creation state (no section, no error surface). ──
  const [prefillRows, setPrefillRows] = useState<readonly PrefillRow[]>([]);

  useEffect(() => {
    const parsed = parseEstimateHandoffParam(
      new URLSearchParams(window.location.search).get('items'),
    );
    if (parsed.length === 0) return;
    setPrefillRows(
      parsed.map((item) => ({ name: item.name, quantity: String(item.quantity) })),
    );
  }, []);

  const setPrefillRow = useCallback((index: number, patch: Partial<PrefillRow>) => {
    setPrefillRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }, []);

  const removePrefillRow = useCallback((index: number) => {
    setPrefillRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  // ── Hidden state: the API rejected the create (403) — render nothing. ──
  if (failure === 'forbidden') {
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
              href="/login"
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
        <>
          {/* ── Estimate prefill rows (task 3.1): ordinary editable
                  entries — removable, extendable, and never
                  transmitted (see the mount-effect note above). They
                  render only when a valid prefill arrived; an empty or
                  malformed one leaves the standard state untouched. ── */}
          {prefillRows.length > 0 && (
            <section
              data-testid="group-order-prefill-rows"
              className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-gray-900">
                {t('prefillTitle')}
              </h2>
              <p className="mt-2 text-sm text-gray-600">{t('prefillHint')}</p>
              <ul className="mt-4 space-y-2">
                {prefillRows.map((row, index) => (
                  <li key={index} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        id={`group-order-prefill-name-${String(index)}`}
                        label={t('prefillName')}
                        aria-label={`${t('prefillName')} ${String(index + 1)}`}
                        value={prefillName(row.name)}
                        onChange={(e) => setPrefillRow(index, { name: e.target.value })}
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        id={`group-order-prefill-quantity-${String(index)}`}
                        label={t('prefillQuantity')}
                        aria-label={`${t('prefillQuantity')} ${String(index + 1)}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={row.quantity}
                        onChange={(e) =>
                          setPrefillRow(index, { quantity: e.target.value })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      data-testid={`group-order-prefill-remove-${String(index)}`}
                      aria-label={t('prefillRemove')}
                      onClick={() => removePrefillRow(index)}
                    >
                      {t('prefillRemove')}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="group-order-prefill-add"
                  onClick={() =>
                    setPrefillRows((prev) => [...prev, { name: '', quantity: '1' }])
                  }
                >
                  {t('prefillAdd')}
                </Button>
              </div>
            </section>
          )}

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
        </>
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
