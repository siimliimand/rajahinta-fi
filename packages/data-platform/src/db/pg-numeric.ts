/**
 * Centralized pg `numeric` → number coercion for the repository boundary.
 *
 * node-postgres returns `numeric` columns as strings to avoid silent
 * IEEE-754 precision loss. Repositories that hand domain consumers a
 * numeric value coerce it here — the single place that trade-off is
 * made — so consumers never re-implement per-caller parsing (task 3.5,
 * change technical-assessment-remediation).
 *
 * @module PgNumeric
 */

/**
 * Coerce a pg `numeric` string to a number, passing null through.
 *
 * @throws TypeError when the value is present but not a finite decimal
 *   (corrupt row or schema drift) — the context names the column so the
 *   failure is attributable.
 */
export function pgNumericToNumber(
  value: string | null,
  context = 'numeric column',
): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(
      `Cannot parse ${context} as decimal: "${value}"`,
    );
  }
  return parsed;
}

/**
 * Coerce a required pg `numeric` string to a number.
 *
 * @throws TypeError when the value is null or not a finite decimal.
 */
export function requirePgNumeric(
  value: string | null,
  context = 'numeric column',
): number {
  const parsed = pgNumericToNumber(value, context);
  if (parsed === null) {
    throw new TypeError(`${context} is required but was null`);
  }
  return parsed;
}
