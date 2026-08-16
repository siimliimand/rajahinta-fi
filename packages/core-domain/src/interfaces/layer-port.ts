/**
 * Layer Boundary Port — the complete contract each layer exposes.
 *
 * This file documents the full "module boundary" for every layer in the
 * modular monolith.  The exports in this file come from the Core Domain
 * layer (the lowest layer).  Cross-layer contracts for DataPlatform,
 * DataAcquisition, and ApplicationApi are documented in comments — their
 * canonical interface files live in each layer's own `src/interfaces/`
 * directory.
 *
 * When extracting a layer to a separate package or microservice, the
 * interfaces listed below are the extraction surface.  The in-process
 * injection is replaced by an RPC/HTTP adapter on both sides.
 *
 * Layer dependency order (bottom → top):
 *
 *   CoreDomain  ←  DataPlatform  ←  DataAcquisition  ←  ApplicationApi
 *
 * Domain types flow up; infrastructure implementations flow down.
 *
 * @module LayerPort
 */

// ==========================================================================
// CORE DOMAIN  (no internal dependencies — pure domain)
// ==========================================================================

/**
 * PUBLIC API — consumed by DataPlatform, DataAcquisition, ApplicationApi.
 *
 * Extraction surface: every type exported from `@rajahinta/core-domain` plus
 * ICalculationEngine and LandedCostParams below.
 * No NestJS, no framework — plain TS.
 */
export type { ICalculationEngine, LandedCostParams } from './calculation-engine.interface';

// All domain types (/src/index.ts) are also part of the port:
//   ExciseCategory, ContainerType, DataReliability, TransactionClass
//   TaxRateVersion, ExciseBase, ContainerDutyRequest
//   ExciseCalculation, ContainerDutyCalculation
//   Disclaimer, LandedCostResult
//   TaxCalculationEngine (abstract class — legacy, migrate to ICalculationEngine)

// ==========================================================================
// DATA PLATFORM  (depends on CoreDomain types only)
// ==========================================================================

/**
 * PUBLIC API — consumed by DataAcquisition, ApplicationApi.
 *
 * Defined in:  @rajahinta/data-platform/src/interfaces/repository-registry.interface.ts
 *
 * Extraction surface:
 *   IRepositoryRegistry      — unified registry (products, taxRates, audit)
 *   IProductRepository       — findById, findOffers
 *   ITaxRateRepository       — findEffectiveVersion, findVersionById
 *   IAuditRepository         — recordCalculation
 *   ProductRecord            — read-model shape (no ORM types exposed)
 *   MerchantOfferRecord
 *   TaxRateVersionRecord
 *   TransportRateRecord
 *   CalculationAuditEntry
 *
 * Consumers NEVER import Drizzle schemas or ORM types directly.
 */

// ==========================================================================
// DATA ACQUISITION  (depends on CoreDomain + DataPlatform types)
// ==========================================================================

/**
 * PUBLIC API — consumed by ApplicationApi, background jobs.
 *
 * Defined in:  @rajahinta/data-acquisition/src/interfaces/data-source.interface.ts
 *
 * Extraction surface:
 *   IDataSourceRegistry       — unified registry (prices, transportRates, taxRates)
 *   IPriceDataSource          — ingestMerchantPrices, scheduleRefresh
 *   ITransportRateDataSource  — refreshCarrierRates, schedulePeriodicRefresh
 *   ITaxRateDataSource        — checkForNewPublishedRates
 *   IngestionResult           — { productsIngested, errors }
 *   RateRefreshResult         — { ratesUpdated }
 *   PublishedRatesCheckResult — { datasetsFound, requiresConfirmation }
 *
 * Consumers NEVER import BullMQ queues or HTTP scrapers directly.
 */

// ==========================================================================
// APPLICATION API  (depends on all lower layers)
// ==========================================================================

/**
 * PUBLIC API — consumed by frontend apps, external API clients.
 *
 * Defined in:  @rajahinta/application-api/src/interfaces/index.ts
 *
 * Extraction surface:
 *   CalculateExciseRequest     — POST /api/v1/calculations/excise body
 *   CalculateLandedCostRequest — POST /api/v1/calculations/landed-cost body
 *   HealthCheckResponse        — GET /api/v1/health response
 *   ApiErrorResponse           — standard error body
 *   IUseCaseOrchestrator       — executeCalculation(userId, sessionId, inputs)
 *
 * Consumers NEVER import NestJS controllers or decorators directly.
 */

// ==========================================================================
// INTRA-LAYER IMPORT RULES
// ==========================================================================

/**
 * ┌──────────────────────────────────────────────────────────────┐
 * │                Presentation  (apps/frontend, apps/backend)   │
 * │  Imports: ApplicationApi interfaces (DTOs)                   │
 * │  Never imports: CoreDomain directly                          │
 * ├──────────────────────────────────────────────────────────────┤
 * │                ApplicationApi  (API layer)                   │
 * │  Imports: CoreDomain (ICalculationEngine, domain types)      │
 * │           DataPlatform (IRepositoryRegistry)                 │
 * │           DataAcquisition (IDataSourceRegistry)              │
 * ├──────────────────────────────────────────────────────────────┤
 * │              DataAcquisition  (ingestion layer)              │
 * │  Imports: CoreDomain (types)                                 │
 * │           DataPlatform (IRepositoryRegistry)                 │
 * ├──────────────────────────────────────────────────────────────┤
 * │                DataPlatform  (data layer)                    │
 * │  Imports: CoreDomain (types)                                 │
 * ├──────────────────────────────────────────────────────────────┤
 * │                 CoreDomain  (domain core)                    │
 * │  Imports: nothing (pure TS)                                  │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Rule of thumb: if a file at layer N imports from layer N+2 or higher,
 * it is crossing the wrong boundary — push the logic down or delegate
 * through an intermediate layer interface.
 */