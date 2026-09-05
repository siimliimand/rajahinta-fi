/**
 * Curated consumption-norms seed (task 4.1, change
 * product-roadmap-phases-1-4, design R5) — the event calculator's
 * reference dataset, keyed by drink type × event profile.
 *
 * Every row carries a verifiable source citation: the derivation from
 * the Finnish standard drink (12 g pure ethanol = 15.2 ml — the
 * national definition documented in the cited "Standard drink"
 * reference, Finland row) plus the URL an operator can check before
 * confirming publication. Norm VALUES are curated estimates derived
 * arithmetically from that definition (drinks per guest per hour ×
 * per-drink volume at a typical ABV); the citation makes the derivation
 * auditable rather than authoritative-sounding. Rows land
 * PENDING_CONFIRMATION — publication is the operator console's manual
 * confirmation step, never the seed's.
 *
 * Idempotency contract differs from the carrier-box seed in one
 * deliberate way: the upsert refreshes PENDING_CONFIRMATION rows only.
 * Published rows are immutable (append-only dataset — a correction is a
 * new version), so a re-run can never rewrite history.
 *
 * @module ConsumptionNormsSeed
 */
import type { D1DatabaseLike } from '../d1/executor';

export interface ConsumptionNormSeedRow {
  readonly versionLabel: string;
  readonly drinkType: string;
  readonly eventProfile: string;
  /** Litres of finished beverage per guest per hour. */
  readonly normValuePerGuestPerHour: number;
  /** Verifiable citation: derivation from the Finnish standard drink + URL. */
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** Verifiable reference for the Finnish standard-drink definition (12 g / 15.2 ml). */
export const CONSUMPTION_NORMS_CITATION_URL =
  'https://en.wikipedia.org/wiki/Standard_drink';

/** The one curated version this seed appends. Corrections append a new version — they never edit this one. */
export const CONSUMPTION_NORMS_SEED_VERSION = 'standard-drink-fi-2026.1';

/** Seed window: effective from the start of 2026, open-ended (null effectiveTo). */
const EFFECTIVE_FROM = '2026-01-01';

/**
 * Format one row's citation: the audited derivation (drinks per guest
 * per hour × 15.2 ml pure ethanol ÷ typical ABV) over the verifiable
 * reference URL. Same shape on every row so operator review can scan it.
 */
function citation(
  drinksPerGuestPerHour: number,
  abvPercent: number,
): string {
  const litres = (drinksPerGuestPerHour * 15.2) / (abvPercent * 10);
  return (
    `Finnish standard drink = 12 g ethanol (15.2 ml); derivation: ` +
    `${drinksPerGuestPerHour} drink(s)/guest/hour × 15.2 ml ÷ ${abvPercent} %ABV ≈ ` +
    `${litres.toFixed(2)} l/guest/hour — "Standard drink", Finland row ` +
    `(${CONSUMPTION_NORMS_CITATION_URL})`
  );
}

/** Round to centilitres — the curated granularity of a norm estimate. */
function litres(drinksPerGuestPerHour: number, abvPercent: number): number {
  return Number(((drinksPerGuestPerHour * 15.2) / (abvPercent * 10)).toFixed(2));
}

interface NormInput {
  readonly drinkType: string;
  readonly eventProfile: string;
  /** Curated pacing in Finnish standard drinks per guest per hour. */
  readonly drinksPerGuestPerHour: number;
  /** Typical ABV (%) of the drink category the derivation assumes. */
  readonly abvPercent: number;
}

/** Build one curated seed row (citation derived, never hand-drifted). */
function norm(input: NormInput): ConsumptionNormSeedRow {
  return {
    versionLabel: CONSUMPTION_NORMS_SEED_VERSION,
    drinkType: input.drinkType,
    eventProfile: input.eventProfile,
    normValuePerGuestPerHour: litres(
      input.drinksPerGuestPerHour,
      input.abvPercent,
    ),
    sourceCitation: citation(input.drinksPerGuestPerHour, input.abvPercent),
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  };
}

// ---------------------------------------------------------------------------
// The curated dataset — pacing per profile in standard drinks/guest/hour
// (beer 4.7 %, still wine 12 %, sparkling 11.5 %, intermediate 18 %,
// cider/long drink 5.5 %, spirits 40 %), rounded to centilitres.
// ---------------------------------------------------------------------------

const CURATED_NORMS: readonly NormInput[] = [
  // Casual gathering — beer-forward, loose pacing.
  { drinkType: 'beer', eventProfile: 'casual_gathering', drinksPerGuestPerHour: 1.0, abvPercent: 4.7 },
  { drinkType: 'other_fermented', eventProfile: 'casual_gathering', drinksPerGuestPerHour: 0.75, abvPercent: 5.5 },
  { drinkType: 'wine_still', eventProfile: 'casual_gathering', drinksPerGuestPerHour: 0.5, abvPercent: 12 },
  { drinkType: 'wine_sparkling', eventProfile: 'casual_gathering', drinksPerGuestPerHour: 0.25, abvPercent: 11.5 },
  { drinkType: 'intermediate_products', eventProfile: 'casual_gathering', drinksPerGuestPerHour: 0.1, abvPercent: 18 },
  { drinkType: 'spirits', eventProfile: 'casual_gathering', drinksPerGuestPerHour: 0.25, abvPercent: 40 },

  // Dinner party — wine-led, paced across courses.
  { drinkType: 'wine_still', eventProfile: 'dinner_party', drinksPerGuestPerHour: 1.0, abvPercent: 12 },
  { drinkType: 'beer', eventProfile: 'dinner_party', drinksPerGuestPerHour: 0.5, abvPercent: 4.7 },
  { drinkType: 'wine_sparkling', eventProfile: 'dinner_party', drinksPerGuestPerHour: 0.25, abvPercent: 11.5 },
  { drinkType: 'other_fermented', eventProfile: 'dinner_party', drinksPerGuestPerHour: 0.25, abvPercent: 5.5 },
  { drinkType: 'intermediate_products', eventProfile: 'dinner_party', drinksPerGuestPerHour: 0.25, abvPercent: 18 },
  { drinkType: 'spirits', eventProfile: 'dinner_party', drinksPerGuestPerHour: 0.15, abvPercent: 40 },

  // Celebration — toast-led (sparkling first hour), otherwise mixed.
  { drinkType: 'wine_sparkling', eventProfile: 'celebration', drinksPerGuestPerHour: 0.75, abvPercent: 11.5 },
  { drinkType: 'beer', eventProfile: 'celebration', drinksPerGuestPerHour: 0.5, abvPercent: 4.7 },
  { drinkType: 'other_fermented', eventProfile: 'celebration', drinksPerGuestPerHour: 0.5, abvPercent: 5.5 },
  { drinkType: 'wine_still', eventProfile: 'celebration', drinksPerGuestPerHour: 0.5, abvPercent: 12 },
  { drinkType: 'spirits', eventProfile: 'celebration', drinksPerGuestPerHour: 0.25, abvPercent: 40 },
  { drinkType: 'intermediate_products', eventProfile: 'celebration', drinksPerGuestPerHour: 0.1, abvPercent: 18 },
];

export const CONSUMPTION_NORMS_SEED: readonly ConsumptionNormSeedRow[] =
  CURATED_NORMS.map(norm);

// Append-only guard: a re-run refreshes PENDING_CONFIRMATION rows only —
// PUBLISHED rows are terminal and can never be rewritten by the seed
// (corrections append a new version instead).
const UPSERT_SQL = `
  INSERT INTO consumption_norms (
    version_label, drink_type, event_profile, norm_value_per_guest_per_hour,
    source_citation, effective_from, effective_to
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (drink_type, event_profile, version_label) DO UPDATE SET
    norm_value_per_guest_per_hour = excluded.norm_value_per_guest_per_hour,
    source_citation = excluded.source_citation,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to
  WHERE consumption_norms.status = 'PENDING_CONFIRMATION'`;

/**
 * Upsert the curated version into consumption_norms as one batch —
 * either the whole version lands or nothing does. Idempotent: re-runs
 * refresh pending rows in place and leave published rows untouched.
 */
export async function seedConsumptionNorms(d1: D1DatabaseLike): Promise<void> {
  await d1.batch(
    CONSUMPTION_NORMS_SEED.map((row) =>
      d1
        .prepare(UPSERT_SQL)
        .bind(
          row.versionLabel,
          row.drinkType,
          row.eventProfile,
          row.normValuePerGuestPerHour,
          row.sourceCitation,
          row.effectiveFrom,
          row.effectiveTo,
        ),
    ),
  );
}
