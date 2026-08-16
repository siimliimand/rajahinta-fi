/**
 * Ranking & Sorting types.
 *
 * Defines the objective sort orders used by the RankingService.
 * No paid/boosted sort orders exist at this layer — the type is a closed
 * union enforced structurally in the RankingService.
 *
 * @module RankingTypes
 */

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