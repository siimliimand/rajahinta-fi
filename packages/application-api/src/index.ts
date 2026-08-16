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
} from '@rajahinta/core-domain';
import { ObservabilityModule } from './observability';
import { FeatureFlagsModule } from './feature-flags';
import { JobsModule } from './jobs';

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
  imports: [FeatureFlagsModule, ObservabilityModule, JobsModule],
  controllers: [CalculationController, HealthController],
  exports: [UseCaseOrchestrator, FeatureFlagsModule, ObservabilityModule, JobsModule],
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