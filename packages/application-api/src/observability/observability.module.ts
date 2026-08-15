import { Global, Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { InstrumentationService } from './instrumentation.service';

/**
 * Observability module — registers KPI metric services as application-wide
 * singletons so any module can inject them without re-importing.
 *
 * Marked @Global() so controllers and services throughout the application-api
 * layer can inject KpiService or InstrumentationService directly.
 */
@Global()
@Module({
  providers: [KpiService, InstrumentationService],
  exports: [KpiService, InstrumentationService],
})
export class ObservabilityModule {}