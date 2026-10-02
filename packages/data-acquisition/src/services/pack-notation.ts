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
 * @module PackNotation
 */

const PACK_NOTATION_PATTERN = /(\d+)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/i;

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
