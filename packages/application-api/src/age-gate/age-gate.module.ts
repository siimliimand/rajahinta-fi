import { Module } from '@nestjs/common';
import { AgeGateService } from './age-gate.service';

/**
 * Isolated age-verification module.
 *
 * Phase 1: lightweight confirmation only. When 15.2 adds server-side
 * verification, this module will expand with persistence and a controller.
 */
@Module({
  providers: [AgeGateService],
  exports: [AgeGateService],
})
export class AgeGateModule {}
