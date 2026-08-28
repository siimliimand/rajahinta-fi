'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSessionUserId, request, getCalculationResult } from '../../lib/api';
import type { CalculatorResult } from '@/lib/types';
import SavedScenariosSection from './components/SavedScenariosSection';
import ReportExportActions from '../calculator/components/ReportExportActions';

/**
 * Account overview page.
 *
 * Phase 1: shows the current session state and a list of account features.
 * The session is created automatically on first visit. Anonymous-only
 * design — no email or personal data collection.
 *
 * @module AccountPage
 */
export default function AccountPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ── Calculation history state ──
  const [historyResults, setHistoryResults] = useState<CalculatorResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // ── Data export state ──
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  useEffect(() => {
    // getSessionUserId creates the cookie if absent, so by the time this
    // component mounts the anonymous session always exists.
    setSessionId(getSessionUserId());
  }, []);

  // ── Fetch calculation history ──
  useEffect(() => {
    if (!sessionId) return;

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
  }, [sessionId]);

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
      anchor.download = `rajahinta-export-${(sessionId ?? 'unknown').slice(0, 8)}.json`;
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
  }, [sessionId]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6">
        <Link
          href="/"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; Home
        </Link>
      </nav>

      <h1 className="mb-1 text-2xl font-bold text-primary-700">My account</h1>
      <p className="mb-8 text-sm text-gray-500">
        Manage your saved baskets, calculation history, and subscription.
      </p>

      {/* ── Session status ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {sessionId ? (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              You are signed in as an anonymous user. Your session is active,
              and account features are available below.
            </p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/account/saved-baskets"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Continue &rarr;
              </Link>
              <Link
                href="/account/create"
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Create new session
              </Link>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Session ID: {sessionId.slice(0, 8)}&hellip;
              &nbsp;&middot;&nbsp; Anonymous account
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              Anonymous account
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Create an anonymous account to save baskets, view your
              calculation history, and manage your preferences. No email or
              personal data required.
            </p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/account/create"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Create account
              </Link>
            </div>
          </>
        )}
      </section>

      {/* ── Account feature list ── */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Account features
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/account/saved-baskets"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">Saved baskets</h3>
            <p className="mt-1 text-xs text-gray-500">
              Save product selections for quick re-calculation.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              Browse saved baskets &rarr;
            </span>
          </Link>

          <Link
            href="/account#calculation-history"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">Calculation history</h3>
            <p className="mt-1 text-xs text-gray-500">
              View and re-run past landed-cost calculations.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              View history &rarr;
            </span>
          </Link>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60">
            <h3 className="font-medium text-gray-900">Subscription</h3>
            <p className="mt-1 text-xs text-gray-500">
              Manage your plan and billing details.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-gray-400">
              Coming soon
            </span>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md">
            <h3 className="font-medium text-gray-900">Data export</h3>
            <p className="mt-1 text-xs text-gray-500">
              Export your data in JSON format.
            </p>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="mt-2 inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export my data'}
            </button>
            {exportSuccess && (
              <p className="mt-1.5 text-xs text-green-600">
                Download started &mdash; check your downloads folder.
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
          Calculation history
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Your recent landed-cost calculations, newest first.
        </p>

        {historyLoading && (
          <p className="mt-4 text-sm text-gray-400">Loading history…</p>
        )}

        {!historyLoading && historyResults.length === 0 && (
          <div className="mt-6 rounded-md bg-gray-50 p-4 text-center text-sm text-gray-500">
            <p className="font-medium">No calculations yet</p>
            <p className="mt-1">
              Visit the{' '}
              <Link
                href="/calculator"
                className="text-primary-600 hover:text-primary-800"
              >
                landed-cost calculator
              </Link>{' '}
              to run your first calculation.
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
                      {formatted}
                      &nbsp;&middot;&nbsp;{calc.metadata.quantity} &times;
                      &euro;{(calc.totalCents / 100).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <Link
                      href="/calculator"
                      className="text-xs font-medium text-primary-600 hover:text-primary-800"
                    >
                      Re-run
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
        <h2 className="text-lg font-semibold text-gray-900">Data retention</h2>
        <p className="mt-1 text-sm text-gray-600">
          Your data is retained only as long as necessary for the service to
          function. The following policies apply automatically:
        </p>
        <dl className="mt-4 space-y-3">
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">Inactive accounts</dt>
            <dd className="text-sm text-gray-500">
              Deleted after <strong>12 months</strong> of inactivity
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">Inactive account anonymization</dt>
            <dd className="text-sm text-gray-500">
              Anonymized after <strong>6 months</strong> of inactivity
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">Calculation history</dt>
            <dd className="text-sm text-gray-500">
              Deleted after <strong>24 months</strong>
            </dd>
          </div>
          <div className="flex justify-between pb-2">
            <dt className="text-sm font-medium text-gray-700">Analytics &amp; telemetry</dt>
            <dd className="text-sm text-gray-500">
              Anonymized after <strong>12 months</strong>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-400">
          Retention is enforced automatically. No action is needed on your part.
        </p>
      </section>
    </main>
  );
}