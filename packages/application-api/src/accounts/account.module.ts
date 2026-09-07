/**
 * AccountModule — minimal account management.
 *
 * Provides {@link AccountService}, {@link AccountRetentionService},
 * {@link DataExportService}, {@link AccountController}, and the
 * session-validation surface kept for the legacy pg suites (task 2.2,
 * design D3; trimmed by task 4.1, change email-password-auth):
 * {@link SessionController} (rotate/revoke of server-issued opaque
 * tokens) and {@link SessionAuthGuard} (cookie-derived identity).
 *
 * Divergence (design D9, change email-password-auth): credentials auth —
 * registration, login, password hash, verified-email state — lives only
 * in the API Worker. This harness deliberately does not implement it; the
 * pg repository rejects the credential writes loudly and no verification
 * semantics remain on the account row.
 *
 * @module AccountModule
 */

import { Module } from '@nestjs/common';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { AccountService } from './account.service';
import { AccountRetentionService } from './account-retention.service';
import { DataExportService } from './data-export.service';
import { AccountController } from './account.controller';
import { SessionTokenService } from './session-token.service';
import { SessionController } from './session.controller';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  imports: [DataPlatformModule],
  controllers: [AccountController, SessionController],
  providers: [
    AccountService,
    AccountRetentionService,
    DataExportService,
    // Server-issued opaque session tokens (tasks 2.1/2.2, change
    // technical-assessment-remediation). SessionRepository and
    // AccountRepository resolve from DataPlatformModule.
    SessionTokenService,
    SessionAuthGuard,
  ],
  exports: [
    AccountService,
    AccountRetentionService,
    DataExportService,
    SessionTokenService,
    SessionAuthGuard,
  ],
})
export class AccountModule {}

export { AccountService } from './account.service';
export { AccountRetentionService } from './account-retention.service';
export type { PurgeResult, AnonymizeResult } from './account-retention.service';
export { DataExportService } from './data-export.service';
export type { DataExport, CalculationExportRecord } from './data-export.types';
export type { Account, Basket, BasketItem, SubscriptionStatus, SavedScenario, SaveScenarioRequest } from './account.types';
export { SessionTokenService } from './session-token.service';
export type { IssuedSession } from './session-token.service';
export { SessionController } from './session.controller';
export type { SessionResponse } from './session.controller';
export { SessionAuthGuard } from './session-auth.guard';
export { CurrentUser, SESSION_TOKEN_REQUEST_KEY } from './current-user.decorator';
export type { AuthenticatedAccount } from './current-user.decorator';
export {
  SESSION_COOKIE_NAME,
  extractSessionToken,
  buildSessionCookie,
  buildSessionCookieClear,
  setSessionCookie,
} from './session-cookie';
