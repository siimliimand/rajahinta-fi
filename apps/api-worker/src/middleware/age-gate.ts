/**
 * AgeGateMiddleware — Hono port of AgeGateGuard + AgeGateService +
 * SimpleConfirmationProvider (packages/application-api/src/age-gate/*,
 * Worker port task 3.2).
 *
 * Phase 1 uses simple confirmation (no identity documents, no DOB). The
 * frontend sets the `age_confirmed` cookie or sends the `x-age-confirmed`
 * header after the user clicks through the age prompt. The middleware
 * checks that a token exists and delegates to the provider; the default
 * {@link simpleConfirmationProvider} accepts any non-empty token. Swap the
 * provider for stronger verification (factory parameter, DI-parity with
 * the Nest VERIFICATION_PROVIDER token).
 *
 * Token extraction reads the header first, then the cookie jar / raw
 * `Cookie` header (Hono's getCookie unifies the jar and raw-header parses
 * of the Nest guard). The provider receives the token as the verification
 * subject, exactly like the guard's `verifyAge(token)` call.
 *
 * @module age-gate
 */

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { ApiHttpError } from '../errors';
import type { AppEnv } from '../env';
/** Outcome of an age verification (VerificationResult parity). */
export interface VerificationResult {
  readonly verified: boolean;
  readonly method: string;
  readonly timestamp: Date;
}

/**
 * Verification-provider port — swap in at composition time for stronger
 * verification than Phase 1's simple confirmation.
 */
export interface IVerificationProvider {
  verifyAge(userId: string): Promise<VerificationResult>;
  upgradeVerification(userId: string, method: string): Promise<VerificationResult>;
}

/** Phase 1 provider: no identity documents, no DOB storage. */
export const simpleConfirmationProvider: IVerificationProvider = {
  async verifyAge(_userId: string): Promise<VerificationResult> {
    return {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  },
  async upgradeVerification(_userId: string, _method: string): Promise<VerificationResult> {
    return {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  },
};

/**
 * Extract a confirmation token from the request — header first, then
 * cookie (getCookie parses the raw `Cookie` header with the same
 * split/trim rules as the Nest guard's last-resort parser).
 */
export function extractConfirmationToken(c: Context<AppEnv>): string | undefined {
  // Primary: x-age-confirmed header
  const headerToken = c.req.header('x-age-confirmed');
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }

  // Fallback: cookie jar / raw Cookie header (age_confirmed)
  const cookieToken = getCookie(c, 'age_confirmed');
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  return undefined;
}

/**
 * Age-gate middleware. Missing/invalid confirmation is a 403 with the
 * guard's exact messages plus a machine-readable `code` for clients
 * driving the recovery flow (AGE_GATE_REQUIRED / AGE_VERIFICATION_FAILED).
 * The rejection payload carries no DOB or identity-document fields
 * (privacy rule — Phase 1 collects nothing).
 */
export function ageGate(
  provider: IVerificationProvider = simpleConfirmationProvider,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = extractConfirmationToken(c);

    if (!token) {
      // Object payload: the message/error mirror the string form byte for
      // byte, plus the machine-readable code the client recovery flow reads.
      throw new ApiHttpError(403, {
        message:
          'Age confirmation required. Please confirm your age via the age-gate prompt.',
        error: 'Forbidden',
        code: 'AGE_GATE_REQUIRED',
      });
    }

    // Use the token as the userId for verification. With
    // SimpleConfirmationProvider any non-empty token passes.
    const result = await provider.verifyAge(token);

    if (!result.verified) {
      throw new ApiHttpError(403, {
        message: 'Age verification failed. Please try confirming your age again.',
        error: 'Forbidden',
        code: 'AGE_VERIFICATION_FAILED',
      });
    }

    await next();
  };
}
