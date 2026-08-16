/**
 * Tax Module — aggregates both sub-engines and the repository port token.
 *
 * Import this module into CoreDomainModule to make AlcoholExciseService
 * and ContainerDutyService available for injection.
 *
 * @module TaxModule
 */
import { Module } from '@nestjs/common';
import { AlcoholExciseService } from './services/alcohol-excise.service';
import { ContainerDutyService } from './services/container-duty.service';

@Module({
  providers: [AlcoholExciseService, ContainerDutyService],
  exports: [AlcoholExciseService, ContainerDutyService],
})
export class TaxModule {}