/**
 * Shared date formatters (change fi-locale-surface-hardening, design
 * D2). Raw ISO dates sat inside Finnish prose ("tilanne 2026-10-04",
 * "… alkaen") while the calculator already rendered "4.10.2026 klo
 * 22.57.50" correctly. Both conventions live here so every surface
 * states dates the same way:
 *
 *   - `fi`: localized numeric date — `4.10.2026`; datetimes keep the
 *     calculator's existing `klo` form.
 *   - `en`: the site's established EN numeric convention (en-GB, the
 *     trip stat / product-page precedent).
 *
 * Unparseable input renders verbatim (the raw string is data, never
 * invented copy) — the TripSuggestionStat fallback precedent.
 *
 * @module DateFormatters
 */

/** Locale tag behind the two-convention split: fi → fi-FI, else en-GB. */
function intlLocale(locale: string): string {
  return locale === 'fi' ? 'fi-FI' : 'en-GB';
}

/**
 * Format a date-only ISO string (`YYYY-MM-DD`, the shape datasets and
 * window bounds use) as a localized numeric calendar date: `4.10.2026`
 * (fi) / `04/10/2026` (en). A date-only string denotes a calendar date,
 * not an instant, so parsing and formatting both pin UTC — the rendered
 * day is the stored day on every runtime, server and client alike (no
 * timezone can shift it by one).
 */
export function formatDate(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return iso;
  const date = new Date(`${iso.trim()}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(intlLocale(locale), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Format an ISO timestamp the way the calculator already does ("4.10.2026
 * klo 22.57.50" under fi — the convention design D2 names as correct),
 * locale-adjusted for en. Like the calculator rendering it replaces, the
 * timestamp renders in the runtime's local zone: it marks WHEN the
 * observation or calculation happened, and its options match the
 * previous `toLocaleString('fi-FI')` calls exactly, so existing rendered
 * timestamps are byte-identical under fi.
 */
export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(intlLocale(locale));
}
