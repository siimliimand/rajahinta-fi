'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PriceHistoryPoint, PriceHistoryResponse } from '@/lib/types';

/**
 * PriceHistoryChart (task 5.1, change price-intelligence-roadmap).
 *
 * Client presentation for the per-product price history on the product
 * page. The DATA is fetched server-side (page.tsx, fixed prerender age
 * token — the endpoint is age-gated) and handed in as a prop; this
 * component owns only the range view and rendering:
 *
 *  - Range toggle 30 / 90 / 365 days: a local, deterministic slice of the
 *    already-fetched daily series (the server fetch covers the widest
 *    range the API allows, 365 days) — no extra requests, and the figures
 *    stay byte-identical across toggles.
 *  - Inline SVG line chart (avg per daily bucket, min–max band), pure SVG
 *    like the calculator HistoryChart — no chart library.
 *  - Accessible data-table alternative carrying the SAME figures as the
 *    chart (full parity: one row per plotted bucket, same avg/min/max and
 *    observation dates).
 *  - Observation dates are stated: the bucket line names the shown range,
 *    the table repeats each bucket's date, and "data available from"
 *    bounds the history when the API reports a truncated one.
 *  - Empty history → renders NOTHING (the whole section is absent).
 *
 * Neutrality: one series, one neutral stroke color; color never encodes
 * price position, and no direction is implied by the chart alone.
 */

const DAY_MS = 86_400_000;

/** Range options, in display order; default selection is 90 days. */
const RANGE_OPTIONS = [30, 90, 365] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

const DEFAULT_RANGE: RangeDays = 90;

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 280;
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 16;
const MARGIN_UPPER = 16;
const MARGIN_LOWER = 32;
const INNER_LEFT = MARGIN_LEFT;
const INNER_RIGHT = VIEW_WIDTH - MARGIN_RIGHT;
const INNER_TOP = MARGIN_UPPER;
const INNER_BOTTOM = VIEW_HEIGHT - MARGIN_LOWER;
const INNER_WIDTH = INNER_RIGHT - INNER_LEFT;
const INNER_HEIGHT = INNER_BOTTOM - INNER_TOP;
const Y_TICKS = 4;

/** Parse an ISO date ('YYYY-MM-DD') to UTC-midnight milliseconds. */
function parseDateMs(iso: string): number {
  return Date.parse(iso.length > 10 ? iso.slice(0, 10) : iso);
}

/** Locale-appropriate full date for observation timestamps. */
function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Short Finnish-style axis label: `26.8.` */
function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** Full Finnish-style date for the axis when the range is wide: `26.8.2026` */
function formatAxisFullDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

