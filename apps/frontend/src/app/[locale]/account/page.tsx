'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ensureSession, request, getCalculationResult } from '../../../lib/api';
import type { CalculatorResult, SessionStatus } from '@/lib/types';
import SavedScenariosSection from './components/SavedScenariosSection';
import ReportExportActions from '../calculator/components/ReportExportActions';

/**
 * Account overview page.
 *
 * Phase 1: shows the current session state and a list of account features.
 * The anonymous session is issued server-side on the first account-touch
 * (the ensureSession probe); the token lives in an httpOnly cookie the page
 * never reads. Anonymous-only design — no email or personal data collection.
 *
 * @module AccountPage
 */
export default function AccountPage() {
  const t = useTranslations('Account');
  const tCommon = useTranslations('Common');

  const [session, setSession] = useState<SessionStatus | null>(null);

  // ── Calculation history state ──
  const [historyResults, setHistoryResults] = useState<CalculatorResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // ── Data export state ──
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // ensureSession resolves only once a server-issued session exists (the
    // request wrapper mints one on the first 401); the userId shown in the
    // UI is the server-derived identity, never a client-generated value.
    ensureSession()
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => {
        // Backend unreachable — the anonymous panel renders instead.
      });
    return () => {
      cancelled = true;
    };
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
        {session ? (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              {t('welcomeBack')}
            </h2>
            <p className="mt-2 text-sm text-gray-600">{t('signedInBody')}</p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/account/saved-baskets"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('continue')}
              </Link>
              <Link
                href="/account/create"
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('createNewSession')}
              </Link>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              {tCommon('sessionId', { id: session.userId.slice(0, 8) })}
              &nbsp;&middot;&nbsp; {t('anonymous')}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              {t('anonymous')}
            </h2>
            <p className="mt-2 text-sm text-gray-600">{t('anonymousBody')}</p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/account/create"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('createAccount')}
              </Link>
            </div>
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
                    {/* Report export — hidden and unfetched while the
                        enable_advanced_features flag is off */}
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

      {/* ── Saved scenarios (flag-gated; hidden and unfetched when off) ── */}
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
