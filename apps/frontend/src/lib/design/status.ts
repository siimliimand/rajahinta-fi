/**
 * Canonical reliability- and confidence-status metadata
 * (OpenSpec: design-system-foundation, task 2.2).
 *
 * Single source of truth for status presentation across the frontend.
 * Components must not keep private status-color maps — import from here
 * (directly or via the `@/components/ui` Badge primitives, which render
 * the same palette).
 *
 * Status hue ladder (design.md D1/D2):
 *   VERIFIED   → green   (observed data)
 *   ESTIMATED  → blue    (derived from incomplete data; informational,
 *                         not a warning)
 *   STALE      → amber   (amber belongs to staleness alone)
 *   UNAVAILABLE→ gray    (no data exists: absence, not danger)
 * Red sits outside the ladder, reserved for errors and destructive
 * affordances — a red badge always means "something is wrong", never
 * "we don't know".
 *
 * All classes reference the CSS-variable token palette from globals.css
 * (mapped in tailwind.config.ts). Never apply Tailwind opacity modifiers
 * to these (e.g. `bg-status-verified/10`) — they do not work on var-based
 * colors; the explicit `-bg` tint tokens exist for surfaces.
 *
 * Labels are message-catalog keys (full dotted paths into
 * `src/messages/{fi,en}.json`), never hardcoded strings. Resolve them with
 * a root next-intl translator: `const t = useTranslations(); t(meta.labelKey)`.
 *
 * Accessibility: color is never the sole carrier of meaning. Status dots
 * differ in shape as well as hue, badges carry distinct icon shapes, and
 * confidence badges use a bar-count meter — every status survives
 * grayscale and color-blindness.
 */

import type { ConfidenceLevel, ReliabilityStatus } from '@/lib/types';

/** Hue-ladder tone per reliability status (D1/D2). */
export type ReliabilityTone = 'verified' | 'estimated' | 'stale' | 'unavailable';

/**
 * Confidence tones reuse the closest ladder groups: HIGH=green (verified),
 * MEDIUM=amber (stale), LOW=red (error — low confidence flags a problem
 * with the numbers, which red legitimately signals).
 */
export type ConfidenceTone = 'verified' | 'stale' | 'error';

/** Token classes for a tinted badge surface (border + fill + on-fill text). */
export interface StatusBadgeClasses {
  readonly bg: string;
  readonly fg: string;
  readonly border: string;
}

/**
 * Icon affordance per reliability status, matching the shapes rendered by
 * `ReliabilityIcon` in `@/components/ui/Badge`: check (verified), wave
 * (estimated — approximate value), clock (stale), dashed circle
 * (unavailable — no data).
 */
export type ReliabilityIconName = 'check' | 'wave' | 'clock' | 'dashed-circle';

export interface ReliabilityStatusMeta {
  /** Ladder tone; structurally compatible with `BadgeTone` in the ui primitives. */
  readonly tone: ReliabilityTone;
  /** Full message-catalog key for the localized status label. */
  readonly labelKey: string;
  /** Grayscale-safe badge icon shape (see `ReliabilityIconName`). */
  readonly icon: ReliabilityIconName;
  /** Tinted badge surface tokens. */
  readonly badge: StatusBadgeClasses;
  /** Solid 700-step fill — dots, icons, chart marks. */
  readonly solid: string;
  /** Solid 700-step text — status-colored text on white surfaces. */
  readonly text: string;
  /**
   * Status dot classes: color AND shape, so meaning never rides on hue
   * alone. Shapes: VERIFIED solid circle, ESTIMATED rounded square,
   * STALE diamond, UNAVAILABLE hollow ring (absence renders as an empty
   * shape). Sizing and layout (`inline-block h-2 w-2 shrink-0`, …) belong
   * to the call site; do not add a competing `rounded-*` utility there.
   */
  readonly dot: string;
}

