/**
 * Pack-notation volume normalizer over the feed product display name.
 *
 * Live multipack feeds corrupt `unit_volume` when the adapter reports the
 * PACK total as `volumeMl` ("Karhu Olut 5.3% 24×33 l" arrives with
 * volumeMl 33000). When the decoded name carries pack notation
 * `N×V unit`, the per-unit volume parsed from the name is AUTHORITATIVE
 * and replaces the volumeMl-derived litres; names without notation keep
 * the existing volumeMl behavior byte-identical. A standalone module so
 * the backfill script (scripts/backfill-unit-volume.mts) regenerates the
 * exact values ingestion stores — one convention, two callers.
 *
 * Recognized notation: `N×V`, `N x V`, `N X V` (separators ×/x/X,
 * whitespace tolerated), V an integer or comma/dot decimal, followed by
 * a REQUIRED unit token (ml/cl/l — any case). A bare "24×33" with no
 * unit is ambiguous and is never guessed.
 *
 * Value interpretation (deterministic):
 *   - `ml` → V/1000; `cl` → V/100 (explicit units convert directly).
 *   - `l` with an explicit decimal point (0,33 / 0.33) reads as written
 *     litres.
 *   - `l` as a BARE integer > 10 reads as CENTILITRES — brewery label
 *     shorthand writes "24×33 l" meaning 24×33 cl (0.33 l per can). The
 *     >10 guard keeps genuine multi-litre packs ("2×3 l" = 3 l) reading
 *     as litres.
 *
 * Returns null when the name carries no unambiguous pack notation — the
 * caller then keeps its existing volume behavior (never fabricates).
 *
 * The same module also exports the DECISIVE side of the notation, the
 * pack SIZE (`parsePackUnits`), for downstream metric use: the €/g
 * metric must divide a pack's price by the package total volume
 * (unit volume × units), and units derive from the name at read time —
 * never persisted. Count parsing is unit-token-independent: in `N×V`
 * the leading integer is the count by position, whether or not the
 * volume token carries a unit ("24×33 l" and bare "24×33" both read
 * 24). The reversed order is recognized only when an explicit volume
 * token (ml/cl/l) marks the leading number as the volume ("33CL x 24"
 * → 24) — without that marker the canonical count-first reading stands,
 * and the magnitude of either number is never used to guess. The
 * textual `N-pack` form ("8-pack tölkki") reads the count directly.
 * Conflicting counts in one name are ambiguous → null; no plausible
 * count (an integer ≥ 1) → null.
 *
 * @module PackNotation
 */

const PACK_NOTATION_PATTERN = /(\d+)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/i;

// Count before the separator — position makes it decisive with or
// without a unit token on the volume ("24×33 l", "24 x 0,33", "24×33").
// The lookbehind keeps a comma-decimal fragment ("…4,6 x 24", an ABV
// followed by a bare count) from reading its fraction as the count.
const UNITS_LEADING_PATTERN = /(?<![.,\d])(\d+)\s*[×xX]\s*\d+(?:[.,]\d+)?/g;
// Count after the separator — decisive only behind an explicit volume
// token ("33CL x 24"); a bare "33 x 24" stays in the canonical reading
// (count first), never swapped by guessing which side is which.
const UNITS_TRAILING_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(?:ml|cl|l)\b\s*[×xX]\s*(\d+)/gi;
// Textual multipack form ("8-pack tölkki", "12-Pack"), same fragment guard.
const UNITS_PACK_WORD_PATTERN = /(?<![.,\d])(\d+)\s*[-–]?\s*pack\b/gi;

/**
 * Parse the per-unit beverage volume in litres from a pack-notation
 * product name, or null when the name carries no unambiguous notation.
 */
export function parsePackUnitVolumeLitres(productName: string): number | null {
  const match = PACK_NOTATION_PATTERN.exec(productName);
  if (match === null) return null;

  const value = Number(match[2].replace(',', '.'));
  if (value <= 0) return null;

  const unit = match[3].toLowerCase();
  if (unit === 'ml') return value / 1000;
  if (unit === 'cl') return value / 100;
  // Litre unit: an explicit decimal reads as written; a bare integer
  // over 10 is brewery centilitre shorthand (24×33 l = 24×33 cl).
  if (match[2].includes('.') || match[2].includes(',')) return value;
  return value > 10 ? value / 100 : value;
}

/**
 * Parse the pack SIZE (units per package) from a pack-notation product
 * name, or null when the name states no decisive count. Deterministic
 * and unit-token-independent: the count never depends on the volume
 * parsing a valid volume. Read-time derivation only — the count is
 * never persisted; callers pass it to the metric as the
 * units-per-package multiplier.
 */
export function parsePackUnits(productName: string): number | null {
  const counts = new Set<number>();
  for (const pattern of [
    UNITS_LEADING_PATTERN,
    UNITS_TRAILING_PATTERN,
    UNITS_PACK_WORD_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(productName); m !== null; m = pattern.exec(productName)) {
      // The count is each pattern's final capture group (the trailing
      // pattern's first group is the volume it follows).
      const count = Number(m[m.length - 1]);
      // A plausible pack size is an integer ≥ 1; anything else (a
      // stray "0×…" fragment) is garbage, not a count to guess around.
      if (Number.isInteger(count) && count >= 1) counts.add(count);
    }
  }
  // Conflicting counts in one name are ambiguous — never pick one.
  return counts.size === 1 ? counts.values().next().value! : null;
}
