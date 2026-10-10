/**
 * Curated consumption-norms seed (task 4.1, change
 * product-roadmap-phases-1-4, design R5; seasonal dataset added by
 * change seasonal-occasion-templates task 1.1) — the event calculator's
 * reference datasets, keyed by drink type × event profile:
 *
 * - `standard-drink-fi-2026.1` — the three general profiles
 *   (casual_gathering, dinner_party, celebration).
 * - `seasonal-occasions-fi-2026.1` — the four Finnish seasonal occasion
 *   profiles (juhannus, vappu, rapujuhlat, talkoot). Seasonality lives
 *   in the profile key, not the effective window: the rows share the
 *   dataset-level window so any year's occasion resolves the same norms.
 *
 * Every row carries a verifiable source citation: the derivation from
 * the Finnish standard drink (12 g pure ethanol = 15.2 ml — the
 * national definition documented in the cited "Standard drink"
 * reference, Finland row) plus the URL an operator can check before
 * confirming publication. Norm VALUES are curated estimates derived
 * arithmetically from that definition (drinks per guest per hour ×
 * per-drink volume at a typical ABV); the citation makes the derivation
 * auditable rather than authoritative-sounding — seasonal rows name the
 * occasion-specific pacing basis ahead of the arithmetic, and the
 * template values stay fully editable in the product. Rows land
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

/**
 * The seasonal occasion dataset this seed appends alongside the
 * standard one (change seasonal-occasion-templates, task 1.1). Same
 * append-only contract, distinct version label: the general dataset's
 * history stays untouched when the seasonal rows land.
 */
export const SEASONAL_CONSUMPTION_NORMS_SEED_VERSION =
  'seasonal-occasions-fi-2026.1';

/**
 * The seasonal occasion profile slugs — the exact keys the seasonal
 * dataset's rows carry (and core-domain's template profile set mirrors).
 */
export const SEASONAL_CONSUMPTION_NORM_EVENT_PROFILES = [
  'juhannus',
  'vappu',
  'rapujuhlat',
  'talkoot',
] as const;

/** Seed window: effective from the start of 2026, open-ended (null effectiveTo). */
const EFFECTIVE_FROM = '2026-01-01';

/**
 * Format one row's citation: the audited derivation (drinks per guest
 * per hour × 15.2 ml pure ethanol ÷ typical ABV) over the verifiable
 * reference URL. Same shape on every row so operator review can scan it.
 * `basis` names the occasion-specific pacing context ahead of the
 * arithmetic (seasonal rows) — the standard dataset passes none and
 * keeps its historical citation text byte-for-byte.
 */
function citation(
  drinksPerGuestPerHour: number,
  abvPercent: number,
  basis?: string,
): string {
  const litres = (drinksPerGuestPerHour * 15.2) / (abvPercent * 10);
  const derivation =
    `Finnish standard drink = 12 g ethanol (15.2 ml); derivation: ` +
    `${drinksPerGuestPerHour} drink(s)/guest/hour × 15.2 ml ÷ ${abvPercent} %ABV ≈ ` +
    `${litres.toFixed(2)} l/guest/hour — "Standard drink", Finland row ` +
    `(${CONSUMPTION_NORMS_CITATION_URL})`;
  return basis === undefined ? derivation : `${basis} — ${derivation}`;
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
  /** Occasion-specific pacing context named in the citation (seasonal rows). */
  readonly basis?: string;
}

