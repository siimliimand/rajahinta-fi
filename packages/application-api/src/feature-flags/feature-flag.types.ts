/** Feature flag identifiers — single source of truth for all gated features. */
export enum FeatureFlag {
  /** Gate new merchant data sources (scrapers, APIs, partner feeds). */
  NEW_MERCHANT_SOURCE = 'NEW_MERCHANT_SOURCE',
  /** Gate new tax rule versions before legal confirmation. */
  NEW_TAX_RULESET = 'NEW_TAX_RULESET',
  /** Gate new UI ranking/sorting behavior. */
  UI_RANKING_V2 = 'UI_RANKING_V2',
}

/** Runtime feature-flag configuration shape used by the service. */
export type FeatureFlagConfig = Record<FeatureFlag, boolean>;