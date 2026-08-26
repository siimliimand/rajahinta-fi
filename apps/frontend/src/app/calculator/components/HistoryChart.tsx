'use client';

import React, { useId } from 'react';
import type {
  PriceHistoryAttribution,
  PriceHistoryGranularity,
  PriceHistoryMetric,
  PriceHistoryPoint,
  PriceHistoryStepClassification,
  ReliabilityStatus,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * One named chart series: a merchant, or the product-wide aggregate
 * (`merchant: null`). Series receive strictly identical visual treatment —
 * colour is assigned by sorted name, never by price position.
 */
export interface HistoryChartSeries {
  /** Merchant display name, or null for the product-wide aggregate. */
  readonly merchant: string | null;
  readonly points: readonly PriceHistoryPoint[];
}

interface HistoryChartProps {
  /** Which metric the series project (price = foreign retail price). */
  readonly metric: PriceHistoryMetric;
  /** Bucket granularity — also drives gap detection for line breaks. */
  readonly granularity: PriceHistoryGranularity;
  readonly series: readonly HistoryChartSeries[];
  /** Classified changes (evidence) used to place tax-rule markers. */
  readonly attribution?: readonly PriceHistoryAttribution[];
  /** Earliest observation date, or null — drives "data available from". */
  readonly earliestAvailableObservationDate?: string | null;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 300;
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 16;
const MARGIN_UPPER = 40;
const MARGIN_LOWER = 32;
const INNER_LEFT = MARGIN_LEFT;
const INNER_RIGHT = VIEW_WIDTH - MARGIN_RIGHT;
const INNER_TOP = MARGIN_UPPER;
const INNER_BOTTOM = VIEW_HEIGHT - MARGIN_LOWER;
const INNER_WIDTH = INNER_RIGHT - INNER_LEFT;
const INNER_HEIGHT = INNER_BOTTOM - INNER_TOP;

const Y_TICKS = 4;
/** Identical stroke weight for every series — neutrality requirement. */
const SERIES_STROKE_WIDTH = 2;
/** Consecutive buckets further apart than 1.5 steps break the line (gaps). */
const GAP_TOLERANCE = 1.5;

// ---------------------------------------------------------------------------
// Controlled-vocabulary labels and colour coding
// ---------------------------------------------------------------------------

const METRIC_LABEL: Record<PriceHistoryMetric, string> = {
  price: 'Foreign retail price',
  'landed-cost': 'Landed cost',
};

const GRANULARITY_LABEL: Record<PriceHistoryGranularity, string> = {
  day: 'Daily',
  week: 'Weekly',
};

/**
 * Reliability badge colours per DESIGN.md: green VERIFIED, amber STALE,
 * gray UNAVAILABLE, blue ESTIMATED. Badges render as visible pills next to
 * each series — never hidden in tooltips.
 */
const RELIABILITY_BADGE: Record<
  ReliabilityStatus,
  { bg: string; text: string; label: string }
> = {
  VERIFIED: { bg: 'bg-green-100', text: 'text-green-800', label: 'Verified' },
  STALE: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Stale' },
  UNAVAILABLE: {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: 'Unavailable',
  },
  ESTIMATED: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Estimated' },
};

/**
 * Strictest-wins ordering mirroring RELIABILITY_ORDER from core-domain
 * (best to worst); the highest index is the most conservative status.
 */
const RELIABILITY_STRICTEST_ORDER: readonly ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

/** Step classifications are observations with evidence, not conclusions. */
const CLASSIFICATION_LABEL: Record<PriceHistoryStepClassification, string> = {
  TAX_RULE_CHANGE: 'Tax rule change',
  MERCHANT_PRICE_CHANGE: 'Merchant price change',
  TRANSPORT_CHANGE: 'Transport cost change',
  MIXED: 'Multiple changes',
  UNCHANGED: 'No change',
};

/** Display name for the product-wide aggregate series. */
const ALL_MERCHANTS_LABEL = 'All merchants';

/**
 * Deterministic categorical colour cycle. Assignment is by index in the
 * name-sorted series list; every series gets the same stroke weight, dot
 * radius, and band opacity pattern — no merchant is visually prominent.
 */
const SERIES_COLORS: readonly {
  stroke: string;
  fill: string;
  band: string;
  bg: string;
}[] = [
  {
    stroke: 'stroke-primary-600',
    fill: 'fill-primary-600',
    band: 'fill-primary-600/10',
    bg: 'bg-primary-600',
  },
  {
    stroke: 'stroke-emerald-600',
    fill: 'fill-emerald-600',
    band: 'fill-emerald-600/10',
    bg: 'bg-emerald-600',
  },
  {
    stroke: 'stroke-violet-600',
    fill: 'fill-violet-600',
    band: 'fill-violet-600/10',
    bg: 'bg-violet-600',
  },
  {
    stroke: 'stroke-orange-600',
    fill: 'fill-orange-600',
    band: 'fill-orange-600/10',
    bg: 'bg-orange-600',
  },
  {
    stroke: 'stroke-cyan-600',
    fill: 'fill-cyan-600',
    band: 'fill-cyan-600/10',
    bg: 'bg-cyan-600',
  },
  {
    stroke: 'stroke-pink-600',
    fill: 'fill-pink-600',
    band: 'fill-pink-600/10',
    bg: 'bg-pink-600',
  },
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Format cents as a euro string (same convention as CalculatorResult). */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Parse an ISO date (or datetime) to UTC-midnight milliseconds. */
function parseDateMs(iso: string): number {
  return Date.parse(iso.length > 10 ? iso.slice(0, 10) : iso);
}

/** Short Finnish-style axis label: `26.8.` */
function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** Full Finnish-style date: `26.8.2026` */
function formatFullDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
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
    fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 2.5
          ? 2.5
          : fraction <= 5
            ? 5
            : 10;
  return nice * exponent;
}

/** Strictest (most conservative) reliability among a series' points. */
function strictestReliability(
  points: readonly PriceHistoryPoint[],
): ReliabilityStatus {
  let strictest: ReliabilityStatus = 'VERIFIED';
  for (const p of points) {
    if (
      RELIABILITY_STRICTEST_ORDER.indexOf(p.reliability) >
      RELIABILITY_STRICTEST_ORDER.indexOf(strictest)
    ) {
      strictest = p.reliability;
    }
  }
  return strictest;
}

/**
 * Split points into contiguous segments. A gap larger than 1.5 bucket steps
 * (a missing period) starts a new segment so the line does not imply
 * observations that do not exist.
 */
function buildSegments(
  points: readonly PriceHistoryPoint[],
  stepMs: number,
): PriceHistoryPoint[][] {
  const sorted = points
    .slice()
    .sort((a, b) => parseDateMs(a.periodStart) - parseDateMs(b.periodStart));
  const segments: PriceHistoryPoint[][] = [];
  let current: PriceHistoryPoint[] = [];
  for (const p of sorted) {
    if (
      current.length > 0 &&
      parseDateMs(p.periodStart) - parseDateMs(current[current.length - 1].periodStart) >
        stepMs * GAP_TOLERANCE
    ) {
      segments.push(current);
      current = [p];
    } else {
      current.push(p);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Code-unit ordering of series by name — deterministic across environments. */
function compareSeriesByName(
  a: HistoryChartSeries,
  b: HistoryChartSeries,
): number {
  const ka = a.merchant ?? '';
  const kb = b.merchant ?? '';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

interface TaxMarker {
  readonly dateMs: number;
  readonly label: string | null;
  readonly merchant: string;
  readonly classification: PriceHistoryStepClassification;
}

/**
 * Tax-rule markers from attribution evidence: steps where an excise or
 * container-duty rule version boundary was crossed. The marker label is the
 * bounding version transition (e.g. `v2.0-2025 → v3.0-2026`). Duplicate
 * date+label pairs (same boundary crossed by several merchants) collapse.
 */
function buildTaxMarkers(
  attribution: readonly PriceHistoryAttribution[],
): TaxMarker[] {
  const seen = new Set<string>();
  const markers: TaxMarker[] = [];
  for (const a of attribution) {
    if (!a.movedInputs.exciseRule && !a.movedInputs.containerDutyRule) continue;
    const boundary = a.exciseRuleBoundary ?? a.containerDutyRuleBoundary;
    const dateMs = parseDateMs(a.toObservedAt);
    const label = boundary
      ? `${boundary.fromVersionLabel ?? '—'} → ${boundary.toVersionLabel ?? '—'}`
      : null;
    const key = `${dateMs}|${label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    markers.push({
      dateMs,
      label,
      merchant: a.merchant,
      classification: a.classification,
    });
  }
  return markers.sort((x, y) => x.dateMs - y.dateMs);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Historical price / landed-cost line chart — pure SVG, no chart library.
 *
 * Presentation only: prepared series in, SVG + visible reliability badges
 * out. Data fetching, feature-flag gating, and metric switching belong to
 * the integrating page.
 *
 * Neutrality: series are sorted by name, share one colour cycle and one
 * stroke weight; colour never encodes price position.
 */
export default function HistoryChart({
  metric,
  granularity,
  series,
  attribution = [],
  earliestAvailableObservationDate = null,
}: HistoryChartProps) {
  const titleId = useId();
  const descId = useId();

  const plottable = series.filter((s) => s.points.length > 0);

  if (plottable.length === 0) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        data-testid="history-chart-empty"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {METRIC_LABEL[metric]} · history
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          No history data available for the selected range.
        </p>
        {earliestAvailableObservationDate && (
          <p className="mt-1 text-xs text-gray-400">
            Data available from{' '}
            {formatFullDate(parseDateMs(earliestAvailableObservationDate))}
          </p>
        )}
      </div>
    );
  }

  const stepMs = granularity === 'week' ? WEEK_MS : DAY_MS;
  const markers = buildTaxMarkers(attribution);

  // Time domain from the data itself (points + markers); padded when the
  // domain collapses to a single date so a lone point still gets a scale.
  let d0 = Infinity;
  let d1 = -Infinity;
  for (const s of plottable) {
    for (const p of s.points) {
      const t = parseDateMs(p.periodStart);
      if (t < d0) d0 = t;
      if (t > d1) d1 = t;
    }
  }
  for (const m of markers) {
    if (m.dateMs < d0) d0 = m.dateMs;
    if (m.dateMs > d1) d1 = m.dateMs;
  }
  if (d0 === d1) {
    d0 -= stepMs;
    d1 += stepMs;
  }

  // Shared y scale across all series (honest comparison); zero-based.
  let rawMax = 0;
  for (const s of plottable) {
    for (const p of s.points) {
      if (p.maxCents > rawMax) rawMax = p.maxCents;
    }
  }
  const yMax = niceCeil(rawMax > 0 ? rawMax * 1.05 : 100);

  const x = (t: number) => INNER_LEFT + ((t - d0) / (d1 - d0)) * INNER_WIDTH;
  const y = (cents: number) =>
    INNER_TOP + INNER_HEIGHT - (cents / yMax) * INNER_HEIGHT;

  // Time-axis labels are thinned so long ranges stay legible.
  const domainDays = (d1 - d0) / DAY_MS;
  const tickCount =
    domainDays >= 90 ? 6 : domainDays >= 21 ? 4 : domainDays >= 3 ? 3 : 2;
  const ticks = Array.from(
    { length: tickCount },
    (_, i) => d0 + ((d1 - d0) * i) / (tickCount - 1),
  );
  const includeYear = domainDays > 180;

  const ordered = plottable.slice().sort(compareSeriesByName);
  const totalObservations = plottable.reduce(
    (sum, s) => sum + s.points.reduce((n, p) => n + p.observationCount, 0),
    0,
  );

  const linePoints = (seg: readonly PriceHistoryPoint[]): string =>
    seg
      .map((p) => `${r2(x(parseDateMs(p.periodStart)))},${r2(y(p.avgCents))}`)
      .join(' ');

  const bandPoints = (seg: readonly PriceHistoryPoint[]): string => {
    const upper = seg.map(
      (p) => `${r2(x(parseDateMs(p.periodStart)))},${r2(y(p.maxCents))}`,
    );
    const lower = seg
      .slice()
      .reverse()
      .map(
        (p) => `${r2(x(parseDateMs(p.periodStart)))},${r2(y(p.minCents))}`,
      );
    return [...upper, ...lower].join(' ');
  };

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="history-chart"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {METRIC_LABEL[metric]} · history
      </h3>
      <p className="mt-0.5 text-xs text-gray-400">
        {GRANULARITY_LABEL[granularity]} buckets · {totalObservations}{' '}
        observations · {formatFullDate(d0)} – {formatFullDate(d1)}
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{`${METRIC_LABEL[metric]} history chart`}</title>
        <desc id={descId}>
          {`${ordered.length} series from ${formatFullDate(d0)} to ${formatFullDate(d1)}. ` +
            `${markers.length} tax rule change markers.`}
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
        {ticks.map((t, i) => (
          <text
            key={`x-${i}`}
            data-testid="axis-tick"
            x={
              i === 0
                ? INNER_LEFT
                : i === ticks.length - 1
                  ? INNER_RIGHT
                  : x(t)
            }
            y={VIEW_HEIGHT - 10}
            textAnchor={
              i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'
            }
            className="fill-gray-500 text-[10px]"
          >
            {includeYear ? formatFullDate(t) : formatShortDate(t)}
          </text>
        ))}

        {/* Tax-rule change markers with version labels */}
        {markers.map((m, i) => {
          const mx = x(m.dateMs);
          const nearLeft = mx - INNER_LEFT < 50;
          const nearRight = INNER_RIGHT - mx < 50;
          return (
            <g key={`marker-${i}`} data-testid="tax-marker">
              <line
                x1={mx}
                x2={mx}
                y1={INNER_TOP}
                y2={INNER_BOTTOM}
                className="stroke-gray-400"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              {m.label && (
                <text
                  x={nearLeft ? INNER_LEFT : nearRight ? INNER_RIGHT : mx}
                  y={i % 2 === 0 ? 16 : 30}
                  textAnchor={nearLeft ? 'start' : nearRight ? 'end' : 'middle'}
                  className="fill-gray-600 text-[10px]"
                >
                  {m.label}
                </text>
              )}
              <title>
                {`${m.merchant}: ${CLASSIFICATION_LABEL[m.classification]} ` +
                  formatFullDate(m.dateMs)}
              </title>
            </g>
          );
        })}

        {/* Series — identical stroke weight, name-sorted colour cycle */}
        {ordered.map((s, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          const name = s.merchant ?? ALL_MERCHANTS_LABEL;
          const segments = buildSegments(s.points, stepMs);
          return (
            <g key={`${si}-${name}`} data-testid="series-group">
              <title>{`${name} — ${METRIC_LABEL[metric]}`}</title>
              {segments.map((seg, gi) =>
                seg.length === 1 ? (
                  <circle
                    key={`seg-${gi}`}
                    data-testid="series-point"
                    cx={x(parseDateMs(seg[0].periodStart))}
                    cy={y(seg[0].avgCents)}
                    r={3}
                    className={color.fill}
                  />
                ) : (
                  <g key={`seg-${gi}`}>
                    <polygon
                      data-testid="series-band"
                      points={bandPoints(seg)}
                      className={color.band}
                      stroke="none"
                    />
                    <polyline
                      data-testid="series-line"
                      points={linePoints(seg)}
                      className={color.stroke}
                      fill="none"
                      strokeWidth={SERIES_STROKE_WIDTH}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                ),
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend: visible reliability / freshness badges per series */}
      <ul className="mt-2 divide-y divide-gray-100">
        {ordered.map((s, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          const status = strictestReliability(s.points);
          const badge = RELIABILITY_BADGE[status];
          const latestMs = Math.max(
            ...s.points.map((p) => parseDateMs(p.periodStart)),
          );
          const name = s.merchant ?? ALL_MERCHANTS_LABEL;
          return (
            <li
              key={`${si}-${name}`}
              className="flex flex-wrap items-center gap-2 py-1.5"
              data-testid="series-legend"
            >
              <span
                aria-hidden="true"
                className={`inline-block h-1 w-4 rounded-full ${color.bg}`}
              />
              <span className="text-sm text-gray-700">{name}</span>
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-tight ${badge.bg} ${badge.text}`}
              >
                {badge.label}
              </span>
              <span className="text-xs text-gray-400">
                Latest {formatFullDate(latestMs)}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Marker evidence for screen readers; the SVG labels stay visible */}
      {markers.length > 0 && (
        <ul className="sr-only">
          {markers.map((m, i) => (
            <li key={`marker-desc-${i}`}>
              {`${m.merchant}: ${CLASSIFICATION_LABEL[m.classification]} on ` +
                `${formatFullDate(m.dateMs)}${m.label ? `, ${m.label}` : ''}`}
            </li>
          ))}
        </ul>
      )}

      {earliestAvailableObservationDate && (
        <p className="mt-1 text-xs text-gray-400">
          Data available from{' '}
          {formatFullDate(parseDateMs(earliestAvailableObservationDate))}
        </p>
      )}
    </div>
  );
}
