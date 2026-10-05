/**
 * Display formatters for stored product attributes (change
 * unit-integrity-and-result-trust, task 4.1).
 *
 * These helpers are pure and locale-independent: the decimal separator is
 * always a dot (the formatEur convention across calculator/basket/compare
 * components), so server and client renders are byte-identical and
 * hydration-safe. Absent or unparseable data returns null — the caller
 * decides render-nothing; the helpers never invent a placeholder figure.
 *
 * @module ProductAttributeFormatters
 */

/**
 * Round to the given decimal count and drop trailing zeros:
 * "38.0" → "38", "14.5" → "14.5", "33.50" → "33.5".
 */
function trimDecimal(text: string): string {
  return String(Number(text));
}

/**
 * Format a stored ABV fraction for display: 0.38 → "38 %", 0.047 →
 * "4.7 %". The fraction is multiplied by 100 and rounded to at most one
 * decimal, so float artifacts can never surface — 0.145 × 100 evaluates
 * to 14.499999999999998 in IEEE-754 arithmetic and renders "14.5 %",
 * never the raw artifact, and a raw fraction can never render as
 * "0.38 % ABV". null (and any non-finite value) → null.
 */
export function formatAbv(fraction: number | null): string | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  return `${trimDecimal((fraction * 100).toFixed(1))} %`;
}

/**
 * Format a canonical litre value (the litre-denominated `unitVolume`
 * text from task 1.3, or a number) with an explicit unit label. Rule:
 * below one litre the value renders in centilitres (0.5 → "50 cl",
 * 0.15 → "15 cl", 0.04 → "4 cl"); one litre and above in litres
 * (1 → "1 l", 3 → "3 l"). Beverage retail convention quotes bottle
 * sizes in cl and large formats (bag-in-box, magnums) in l, and the
 * unit switch moves sub-litre values away from the decimal boundary so
 * the two-decimal cap never truncates meaningful precision (0.33 l is
 * exact as 33 cl, lossy as "0.33 l" at two decimals only by luck).
 * Legacy suffixed text ("0.5 l") still parses; unparseable or
 * non-positive values (corrupt data) → null.
 */
export function formatVolume(litres: string | number | null): string | null {
  const value =
    typeof litres === 'number' ? litres : Number.parseFloat(litres ?? '');
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 1) return `${trimDecimal((value * 100).toFixed(2))} cl`;
  return `${trimDecimal(value.toFixed(2))} l`;
}

/**
 * Join product-attribute parts into one display row: "Anchor · viinit ·
 * 75 cl · 12.5 %". Absent parts (null, undefined, empty or whitespace-only
 * text) contribute nothing — including no separator — so a product whose
 * feed name yields no brand renders "viinit · 75 cl", never the dangling
 * "· viinit · …" that per-part ``brand + (part ? ` · ${part}` : '')``
 * interpolation produced when brand is empty (change
 * fi-locale-surface-hardening). Every part absent → null, matching the
 * module's absent-means-null convention; the caller decides
 * render-nothing.
 */
export function formatAttributeRow(
  ...parts: Array<string | null | undefined>
): string | null {
  const present = parts.filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  if (present.length === 0) return null;
  return present.join(' · ');
}
