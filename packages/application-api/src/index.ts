import {
  Module,
  Controller,
  Get,
  Injectable,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  LandedCostResult,
  CoreDomainModule,
  type CalculatorPorts,
  type OptimizerModulePorts,
  RankingModule,
  DeclarationModule,
} from '@rajahinta/core-domain';
import {
  DataPlatformModule,
  ProductRepository,
  CalculationRecordRepository,
  MerchantTermsRepository,
  BasketCalculationRecordRepository,
  TransportOfferRepository,
  DrizzleProductRepository,
  DrizzleCalculationRecordRepository,
  DrizzleMerchantTermsRepository,
  DrizzleBasketCalculationRecordRepository,
  DrizzleTransportOfferRepository,
  TaxRuleRepositoryAdapter,
} from '@rajahinta/data-platform';
import { ObservabilityModule } from './observability';
import { FeatureFlagsModule } from './feature-flags';
import { JobsModule } from './jobs';
import { IdempotencyModule } from './idempotency';
import { RateLimitingModule } from './rate-limiting';
import { BillingModule } from './billing';
import { AuditModule } from './audit';
import { RedisModule } from './redis';
import { AgeGateModule } from './age-gate';
import { AccountModule } from './accounts';
import { CalculatorController } from './calculator';
import { BasketOptimizerController } from './basket';
import { SearchController } from './search';
import { DeclarationController } from './declaration';
import { HistoricalDataModule } from './historical';
import { ReportsModule } from './reports';
import { MerchantsModule } from './merchants';
import { AnalyticsModule, OutboundRedirectController } from './analytics';
import { CorrectionModule } from './correction';
import { RankingModule as ApplicationRankingModule } from './ranking';
import { CalculationController, CalculateLandedCostDto } from './calculations';
import { ReadinessService, type ReadinessResponse } from './observability';

// ---------------------------------------------------------------------------
// Module boundary — pure DTO interfaces for cross-layer contracts
// ---------------------------------------------------------------------------

export type {
  CalculateExciseRequest,
  CalculateLandedCostRequest,
  ApiErrorResponse,
  IUseCaseOrchestrator,
} from './interfaces';

// ---------------------------------------------------------------------------
// NestJS DTOs (legacy endpoints — validation lives in the controller,
// following the project-wide imperative-validation pattern)
// ---------------------------------------------------------------------------

export { CalculationController, CalculateExciseDto, CalculateLandedCostDto } from './calculations';

export class HealthCheckResponse {
  status!: 'ok';
  timestamp!: string;
}

// ---------------------------------------------------------------------------
// Health controller
// ---------------------------------------------------------------------------

/**
 * Liveness (`GET /api/v1/health`) is deliberately process-only — no
 * dependency network calls — so an orchestrator never restarts a pod whose
 * database is briefly down. Readiness (`GET /api/v1/health/ready`) verifies
 * PostgreSQL and Redis with short timeouts and fails (503) when either is
 * unreachable, so a pod with a dead dependency stops receiving traffic.
 */
