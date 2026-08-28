export { AccountModule } from './account.module';
export { AccountService } from './account.service';
export { AccountRetentionService } from './account-retention.service';
export type { PurgeResult, AnonymizeResult } from './account-retention.service';
export { DataExportService } from './data-export.service';
export type { DataExport, CalculationExportRecord } from './data-export.types';
export type { Account, Basket, BasketItem, SubscriptionStatus, SavedScenario, SaveScenarioRequest } from './account.types';
export { SessionTokenService } from './session-token.service';
export type { IssuedSession } from './session-token.service';
// Session authentication surface (task 2.2, design D3)
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
// Email-verification groundwork (task 2.4, D5)
export { VerifiedEmailStore, UnboundVerifiedEmailStore } from './verified-email.store';
export {
  isPlaceholderEmail,
  isAccountVerified,
  isValidEmailFormat,
  PLACEHOLDER_EMAIL_SUFFIX,
} from './email-verification';
