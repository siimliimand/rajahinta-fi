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
  /**
   * Gate advanced Phase 2 surfaces: scenario (endpoints + UI), report
   * (endpoint + export buttons), reliability (endpoint + embedded scores),
   * and declaration guidance (field + panel).
   * Spec/design slug: `enable_advanced_features`.
   * Default OFF for instant rollback of all four surfaces together.
   */
  ADVANCED_FEATURES = 'ADVANCED_FEATURES',
  /**
   * Gate the operator console — the authenticated UI + API at
   * `/ops/console/**` for governance permission grants, tax-rate/FX
   * dataset-version confirmation, and the correction queue
   * (task 12.1, change technical-assessment-remediation).
   * Default OFF per the compliance rule (new UI ships flag-off); the
   * bearer+allowlist guard stays on regardless of the flag.
   */
  OPERATOR_CONSOLE = 'OPERATOR_CONSOLE',
}

/** Runtime feature-flag configuration shape used by the service. */
export type FeatureFlagConfig = Record<FeatureFlag, boolean>;