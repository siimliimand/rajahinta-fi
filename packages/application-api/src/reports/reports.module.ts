/**
 * Reports Module — registration and dependency wiring for the report export
 * API (task 3.3, change phase2-advanced-features).
 *
 * {@link ReportExportService} reads calculation records through the SAME
 * {@link CALCULATION_RECORD_QUERY_PORT} token the declaration feature uses —
 * one record read path, no second adapter.  The token carries the same
 * null default as the core-domain DeclarationModule (the concrete adapter
 * has not been bound anywhere yet — it is a pre-existing, shared wiring
 * step); the service fails fast with a descriptive error when the port is
 * unwired.
 *
 * Guards (RateLimitGuard, FeatureFlagGuard, AgeGateGuard, EntitlementGuard)
 * resolve from modules already imported by the composition root
 * (RateLimitingModule, FeatureFlagsModule, AgeGateModule, EntitlementModule
 * via CoreDomainModule) — no additional imports needed for them.
 *
 * @module ReportsModule
 */

import { Module, type Provider, type Type } from '@nestjs/common';
import {
  CALCULATION_RECORD_QUERY_PORT,
  type ICalculationRecordQueryPort,
} from '@rajahinta/core-domain';
import { ReportExportService } from './report-export.service';
import { ReportsController } from './reports.controller';

/**
 * Ports for {@link ReportsModule.forRoot}.  Omitted ports keep the null
 * default (tests inject via overrideProvider; the host binds the concrete
 * adapter when one is added).
 */
export interface ReportsModulePorts {
  /** Concrete calculation-record query adapter (single record read path). */
  recordQueryPort?: Type<ICalculationRecordQueryPort>;
}

@Module({
  controllers: [ReportsController],
  providers: [
    ReportExportService,
    { provide: CALCULATION_RECORD_QUERY_PORT, useValue: null },
  ],
  exports: [ReportExportService, CALCULATION_RECORD_QUERY_PORT],
})
export class ReportsModule {
  /**
   * Configure the module with a concrete record-query adapter, bound inside
   * the module's own scope so ReportExportService resolves it (a provider
   * registered only at the host's composition root is shadowed by the
   * module-local null default — same rationale as CalculatorModule.forRoot
   * / OptimizerModule.forRoot).  Fresh class identity per call so a
   * configured instance never collapses with the port-less static module.
   */
  static forRoot(ports: ReportsModulePorts = {}) {
    const providers: Provider[] = [
      ReportExportService,
      ports.recordQueryPort
        ? { provide: CALCULATION_RECORD_QUERY_PORT, useClass: ports.recordQueryPort }
        : { provide: CALCULATION_RECORD_QUERY_PORT, useValue: null },
    ];

    const configured = class ConfiguredReportsModule {};

    return {
      module: configured,
      controllers: [ReportsController],
      providers,
      exports: [ReportExportService, CALCULATION_RECORD_QUERY_PORT],
    };
  }
}
