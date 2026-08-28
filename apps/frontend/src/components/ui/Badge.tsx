import type { ReactNode } from 'react';
import type { ConfidenceLevel, ReliabilityStatus } from '@/lib/types';

/**
 * Badge primitives (OpenSpec: design-system-foundation, D1/D2/D5).
 *
 * Colors come exclusively from the status token palette in globals.css
 * (verified=green, estimated=blue, stale=amber, unavailable=gray, error=red).
 * Never use Tailwind opacity modifiers on these (e.g. `bg-status-verified/10`)
 * — they do not work on var-based colors; the explicit `-bg` tint tokens
 * exist for backgrounds.
 *
 * Color is never the sole carrier of meaning (design goal): every status
 * badge carries a distinct icon shape and every confidence badge a
 * bar-count meter, so the meaning survives grayscale and color-blindness.
 * Icons are aria-hidden; the visible text label is the accessible name.
 *
 * Confidence tones mirror the pre-existing per-component CONFIDENCE_META
 * maps (green/amber/red for HIGH/MEDIUM/LOW) using the closest token
 * groups: verified (green), stale (amber), error (red).
 */

export type BadgeTone =
  | 'verified'
  | 'estimated'
  | 'stale'
  | 'unavailable'
  | 'error'
  | 'neutral';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  className?: string;
  children: ReactNode;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  verified:
    'bg-status-verified-bg text-status-verified-fg border-status-verified-border',
  estimated:
    'bg-status-estimated-bg text-status-estimated-fg border-status-estimated-border',
  stale: 'bg-status-stale-bg text-status-stale-fg border-status-stale-border',
  unavailable:
    'bg-status-unavailable-bg text-status-unavailable-fg border-status-unavailable-border',
  error: 'bg-error-bg text-error-fg border-error-border',
  neutral: 'bg-gray-100 text-gray-800 border-gray-200',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[11px]',
  md: 'px-2 py-1 text-xs',
};

/** Generic tinted badge. The text content carries the meaning; tone is decorative. */
export function Badge({
  tone = 'neutral',
  size = 'md',
  className = '',
  children,
}: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={[
        'inline-flex items-center gap-1 rounded-md border font-medium leading-tight',
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reliability badges
// ---------------------------------------------------------------------------

/**
 * Grayscale-safe icon per reliability status: check (verified), wave
 * (estimated — approximate value), clock (stale), dashed circle
 * (unavailable — no data). Shapes differ so status survives without color.
 */
function ReliabilityIcon({ status }: { status: ReliabilityStatus }) {
  const common = {
    viewBox: '0 0 12 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
  } as const;

  switch (status) {
    case 'VERIFIED':
      return (
        <svg {...common} className="h-3 w-3 shrink-0">
          <path d="M2.5 6.3l2.3 2.3 4.7-5" />
        </svg>
      );
    case 'ESTIMATED':
      return (
        <svg {...common} className="h-3 w-3 shrink-0">
          <path d="M2 7.2c1.1-1.7 2.9-1.7 4 0s2.9 1.7 4 0" />
        </svg>
      );
    case 'STALE':
      return (
        <svg {...common} className="h-3 w-3 shrink-0">
          <circle cx="6" cy="6" r="4.25" />
          <path d="M6 3.6V6l1.7 1.2" />
        </svg>
      );
    case 'UNAVAILABLE':
      return (
        <svg {...common} className="h-3 w-3 shrink-0">
          <circle cx="6" cy="6" r="4.25" strokeDasharray="2 1.5" />
          <path d="M3.9 6h4.2" />
        </svg>
      );
  }
}

const RELIABILITY_TONE: Record<ReliabilityStatus, BadgeTone> = {
  VERIFIED: 'verified',
  ESTIMATED: 'estimated',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
};

export interface ReliabilityBadgeProps {
  status: ReliabilityStatus;
  size?: BadgeSize;
  className?: string;
  /**
   * Localized label (e.g. from next-intl `Common.reliability.<status>`).
   * Falls back to the raw status string so the badge is never unlabeled.
   */
  children?: ReactNode;
}

/** Reliability status badge using the D1/D2 hue ladder. */
export function ReliabilityBadge({
  status,
  size = 'sm',
  className = '',
  children,
}: ReliabilityBadgeProps) {
  return (
    <Badge tone={RELIABILITY_TONE[status]} size={size} className={className}>
      <ReliabilityIcon status={status} />
      {children ?? status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Confidence badges
// ---------------------------------------------------------------------------

const CONFIDENCE_TONE: Record<ConfidenceLevel, BadgeTone> = {
  HIGH: 'verified',
  MEDIUM: 'stale',
  LOW: 'error',
};

const CONFIDENCE_FILLED_BARS: Record<ConfidenceLevel, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Signal-strength meter: LOW/MEDIUM/HIGH fill 1/2/3 ascending bars.
 * The filled count distinguishes levels without relying on hue.
 */
function ConfidenceBars({ level }: { level: ConfidenceLevel }) {
  const filled = CONFIDENCE_FILLED_BARS[level];
  const heights = ['h-1', 'h-1.5', 'h-2'];
  return (
    <span aria-hidden="true" className="flex shrink-0 items-end gap-px">
      {heights.map((height, index) => (
        <span
          key={height}
          className={`w-0.5 rounded-sm bg-current ${height} ${
            index < filled ? '' : 'opacity-40'
          }`}
        />
      ))}
    </span>
  );
}

export interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  size?: BadgeSize;
  className?: string;
  /**
   * Localized label (e.g. from next-intl `Common.confidence.<level>`).
   * Falls back to the raw level string so the badge is never unlabeled.
   */
  children?: ReactNode;
}

/** Confidence level badge (HIGH/MEDIUM/LOW), pill-shaped like the existing inline badges. */
export function ConfidenceBadge({
  level,
  size = 'md',
  className = '',
  children,
}: ConfidenceBadgeProps) {
  return (
    <span
      data-level={level}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border font-medium leading-tight',
        TONE_CLASSES[CONFIDENCE_TONE[level]],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ConfidenceBars level={level} />
      {children ?? level}
    </span>
  );
}
