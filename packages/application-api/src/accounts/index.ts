export { AccountModule } from './account.module';
export { AccountService } from './account.service';
export { AccountRetentionService } from './account-retention.service';
export type { PurgeResult, AnonymizeResult } from './account-retention.service';
export { DataExportService } from './data-export.service';
export type { DataExport, CalculationExportRecord } from './data-export.types';
export type { Account, Basket, BasketItem, SubscriptionStatus, SavedScenario, SaveScenarioRequest } from './account.types';
export { SessionTokenService } from './session-token.service';
export type { IssuedSession } from './session-token.service';
// Session-validation surface (task 2.2, design D3; issuance removed by
// task 4.1, change email-password-auth — credentials auth lives only in
// the API Worker).
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