/** Euro amount from integer cents — page-consistent `12.34 €` form. */
function formatEur(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

/** Round to two decimals to keep SVG coordinate strings compact. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Smallest 1 / 2 / 2.5 / 5 × 10^n ≥ value; 100 floor for degenerate data. */
function niceCeil(value: number): number {
  if (value <= 0) return 100;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

/**
 * The range slice, exported for the parity tests: the points of `series`
 * whose bucket start falls inside the LAST `rangeDays` days of the
 * response's echoed window, ascending by date. Pure and deterministic —
 * the chart and the table are fed from this one array.
 */
export function sliceSeries(
  history: PriceHistoryResponse,
  rangeDays: RangeDays,
): PriceHistoryPoint[] {
  const fromMs = parseDateMs(history.to) - (rangeDays - 1) * DAY_MS;
  return history.series
    .filter((p) => parseDateMs(p.periodStart) >= fromMs)
    .sort((a, b) => parseDateMs(a.periodStart) - parseDateMs(b.periodStart));
}

interface PriceHistoryChartProps {
  /** Server-fetched response for the widest (365-day) window. */
  readonly history: PriceHistoryResponse;
}

export default function PriceHistoryChart({ history }: PriceHistoryChartProps) {
  const t = useTranslations('PriceHistoryChart');
  const locale = useLocale();
  const [range, setRange] = useState<RangeDays>(DEFAULT_RANGE);
  const titleId = useId();
  const descId = useId();

  // Section absent when no history — not an empty box, nothing at all.
  if (history.series.length === 0) {
    return null;
  }

  const points = sliceSeries(history, range);
  const metricLabel = t('metricLabel');
  const shownFrom = points.length > 0 ? parseDateMs(points[0]!.periodStart) : null;
  const shownTo = points.length > 0 ? parseDateMs(points[points.length - 1]!.periodStart) : null;

  // Scale from the SHOWN slice only; zero-based y is the honest baseline.
  let rawMax = 0;
  for (const p of points) {
    if (p.maxCents > rawMax) rawMax = p.maxCents;
  }
  const yMax = niceCeil(rawMax > 0 ? rawMax * 1.05 : 100);
  const x = (ms: number) =>
    INNER_LEFT + ((ms - (shownFrom ?? 0)) / Math.max(shownTo! - (shownFrom ?? 0), 1)) * INNER_WIDTH;
  const y = (cents: number) => INNER_TOP + INNER_HEIGHT - (cents / yMax) * INNER_HEIGHT;

  const linePoints = points
    .map((p) => `${r2(x(parseDateMs(p.periodStart)))},${r2(y(p.avgCents))}`)
    .join(' ');
  const bandPoints = [
    ...points.map((p) => `${r2(x(parseDateMs(p.periodStart)))},${r2(y(p.maxCents))}`),
    ...points
      .slice()
      .reverse()
      .map((p) => `${r2(x(parseDateMs(p.periodStart)))},${r2(y(p.minCents))}`),
  ].join(' ');

  const tickCount = points.length >= 90 ? 6 : points.length >= 21 ? 4 : points.length >= 3 ? 3 : 2;
  const ticks =
    shownFrom !== null && shownTo !== null
      ? Array.from(
          { length: tickCount },
          (_, i) => shownFrom + ((shownTo - shownFrom) * i) / (tickCount - 1),
        )
      : [];
  const includeYear = range === 365;

  const totalObservations = points.reduce((n, p) => n + p.observationCount, 0);

  return (
    <section
      aria-label={t('ariaLabel')}
      data-testid="price-history-section"
      className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
        {t('heading')}
      </h2>
      {/* Observation dates stated: the shown window, bucket count, and
          observation count — every displayed figure traceable. */}
      <p className="mb-4 text-xs text-gray-400" data-testid="price-history-window">
        {t('bucketsLine', {
          from: shownFrom !== null ? formatDate(new Date(shownFrom).toISOString(), locale) : '—',
          to: shownTo !== null ? formatDate(new Date(shownTo).toISOString(), locale) : '—',
          buckets: points.length,
          observations: totalObservations,
        })}
      </p>
      {history.earliestAvailableObservationDate && (
        <p className="mb-4 text-xs text-gray-400">
          {t('availableFrom', {
            date: formatDate(history.earliestAvailableObservationDate, locale),
          })}
        </p>
      )}

      {/* Range toggle — identical button styling for every option. */}
      <div
        role="group"
        aria-label={t('rangeGroup')}
        className="mb-4 flex items-center gap-1"
      >
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`price-history-range-${option}`}
            aria-pressed={range === option}
            onClick={() => setRange(option)}
            className={[
              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              range === option
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400',
            ].join(' ')}
          >
            {t(`range.${option}`)}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        data-testid="price-history-svg"
      >
        <title id={titleId}>{t('chartTitle', { metric: metricLabel })}</title>
        <desc id={descId}>
          {t('chartDesc', {
            buckets: points.length,
            from: shownFrom !== null ? formatDate(new Date(shownFrom).toISOString(), locale) : '—',
            to: shownTo !== null ? formatDate(new Date(shownTo).toISOString(), locale) : '—',
          })}
        </desc>

        {/* Horizontal grid + euro labels */}
        {Array.from({ length: Y_TICKS + 1 }, (_, i) => {
          const cents = (yMax / Y_TICKS) * i;
          return (
            <g key={`y-${i}`}>
              <line
                x1={INNER_LEFT}
                x2={INNER_RIGHT}
                y1={y(cents)}
                y2={y(cents)}
                className={i === 0 ? 'stroke-gray-300' : 'stroke-gray-100'}
                strokeWidth={1}
              />
              <text
                x={INNER_LEFT - 8}
                y={y(cents) + 3}
                textAnchor="end"
                className="fill-gray-500 text-[10px]"
              >
                {formatEur(cents)}
              </text>
            </g>
          );
        })}

        {/* Time axis */}
        <line
          x1={INNER_LEFT}
          x2={INNER_RIGHT}
          y1={INNER_BOTTOM}
          y2={INNER_BOTTOM}
          className="stroke-gray-300"
          strokeWidth={1}
        />
        {ticks.map((ms, i) => (
          <text
            key={`x-${i}`}
            x={i === 0 ? INNER_LEFT : i === ticks.length - 1 ? INNER_RIGHT : x(ms)}
            y={VIEW_HEIGHT - 10}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
            className="fill-gray-500 text-[10px]"
          >
            {includeYear ? formatAxisFullDate(ms) : formatShortDate(ms)}
          </text>
        ))}

        {/* Single neutral series: min–max band, then the average line */}
        {points.length > 0 && (
          <g data-testid="price-history-series">
            <polygon
              data-testid="price-history-band"
              points={bandPoints}
              className="fill-primary-600/10"
              stroke="none"
            />
            <polyline
              data-testid="price-history-line"
              points={linePoints}
              className="stroke-primary-600"
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>

      {/* Data-table alternative — full parity with the plotted slice:
          one row per bucket, same figures, observation dates visible. */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-primary-700">
          {t('tableSummary')}
        </summary>
        <div className="mt-2 max-h-96 overflow-y-auto">
          <table className="w-full text-sm" data-testid="price-history-table">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-4 font-medium">{t('columnDate')}</th>
                <th className="pb-2 pr-4 font-medium">{t('columnAverage')}</th>
                <th className="pb-2 pr-4 font-medium">{t('columnMin')}</th>
                <th className="pb-2 pr-4 font-medium">{t('columnMax')}</th>
                <th className="pb-2 font-medium">{t('columnObservations')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {points.map((p) => (
                <tr key={p.periodStart} data-testid="price-history-row">
                  <td className="py-1.5 pr-4 text-gray-700">
                    {formatDate(p.periodStart, locale)}
                  </td>
                  <td className="py-1.5 pr-4 font-medium text-gray-900">
                    {formatEur(p.avgCents)}
                  </td>
                  <td className="py-1.5 pr-4 text-gray-500">{formatEur(p.minCents)}</td>
                  <td className="py-1.5 pr-4 text-gray-500">{formatEur(p.maxCents)}</td>
                  <td className="py-1.5 text-gray-500">{p.observationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
