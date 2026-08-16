/**
 * Phase 1 age-verification service — acknowledges frontend confirmation.
 *
 * Delegates to the injected {@link IVerificationProvider}. By default
 * the module provides {@link SimpleConfirmationProvider} (no identity
 * docs, no DOB storage). Swap the provider at DI configuration time
 * for stronger verification.
 *
 * @module AgeGateService
 */

import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import {
  IVerificationProvider,
  VerificationResult,
  VERIFICATION_PROVIDER,
} from './verification-provider.interface';

@Injectable()
export class AgeGateService {
  private readonly logger = new Logger(AgeGateService.name);

  constructor(
    @Optional() @Inject(VERIFICATION_PROVIDER)
    private readonly provider?: IVerificationProvider,
  ) {
    if (!this.provider) {
      this.logger.warn(
        'No VerificationProvider injected — falling back to inline simple confirmation. ' +
        'Register a provider via the VERIFICATION_PROVIDER token for production use.',
      );
    }
  }

  /**
   * Verify the user meets the age requirement.
   *
   * Delegates to the configured provider, or falls back to a simple
   * inline confirmation when no provider is injected (e.g. in tests).
   *
   * @param userId — session or authenticated-user identifier
   */
  async verifyAge(userId: string): Promise<VerificationResult> {
    if (this.provider) {
      return this.provider.verifyAge(userId);
    }

    // Fallback: simple inline confirmation (used when no provider injected)
    this.logger.debug(`Inline age verification for userId="${userId}"`);
    return {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  }

  /**
   * Upgrade an existing verification to a stronger method.
   *
   * @param userId — session or authenticated-user identifier
   * @param method — the stronger method identifier
   */
  async upgradeVerification(userId: string, method: string): Promise<VerificationResult> {
    if (this.provider) {
      return this.provider.upgradeVerification(userId, method);
    }

    this.logger.debug(`Inline upgrade for userId="${userId}" — no-op in Phase 1`);
    return {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  }
}