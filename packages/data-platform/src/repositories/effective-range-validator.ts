/**
 * Pure effective-range validation — shared by the tax-rate repository and
 * the seed self-check.
 *
 * Lives in its own module (not inside tax-rate.repository.ts) so that
 * seed → validator and repository → validator never form an import cycle.
 *
 * @module effective-range-validator
 */

/**
 * Describes a single date-interval rule for validation.
 */
export interface EffectiveRangeInput {
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/**
 * Validate that a set of effective-date intervals are non-overlapping and
 * gapless within a (taxType, productCategory) group.
 *
 * **Semantics:**
 *   - Intervals are [effectiveFrom, effectiveTo] (inclusive on both ends;
 *     null effectiveTo means "open-ended / currently active").
 *   - Adjacent ranges are **permitted**: if prev.effectiveTo is 2026-03-31,
 *     next.effectiveFrom may be 2026-04-01 (the day after). This supports
 *     the 2026 intra-year split where one rule ends 31.3. and the next
 *     starts 1.4.
 *   - Gaps (next.effectiveFrom > day after prev.effectiveTo) are rejected.
 *   - Overlaps (next.effectiveFrom ≤ prev.effectiveTo) are rejected.
 *
 * @returns A list of human-readable error descriptions. Empty array = valid.
 */
export function validateEffectiveRanges(
  rules: EffectiveRangeInput[],
): string[] {
  if (rules.length < 2) return [];

  const sorted = [...rules].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );

  const errors: string[] = [];

  // Check for multiple open-ended rules — they'd overlap each other
  const openEnded = sorted.filter((r) => r.effectiveTo === null);
  if (openEnded.length > 1) {
    errors.push(
      `Multiple open-ended rules: ${openEnded.map((r) => r.effectiveFrom.toISOString()).join(', ')}`,
    );
    // Can't validate ordering among open-ended rules; return early
    return errors;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];

    // If prev is open-ended, any later rule overlaps
    if (prev.effectiveTo === null) {
      errors.push(
        `Overlap: open-ended rule starting ${prev.effectiveFrom.toISOString()} overlaps with rule starting ${next.effectiveFrom.toISOString()}`,
      );
      continue;
    }

    // Overlap: next starts on or before prev's end date
    if (next.effectiveFrom.getTime() <= prev.effectiveTo.getTime()) {
      errors.push(
        `Overlap: rule [${prev.effectiveFrom.toISOString()} – ${prev.effectiveTo.toISOString()}] overlaps with rule starting ${next.effectiveFrom.toISOString()}`,
      );
      continue;
    }

    // Gap: next starts more than one day after prev's end date
    const dayAfterEnd = new Date(prev.effectiveTo);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
    if (next.effectiveFrom.getTime() > dayAfterEnd.getTime()) {
      errors.push(
        `Gap: rule ending ${prev.effectiveTo.toISOString()} followed by rule starting ${next.effectiveFrom.toISOString()} (expected start ${dayAfterEnd.toISOString()})`,
      );
    }
  }

  return errors;
}
