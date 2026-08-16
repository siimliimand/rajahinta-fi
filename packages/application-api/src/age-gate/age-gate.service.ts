import { Injectable, Logger } from '@nestjs/common';

/**
 * Phase 1 age-verification service — acknowledges frontend confirmation.
 *
 * No identity documents, no DOB storage. The frontend handles the simple
 * "Are you 18+" confirmation via localStorage; this service provides the
 * API contract for future stronger verification (15.2).
 *
 * Upgrade path: when 15.2 lands, this service will accept verification
 * tokens or document hashes and persist confirmation server-side. The
 * `verifyAge` signature is designed to accommodate that without breaking
 * callers.
 */
@Injectable()
export class AgeGateService {
  private readonly logger = new Logger(AgeGateService.name);

  /**
   * Acknowledge age confirmation.
   *
   * Phase 1: always returns verified=true for any userId. The actual gate
   * lives in the frontend localStorage flag. This endpoint exists so the
   * application layer has a contract to call, and so 15.2 can swap in
   * real verification without touching callers.
   *
   * @param userId — anonymous session identifier or future authenticated user ID
   * @returns { verified: boolean }
   */
  async verifyAge(userId: string): Promise<{ verified: boolean }> {
    this.logger.debug(`Age verification acknowledged for ${userId}`);
    // Phase 1: trust the frontend confirmation.
    // 15.2: replace with server-side verification logic.
    return { verified: true };
  }
}