/** Build one curated seed row (citation derived, never hand-drifted). */
function norm(
  versionLabel: string,
  input: NormInput,
): ConsumptionNormSeedRow {
  return {
    versionLabel,
    drinkType: input.drinkType,
    eventProfile: input.eventProfile,
    normValuePerGuestPerHour: litres(
      input.drinksPerGuestPerHour,
      input.abvPercent,
    ),
    sourceCitation: citation(
      input.drinksPerGuestPerHour,
      input.abvPercent,
      input.basis,
    ),
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

export const CONSUMPTION_NORMS_SEED_ROWS: readonly ConsumptionNormSeedRow[] =
  CURATED_NORMS.map((input) => norm(CONSUMPTION_NORMS_SEED_VERSION, input));

// ---------------------------------------------------------------------------
// The seasonal dataset — pacing per occasion in standard drinks/guest/hour,
// each row's citation naming the occasion basis (same ABV table as above).
// The values are editable curated estimates; the citations make the basis
// auditable. Seasonality is the profile key, so the dataset window matches
// the standard dataset's (2026-01-01, open-ended).
// ---------------------------------------------------------------------------

const SEASONAL_CURATED_NORMS: readonly NormInput[] = [
  // Juhannus — midsummer: long outdoor celebration away from retail,
  // beer- and cider-led pacing over many hours (grill saareke), sauna
  // spot-drinking rather than spirits pacing.
  { drinkType: 'beer', eventProfile: 'juhannus', drinksPerGuestPerHour: 1.25, abvPercent: 4.7, basis: 'Juhannus (midsummer) pacing basis: long outdoor celebration away from retail hours, beer-led grilling day across many hours' },
  { drinkType: 'other_fermented', eventProfile: 'juhannus', drinksPerGuestPerHour: 1.0, abvPercent: 5.5, basis: 'Juhannus (midsummer) pacing basis: cider and long-drink share spikes at midsummer alongside the beer lead' },
  { drinkType: 'wine_sparkling', eventProfile: 'juhannus', drinksPerGuestPerHour: 0.25, abvPercent: 11.5, basis: 'Juhannus (midsummer) pacing basis: a modest welcome toast, not a sparkling-led occasion' },
  { drinkType: 'wine_still', eventProfile: 'juhannus', drinksPerGuestPerHour: 0.25, abvPercent: 12, basis: 'Juhannus (midsummer) pacing basis: background wine at the dinner table, beer dominates outdoors' },
  { drinkType: 'intermediate_products', eventProfile: 'juhannus', drinksPerGuestPerHour: 0.1, abvPercent: 18, basis: 'Juhannus (midsummer) pacing basis: marginal fortified/intermediate share at an outdoor occasion' },
  { drinkType: 'spirits', eventProfile: 'juhannus', drinksPerGuestPerHour: 0.25, abvPercent: 40, basis: 'Juhannus (midsummer) pacing basis: spot drinking around sauna, not a paced spirits occasion' },

  // Vappu — May Day: daytime street celebration, sparkling-wine and
  // sima-adjacent fermented specials lead the day; modest spirits.
  { drinkType: 'wine_sparkling', eventProfile: 'vappu', drinksPerGuestPerHour: 0.75, abvPercent: 11.5, basis: 'Vappu (May Day) pacing basis: daytime celebration led by sparkling wine toasts and sima tradition' },
  { drinkType: 'other_fermented', eventProfile: 'vappu', drinksPerGuestPerHour: 0.75, abvPercent: 5.5, basis: 'Vappu (May Day) pacing basis: sima-adjacent low-ABV fermented specials and cider carried to the streets' },
  { drinkType: 'beer', eventProfile: 'vappu', drinksPerGuestPerHour: 0.5, abvPercent: 4.7, basis: 'Vappu (May Day) pacing basis: daytime beer alongside the sparkling/sima lead, modest pacing' },
  { drinkType: 'wine_still', eventProfile: 'vappu', drinksPerGuestPerHour: 0.1, abvPercent: 12, basis: 'Vappu (May Day) pacing basis: marginal still-wine share at a daytime street occasion' },
  { drinkType: 'intermediate_products', eventProfile: 'vappu', drinksPerGuestPerHour: 0.1, abvPercent: 18, basis: 'Vappu (May Day) pacing basis: marginal fortified/intermediate share at a daytime occasion' },
  { drinkType: 'spirits', eventProfile: 'vappu', drinksPerGuestPerHour: 0.15, abvPercent: 40, basis: 'Vappu (May Day) pacing basis: minimal spirits pacing — the day is sparkling- and sima-led' },

  // Rapujuhlat — crayfish parties: seated dinner-format party paced by
  // snaps toasts (songs) with beer chasers; structured, spirits-tilted.
  { drinkType: 'spirits', eventProfile: 'rapujuhlat', drinksPerGuestPerHour: 0.75, abvPercent: 40, basis: 'Rapujuhlat (crayfish party) pacing basis: snaps toasts paced with the songs through the seated party' },
  { drinkType: 'beer', eventProfile: 'rapujuhlat', drinksPerGuestPerHour: 0.5, abvPercent: 4.7, basis: 'Rapujuhlat (crayfish party) pacing basis: beer as the snaps chaser through the seated dinner' },
  { drinkType: 'wine_sparkling', eventProfile: 'rapujuhlat', drinksPerGuestPerHour: 0.25, abvPercent: 11.5, basis: 'Rapujuhlat (crayfish party) pacing basis: an opening toast before the snaps pacing takes over' },
  { drinkType: 'wine_still', eventProfile: 'rapujuhlat', drinksPerGuestPerHour: 0.25, abvPercent: 12, basis: 'Rapujuhlat (crayfish party) pacing basis: table wine alongside the crayfish dinner courses' },
  { drinkType: 'intermediate_products', eventProfile: 'rapujuhlat', drinksPerGuestPerHour: 0.25, abvPercent: 18, basis: 'Rapujuhlat (crayfish party) pacing basis: fortified/vermouth-style serves fit the dinner format' },
  { drinkType: 'other_fermented', eventProfile: 'rapujuhlat', drinksPerGuestPerHour: 0.1, abvPercent: 5.5, basis: 'Rapujuhlat (crayfish party) pacing basis: marginal cider share at a seated snaps-led dinner' },

  // Talkoot — voluntary work parties: modest beer-forward provisions
  // around the shared meal, low pacing during the work itself.
  { drinkType: 'beer', eventProfile: 'talkoot', drinksPerGuestPerHour: 0.5, abvPercent: 4.7, basis: 'Talkoot (voluntary work party) basis: modest beer-forward provisions around the shared meal' },
  { drinkType: 'other_fermented', eventProfile: 'talkoot', drinksPerGuestPerHour: 0.25, abvPercent: 5.5, basis: 'Talkoot (voluntary work party) basis: light cider share in the after-work provisions' },
  { drinkType: 'wine_still', eventProfile: 'talkoot', drinksPerGuestPerHour: 0.1, abvPercent: 12, basis: 'Talkoot (voluntary work party) basis: marginal still-wine share in the after-work provisions' },
  { drinkType: 'wine_sparkling', eventProfile: 'talkoot', drinksPerGuestPerHour: 0.1, abvPercent: 11.5, basis: 'Talkoot (voluntary work party) basis: marginal sparkling share — a completion toast at most' },
  { drinkType: 'intermediate_products', eventProfile: 'talkoot', drinksPerGuestPerHour: 0.1, abvPercent: 18, basis: 'Talkoot (voluntary work party) basis: marginal fortified/intermediate share in the provisions' },
  { drinkType: 'spirits', eventProfile: 'talkoot', drinksPerGuestPerHour: 0.15, abvPercent: 40, basis: 'Talkoot (voluntary work party) basis: minimal spirits — work safety keeps pacing near zero until the job is done' },
];

export const SEASONAL_CONSUMPTION_NORMS_SEED_ROWS: readonly ConsumptionNormSeedRow[] =
  SEASONAL_CURATED_NORMS.map((input) =>
    norm(SEASONAL_CONSUMPTION_NORMS_SEED_VERSION, input),
  );

/** Every curated row this seed appends — both datasets, standard first. */
export const ALL_CONSUMPTION_NORMS_SEED_ROWS: readonly ConsumptionNormSeedRow[] =
  [...CONSUMPTION_NORMS_SEED_ROWS, ...SEASONAL_CONSUMPTION_NORMS_SEED_ROWS];

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
 * Upsert the curated versions (standard + seasonal) into
 * consumption_norms as one batch — either the whole seed lands or
 * nothing does. Idempotent: re-runs refresh pending rows in place and
 * leave published rows untouched.
 */
export async function seedConsumptionNorms(d1: D1DatabaseLike): Promise<void> {
  await d1.batch(
    ALL_CONSUMPTION_NORMS_SEED_ROWS.map((row) =>
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
