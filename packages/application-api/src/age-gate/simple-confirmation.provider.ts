/**
 * SimpleConfirmationProvider — Phase 1 age-verification provider.
 *
 * No identity documents, no DOB storage. The actual gate lives in the
 * frontend localStorage flag. This provider exists so the DI wiring
 * and application-layer contract are in place, ready to be replaced
 * by a stronger provider if the legal opinion requires it.
 *
 * @module SimpleConfirmationProvider
 */

import { Injectable, Logger } from '@nestjs/common';
import type { IVerificationProvider, VerificationResult } from './verification-provider.interface';

@Injectable()
export class SimpleConfirmationProvider implements IVerificationProvider {
  private readonly logger = new Logger(SimpleConfirmationProvider.name);

  async verifyAge(userId: string): Promise<VerificationResult> {
    this.logger.debug(`Age verification acknowledged for userId="${userId}"`);
    return {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  }

  async upgradeVerification(userId: string, _method: string): Promise<VerificationResult> {
    this.logger.debug(`Upgrade requested for userId="${userId}" — no-op in Phase 1`);
    return {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  }
}