/**
 * Pluggable identity/age-verification provider interface.
 *
 * ## Design rationale
 *
 * This module is designed for pluggable verification — the
 * `SimpleConfirmationProvider` (the Phase 1 default) can be replaced
 * with a stronger provider if the legal review requires identity
 * verification or document-based age proof.
 *
 * To swap providers:
 *
 * 1. Implement `IVerificationProvider` in a new class.
 * 2. Register it in the `AgeGateModule` providers using the
 *    `VERIFICATION_PROVIDER` injection token, replacing the
 *    `SimpleConfirmationProvider` binding.
 * 3. No other code changes are needed — `AgeGateService` and all
 *    callers depend only on this interface.
 *
 * @module VerificationProvider
 */

/**
 * Result of an age-verification check.
 */
export interface VerificationResult {
  /** Whether the user is verified as meeting the age requirement. */
  readonly verified: boolean;
  /** Short identifier for the verification method used (e.g. "simple-confirmation", "identity-document"). */
  readonly method: string;
  /** ISO timestamp of when the verification was performed. */
  readonly timestamp: Date;
}

/**
 * DI token for injecting a verification provider.
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class MyProvider implements IVerificationProvider { … }
 *
 * // In the module:
 * {
 *   provide: VERIFICATION_PROVIDER,
 *   useClass: MyProvider,
 * }
 * ```
 */
export const VERIFICATION_PROVIDER = Symbol('VERIFICATION_PROVIDER');

/**
 * Contract for age-verification providers.
 *
 * Implementations must be stateless (or persist state externally) so
 * they can be swapped at DI configuration time.
 */
export interface IVerificationProvider {
  /**
   * Verify that the given user meets the age requirement.
   *
   * @param userId — session or authenticated-user identifier
   * @returns The verification result
   */
  verifyAge(userId: string): Promise<VerificationResult>;

  /**
   * Upgrade an existing verification to a stronger method.
   *
   * Phase 1: no-op (returns current result).
   * Future: triggers document upload, identity verification, etc.
   *
   * @param userId — session or authenticated-user identifier
   * @param method — the stronger method identifier
   * @returns The upgraded verification result
   */
  upgradeVerification(userId: string, method: string): Promise<VerificationResult>;
}