/**
 * Shared euro money formatters (change fi-locale-surface-hardening,
 * design D2). Before this module, client surfaces formatted amounts
 * three inconsistent ways — `€64.19` (calculator, dot decimals,
 * symbol-first), `0,49 €` (catalog, correct Finnish via Intl), and dot
 * decimals inside prose — sometimes within one view. Every surface that
 * renders euro cents renders through here so the presentation is one
 * convention per locale:
 *
 *   - `fi`: comma decimals, suffix symbol, non-breaking space before
 *     the sign — `64,19 €` (fi-FI currency format, the catalog cards'
 *     existing correct form).
 *   - `en`: symbol-first dot decimals — `€64.19` (en-IE currency
 *     format, the calculator components' existing EN convention).
 *
 * The output is Intl's, never hand-built: the catalog surfaces already
 * render through `Intl.NumberFormat` currency formatting, and the two
 * conventions must stay byte-identical to those cards. Amounts are
 * formatted, never re-rounded — `formatMoney(cents)` presents exactly
 * the API-provided integer cents (dividing by 100 is exact at the
 * two-decimal granularity every monetary field carries).
 *
 * @module MoneyFormatters
 */

/** Locale tag behind the two-convention split: EN → en-IE, else fi-FI. */
function currencyLocale(locale: string): string {
  return locale === 'en' ? 'en-IE' : 'fi-FI';
}

/**
 * Format integer euro cents as a currency string in the active locale
 * (group-order `formatCents` / catalog `formatEuro` precedent, shared).
 * A formatter construction failure (no ICU) degrades to the plain
 * `10.00 €` form rather than throwing — the figure itself never moves.
 */
export function formatMoney(cents: number, locale: string): string {
  try {
    return new Intl.NumberFormat(currencyLocale(locale), {
      style: 'currency',
      currency: 'EUR',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

/**
 * Signed variant for figures where the direction of the difference must
 * stay visible even at zero or negative values (the benchmark-gap
 * convention): `+`, `-`, or no sign at exactly zero, followed by the
 * unsigned amount in the active locale's money form. The API's sign
 * semantics are unchanged — positive means the calculated offer costs
 * more than the reference.
 */
export function formatSignedMoney(cents: number, locale: string): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${formatMoney(Math.abs(cents), locale)}`;
}
