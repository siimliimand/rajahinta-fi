/**
 * External data source contract.
 *
 * Defines the interface for ingesting data from external sources
 * (merchant price feeds, carrier transport rates, official tax-rate
 * publications).  Consumers (Application API, background jobs) depend
 * on this interface rather than on queue-specific or HTTP-specific
 * implementations, making the data-acquisition layer extractable to
 * a standalone worker service.
 *
 * Every sourced fact carries a reliability status and timestamp as
 * required by the domain's data-freshness constraint.
 *
 * @module DataSource
 */

/** Result of a price-ingestion run. */
export interface IngestionResult {
  readonly productsIngested: number;
  readonly errors: string[];
}

/** Result of a transport-rate refresh. */
export interface RateRefreshResult {
  readonly ratesUpdated: number;
}

/** Result of checking for newly published official rates. */
export interface PublishedRatesCheckResult {
  readonly datasetsFound: number;
  readonly requiresConfirmation: boolean;
}

// --------------------------------------------------------------------------
// Data-source contracts
// --------------------------------------------------------------------------

/**
 * Ingests product/price data from external merchant sources.
 * Concrete implementations wire into merchant-specific APIs or scrapers.
 */
export interface IPriceDataSource {
  /** Pull prices for a given merchant and return ingestion stats. */
  ingestMerchantPrices(
    merchantId: string,
    sourceUrl: string,
  ): Promise<IngestionResult>;

  /** Schedule a recurring refresh for a merchant's prices. */
  scheduleRefresh(merchantId: string, cronExpression: string): void;
}

/**
 * Refreshes carrier transport rates from external rate tables.
 */
export interface ITransportRateDataSource {
  /** Pull latest rates for a carrier and return update stats. */
  refreshCarrierRates(carrierId: string): Promise<RateRefreshResult>;

  /** Schedule periodic refresh of all active carrier rates. */
  schedulePeriodicRefresh(intervalMs: number): void;
}

/**
 * Monitors official tax-rate publications (e.g. Finnish Tax Administration).
 *
 * Discovered changes are NEVER auto-published – they create a task for
 * manual/legal confirmation before the new dataset goes live.
 */
export interface ITaxRateDataSource {
  /** Check for newly published official rate changes. */
  checkForNewPublishedRates(): Promise<PublishedRatesCheckResult>;
}

// --------------------------------------------------------------------------
// Unified registry for data-acquisition sources
// --------------------------------------------------------------------------

/**
 * Registry that exposes every external data source.
 *
 * Consumers inject `IDataSourceRegistry` to access any data source
 * without depending on queue infrastructure or concrete source classes.
 */
export interface IDataSourceRegistry {
  readonly prices: IPriceDataSource;
  readonly transportRates: ITransportRateDataSource;
  readonly taxRates: ITaxRateDataSource;
}