import { Global, Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { InstrumentationService } from './instrumentation.service';
import { OpsDashboardService } from './ops-dashboard.service';
import { OpsDashboardController } from './ops-dashboard.controller';
import { OpsAccessGuard } from './ops-access.guard';
import { ReadinessService } from './readiness.service';
import { CostAttributionService } from './cost-attribution.service';

/**
 * Observability module — registers KPI metric services, ops dashboard,
 * readiness checks, and cost attribution as application-wide singletons
 * so any module can inject them without re-importing.
 *
 * Marked @Global() so controllers and services throughout the
 * application-api layer can inject these services directly.
 */
@Global()
@Module({
  controllers: [OpsDashboardController],
  providers: [
    KpiService,
    InstrumentationService,
    OpsDashboardService,
    OpsAccessGuard,
    ReadinessService,
    CostAttributionService,
  ],
  exports: [
    KpiService,
    InstrumentationService,
    OpsDashboardService,
    OpsAccessGuard,
    ReadinessService,
    CostAttributionService,
  ],
})
export class ObservabilityModule {}