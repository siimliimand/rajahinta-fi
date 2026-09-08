'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ApiFetchError,
  reportCalculationOutcome,
} from '@/lib/api';
import type { OutcomeReport } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a euro amount ("24.90", "24,90", "25") into positive integer
 * cents, or null when the input is not a positive amount. The comma
 * form is accepted because the Finnish catalog suggests it.
 */
export function parseEuroToCents(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number.parseFloat(normalized) * 100);
  if (!Number.isInteger(cents) || cents <= 0) return null;
  return cents;
}

/** Which mapped failure the API answered with. */
type OutcomeErrorKind =
  | 'invalid'
  | 'duplicate'
  | 'window'
  | 'generic';

function errorKind(err: unknown): OutcomeErrorKind {
  if (err instanceof ApiFetchError) {
    switch (err.body?.error) {
      case 'OUTCOME_ALREADY_EXISTS':
        return 'duplicate';
      case 'WINDOW_EXPIRED':
        return 'window';
      case 'REPORTED_TOTAL_NOT_POSITIVE':
        return 'invalid';
      default:
        return 'generic';
    }
  }
  return 'generic';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OutcomeReportFormProps {
  /** The calculation record this outcome belongs to (unique per account). */
  recordId: number;
  /** The estimated total, shown for context next to the input. */
  estimatedTotalCents: number;
  /** Called after a successful report so the parent can update flags. */
  onReported?: (report: OutcomeReport) => void;
}

/**
 * Report-outcome form for one account history record
 * (trust-and-reach-roadmap task 3.3, spec calculation-outcomes).
 *
 * Rendered by the account page only for records that (a) still miss an
 * outcome and (b) sit inside the 60-day window; the server enforces the
 * same window and the one-outcome-per-record rule, and this form maps
 * those rejections to controlled copy (duplicate → already-reported
 * note, window → closed note). The reported amount is stored once and
 * never edited — the stored outcome stays untouched on a duplicate.
 */
export default function OutcomeReportForm({
  recordId,
  estimatedTotalCents,
  onReported,
}: OutcomeReportFormProps) {
  const t = useTranslations('OutcomeReport');

  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<OutcomeReport | null>(null);
  const [failure, setFailure] = useState<OutcomeErrorKind | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseEuroToCents(amount);
    if (cents === null) {
      setFailure('invalid');
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const created = await reportCalculationOutcome(recordId, cents);
      setReport(created);
      onReported?.(created);
    } catch (err: unknown) {
      setFailure(errorKind(err));
    } finally {
      setSubmitting(false);
    }
  }

  // A recorded outcome is terminal for this record: show the outcome of
  // the margin comparison instead of the form.
  if (report !== null) {
    return (
      <div
        data-testid={`outcome-report-success-${recordId}`}
        className="mt-2 rounded-md bg-gray-50 p-3 text-xs text-gray-600"
      >
        <p className="font-medium text-gray-800">
          {report.withinMargin ? t('successWithin') : t('successOutside')}
        </p>
      </div>
    );
  }

  return (
    <form
      data-testid={`outcome-report-form-${recordId}`}
      onSubmit={handleSubmit}
      className="mt-2 rounded-md bg-gray-50 p-3"
    >
      <p className="text-xs font-medium text-gray-800">{t('formTitle')}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        {t('formIntro')}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label
          htmlFor={`outcome-amount-${recordId}`}
          className="text-xs text-gray-600"
        >
          {t('amountLabel')}
        </label>
        <input
          id={`outcome-amount-${recordId}`}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (failure === 'invalid') setFailure(null);
          }}
          disabled={submitting}
          className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
        />
        <span className="text-xs text-gray-400">
          {`€${(estimatedTotalCents / 100).toFixed(2)}`}
        </span>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? t('submitting') : t('submit')}
        </button>
      </div>

      {failure === 'invalid' && (
        <p role="alert" className="mt-2 text-xs font-medium text-error">
          {t('invalidAmount')}
        </p>
      )}
      {failure === 'duplicate' && (
        <p role="alert" className="mt-2 text-xs text-gray-600">
          {t('alreadyReported')}
        </p>
      )}
      {failure === 'window' && (
        <p role="alert" className="mt-2 text-xs text-gray-600">
          {t('windowExpired')}
        </p>
      )}
      {failure === 'generic' && (
        <p role="alert" className="mt-2 text-xs font-medium text-error">
          {t('reportFailed')}
        </p>
      )}
    </form>
  );
}
