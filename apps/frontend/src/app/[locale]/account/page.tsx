'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  ApiFetchError,
  ensureSession,
  request,
  getCalculationResult,
  requestVerificationEmail,
} from '@/lib/api';
import { Badge } from '@/components/ui';
import type { CalculatorResult, SessionStatus } from '@/lib/types';
import SavedScenariosSection from './components/SavedScenariosSection';
import ReportExportActions from '../calculator/components/ReportExportActions';

/**
 * Account overview page.
 *
 * Shows the signed-in account (server-derived identity from
 * `GET /account/me`) and the account features. There is no signed-out
 * render: an account-scoped 401 redirects to `/login` (design D8 — the
 * anonymous auto-mint no longer exists). The email-verification state is
 * a status badge, never a lockout (USER-GUIDE); an unverified account can
 * re-send the verification email here.
 *
 * @module AccountPage
 */
export default function AccountPage() {
  const t = useTranslations('Account');
  const tCommon = useTranslations('Common');
  const router = useRouter();

  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [probeTick, setProbeTick] = useState(0);

  // ── Calculation history state ──
  const [historyResults, setHistoryResults] = useState<CalculatorResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // ── Data export state ──
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // ── Verification-email resend state ──
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>(
    'idle',
  );

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    ensureSession()
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiFetchError && err.status === 401) {
          // No signed-in session — the anonymous bootstrap is gone, so
          // the sign-in page is the only way in.
          router.replace('/login');
          return;
        }
        // Backend unreachable — offer a retry instead of a redirect.
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, probeTick]);

  const handleResend = useCallback(async () => {
    setResendState('sending');
    try {
      await requestVerificationEmail();
      setResendState('sent');
    } catch {
      setResendState('failed');
    }
  }, []);

  // ── Fetch calculation history ──
  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      try {
        const ids = await request<number[]>('/api/v1/account/history');
        if (cancelled) return;

        // Fetch full results for the last 10 records (newest first when reversed).
        const recentIds = ids.slice(-10).reverse();
        const results = await Promise.all(
          recentIds.map((id) =>
            getCalculationResult(id).catch(() => null),
          ),
        );
        if (cancelled) return;
        setHistoryResults(
          results.filter((r): r is CalculatorResult => r !== null),
        );
      } catch {
        // Phase 1: history is non-critical; silently ignore failures.
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // ── Data export handler ──
  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportSuccess(false);

    try {
      const data = await request<Record<string, unknown>>(
        '/api/v1/account/export',
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rajahinta-export-${(session?.userId ?? 'unknown').slice(0, 8)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 4000);
    } catch {
      // Phase 1: export failure is non-critical; leave no visible error state.
    } finally {
      setExporting(false);
    }
  }, [session]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Session status ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {!session && !loadFailed && (
          <p data-testid="account-loading" className="text-sm text-gray-500">
            {t('loading')}
          </p>
        )}

        {!session && loadFailed && (
          <div data-testid="account-load-failed" className="text-sm text-gray-600">
            <p role="alert" className="font-medium text-error">
              {t('loadFailed')}
            </p>
            <button
              type="button"
              onClick={() => setProbeTick((n) => n + 1)}
              className="mt-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {tCommon('retry')}
            </button>
          </div>
        )}

        {session && (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              {t('signedInTitle')}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p data-testid="account-email" className="text-sm font-medium text-gray-900">
                {session.email}
              </p>
              {session.verified ? (
                <span data-testid="account-verified-badge">
                  <Badge tone="verified">{t('verifiedBadge')}</Badge>
                </span>
              ) : (
                <span data-testid="account-unverified-badge">
                  <Badge tone="neutral">{t('unverifiedBadge')}</Badge>
                </span>
              )}
            </div>

            {!session.verified && (
              <div className="mt-4 rounded-md bg-gray-50 p-4">
                <p className="text-sm text-gray-600">{t('unverifiedBody')}</p>
                <button
                  type="button"
                  data-testid="account-resend-verification"
                  onClick={() => void handleResend()}
                  disabled={resendState === 'sending'}
                  className="mt-3 inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('resendVerification')}
                </button>
                {resendState === 'sent' && (
                  <p data-testid="account-resend-sent" className="mt-2 text-xs text-green-600">
                    {t('resendSent')}
                  </p>
                )}
                {resendState === 'failed' && (
                  <p data-testid="account-resend-failed" role="alert" className="mt-2 text-xs font-medium text-error">
                    {t('resendFailed')}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Account feature list ── */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('featuresTitle')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/account/saved-baskets"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">{t('savedBaskets')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('savedBasketsDesc')}</p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              {t('browseSavedBaskets')}
            </span>
          </Link>

          {/* Price alerts */}
          <Link
            href="/account/alerts"
            data-testid="account-alerts-card"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">
              {t('priceAlerts')}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {t('priceAlertsDesc')}
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              {t('browsePriceAlerts')}
            </span>
          </Link>

          <Link
            href="/account#calculation-history"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">{t('historyFeature')}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {t('historyFeatureDesc')}
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              {t('viewHistory')}
            </span>
          </Link>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60">
            <h3 className="font-medium text-gray-900">{t('subscription')}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {t('subscriptionDesc')}
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-gray-400">
              {t('comingSoon')}
            </span>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md">
            <h3 className="font-medium text-gray-900">{t('dataExport')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('dataExportDesc')}</p>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="mt-2 inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? t('exporting') : t('exportButton')}
            </button>
            {exportSuccess && (
              <p className="mt-1.5 text-xs text-green-600">
                {t('downloadStarted')}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Calculation history ── */}
      <section
        id="calculation-history"
        className="mb-8 scroll-mt-16 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-gray-900">
          {t('historyTitle')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{t('historyDesc')}</p>

        {historyLoading && (
          <p className="mt-4 text-sm text-gray-400">{t('loadingHistory')}</p>
        )}

        {!historyLoading && historyResults.length === 0 && (
          <div className="mt-6 rounded-md bg-gray-50 p-4 text-center text-sm text-gray-500">
            <p className="font-medium">{t('noCalculations')}</p>
            <p className="mt-1">
              {t.rich('noCalculationsDesc', {
                link: (chunks) => (
                  <Link
                    href="/calculator"
                    className="text-primary-600 hover:text-primary-800"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        )}

        {!historyLoading && historyResults.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-100">
            {historyResults.map((calc) => {
              const ts = calc.metadata.calculationTimestamp;
              const date = new Date(ts);
              const formatted = date.toLocaleDateString('fi-FI', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <li
                  key={calc.calculationRecordId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {calc.metadata.productName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t('historyEntry', {
                        date: formatted,
                        quantity: calc.metadata.quantity,
                        total: (calc.totalCents / 100).toFixed(2),
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <Link
                      href="/calculator"
                      className="text-xs font-medium text-primary-600 hover:text-primary-800"
                    >
                      {t('reRun')}
                    </Link>
                    <ReportExportActions
                      recordId={calc.calculationRecordId}
                      compact
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Saved scenarios ── */}
      <SavedScenariosSection />

      {/* ── Data retention ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          {t('retentionTitle')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{t('retentionBody')}</p>
        <dl className="mt-4 space-y-3">
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">
              {t('inactiveAccountsLabel')}
            </dt>
            <dd className="text-sm text-gray-500">
              {t.rich('inactiveAccountsValue', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">
              {t('anonymizationLabel')}
            </dt>
            <dd className="text-sm text-gray-500">
              {t.rich('anonymizationValue', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">
              {t('historyRetentionLabel')}
            </dt>
            <dd className="text-sm text-gray-500">
              {t.rich('historyRetentionValue', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </dd>
          </div>
          <div className="flex justify-between pb-2">
            <dt className="text-sm font-medium text-gray-700">
              {t('analyticsLabel')}
            </dt>
            <dd className="text-sm text-gray-500">
              {t.rich('analyticsValue', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-400">{t('retentionNote')}</p>
      </section>
    </main>
  );
}
