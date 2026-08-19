/**
 * Tax Module — aggregates both sub-engines and the repository port token.
 *
 * Import this module into CoreDomainModule to make AlcoholExciseService
 * and ContainerDutyService available for injection.
 *
 * @module TaxModule
 */
import { Module } from '@nestjs/common';
import { AlcoholExciseService, TAX_RULE_REPOSITORY_PORT } from './services/alcohol-excise.service';
import { ContainerDutyService } from './services/container-duty.service';
import { TaxRuleQueryService } from './services/tax-rule-query.service';

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