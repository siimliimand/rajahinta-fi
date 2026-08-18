/**
 * Age-verification module — pluggable verification via DI.
 *
 * ## Pluggable provider design
 *
 * By default this module provides `SimpleConfirmationProvider` bound to
 * the `VERIFICATION_PROVIDER` token. To swap in a stronger provider:
 *
 * ```typescript
 * @Module({
 *   imports: [AgeGateModule],
 *   providers: [
 *     {
 *       provide: VERIFICATION_PROVIDER,
 *       useClass: MyStrongerProvider,
 *     },
 *   ],
 * })
 * export class MyModule {}
 * ```
 *
 * The `AgeGateService` delegates to whatever provider is bound to the
 * token, so no code changes are needed downstream.
 *
 * ## Documentation
 *
 * This module is designed for pluggable verification — the
 * SimpleConfirmationProvider can be replaced with a stronger provider
 * if the legal review requires identity verification.
 *
 * @module AgeGateModule
 */

import { Module } from '@nestjs/common';
import { AgeGateService } from './age-gate.service';
import { AgeGateGuard } from './age-gate.guard';
import { SimpleConfirmationProvider } from './simple-confirmation.provider';
import { VERIFICATION_PROVIDER } from './verification-provider.interface';

@Module({
  providers: [
    AgeGateService,
    AgeGateGuard,
    SimpleConfirmationProvider,
    {
      provide: VERIFICATION_PROVIDER,
      useExisting: SimpleConfirmationProvider,
    },
  ],
  exports: [AgeGateService, AgeGateGuard],
})
export class AgeGateModule {}