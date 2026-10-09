'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiFetchError, ensureSession } from '@/lib/api';
import { Link } from '@/i18n/navigation';

/**
 * Session-sticky dismissal: one dismissal hides the prompt for the rest
 * of the browsing session, across every result rendered after it. The
 * key lives in sessionStorage, so a new session starts clean.
 */
const DISMISS_KEY = 'rajahinta-outcome-nudge-dismissed';

/** Which prompt variant — and whether one renders at all. */
type NudgeVisibility = 'checking' | 'signedIn' | 'anonymous' | 'hidden';

interface OutcomeNudgeProps {
  /** The calculation record the account deep-link preselects. */
  readonly recordId: number;
}

/**
 * Post-calculation outcome nudge (honest-trust-surfaces task 3.3,
 * design D7): one dismissible prompt on the result view pointing to the
 * account page's OutcomeReportForm. The session probe (`ensureSession`,
 * the same read the account page uses) only decides WHICH prompt renders
 * — a 401 means the anonymous sign-in path, any other failure hides the
 * prompt entirely rather than guessing.
 *
 * Presentation contract: the prompt never blocks or restyles the result,
 * renders nothing until its state resolves, sends nothing on its own
 * (no report submission, no analytics — the probe is a read), and once
 * dismissed stays dismissed for the session.
 *
 * @module OutcomeNudge
 */
export default function OutcomeNudge({ recordId }: OutcomeNudgeProps) {
  const t = useTranslations('CalculatorResult');
  const [visibility, setVisibility] = useState<NudgeVisibility>('checking');

  useEffect(() => {
    // Dismissal is checked first — a dismissed session never probes.
    if (sessionStorage.getItem(DISMISS_KEY) === '1') {
      setVisibility('hidden');
      return;
    }
    let cancelled = false;
    ensureSession()
      .then(() => {
        if (!cancelled) setVisibility('signedIn');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVisibility(
          err instanceof ApiFetchError && err.status === 401
            ? 'anonymous'
            : 'hidden',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisibility('hidden');
  }

  if (visibility === 'checking' || visibility === 'hidden') {
    return null;
  }

  const signedIn = visibility === 'signedIn';

  return (
    <div
      data-testid="outcome-nudge"
      className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
    >
      <p className="text-xs leading-relaxed text-gray-600">
        {signedIn
          ? t('outcomeNudge.bodySignedIn')
          : t('outcomeNudge.bodyAnonymous')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href={
            signedIn
              ? { pathname: '/account', query: { outcome: recordId } }
              : '/login'
          }
          data-testid="outcome-nudge-cta"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          {signedIn
            ? t('outcomeNudge.ctaSignedIn')
            : t('outcomeNudge.ctaAnonymous')}
        </Link>
        <button
          type="button"
          data-testid="outcome-nudge-dismiss"
          onClick={dismiss}
          className="text-xs text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          {t('outcomeNudge.dismiss')}
        </button>
      </div>
    </div>
  );
}
