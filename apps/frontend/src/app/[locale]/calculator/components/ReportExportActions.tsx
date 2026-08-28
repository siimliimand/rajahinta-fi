'use client';

/**
 * ReportExportActions — JSON/CSV download and print-report actions for a
 * persisted calculation (task 4.2, change phase2-advanced-features).
 *
 * Behaviour:
 *  - `enable_advanced_features` off ⇒ the actions render nothing and no
 *    report request is fired (same guard-before-fetch pattern as
 *    ProductHistoryPanel). The flag state arrives with the initial HTML
 *    payload, so the actions' visibility is correct on the first render.
 *  - PREMIUM entitlement failures (403 error 'InsufficientEntitlement')
 *    surface a controlled-vocabulary message — never a crash and never
 *    promotional wording.
 *  - Reports are fetched as blobs (the route needs the age-confirmation
 *    header, which a plain anchor navigation cannot attach cross-origin).
 *
 * @module ReportExportActions
 */

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  classifyReportError,
  downloadReport,
  openPrintableReport,
} from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type BusyFormat = 'json' | 'csv' | 'print' | null;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReportExportActionsProps {
  /** Persisted calculation record to export. */
  readonly recordId: number;
  /** Compact variant for inline use in history rows. */
  readonly compact?: boolean;
}

export default function ReportExportActions({
  recordId,
  compact = false,
}: ReportExportActionsProps) {
  const t = useTranslations('ReportExport');
  // Flag state is inlined with the initial HTML payload (task 9.4).
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.ADVANCED_FEATURES;
  const [busy, setBusy] = useState<BusyFormat>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Hidden state: flag off in the inlined payload ──
  if (!flagEnabled) {
    return null;
  }

  // ── Shared runner: classify failures into controlled messages ──
  const run = async (format: BusyFormat, action: () => Promise<void>) => {
    if (busy !== null) return;
    setBusy(format);
    setError(null);
    try {
      await action();
    } catch (err: unknown) {
      const { kind } = classifyReportError(err);
      setError(kind === 'forbidden' || kind === 'not-found' ? null : t(`errors.${kind}`));
    } finally {
      setBusy(null);
    }
  };

  const buttonClass = compact
    ? 'rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
    : 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div
      className={compact ? 'inline-flex flex-wrap items-center gap-1.5' : 'mt-3'}
      data-testid="report-export-actions"
    >
      {!compact && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('title')}
        </h3>
      )}
      <div className="inline-flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="report-export-json"
          onClick={() => run('json', () => downloadReport(recordId, 'json'))}
          disabled={busy !== null}
          className={buttonClass}
        >
          {busy === 'json' ? t('downloading') : t('downloadJson')}
        </button>
        <button
          type="button"
          data-testid="report-export-csv"
          onClick={() => run('csv', () => downloadReport(recordId, 'csv'))}
          disabled={busy !== null}
          className={buttonClass}
        >
          {busy === 'csv' ? t('downloading') : t('downloadCsv')}
        </button>
        <button
          type="button"
          data-testid="report-export-print"
          onClick={() => run('print', () => openPrintableReport(recordId))}
          disabled={busy !== null}
          className={buttonClass}
        >
          {busy === 'print' ? t('preparing') : t('print')}
        </button>
      </div>
      {error && (
        <p
          className={`${compact ? 'w-full' : 'mt-2'} text-xs text-gray-600`}
          data-testid="report-export-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
