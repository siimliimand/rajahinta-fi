/**
 * Client time-to-result timer — start on calculator submit, capture on the
 * rendered result. performance.now() is monotonic, keeping durations
 * comparable across devices; module state is safe because a page load is
 * one session.
 *
 * @module TimeToResult
 */

let startedAt: number | null = null;

/** Begin measuring; a re-submit restarts the clock. */
export function startTimeToResult(): void {
  startedAt = performance.now();
}

/**
 * Stop and return elapsed whole milliseconds, or null when nothing runs —
 * a duration is never fabricated (AE recorder contract). Clears the clock
 * so a later result without a new submit cannot reuse stale time.
 */
export function captureTimeToResultMs(): number | null {
  if (startedAt === null) return null;
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  startedAt = null;
  return elapsedMs;
}
