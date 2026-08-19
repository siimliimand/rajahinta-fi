/**
 * Port interface for tax rule lookup.
 *
 * Core Domain owns this port so the tax services depend on an abstraction,
 * not on a specific repository implementation.  The concrete adapter lives
 * in the composition root (DataPlatform or ApplicationApi) and wires
 * {@link import('@rajahinta/data-platform').IRepositoryRegistry} into this
 * contract at bootstrap time.
 *
 * @module TaxRuleRepositoryPort
 */

/** ABV-tier conditions extracted from the JSON exemption conditions. */
export interface AbvTierConditions {
  readonly minAlcoholByVolume?: number;
  readonly maxAlcoholByVolume?: number;
}

/** Read-model shape — mirrors a subset of TaxRuleRecord without ORM types. */
export interface TaxRuleRecordPort {
  readonly id: number;
  readonly taxType: string;
  readonly productCategory: string;
  /** Decimal string so precision is preserved across serialisation boundaries. */
  readonly rate: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly calculationFormulaReference: string;
  readonly officialSource: string;
  readonly verificationDate: Date | null;
  readonly versionLabel: string;
  /**
   * ABV-tier / exemption conditions extracted from the JSONB column.
   *
   * - `maxAlcoholByVolume` alone (no `minAlcoholByVolume`): the rule applies to
   *   products with ABV ≤ this threshold. When the product's ABV is below this
   *   threshold, the rate is **zero** (exempt).
   * - `minAlcoholByVolume` alone: the rule applies to products with ABV ≥ this
   *   threshold at the stated rate.
   * - Both `minAlcoholByVolume` and `maxAlcoholByVolume`: the rule applies to
   *   products in this ABV range at the stated rate.
   * - `null`: no tier constraints — the rule is a catch-all.
   */
  readonly exemptionConditions: AbvTierConditions | null;
}

/**
 * Repository contract that the tax engines need.
 *
 * Consumers inject this interface.  An adapter in the composition root
 * maps the concrete {@code IRepositoryRegistry.taxRates} API to this port.
 */
export interface ITaxRuleRepositoryPort {
  /**
   * Return the most specific tax rule for the given type and category
   * that was effective on {@code asOf}.
   *
   * "Most specific" means the row whose {@code productCategory} best matches
   * the requested category (exact match preferred), falling back to a
   * wildcard / general row for the same taxType if no exact match exists.
   */
  findApplicable(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<TaxRuleRecordPort | null>;

  /**
   * Return ALL active tax rules for the given type and category that were
   * effective on {@code asOf}, ordered by effectiveFrom descending.
   *
   * Multiple rules can exist for the same category with different ABV-tier
   * constraints (e.g. {@code wine_still} has a LOW tier for 1.2–15 % ABV and
   * a HIGH tier for 15–18 % ABV).  The caller selects the correct rule based
   * on the product's ABV and the {@code exemptionConditions} on each rule.
   */
  findAllApplicable(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<TaxRuleRecordPort[]>;

  /**
   * Return all tax rules for the given type and category whose effective
   * window overlaps {@code [fromDate, toDate)}.
   *
   * Overlap logic: a rule applies on a given date D when
   *   effectiveFrom <= D AND (effectiveTo IS NULL OR effectiveTo > D).
   * This method returns every row whose window intersects the query range.
   *
   * Results are ordered by effectiveFrom ascending.
   */
  findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecordPort[]>;

  /**
   * Return the distinct version labels of all currently active tax rules.
   *
   * A rule is considered active when its effectiveness window covers the
   * current date: effectiveFrom <= now AND (effectiveTo IS NULL OR effectiveTo > now).
   * Used by the idempotency layer to detect stale cache entries.
   */
  findActiveVersionLabels(): Promise<readonly string[]>;
}