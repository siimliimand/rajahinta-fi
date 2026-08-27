import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Injectable,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  TaxCalculationEngine,
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
import { AgeGateGuard } from './age-gate';
import { AccountModule } from './accounts';
import { CalculatorController } from './calculator';
import { BasketOptimizerController } from './basket';
import { SearchController } from './search';
import { DeclarationController } from './declaration';
import { HistoricalDataModule } from './historical';
import { AnalyticsModule, OutboundRedirectController } from './analytics';
import { CorrectionModule } from './correction';
import { RankingModule as ApplicationRankingModule } from './ranking';
import { TaxCalculationEngineAdapter } from './adapters/tax-calculation-engine.adapter';

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
// NestJS DTOs (legacy — replace with interfaces above over time)
// ---------------------------------------------------------------------------

export class CalculateExciseDto {
  category!: 'beer' | 'wine' | 'spirits' | 'intermediate' | 'other';
  volumeLitres!: number;
  alcoholByVolume!: number;
}

export class CalculateLandedCostDto {
  retailPriceCents!: number;
  transportCostCents!: number;
  exciseBase!: CalculateExciseDto | null;
  containerType!: string | null;
  containerVolumeLitres!: number | null;
  depositSystemVerified!: boolean;
  transactionClass!: 'distance-selling' | 'distance-buying' | 'traveller-import';
}

export class HealthCheckResponse {
  status!: 'ok';
  timestamp!: string;
  version!: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('calculations')
@Controller('api/v1/calculations')
@UseGuards(AgeGateGuard)
export class CalculationController {
  constructor(private readonly engine: TaxCalculationEngine) {}

  @Post('excise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate alcohol excise duty' })
  @ApiResponse({
    status: 200,
    description: 'Excise calculation result with provenance evidence',
  })
  async calculateExcise(@Body() dto: CalculateExciseDto) {
    return this.engine.calculateExcise({
      category: dto.category,
      volumeLitres: dto.volumeLitres,
      alcoholByVolume: dto.alcoholByVolume,
    });
  }

  @Post('landed-cost')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate full landed cost for a basket line' })
  @ApiResponse({
    status: 200,
    description: 'Complete landed-cost result with disclaimer',
  })
  async calculateLandedCost(
    @Body() dto: CalculateLandedCostDto,
  ): Promise<LandedCostResult> {
    return this.engine.calculateLandedCost({
      retailPriceCents: dto.retailPriceCents,
      transportCostCents: dto.transportCostCents,
      exciseBase: dto.exciseBase ?? null,
      containerDutyRequest: dto.containerType
        ? {
            containerType: dto.containerType as any,
            volumeLitres: dto.containerVolumeLitres ?? 0,
            depositSystemVerified: dto.depositSystemVerified,
          }
        : null,
      transactionClass: dto.transactionClass,
    });
  }
}

// ---------------------------------------------------------------------------
// Health controller
// ---------------------------------------------------------------------------

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Service health check' })
  @ApiResponse({ status: 200, description: 'Healthy' })
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
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
  ],
  providers: [
    TaxCalculationEngineAdapter,
    // Concrete repository implementations — wire SearchController and
    // CalculatorController to Drizzle-backed data access
    { provide: ProductRepository, useClass: DrizzleProductRepository },
    { provide: CalculationRecordRepository, useClass: DrizzleCalculationRecordRepository },
    { provide: TaxCalculationEngine, useClass: TaxCalculationEngineAdapter },
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
      ],
      providers: [
        TaxCalculationEngineAdapter,
        { provide: ProductRepository, useClass: DrizzleProductRepository },
        { provide: CalculationRecordRepository, useClass: DrizzleCalculationRecordRepository },
        { provide: TaxCalculationEngine, useClass: TaxCalculationEngineAdapter },
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

export { RateLimitingModule, RateLimitingService, InMemoryRateLimiter, RATE_LIMITER, RateLimitGuard, RateLimit, RATE_LIMIT_PROFILES } from './rate-limiting';
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
export type { CalculateRequest, CalculationRecordResponse } from './calculator';

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