/**
 * Product name quality gate — pure classification and annotation
 * stripping over the merchant feed display name. No I/O, no DB: the
 * same functions serve ingestion (task 2.3) and the catalog-wide
 * backfill (task 1.1), so both callers classify byte-identically —
 * one convention, two callers (pack-notation precedent).
 *
 * Informativeness gate (spec: Name informativeness gate at
 * ingestion): a name is QUARANTINED when it is empty after trimming,
 * or its remaining alphabetic content is shorter than 3 characters
 * after ABV percentages, volumes, pack notations, and bare numeric
 * tokens are stripped. Everything else is OK. The alphabetic count is
 * Unicode-aware (`\p{L}`) so names like "ÀN 2022" count their accented
 * letters and Finnish/ Swedish names keep their characters.
 *
 * Strip order inside the test: merchant annotation parentheticals
 * first (merchant commentary must not rescue a token-only name),
 * then ABV percentages, volume-unit tokens, the textual `N-pack`
 * notation, and finally any remaining bare numeric tokens. Pack
 * notation survives the gate THROUGH its alphabetic residue —
 * "Karhu III 0,9 l tlk" and "Harboe 24 x 0,33 l" carry the brand,
 * so they classify ok; a name that is only notation ("70 cl",
 * "24 x 0,33 l") has no identity and quarantines, exactly like the
 * spec's token-only scenario. The `N-pack` pattern mirrors the
 * textual form already recognized in pack-notation.ts (same fragment
 * guard); the numeric/ volume strips make the `N×V unit` forms
 * vanish on their own, so no pack logic is re-derived here.
 *
 * Annotation stripping (spec: Merchant annotation stripping):
 * parenthetical merchant-side commentary — availability notes,
 * per-customer purchase limits, rarity or restock remarks — is
 * removed from the display name and returned as annotation metadata.
 * A parenthetical counts as commentary only when its content matches
 * the commentary vocabulary; product parentheticals like
 * "(24 x 0,33 l)" or "(0,5 l tlk)" carry no vocabulary and are left
 * untouched. Annotation presence never quarantines — the annotated
 * name is ok with a stripped display name, and the raw feed name is
 * preserved upstream (task 2.3 persists all three). Both functions
 * are deterministic: same input, same output, always.
 *
 * @module NameQuality
 */

/**
 * Merchant commentary vocabulary inside a parenthetical. Anchored to
 * the forms observed in the live feed and named in the proposal:
 * "(saatavuus 1 plo)", "(erittäin rajallinen saatavuus, 1plo/asiakas)",
 * plus their English equivalents. Pure notation parentheticals
 * (digits, volume units, ×, punctuation) never match.
 */
const ANNOTATION_CONTENT_PATTERN =
  /(?:saatavuus|rajallinen|rajoitettu|loppu(?:nut)?|asiakk?a|varast(?:ossa|on)|ennakkotilaus|availability|limited|limit|restock|sold\s+out|in\s+stock|while\s+stocks|per\s+customer)/i;

const ANNOTATED_PARENTHETICAL_PATTERN = new RegExp(
  `\\s*\\(([^)]*${ANNOTATION_CONTENT_PATTERN.source}[^)]*)\\)`,
  'gi',
);

// "40 %", "5.3%", "4,6 % vol" — the % token marks the number as ABV;
// an attached vol/alc unit word goes with it so "40 % vol" cannot
// pass the gate on the unit word alone.
const ABV_PATTERN = /\d+(?:[.,]\d+)?\s*%(?:\s*(?:vol|alc)\b\.?)?/gi;

// "70 cl", "0,33 l", "330 ml" — a number with an explicit volume-unit
// token; same unit set as pack-notation.ts.
const VOLUME_PATTERN = /\d+(?:[.,]\d+)?\s*(?:ml|cl|l)\b/gi;

// Textual multipack form ("12-pack", "8-pack tölkki"), mirrored from
// pack-notation.ts's UNITS_PACK_WORD_PATTERN including the fragment
// guard that keeps a comma-decimal fraction from reading as a count.
const PACK_WORD_PATTERN = /(?<![.,\d])\d+\s*[-–]?\s*pack\b/gi;

// Any leftover number: vintages ("2022"), pack counts, stray decimals.
const BARE_NUMERIC_PATTERN = /\d+(?:[.,]\d+)?/g;

/** The quality classification the gate assigns to a feed name. */
export type NameQuality = 'ok' | 'quarantined';

/**
 * Strip the merchant-annotation parentheticals from a feed name.
 * Internal helper — operates on a single name, deterministic.
 */
function stripAnnotations(rawName: string): {
  base: string;
  annotation: string | null;
} {
  const annotations: string[] = [];
  const base = rawName.replace(
    ANNOTATED_PARENTHETICAL_PATTERN,
    (_match: string, content: string) => {
      annotations.push(content.trim());
      return ' ';
    },
  );
  return {
    base: base.replace(/\s+/g, ' ').trim(),
    annotation: annotations.length > 0 ? annotations.join('; ') : null,
  };
}

/**
 * Classify a feed display name through the informativeness gate:
 * empty/ whitespace-only names and token-only names ("40 %",
 * "70 cl", "ÀN 2022") quarantine; names carrying at least 3
 * alphabetic characters beyond ABV/ volume/ pack/ numeric tokens
 * pass. Deterministic and pure — the raw name is never transformed
 * here.
 */
export function classifyNameQuality(rawName: string): NameQuality {
  const { base } = stripAnnotations(rawName);
  const residue = base
    .replace(ABV_PATTERN, ' ')
    .replace(VOLUME_PATTERN, ' ')
    .replace(PACK_WORD_PATTERN, ' ')
    .replace(BARE_NUMERIC_PATTERN, ' ');
  const alphabeticCount = residue.match(/\p{L}/gu)?.length ?? 0;
  return alphabeticCount < 3 ? 'quarantined' : 'ok';
}

/**
 * Strip the merchant-annotation parentheticals (availability notes,
 * purchase limits, rarity/ restock remarks) from a feed display name.
 * Returns the cleaned display name plus the annotation text, or null
 * when the name carries no commentary. Product parentheticals — pack
 * notation like "(24 x 0,33 l)" — are never stripped. Deterministic;
 * annotation presence does not affect the quality classification
 * (annotate-and-strip is orthogonal to the informativeness gate).
 */
export function stripNameAnnotation(rawName: string): {
  displayName: string;
  annotation: string | null;
} {
  const { base, annotation } = stripAnnotations(rawName);
  return { displayName: base, annotation };
}
