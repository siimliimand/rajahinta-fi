'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getAccuracyStatistic } from '@/lib/api';
import type { AccuracyStatistic } from '@/lib/types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Where the statistic is embedded — the home trust row wants a quiet
 * column entry, the methodology page a full section block.
 */
type AccuracyStatVariant = 'trust-row' | 'section';

interface AccuracyStatProps {
  variant?: AccuracyStatVariant;
}

/**
 * The public accuracy statistic (trust-and-reach-roadmap task 3.3, spec
 * calculation-outcomes "Public accuracy statistic labeled user-reported").
 *
 * Hard rules, enforced here and not elsewhere:
 *   - The statistic is ALWAYS labeled with the API-supplied user-reported
 *     wording (`label[locale]`) — this view never invents its own label,
 *     so every rendering of the number carries the exact wording the
 *     backend committed to.
 *   - The sample size is always displayed next to the share.
 *   - The empty state is honest: count 0 renders "no user-reported
 *     outcomes yet", never a percentage (share is null exactly when
 *     count is 0).
 *
 * Fetch failures degrade to a quiet unavailable note — the statistic is
 * informational and must not block the page around it.
 */
export default function AccuracyStat({
  variant = 'trust-row',
}: AccuracyStatProps) {
  const t = useTranslations('AccuracyStat');
  const tCommon = useTranslations('Common');
  const locale = useLocale();

  const [stat, setStat] = useState<AccuracyStatistic | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getAccuracyStatistic()
      .then((s) => {
        if (!cancelled) setStat(s);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  // The user-reported label, exactly as the API words it for this locale.
  const userReportedLabel = stat
    ? locale === 'fi'
      ? stat.label.fi
      : stat.label.en
    : null;

  const asOf = stat && !Number.isNaN(Date.parse(stat.asOf))
    ? new Date(stat.asOf).toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      })
    : null;

  if (variant === 'section') {
    return (
      <section
        aria-labelledby="accuracy-heading"
        data-testid="accuracy-section"
        className="mb-8 scroll-mt-16 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h2 id="accuracy-heading" className="mb-2 text-sm font-semibold text-gray-700">
          {t('heading')}
        </h2>

        {stat === null && !failed && (
          <p className="text-sm text-gray-400" aria-live="polite">
            {t('loading')}
          </p>
        )}

        {failed && stat === null && (
          <div>
            <p role="alert" className="text-sm text-error">
              {t('loadFailed')}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {tCommon('retry')}
            </button>
          </div>
        )}

        {stat !== null && stat.count === 0 && (
          <div data-testid="accuracy-empty">
            <p className="text-sm font-medium text-gray-900">{t('emptyTitle')}</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              {t('emptyBody')}
            </p>
            {userReportedLabel && (
              <p className="mt-2 text-xs text-gray-400">{userReportedLabel}</p>
            )}
          </div>
        )}

        {stat !== null && stat.count > 0 && (
          <div data-testid="accuracy-statistic">
            <p className="text-sm leading-relaxed text-gray-600">
              {t('shareLine', {
                share: formatShare(stat.withinMarginShare, locale),
              })}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {t('countLine', { count: stat.count })}
            </p>
            <p className="mt-2 text-xs text-gray-400">
              {userReportedLabel}
              {asOf !== null ? ` · ${t('asOfLine', { date: asOf })}` : ''}
            </p>
          </div>
        )}
      </section>
    );
  }

  // ── trust-row variant: a quiet column entry (home page) ──
  return (
    <div data-testid="accuracy-trust-row">
      <h3 className="text-sm font-semibold text-gray-900">{t('heading')}</h3>

      {stat === null && !failed && (
        <p className="mt-1.5 text-sm text-gray-400" aria-live="polite">
          {t('loading')}
        </p>
      )}

      {failed && stat === null && (
        <p className="mt-1.5 text-sm text-gray-400">{t('loadFailed')}</p>
      )}

      {stat !== null && stat.count === 0 && (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
            {t('emptyTitle')}.
          </p>
          {userReportedLabel && (
            <p className="mt-1 text-xs text-gray-400">{userReportedLabel}</p>
          )}
        </>
      )}

      {stat !== null && stat.count > 0 && (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
            {t('shareLine', {
              share: formatShare(stat.withinMarginShare, locale),
            })}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            {t('countLine', { count: stat.count })}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {userReportedLabel}
            {asOf !== null ? ` · ${t('asOfLine', { date: asOf })}` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Format the within-margin fraction for the share line. The share is a
 * fraction in [0,1]; a non-finite or out-of-range value falls back to a
 * dash rather than a fabricated number.
 */
function formatShare(share: number | null, locale: string): string {
  if (share === null || !Number.isFinite(share) || share < 0 || share > 1) {
    return '–';
  }
  const percent = share * 100;
  const formatted = percent.toFixed(percent % 1 === 0 ? 0 : 1);
  return locale === 'fi' ? `${formatted.replace('.', ',')} %` : `${formatted} %`;
}