@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe — process is up (no dependency checks)' })
  @ApiResponse({ status: 200, description: 'Process alive' })
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — PostgreSQL SELECT 1 and Redis ping with short timeouts' })
  @ApiResponse({ status: 200, description: 'All dependencies reachable' })
  @ApiResponse({ status: 503, description: 'At least one dependency is down — body reports which' })
  async ready(
    @Res({ passthrough: true }) res: { status: (code: number) => void },
  ): Promise<ReadinessResponse> {
    const result = await this.readiness.check();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Use-case orchestrator (empty shell for future feature wiring)
// ---------------------------------------------------------------------------

@Injectable()
export abstract class UseCaseOrchestrator {
  abstract executeCalculation(
    userId: string,
    sessionId: string,
    inputs: CalculateLandedCostDto,
  ): Promise<LandedCostResult>;
}

// ---------------------------------------------------------------------------
// NestJS module — registers controllers, exports orchestrator
// ---------------------------------------------------------------------------

@Module({
imports: [
    FeatureFlagsModule,
    ObservabilityModule,
    JobsModule,
    IdempotencyModule,
    RateLimitingModule,
    BillingModule,
    AuditModule,
    AgeGateModule,
    AccountModule,
    AnalyticsModule,
    RedisModule,
    CoreDomainModule,
   RankingModule,
   DeclarationModule,
   DataPlatformModule,
   CorrectionModule,
    ApplicationRankingModule,
    // Price-history API — declares its own controller behind the
    // enable_historical_price_intelligence feature flag (task 4.1).
    HistoricalDataModule,
    // Report export API — declares its own controller behind the
    // ADVANCED_FEATURES feature flag + calculation:export entitlement
    // (task 3.3, change phase2-advanced-features).
    ReportsModule,
    // Merchant reliability API — declares its own controller behind the
    // ADVANCED_FEATURES feature flag + PRICE_DATA launch gate + age gate
    // (task 3.4, change phase2-advanced-features); also exports the
    // score pipeline used by the search module's detail-response embed.
    MerchantsModule,
  ],
  providers: [
    // Concrete repository implementations — wire SearchController and
    // CalculatorController to Drizzle-backed data access
    { provide: ProductRepository, useClass: DrizzleProductRepository },
    { provide: CalculationRecordRepository, useClass: DrizzleCalculationRecordRepository },
    // Register concrete classes so NestJS can resolve their constructor deps
    DrizzleProductRepository,
    DrizzleCalculationRecordRepository,
  ],
  controllers: [
    CalculationController,
    HealthController,
    CalculatorController,
    SearchController,
    DeclarationController,
    OutboundRedirectController,
    BasketOptimizerController,
  ],
  exports: [FeatureFlagsModule, ObservabilityModule, JobsModule, IdempotencyModule, RateLimitingModule, AuditModule, RedisModule],
})
export class ApplicationApiModule {}

/**
 * Deliberately undecorated class used as the identity of the CONFIGURED
 * module returned by {@link ApplicationApiModule.forRoot} — a fresh class
 * avoids NestJS merging the static @Module metadata of ApplicationApiModule
 * (whose default imports bring a null-port CalculatorModule) into the
 * configured graph. See CoreDomainConfiguredModule for the same pattern.
 */
export class ApplicationApiConfiguredModule {}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ApplicationApiModule {
  /**
   * Configure the layer with concrete calculator port implementations
   * (product data lookup + calculation record persistence). The ports are
   * threaded into CoreDomainModule.forRoot so they are visible to
   * LandedCostCalculatorService inside its own module scope.
   */
  export function forRoot(ports: CalculatorPorts & Partial<OptimizerModulePorts>) {
    const coreDomain = CoreDomainModule.forRoot({
      ...ports,
      // The real tax-rule repository for AlcoholExciseService — without
      // this the core-domain TaxModule binds the port to null and every
      // calculation degrades to the no-rule fallback.
      taxRuleRepository: TaxRuleRepositoryAdapter,
      // The port adapters (defined in the host app) inject repository
      // tokens — register the concrete bindings inside the calculator
      // module scope where the adapters are instantiated.
      extraProviders: [
        { provide: ProductRepository, useClass: DrizzleProductRepository },
        { provide: CalculationRecordRepository, useClass: DrizzleCalculationRecordRepository },
        { provide: MerchantTermsRepository, useClass: DrizzleMerchantTermsRepository },
        { provide: BasketCalculationRecordRepository, useClass: DrizzleBasketCalculationRecordRepository },
        { provide: TransportOfferRepository, useClass: DrizzleTransportOfferRepository },
      ],
    });
    return {
      module: ApplicationApiConfiguredModule,
      imports: [
        FeatureFlagsModule,
        ObservabilityModule,
        JobsModule,
        IdempotencyModule,
        RateLimitingModule,
        BillingModule,
        AuditModule,
        AgeGateModule,
        AccountModule,
        AnalyticsModule,
        RedisModule,
        RankingModule,
        DeclarationModule,
        DataPlatformModule,
        CorrectionModule,
        ApplicationRankingModule,
        coreDomain, // brings the CONFIGURED CalculatorModule (ports injected)
        HistoricalDataModule,
        ReportsModule,
        MerchantsModule,
      ],
      providers: [
        { provide: ProductRepository, useClass: DrizzleProductRepository },
        { provide: CalculationRecordRepository, useClass: DrizzleCalculationRecordRepository },
        DrizzleProductRepository,
        DrizzleCalculationRecordRepository,
      ],
      controllers: [
        CalculationController,
        HealthController,
        CalculatorController,
        SearchController,
        DeclarationController,
        OutboundRedirectController,
        BasketOptimizerController,
      ],
      exports: [FeatureFlagsModule, ObservabilityModule, JobsModule, IdempotencyModule, RateLimitingModule, AuditModule, RedisModule],
    };
  }
}

// ---------------------------------------------------------------------------
// Feature-flag re-exports for consumers outside the layer
// ---------------------------------------------------------------------------

export { FeatureFlag, FeatureFlagService, FeatureFlagGuard, FeatureFlagDec as FeatureFlagDecorator } from './feature-flags';
export type { FeatureFlagConfig } from './feature-flags';
export { FeatureFlagsModule } from './feature-flags';

// ---------------------------------------------------------------------------
// Observability re-exports for consumers outside the layer
// ---------------------------------------------------------------------------

export { KpiCategory, MetricType } from './observability';
export type { KpiMetric, MetricTags } from './observability';
export { KpiService, InstrumentationService, OpsDashboardService, OpsDashboardController, CostAttributionService, ObservabilityModule } from './observability';
export type { StaleDataResult, StaleDataSource, VerifiedCalculationResult, ComplianceIncident, DashboardSnapshot, CostSummary, CostBreakdown } from './observability';

// ---------------------------------------------------------------------------
// Jobs re-exports for consumers outside the layer
// ---------------------------------------------------------------------------

export { JobsModule } from './jobs';

// ---------------------------------------------------------------------------
// Idempotency re-exports for consumers outside the layer
// ---------------------------------------------------------------------------

export { IdempotencyModule, IdempotencyService, InMemoryIdempotencyCache, RedisIdempotencyCache, IDEMPOTENCY_CACHE, hashInput } from './idempotency';
export type { CacheKeyInput, IdempotencyOptions, IIdempotencyCache, RedisIdempotencyOptions } from './idempotency';

// ---------------------------------------------------------------------------
// Redis shared client — wire into feature modules for production use
// ---------------------------------------------------------------------------

export { RedisModule, REDIS_CLIENT } from './redis';

// ---------------------------------------------------------------------------
// Rate Limiting re-exports for consumers outside the layer
// ---------------------------------------------------------------------------

export { RateLimitingModule, RateLimitingService, InMemoryRateLimiter, RedisRateLimiter, RATE_LIMITER, RateLimitGuard, RateLimit, RATE_LIMIT_PROFILES } from './rate-limiting';
export type { RateLimitProfileName, IRateLimiter } from './rate-limiting';

// ---------------------------------------------------------------------------
// Billing — subscription billing integration (Phase 1: simulated)
// ---------------------------------------------------------------------------

export { BillingModule, BillingService } from './billing';
export type { SubscriptionStatus } from './billing';

// ---------------------------------------------------------------------------
// Calculator — landed-cost calculation API
// ---------------------------------------------------------------------------

export { CalculatorController } from './calculator';
export type {
  CalculateRequest,
  CalculationResultResponse,
  UnpersistedClassification,
} from './calculator';

// ---------------------------------------------------------------------------
// Search — product search and discovery API
// ---------------------------------------------------------------------------

export { SearchController } from './search';
export type { SearchProductsQuery, ProductSearchResult, ProductSearchItem, ProductDetailResponse, OfferItem } from './search';

// ---------------------------------------------------------------------------
// Declaration — excise declaration assistant API
// ---------------------------------------------------------------------------

export { DeclarationController } from './declaration';
export type { DeclarationSummaryResponse } from './declaration';

// ---------------------------------------------------------------------------
// Historical — price-history API (feature-flagged, default off)
// ---------------------------------------------------------------------------

export { HistoricalDataModule, HistoricalDataController } from './historical';
export type {
  PriceHistoryMetric,
  PriceHistoryGranularity,
  PriceHistoryPoint,
  PriceHistoryMovedInputs,
  PriceHistoryRuleBoundary,
  PriceHistoryAttribution,
  PriceHistoryResponse,
} from './historical';

// ---------------------------------------------------------------------------
// Reports — calculation export API (feature-flagged + entitlement-gated)
// ---------------------------------------------------------------------------

export { ReportsModule, ReportsController, ReportExportService } from './reports';
export type { ReportFormat, JsonReport, ReportsModulePorts } from './reports';

// ---------------------------------------------------------------------------
// Merchants — merchant reliability API (feature-flagged, default off)
// ---------------------------------------------------------------------------

export { MerchantsModule, MerchantReliabilityController, MerchantReliabilityService } from './merchants';
export type { MerchantReliabilityScoreDto, MerchantReliabilityMap, MerchantReliabilityListResponse } from './merchants';

// ---------------------------------------------------------------------------
// Correction — correction flagging API
// ---------------------------------------------------------------------------

export { CorrectionModule, CorrectionController, CorrectionService } from './correction';
export type { CreateCorrectionDto, CorrectionItem, CorrectionListResponse } from './correction';

// ---------------------------------------------------------------------------
// Audit — immutable audit log (in-memory Phase 1 implementation)
// ---------------------------------------------------------------------------

export { AuditModule, InMemoryAuditRepository } from './audit';

// ---------------------------------------------------------------------------
// Age Gate — lightweight access-control verification (Phase 1: confirmation only)
// ---------------------------------------------------------------------------

export { AgeGateModule, AgeGateService, SimpleConfirmationProvider, VERIFICATION_PROVIDER } from './age-gate';
export type { IVerificationProvider, VerificationResult } from './age-gate';

// ---------------------------------------------------------------------------
// Accounts — minimal account system (saved baskets, history, subscription)
// ---------------------------------------------------------------------------

export { AccountModule, AccountService, AccountRetentionService, DataExportService } from './accounts';
export type { Account, Basket, BasketItem, PurgeResult, AnonymizeResult, DataExport, CalculationExportRecord } from './accounts';

// ---------------------------------------------------------------------------
// Analytics — click analytics (Phase 1: in-memory, no purchase tracking)
// ---------------------------------------------------------------------------

export { AnalyticsModule, ClickAnalyticsService } from './analytics';

// ---------------------------------------------------------------------------
// Ranking — ranking methodology API
// ---------------------------------------------------------------------------

export { RankingModule, RankingController } from './ranking';
export type { RankingMethodology, SortOrderDescription } from './ranking';

// ---------------------------------------------------------------------------
// Basket — basket optimization API
// ---------------------------------------------------------------------------

export { BasketOptimizerController } from './basket';
export type { BasketOptimizeRequest, BasketItemInput } from './basket';