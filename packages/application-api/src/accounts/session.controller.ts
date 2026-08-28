/**
 * SessionController — server-issued anonymous session lifecycle (task 2.2,
 * change technical-assessment-remediation; design D3).
 *
 * `POST /api/v1/account/session` issues an anonymous session: the identity
 * is GENERATED here (random UUID), never chosen by the client — the same
 * create-on-demand anonymous flow the retired `x-user-id` model used, minus
 * the client-supplied identifier. The opaque token is set as an httpOnly
 * `rajahinta_session` cookie and never appears in a response body.
 *
 * `POST /api/v1/account/session/rotate` atomically replaces the presented
 * token (the old one stops authenticating immediately); `DELETE
 * /api/v1/account/session` revokes it (logout). Existing client-UUID
 * anonymous accounts are NOT migrated — anonymous data is disposable by
 * design (see email-verification.ts for the verified-account upgrade path).
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
import { randomUUID } from 'node:crypto';
import { SessionTokenService } from './session-token.service';
import { AccountService } from './account.service';
import { SessionAuthGuard } from './session-auth.guard';
import { CurrentUser, type AuthenticatedAccount } from './current-user.decorator';
import {
  buildSessionCookie,
  buildSessionCookieClear,
  setSessionCookie,
  type CookieResponse,
} from './session-cookie';
import { RateLimitGuard, RateLimit } from '../rate-limiting';

/** Response for issue/rotate — the token itself travels only in the cookie. */
export interface SessionResponse {
  readonly userId: string;
  readonly expiresAt: string;
  readonly verified: boolean;
}

@ApiTags('account')
@Controller('api/v1/account')
export class SessionController {
  constructor(
    private readonly sessionTokens: SessionTokenService,
    private readonly accountService: AccountService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/account/session — anonymous session issuance
  // ---------------------------------------------------------------------------

  @Post('session')
  @UseGuards(RateLimitGuard)
  @RateLimit('DEFAULT')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue an anonymous session',
    description:
      'Creates a fresh anonymous account with a server-generated identity ' +
      'and returns its session as an httpOnly `rajahinta_session` cookie. ' +
      'The token never appears in a response body. Anonymous account data ' +
      'is DISPOSABLE until the account completes email verification — it is ' +
      'not protected by identity guarantees and may be pruned by retention.',
  })
  @ApiResponse({ status: 201, description: 'Session issued; cookie set' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async issue(
    @Res({ passthrough: true }) res?: CookieResponse,
  ): Promise<SessionResponse> {
    const userId = randomUUID();
    const row = await this.accountService.ensureAccountForSession(userId);
    const issued = await this.sessionTokens.issueSession(row.id);
    setSessionCookie(res, buildSessionCookie(issued.token, issued.session.expiresAt));
    return {
      userId,
      expiresAt: issued.session.expiresAt.toISOString(),
      verified: false,
    };
  }

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
      verified: user.verified,
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
