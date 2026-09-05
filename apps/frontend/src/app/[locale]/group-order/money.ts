/**
 * Money and date helpers for the group order views (task 9.4).
 *
 * The UI works in euros; the API contract is integer euro cents only, so
 * conversion happens exactly at the form edge (alerts threshold
 * precedent). Parsing is strict — a shared-cost amount must be a plain
 * euro figure with at most two decimals (Finnish comma accepted) within
 * the DTO bound — because every cent reaching the ledger must be an
 * exact integer (the allocation arithmetic is pure integer math).
 *
 * @module GroupOrderMoney
 */

/** The DTO's upper bound for one shared-cost line (€1,000,000 in cents). */
export const MAX_SHARED_COST_CENTS = 100_000_000;

/**
 * Parse a euro amount into integer cents, or null when the input is not
 * a plain non-negative euro figure with at most two decimals.
 */
export function parseEuroToCents(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_SHARED_COST_CENTS) {
    return null;
  }
  return cents;
}

/** Format integer cents as a currency string in the active locale. */
export function formatCents(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'fi-FI', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

/**
 * Format an ISO timestamp with the fi-FI conventions used across the
 * account area (locale-adjusted); an unparseable value renders as-is.
 */
export function formatTimestamp(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(locale === 'en' ? 'en-IE' : 'fi-FI', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
