/**
 * Canonical status module invariants (design.md D1/D2).
 *
 * Pure module test — node environment, no DOM needed.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import type { ReliabilityStatusMeta, ConfidenceLevelMeta } from '@/lib/design/status';
import type { BadgeTone } from '@/components/ui/Badge';
import type { ConfidenceLevel, ReliabilityStatus } from '@/lib/types';
import fiMessages from '@/messages/fi.json';
import enMessages from '@/messages/en.json';

const RELIABILITY_STATUSES: readonly ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];

/** Resolve a dotted message-catalog key to its leaf string, if present. */
function resolveCatalogString(
  messages: unknown,
  key: string,
): string | undefined {
  const leaf = key.split('.').reduce<unknown>((node, part) => {
    if (node != null && typeof node === 'object') {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
  return typeof leaf === 'string' ? leaf : undefined;
}

/** All Tailwind classes an element of this meta could contribute. */
function reliabilityClasses(meta: ReliabilityStatusMeta): string[] {
  return [
    meta.badge.bg,
    meta.badge.fg,
    meta.badge.border,
    meta.solid,
    meta.text,
    meta.dot,
  ];
}

function confidenceClasses(meta: ConfidenceLevelMeta): string[] {
  return [meta.badge.bg, meta.badge.fg, meta.badge.border, meta.solid, meta.text];
}

describe('RELIABILITY_STATUS_META — D1/D2 hue ladder', () => {
  it('covers exactly the ReliabilityStatus union', () => {
    expect(Object.keys(RELIABILITY_STATUS_META).sort()).toEqual(
      [...RELIABILITY_STATUSES].sort(),
    );
  });

  it('maps VERIFIED to the green (verified) token group', () => {
    const meta = RELIABILITY_STATUS_META.VERIFIED;
    expect(meta.tone).toBe('verified');
    expect(meta.badge.bg).toBe('bg-status-verified-bg');
    expect(meta.solid).toBe('bg-status-verified');
  });

  it('maps ESTIMATED to the blue (estimated) token group', () => {
    const meta = RELIABILITY_STATUS_META.ESTIMATED;
    expect(meta.tone).toBe('estimated');
    expect(meta.badge.bg).toBe('bg-status-estimated-bg');
    expect(meta.solid).toBe('bg-status-estimated');
  });

  it('maps STALE to the amber (stale) token group', () => {
    const meta = RELIABILITY_STATUS_META.STALE;
    expect(meta.tone).toBe('stale');
    expect(meta.badge.bg).toBe('bg-status-stale-bg');
    expect(meta.solid).toBe('bg-status-stale');
  });

  it('maps UNAVAILABLE to gray — absence is neutral, never a warning', () => {
    const meta = RELIABILITY_STATUS_META.UNAVAILABLE;
    expect(meta.tone).toBe('unavailable');
    expect(meta.badge.bg).toBe('bg-status-unavailable-bg');
    expect(meta.solid).toBe('bg-status-unavailable');
  });

  it('keeps red reserved for errors: no reliability status uses error tokens', () => {
    // D1: red belongs to errors and destructive affordances only. The whole
    // ladder — including UNAVAILABLE ("we don't know") — must stay red-free.
    for (const status of RELIABILITY_STATUSES) {
      for (const cls of reliabilityClasses(RELIABILITY_STATUS_META[status])) {
        expect(cls).not.toMatch(/error/);
      }
    }
  });

  it('gives every status a non-empty labelKey that exists in both catalogs', () => {
    for (const status of RELIABILITY_STATUSES) {
      const { labelKey } = RELIABILITY_STATUS_META[status];

      expect(labelKey).toMatch(/^Common\.reliability\.[A-Z]+$/);
      expect(resolveCatalogString(fiMessages, labelKey)).toBeTruthy();
      expect(resolveCatalogString(enMessages, labelKey)).toBeTruthy();
    }
  });

  it('keeps badge icon shapes distinct across statuses', () => {
    const icons = RELIABILITY_STATUSES.map(
      (status) => RELIABILITY_STATUS_META[status].icon,
    );

    expect(new Set(icons).size).toBe(RELIABILITY_STATUSES.length);
  });

  it('keeps dot SHAPES distinct even with color tokens stripped (D2: color is never the sole carrier)', () => {
    const shapeOf = (dot: string) =>
      dot
        .replace(/(?:bg|border|text)-status-[a-z-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const shapes = RELIABILITY_STATUSES.map((status) =>
      shapeOf(RELIABILITY_STATUS_META[status].dot),
    );

    expect(new Set(shapes).size).toBe(RELIABILITY_STATUSES.length);
    // Sanity: stripping must not leave every shape empty.
    expect(shapes.every((shape) => shape.length > 0)).toBe(true);
  });

  it('renders the UNAVAILABLE dot as a hollow ring (no data, no fill)', () => {
    const dot = RELIABILITY_STATUS_META.UNAVAILABLE.dot;

    expect(dot).toContain('border-2');
    expect(dot).not.toMatch(/\bbg-status-/);
  });

  it('stays structurally compatible with the Badge tone union', () => {
    // Compile-time: meta tones must remain assignable to BadgeTone.
    const tones: Record<ReliabilityStatus, BadgeTone> = {
      VERIFIED: RELIABILITY_STATUS_META.VERIFIED.tone,
      ESTIMATED: RELIABILITY_STATUS_META.ESTIMATED.tone,
      STALE: RELIABILITY_STATUS_META.STALE.tone,
      UNAVAILABLE: RELIABILITY_STATUS_META.UNAVAILABLE.tone,
    };

    expect(Object.values(tones)).toEqual([
      'verified',
      'estimated',
      'stale',
      'unavailable',
    ]);
  });
});

describe('CONFIDENCE_LEVEL_META — D1/D2 tone reuse', () => {
  it('covers exactly the ConfidenceLevel union', () => {
    expect(Object.keys(CONFIDENCE_LEVEL_META).sort()).toEqual(
      [...CONFIDENCE_LEVELS].sort(),
    );
  });

  it('HIGH maps to green (verified), MEDIUM to amber (stale)', () => {
    expect(CONFIDENCE_LEVEL_META.HIGH.tone).toBe('verified');
    expect(CONFIDENCE_LEVEL_META.HIGH.badge.bg).toBe('bg-status-verified-bg');
    expect(CONFIDENCE_LEVEL_META.MEDIUM.tone).toBe('stale');
    expect(CONFIDENCE_LEVEL_META.MEDIUM.badge.bg).toBe('bg-status-stale-bg');
  });

  it('LOW confidence is an error signal and uses the red token group', () => {
    const meta = CONFIDENCE_LEVEL_META.LOW;

    expect(meta.tone).toBe('error');
    expect(meta.badge.bg).toBe('bg-error-bg');
    expect(meta.solid).toBe('bg-error');
  });

  it('uses red for LOW only — HIGH and MEDIUM stay red-free', () => {
    for (const level of ['HIGH', 'MEDIUM'] as const) {
      for (const cls of confidenceClasses(CONFIDENCE_LEVEL_META[level])) {
        expect(cls).not.toMatch(/error/);
      }
    }
  });

  it('gives every level a non-empty labelKey that exists in both catalogs', () => {
    for (const level of CONFIDENCE_LEVELS) {
      const { labelKey } = CONFIDENCE_LEVEL_META[level];

      expect(labelKey).toMatch(/^Common\.confidence\.[A-Z]+$/);
      expect(resolveCatalogString(fiMessages, labelKey)).toBeTruthy();
      expect(resolveCatalogString(enMessages, labelKey)).toBeTruthy();
    }
  });

  it('stays structurally compatible with the Badge tone union', () => {
    // Compile-time: meta tones must remain assignable to BadgeTone.
    const tones: Record<ConfidenceLevel, BadgeTone> = {
      HIGH: CONFIDENCE_LEVEL_META.HIGH.tone,
      MEDIUM: CONFIDENCE_LEVEL_META.MEDIUM.tone,
      LOW: CONFIDENCE_LEVEL_META.LOW.tone,
    };

    expect(tones).toEqual({
      HIGH: 'verified',
      MEDIUM: 'stale',
      LOW: 'error',
    });
  });
});