export interface ConfidenceLevelMeta {
  /** Tone; structurally compatible with `BadgeTone` in the ui primitives. */
  readonly tone: ConfidenceTone;
  /** Full message-catalog key for the localized level label. */
  readonly labelKey: string;
  /** Tinted badge surface tokens. */
  readonly badge: StatusBadgeClasses;
  /** Solid fill — dots and marks (pair with an adjacent text label). */
  readonly solid: string;
  /** Solid text — level-colored text on white surfaces. */
  readonly text: string;
}

/** Reliability status metadata keyed by the API's `ReliabilityStatus` union. */
export const RELIABILITY_STATUS_META: Record<ReliabilityStatus, ReliabilityStatusMeta> = {
  VERIFIED: {
    tone: 'verified',
    labelKey: 'Common.reliability.VERIFIED',
    icon: 'check',
    badge: {
      bg: 'bg-status-verified-bg',
      fg: 'text-status-verified-fg',
      border: 'border-status-verified-border',
    },
    solid: 'bg-status-verified',
    text: 'text-status-verified',
    dot: 'rounded-full bg-status-verified',
  },
  ESTIMATED: {
    tone: 'estimated',
    labelKey: 'Common.reliability.ESTIMATED',
    icon: 'wave',
    badge: {
      bg: 'bg-status-estimated-bg',
      fg: 'text-status-estimated-fg',
      border: 'border-status-estimated-border',
    },
    solid: 'bg-status-estimated',
    text: 'text-status-estimated',
    dot: 'rounded-[2px] bg-status-estimated',
  },
  STALE: {
    tone: 'stale',
    labelKey: 'Common.reliability.STALE',
    icon: 'clock',
    badge: {
      bg: 'bg-status-stale-bg',
      fg: 'text-status-stale-fg',
      border: 'border-status-stale-border',
    },
    solid: 'bg-status-stale',
    text: 'text-status-stale',
    dot: 'rotate-45 rounded-[2px] bg-status-stale',
  },
  UNAVAILABLE: {
    tone: 'unavailable',
    labelKey: 'Common.reliability.UNAVAILABLE',
    icon: 'dashed-circle',
    badge: {
      bg: 'bg-status-unavailable-bg',
      fg: 'text-status-unavailable-fg',
      border: 'border-status-unavailable-border',
    },
    solid: 'bg-status-unavailable',
    text: 'text-status-unavailable',
    // Hollow ring: no data exists, so the dot renders as an empty shape.
    // `border-status-unavailable` resolves to the solid gray-700 token,
    // not the pale -border tint.
    dot: 'rounded-full border-2 border-status-unavailable',
  },
};

/**
 * Confidence level metadata keyed by the API's `ConfidenceLevel` union.
 * Shape affordance for confidence lives in the `ConfidenceBadge` bar
 * meter (1/2/3 ascending bars), not in these classes — when rendering a
 * bare confidence dot, keep a text label adjacent.
 */
export const CONFIDENCE_LEVEL_META: Record<ConfidenceLevel, ConfidenceLevelMeta> = {
  HIGH: {
    tone: 'verified',
    labelKey: 'Common.confidence.HIGH',
    badge: {
      bg: 'bg-status-verified-bg',
      fg: 'text-status-verified-fg',
      border: 'border-status-verified-border',
    },
    solid: 'bg-status-verified',
    text: 'text-status-verified',
  },
  MEDIUM: {
    tone: 'stale',
    labelKey: 'Common.confidence.MEDIUM',
    badge: {
      bg: 'bg-status-stale-bg',
      fg: 'text-status-stale-fg',
      border: 'border-status-stale-border',
    },
    solid: 'bg-status-stale',
    text: 'text-status-stale',
  },
  LOW: {
    tone: 'error',
    labelKey: 'Common.confidence.LOW',
    badge: {
      bg: 'bg-error-bg',
      fg: 'text-error-fg',
      border: 'border-error-border',
    },
    solid: 'bg-error',
    text: 'text-error',
  },
};
