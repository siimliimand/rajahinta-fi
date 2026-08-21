/**
 * Tax Module — aggregates both sub-engines and the repository port token.
 *
 * Import this module into CoreDomainModule to make AlcoholExciseService
 * and ContainerDutyService available for injection.
 *
 * Hosts that run real calculations should provide the tax-rule repository
 * via `TaxModule.forRoot({ taxRuleRepository })` (threaded through
 * `CoreDomainModule.forRoot` / `ApplicationApiModule.forRoot`) — the static
 * default binds the port to null because core-domain has no persistence
 * layer of its own.
 *
 * @module TaxModule
 */
import { Module, type Provider, type Type } from '@nestjs/common';
import {
  AlcoholExciseService,
  TAX_RULE_REPOSITORY_PORT,
} from './services/alcohol-excise.service';
import type { ITaxRuleRepositoryPort } from './ports/tax-rule-repository.port';
import { ContainerDutyService } from './services/container-duty.service';
import { TaxRuleQueryService } from './services/tax-rule-query.service';

/** Options accepted by {@link TaxModule.forRoot}. */
export interface TaxModuleOptions {
  taxRuleRepository?: Type<ITaxRuleRepositoryPort>;
}

@Module({
  providers: [
    AlcoholExciseService,
    ContainerDutyService,
    TaxRuleQueryService,
    { provide: TAX_RULE_REPOSITORY_PORT, useValue: null },
  ],
  exports: [AlcoholExciseService, ContainerDutyService, TaxRuleQueryService, TAX_RULE_REPOSITORY_PORT],
})
export class TaxModule {}

/** Identity of the CONFIGURED tax module — deliberately undecorated. */
export class TaxConfiguredModule {}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace TaxModule {
  /**
   * Configure the module with a concrete tax-rule repository. A fresh
   * module identity is used so the class's static null-port metadata is
   * not merged into the configured instance (see CalculatorModule.forRoot).
   */
  export function forRoot(options: TaxModuleOptions) {
    const providers: Provider[] = [
      AlcoholExciseService,
      ContainerDutyService,
      TaxRuleQueryService,
      options.taxRuleRepository
        ? { provide: TAX_RULE_REPOSITORY_PORT, useClass: options.taxRuleRepository }
        : { provide: TAX_RULE_REPOSITORY_PORT, useValue: null },
    ];
    return {
      module: TaxConfiguredModule,
      providers,
      exports: [AlcoholExciseService, ContainerDutyService, TaxRuleQueryService, TAX_RULE_REPOSITORY_PORT],
    };
  }
}
