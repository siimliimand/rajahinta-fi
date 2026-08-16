import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Injectable,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  TaxCalculationEngine,
  LandedCostResult,
  CalculatorModule,
  RankingModule,
  DeclarationModule,
} from '@rajahinta/core-domain';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { ObservabilityModule } from './observability';
import { FeatureFlagsModule } from './feature-flags';
import { JobsModule } from './jobs';
import { IdempotencyModule } from './idempotency';
import { RateLimitingModule } from './rate-limiting';
import { BillingModule } from './billing';
import { AuditModule } from './audit';
import { AgeGateModule } from './age-gate';
import { AccountModule } from './accounts';
import { CalculatorController } from './calculator';
import { SearchController } from './search';
import { DeclarationController } from './declaration';

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
    CalculatorModule,
    RankingModule,
    DeclarationModule,
    DataPlatformModule,
  ],
  controllers: [
    CalculationController,
    HealthController,
    CalculatorController,
    SearchController,
    DeclarationController,
  ],
  exports: [UseCaseOrchestrator, FeatureFlagsModule, ObservabilityModule, JobsModule, IdempotencyModule, RateLimitingModule, AuditModule],
})
export class ApplicationApiModule {}

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

export { IdempotencyModule, IdempotencyService, InMemoryIdempotencyCache, IDEMPOTENCY_CACHE, hashInput } from './idempotency';
export type { CacheKeyInput, IdempotencyOptions, IIdempotencyCache } from './idempotency';

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

export { AccountModule, AccountService } from './accounts';
export type { Account, Basket, BasketItem } from './accounts';