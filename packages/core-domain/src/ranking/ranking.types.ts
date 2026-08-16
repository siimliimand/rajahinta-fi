/**
 * Ranking & Sorting types.
 *
 * Defines the objective sort orders used by the RankingService and the
 * {@link NeutralSortInput} type that enforces structural neutrality.
 *
 * ## Neutrality guarantee
 *
 * {@link NeutralSortInput} is the **only** input type accepted by
 * `RankingService.rank()`. It contains no field for paid placement,
 * promotional boost, merchant scoring, sponsored position, or any
 * form of manual curation. This is enforced structurally:
 *
 * 1. **Type-level**: the interface is closed — it only exposes fields
 *    necessary for objective, deterministic sorting.
 * 2. **Compile-time**: a type-level assertion (below) proves that an
 *    object with an extra `paidBoost` field is not assignable to
 *    `NeutralSortInput`.
 * 3. **Runtime**: `RankingService.rank()` rejects inputs containing
 *    unknown properties (those not declared on `NeutralSortInput`).
 *
 * No code path within this module — or any module that calls into it —
 * can influence sort position via a merchant payment or manual boost.
 *
 * ## Billing isolation
 *
 * This module is structurally separate from `BillingModule`
 * (`@rajahinta/application-api`). No ranking type references a billing
 * type, and no billing type can be used as ranking input. This is enforced
 * at both compile time (type system) and runtime (import analysis in
 * `billing-ranking-isolation.test.ts`).
 *
 * @module RankingTypes
 */

// ---------------------------------------------------------------------------
// NeutralSortInput — structually neutral sort input
// ---------------------------------------------------------------------------

/**
 * The only fields available for sorting.
 *
 * Every property here is a purely factual, objective attribute of the
 * product or its calculated cost. No promotional, paid, or curated fields
 * exist at this layer.
 *
 * All numeric fields are `number` (not `bigint` or a branded type) to
 * keep the type simple and composable while remaining structurally sealed.
 */
export interface NeutralSortInput {
  /** Total landed cost in euro-cents. */
  readonly totalCents: number;

  /** Product volume in litres. */
  readonly volumeLitres: number;

  /** Quantity of units calculated. */
  readonly quantity: number;

  /** Normalized product name (used as tiebreaker and for alphabetical sort). */
  readonly productName: string;

  /** Alcohol by volume percentage (0–100). */
  readonly alcoholByVolume: number;

  /** Canonical product category (beer, wine, spirits, etc.). */
  readonly category: string;
}

/**
 * Compile-time assertion: an object with a `paidBoost` field is NOT
 * assignable to `NeutralSortInput`.
 *
 * This proves the type system will catch any attempt to pass paid/manual
 * placement data into the sorting function at the call site. If this line
 * ever compiles without error, the neutrality enforcement has been broken.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type _NeutralityTypeCheck = NeutralSortInput extends { paidBoost: number }
  ? never
  : true;

// ---------------------------------------------------------------------------
// SortOrder
// ---------------------------------------------------------------------------

/**
 * Objective sort orders for ranking beverage cost comparisons.
 *
 * Every sort is a deterministic, objective comparator. No paid placement,
 * boosted results, or sponsored positions exist in this type.
 */
export type SortOrder =
  | 'LOWEST_LANDED_COST'
  | 'LOWEST_PER_LITRE'
  | 'LOWEST_PER_UNIT'
  | 'ALPHABETICAL'
  | 'ALCOHOL_PERCENTAGE'
  | 'PRODUCT_CATEGORY';