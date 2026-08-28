/**
 * AccountModule — minimal account management.
 *
 * Provides {@link AccountService}, {@link AccountRetentionService},
 * {@link DataExportService}, {@link AccountController}, and the
 * session-authentication surface (task 2.2, design D3):
 * {@link SessionController} (issue/rotate/revoke of server-issued opaque
 * tokens) and {@link SessionAuthGuard} (cookie-derived identity).
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
import {
  VerifiedEmailStore,
  UnboundVerifiedEmailStore,
} from './verified-email.store';

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
    // Email-verification upgrade write path (task 2.4, D5). The default
    // binding fails explicitly until data-platform exposes an account
    // email update; tests override it with a fake.
    { provide: VerifiedEmailStore, useClass: UnboundVerifiedEmailStore },
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
export {
  VerifiedEmailStore,
  UnboundVerifiedEmailStore,
} from './verified-email.store';
export {
  isPlaceholderEmail,
  isAccountVerified,
  isValidEmailFormat,
  PLACEHOLDER_EMAIL_SUFFIX,
} from './email-verification';
