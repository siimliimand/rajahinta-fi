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
}