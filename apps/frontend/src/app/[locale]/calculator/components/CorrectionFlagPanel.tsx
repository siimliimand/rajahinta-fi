'use client';

import React, { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createCorrectionFlag } from '@/lib/api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CorrectionFlagPanelProps {
  /** The calculation record ID to flag. */
  readonly recordId: number;
  /** The product name, shown as read-only context. */
  readonly productName: string;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type FormPhase = 'closed' | 'open' | 'submitting' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Inline "Flag a problem" affordance for the calculator result page.
 *
 * Starts as a collapsed trigger link.  When clicked, it expands into a
 * small form with the calculation context pre-filled (record ID, product
 * name read-only) and a free-text reason field.  On submit it POSTs to
 * `/api/v1/corrections` and shows a success or error state.
 */
export default function CorrectionFlagPanel({
  recordId,
  productName,
}: CorrectionFlagPanelProps) {
  const t = useTranslations('CorrectionFlag');
  const [phase, setPhase] = useState<FormPhase>('closed');
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Open / close ──
  const open = useCallback(() => setPhase('open'), []);
  const cancel = useCallback(() => {
    setPhase('closed');
    setReason('');
    setErrorMessage(null);
  }, []);

  // ── Submit ──
  const submit = useCallback(async () => {
    if (!reason.trim()) return;
    setPhase('submitting');
    setErrorMessage(null);

    try {
      await createCorrectionFlag('calculation', recordId, reason.trim());
      setPhase('success');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t('submitFailed');
      setErrorMessage(message);
      setPhase('error');
    }
  }, [reason, recordId, t]);

  // ── Collapsed trigger ──
  if (phase === 'closed') {
    return (
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={open}
          className="text-xs text-gray-400 underline decoration-dotted underline-offset-2 hover:text-gray-600"
        >
          {t('trigger')}
        </button>
      </div>
    );
  }

  // ── Success ──
  if (phase === 'success') {
    return (
      <div className="mt-8 rounded-lg border border-green-200 bg-green-50 p-5 text-center">
        <p className="text-sm font-medium text-green-800">{t('successTitle')}</p>
        <p className="mt-1 text-xs text-green-600">{t('successBody')}</p>
        <button
          type="button"
          onClick={cancel}
          className="mt-3 text-xs text-green-700 underline hover:text-green-800"
        >
          {t('dismiss')}
        </button>
      </div>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-medium text-red-800">{t('errorTitle')}</p>
        <p className="mt-1 text-xs text-red-600">{errorMessage}</p>
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!reason.trim()}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {t('retry')}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ── Open / submitting form ──
  return (
    <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <p className="mb-3 text-sm font-medium text-amber-800">{t('trigger')}</p>

      {/* Read-only context */}
      <div className="mb-3 rounded bg-white px-3 py-2 text-xs text-gray-600">
        <span className="font-medium text-gray-800">{t('calculation')}</span> #
        {recordId} &mdash; {productName}
      </div>

      {/* Reason textarea */}
      <label className="mb-1 block text-xs font-medium text-gray-700">
        {t('describeIssue')}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={phase === 'submitting'}
          placeholder={t('placeholder')}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800 placeholder-gray-400 disabled:opacity-50"
        />
      </label>

      {/* Actions */}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!reason.trim() || phase === 'submitting'}
          className="rounded-md bg-primary-600 px-4 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {phase === 'submitting' ? t('submitting') : t('submit')}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={phase === 'submitting'}
          className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
