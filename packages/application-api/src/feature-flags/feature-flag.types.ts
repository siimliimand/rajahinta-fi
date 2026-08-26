/** Feature flag identifiers — single source of truth for all gated features. */
export enum FeatureFlag {
  /** Gate new merchant data sources (scrapers, APIs, partner feeds). */
  NEW_MERCHANT_SOURCE = 'NEW_MERCHANT_SOURCE',
  /** Gate new tax rule versions before legal confirmation. */
  NEW_TAX_RULESET = 'NEW_TAX_RULESET',
  /** Gate new UI ranking/sorting behavior. */
  UI_RANKING_V2 = 'UI_RANKING_V2',
  /**
   * Gate historical price intelligence (price-history API + UI charts).
   * Spec/design slug: `enable_historical_price_intelligence`.
   * Default OFF until product review — instant rollback for the
   * user-facing historical data presentation.
   */
  HISTORICAL_PRICE_INTELLIGENCE = 'HISTORICAL_PRICE_INTELLIGENCE',
  /**
   * Gate basket optimization API and UI (multi-store split, tiered shipping).
   * Spec slug: `enable_basket_optimization`.
   * Default OFF during active development — enabled once integration tests pass.
   */
  BASKET_OPTIMIZATION = 'BASKET_OPTIMIZATION',
}

/** Runtime feature-flag configuration shape used by the service. */
export type FeatureFlagConfig = Record<FeatureFlag, boolean>;