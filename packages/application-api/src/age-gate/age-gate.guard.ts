/**
 * AgeGateGuard — NestJS guard that enforces age confirmation on routes.
 *
 * Reads a confirmation token from:
 * 1. Header `x-age-confirmed` (primary)
 * 2. Cookie `age_confirmed` (fallback)
 *
 * Delegates to {@link AgeGateService} for verification. If the token is
 * missing or invalid, throws `ForbiddenException`.
 *
 * ## Usage
 * ```typescript
 * @UseGuards(AgeGateGuard)
 * @Get('restricted')
 * async restrictedEndpoint() { … }
 * ```
 *
 * ## Design rationale
 *
 * Phase 1 uses simple confirmation (no identity documents, no DOB).
 * The frontend sets `age_confirmed` cookie or sends `x-age-confirmed`
 * header after the user clicks through the age prompt. The guard checks
 * that a token exists and delegates to the injected provider; the
 * default `SimpleConfirmationProvider` accepts any non-empty token.
 *
 * @module AgeGateGuard
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AgeGateService } from './age-gate.service';

/**
 * Extract a confirmation token from the request — header first, then cookie.
 */
function extractConfirmationToken(request: {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  // Primary: x-age-confirmed header
  const headerToken = request.headers?.['x-age-confirmed'];
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }

  // Fallback: cookies object (when cookie-parser is wired)
  const cookieToken = request.cookies?.age_confirmed;
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  // Last resort: parse raw Cookie header
  const rawCookie = request.headers?.cookie;
  if (typeof rawCookie === 'string' && rawCookie.length > 0) {
    const match = rawCookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('age_confirmed='));
    if (match) {
      const value = match.slice('age_confirmed='.length);
      if (value.length > 0) {
        return value;
      }
    }
  }

  return undefined;
}

@Injectable()
export class AgeGateGuard implements CanActivate {
  constructor(private readonly ageGateService: AgeGateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractConfirmationToken(request);

    // The object body mirrors the Hono Worker port's rejection payload
    // (message byte-identical, plus a stable `code`) so both surfaces stay
    // byte-compatible for clients.
    if (!token) {
      throw new ForbiddenException({
        statusCode: 403,
        message:
          'Age confirmation required. Please confirm your age via the age-gate prompt.',
        error: 'Forbidden',
        code: 'AGE_GATE_REQUIRED',
      });
    }

    // Use the token as the userId for verification. With
    // SimpleConfirmationProvider any non-empty token passes.
    const result = await this.ageGateService.verifyAge(token);

    if (!result.verified) {
      throw new ForbiddenException({
        statusCode: 403,
        message:
          'Age verification failed. Please try confirming your age again.',
        error: 'Forbidden',
        code: 'AGE_VERIFICATION_FAILED',
      });
    }

    return true;
  }
}