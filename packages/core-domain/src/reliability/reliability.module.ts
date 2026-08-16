/**
 * Reliability Module.
 *
 * Registers the ReliabilityService and exports it for injection into
 * the acquisition pipeline, calculation engine, and ranking/sorting system.
 *
 * Import this module into CoreDomainModule to make ReliabilityService
 * available across the domain layer.
 *
 * @module ReliabilityModule
 */
import { Module } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';

@Module({
  providers: [ReliabilityService],
  exports: [ReliabilityService],
})
export class ReliabilityModule {}