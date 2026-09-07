/**
 * SessionController — session-validation surface of the legacy harness
 * (task 2.2, change technical-assessment-remediation; design D3; trimmed
 * by task 4.1, change email-password-auth).
 *
 * This controller exists only so the legacy pg suites keep exercising
 * session rotate/revoke and the SessionAuthGuard contract: `POST
 * /api/v1/account/session/rotate` atomically replaces the presented token
 * (the old one stops authenticating immediately); `DELETE
 * /api/v1/account/session` revokes it (logout).
 *
 * No session ISSUANCE endpoint lives here: anonymous issuance and the
 * placeholder-email model were removed (design D9) so the removed model
 * cannot resurrect in code. Credentials auth — registration, login,
 * verified-email state — lives only in the API Worker; this harness
 * deliberately does not implement it.
 *
 * @module SessionController
 */

import {
  Controller,
  Post,
  Delete,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SessionTokenService } from './session-token.service';
import { SessionAuthGuard } from './session-auth.guard';
import { CurrentUser, type AuthenticatedAccount } from './current-user.decorator';
import {
  buildSessionCookie,
  buildSessionCookieClear,
  setSessionCookie,
  type CookieResponse,
} from './session-cookie';
import { RateLimitGuard, RateLimit } from '../rate-limiting';

/** Response for rotate — the token itself travels only in the cookie. */
export interface SessionResponse {
  readonly userId: string;
  readonly expiresAt: string;
}

@ApiTags('account')
@Controller('api/v1/account')
export class SessionController {
  constructor(private readonly sessionTokens: SessionTokenService) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/account/session/rotate — atomic token rotation
  // ---------------------------------------------------------------------------

  @Post('session/rotate')
  @UseGuards(SessionAuthGuard, RateLimitGuard)
  @RateLimit('DEFAULT')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Rotate the session token',
    description:
      'Issues a successor token and invalidates the presented one in a ' +
      'single transaction, then sets the new httpOnly cookie. The previous ' +
      'token stops authenticating immediately — a rotated token never ' +
      'mints a successor.',
  })
  @ApiResponse({ status: 200, description: 'Rotated; new cookie set' })
  @ApiResponse({ status: 401, description: 'No/invalid session, or a legacy x-user-id header was presented' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async rotate(
    @CurrentUser() user: AuthenticatedAccount,
    @Req() req: { sessionToken?: string },
    @Res({ passthrough: true }) res?: CookieResponse,
  ): Promise<SessionResponse> {
    const issued = await this.sessionTokens.rotateSessionToken(
      req.sessionToken ?? '',
    );
    if (issued === null) {
      // The guard already validated the token; this covers a concurrent
      // rotation/expiry racing between guard and service.
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Session token is invalid, expired, or revoked.',
        error: 'InvalidSession',
      });
    }
    setSessionCookie(res, buildSessionCookie(issued.token, issued.session.expiresAt));
    return {
      userId: user.userId,
      expiresAt: issued.session.expiresAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/account/session — logout
  // ---------------------------------------------------------------------------

  @Delete('session')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke the session (logout)',
    description:
      'Revokes the presented session token and clears the session cookie. ' +
      'The account and its data are unaffected (GDPR export/erasure have ' +
      'their own endpoints).',
  })
  @ApiResponse({ status: 200, description: 'Session revoked; cookie cleared' })
  @ApiResponse({ status: 401, description: 'No/invalid session, or a legacy x-user-id header was presented' })
  async revoke(
    @Req() req: { sessionToken?: string },
    @Res({ passthrough: true }) res?: CookieResponse,
  ): Promise<{ revoked: true }> {
    await this.sessionTokens.revokeSession(req.sessionToken ?? '');
    setSessionCookie(res, buildSessionCookieClear());
    return { revoked: true };
  }
}
