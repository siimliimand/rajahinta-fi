'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getAccuracyBreakdown, getAccuracyStatistic } from '@/lib/api';
import type {
  AccuracyBreakdown,
  AccuracyBreakdownCell,
  AccuracyBreakdownDimension,
  AccuracyCoverage,
  AccuracyStatistic,
} from '@/lib/types';
import { categoryLabel } from '../products/category-labels';

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

/** The two split dimensions the breakdown endpoint accepts. */
const DIMENSIONS: readonly AccuracyBreakdownDimension[] = [
  'category',
  'carrier',
];

/**
 * The public accuracy statistic (trust-and-reach-roadmap task 3.3, spec
 * calculation-outcomes "Public accuracy statistic labeled user-reported";
 * breakdown task 5.2, change expand-alerts-accuracy-breakdowns).
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
 * Coverage mode (honest-trust-surfaces task 3.2, design D4): when the
 * count is 0 AND the response carries the additive `coverage` block, the
 * island renders that block instead — products tracked, offer
 * observations, last sync — labeled as catalog coverage ("Seurattu
 * valikoima"), visually distinct from the accuracy presentation (its own
 * label and layout, no share, no sample size, no breakdown selector).
 * The flip is data-driven only: the first non-zero count returns the
 * island to the user-reported presentation with no code change. A
 * count-0 response WITHOUT the block (captured before task 3.1) keeps
 * the honest empty state.
 *
 * Breakdown (section variant only): a category | carrier selector fetches
 * `?groupBy=…` and renders one block per cell by its API-supplied state —
 * `share` renders share + count, `count_only` renders the count with the
 * suppression reason and NEVER a percentage (the share never enters the
 * response below the floor), `empty` renders the honest empty state. The
 * trust-row variant keeps the global figure and gains no selector.
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

  // Coverage mode (design D4): a count-0 response with the additive
  // coverage block renders the catalog-coverage presentation; a count-0
  // response without the block falls through to the honest empty state,
  // and any non-zero count always renders the user-reported statistic.
  const coverageBlock =
    stat !== null && stat.count === 0 ? stat.coverage ?? null : null;

  if (variant === 'section') {
    return (
      <section
        aria-labelledby="accuracy-heading"
        data-testid="accuracy-section"
        className="mb-8 scroll-mt-16 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h2 id="accuracy-heading" className="mb-2 text-sm font-semibold text-gray-700">
          {coverageBlock !== null ? t('coverageLabel') : t('heading')}
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

        {coverageBlock !== null && (
          <AccuracyCoverageBlock coverage={coverageBlock} locale={locale} />
        )}

        {coverageBlock === null && stat !== null && stat.count === 0 && (
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

        {coverageBlock === null && stat !== null && stat.count > 0 && (
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

        {/* ── Breakdown (task 5.2): the selector rides below the global
                figure — the global statistic stays the default view, and
                picking a dimension fetches its split. Picking the active
                dimension again returns to the global figure. In coverage
                mode there are no outcomes to split, so the selector does
                not render. ── */}
        {coverageBlock === null && stat !== null && (
          <AccuracyBreakdownPanel locale={locale} />
        )}
      </section>
    );
  }

  // ── trust-row variant: a quiet column entry (home page) ──
  return (
    <div data-testid="accuracy-trust-row">
      <h3 className="text-sm font-semibold text-gray-900">
        {coverageBlock !== null ? t('coverageLabel') : t('heading')}
      </h3>

      {stat === null && !failed && (
        <p className="mt-1.5 text-sm text-gray-400" aria-live="polite">
          {t('loading')}
        </p>
      )}

      {failed && stat === null && (
        <p className="mt-1.5 text-sm text-gray-400">{t('loadFailed')}</p>
      )}

      {coverageBlock !== null && (
        <AccuracyCoverageBlock coverage={coverageBlock} locale={locale} />
      )}

      {coverageBlock === null && stat !== null && stat.count === 0 && (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
            {t('emptyTitle')}.
          </p>
          {userReportedLabel && (
            <p className="mt-1 text-xs text-gray-400">{userReportedLabel}</p>
          )}
        </>
      )}

      {coverageBlock === null && stat !== null && stat.count > 0 && (
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

// ---------------------------------------------------------------------------
// Coverage block (task 3.2, design D4)
// ---------------------------------------------------------------------------

/**
 * The catalog-coverage presentation: the three true values from the
 * accuracy response's additive `coverage` block, labeled as catalog
 * coverage and laid out as a label/value list — deliberately unlike the
 * share/count paragraphs of the user-reported statistic, so the two
 * modes cannot be mistaken for each other. An absent or unparseable
 * watermark renders no sync row: only what exists.
 */
function AccuracyCoverageBlock({
  coverage,
  locale,
}: {
  coverage: AccuracyCoverage;
  locale: string;
}) {
  const t = useTranslations('AccuracyStat');

  const lastSync =
    coverage.lastIngestAt !== null &&
    !Number.isNaN(Date.parse(coverage.lastIngestAt))
      ? new Date(coverage.lastIngestAt).toLocaleDateString(
          locale === 'fi' ? 'fi-FI' : 'en-GB',
          { year: 'numeric', month: 'numeric', day: 'numeric' },
        )
      : null;

  return (
    <div
      data-testid="accuracy-coverage"
      className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3"
    >
      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-gray-500">
            {t('coverageProductsLabel')}
          </dt>
          <dd className="text-sm font-medium text-gray-900">
            {coverage.productCount}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-gray-500">
            {t('coverageObservationsLabel')}
          </dt>
          <dd className="text-sm font-medium text-gray-900">
            {coverage.offerObservations}
          </dd>
        </div>
        {lastSync !== null && (
          <div
            className="flex items-baseline justify-between gap-3"
            data-testid="accuracy-coverage-last-sync"
          >
            <dt className="text-xs text-gray-500">
              {t('coverageSyncLabel')}
            </dt>
            <dd className="text-sm font-medium text-gray-900">{lastSync}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        {t('coverageNote')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown panel (section variant only, task 5.2)
// ---------------------------------------------------------------------------

/**
 * The category | carrier selector and its cells. Kept as a subcomponent
 * so the fetch lifecycle rides the selected dimension alone — the global
 * statistic above is untouched by breakdown loads and failures.
 */
function AccuracyBreakdownPanel({ locale }: { locale: string }) {
  const t = useTranslations('AccuracyStat');
  const tCommon = useTranslations('Common');

  const [dimension, setDimension] = useState<AccuracyBreakdownDimension | null>(
    null,
  );
  const [breakdown, setBreakdown] = useState<AccuracyBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (dimension === null) {
      setBreakdown(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getAccuracyBreakdown(dimension)
      .then((b) => {
        if (!cancelled) setBreakdown(b);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dimension, reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  const toggleDimension = useCallback((next: AccuracyBreakdownDimension) => {
    setDimension((prev) => (prev === next ? null : next));
  }, []);

  const breakdownLabel =
    breakdown !== null
      ? locale === 'fi'
        ? breakdown.label.fi
        : breakdown.label.en
      : null;

  const breakdownAsOf =
    breakdown !== null && !Number.isNaN(Date.parse(breakdown.asOf))
      ? new Date(breakdown.asOf).toLocaleDateString(
          locale === 'fi' ? 'fi-FI' : 'en-GB',
          { year: 'numeric', month: 'numeric', day: 'numeric' },
        )
      : null;

  return (
    <div
      data-testid="accuracy-breakdown"
      className="mt-4 border-t border-gray-100 pt-4"
    >
      <p className="text-xs font-medium text-gray-500">{t('dimensionLabel')}</p>
      <div
        role="group"
        aria-label={t('dimensionLabel')}
        className="mt-2 flex gap-2"
      >
        {DIMENSIONS.map((dim) => (
          <button
            key={dim}
            type="button"
            aria-pressed={dimension === dim}
            data-testid={`accuracy-dimension-${dim}`}
            onClick={() => toggleDimension(dim)}
            className={
              dimension === dim
                ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700'
                : 'rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50'
            }
          >
            {dim === 'category' ? t('dimensionCategory') : t('dimensionCarrier')}
          </button>
        ))}
      </div>

      {dimension !== null && loading && (
        <p className="mt-3 text-sm text-gray-400" aria-live="polite">
          {t('loading')}
        </p>
      )}

      {dimension !== null && failed && breakdown === null && (
        <div className="mt-3">
          <p role="alert" className="text-sm text-error">
            {t('breakdownFailed')}
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

      {breakdown !== null && (
        <ul
          data-testid="accuracy-breakdown-cells"
          className="mt-3 divide-y divide-gray-100"
        >
          {breakdown.cells.map((cell) => (
            <BreakdownCellRow
              key={cell.key}
              cell={cell}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {breakdown !== null && (
        <p className="mt-3 text-xs text-gray-400">
          {breakdownLabel}
          {breakdownAsOf !== null
            ? ` · ${t('asOfLine', { date: breakdownAsOf })}`
            : ''}
        </p>
      )}
    </div>
  );
}

/**
 * One breakdown cell by its API-supplied honesty state. The state comes
 * from the endpoint (design D5): only `share` cells carry a numeric
 * share, so a below-floor percentage cannot exist here even by accident.
 */
function BreakdownCellRow({
  cell,
  locale,
}: {
  cell: AccuracyBreakdownCell;
  locale: string;
}) {
  const t = useTranslations('AccuracyStat');

  return (
    <li
      data-testid="accuracy-breakdown-cell"
      data-state={cell.state}
      className="py-2"
    >
      <p className="text-xs font-medium text-gray-700">
        {cellLabel(cell.key, locale)}
      </p>
      {cell.state === 'share' && (
        <>
          <p className="mt-0.5 text-sm text-gray-600">
            {t('shareLine', {
              share: formatShare(cell.withinMarginShare, locale),
            })}
          </p>
          <p className="text-sm text-gray-700">
            {t('countLine', { count: cell.count })}
          </p>
        </>
      )}
      {cell.state === 'count_only' && (
        <>
          {/* Count only — no share is rendered because none arrived. */}
          <p className="mt-0.5 text-sm text-gray-700">
            {t('countLine', { count: cell.count })}
          </p>
          <p className="text-xs text-gray-500">{t('countOnlyNote')}</p>
        </>
      )}
      {cell.state === 'empty' && (
        <p className="mt-0.5 text-sm text-gray-400">{t('cellEmpty')}</p>
      )}
    </li>
  );
}

/** Localized label for a category cell key; carrier keys render verbatim
 *  (they are the transport offers' carrier identifiers — factual values,
 *  not vocabulary the catalogs carry). */
function cellLabel(key: string, locale: string): string {
  return categoryLabel(key, locale === 'fi' ? 'fi' : 'en');
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
