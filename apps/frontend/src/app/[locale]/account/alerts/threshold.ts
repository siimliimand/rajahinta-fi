/**
 * Price-alert threshold unit conversion (task 2.4, change
 * product-roadmap-phases-1-4).
 *
 * The alerts API stores integer euro cents bounded to 1..1,000,000
 * (€0.01–€10,000 — see api-worker alerts.routes.ts). The UI works in
 * euros — the unit every price on the site is displayed in — and
 * converts at this one boundary, so the API contract never sees
 * fractional cents and the user never sees cents.
 *
 * @module threshold
 */

/** Upper threshold bound in cents: €10,000 — mirrors the API's zod max. */
const MAX_THRESHOLD_CENTS = 1_000_000;

/**
 * Parse a user-entered euro amount into integer euro cents.
 *
 * Accepts "12", "12.5", and the Finnish comma decimal form "12,55";
 * rejects non-numeric input, more than two decimals, and values outside
 * €0.01–€10,000. Returns null when invalid — no silent rounding.
 */
export function eurosToCents(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (cents < 1 || cents > MAX_THRESHOLD_CENTS) return null;
  return cents;
}

/** Render integer euro cents with the site's fixed two-decimal convention. */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
