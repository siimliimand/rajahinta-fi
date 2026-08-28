/**
 * /ops barrel — public exports of the operator console API
 * (task 12.1, change technical-assessment-remediation).
 *
 * @module ops
 */

export { OpsModule } from './ops.module';
export { OpsGovernanceController, OpsGovernanceService } from './governance';
export { InMemorySourceGovernanceRepository } from './governance';
export {
  OpsDatasetConfirmationController,
  OpsDatasetConfirmationService,
  InMemoryRateReviewRepository,
} from './confirmations';
export { OpsCorrectionQueueController, OpsCorrectionQueueService } from './corrections';
export { OpsAuditTrailController, OpsAuditTrailService } from './audit';
export type {
  OperatorActionDto,
  GrantGovernanceDto,
  RevokeGovernanceDto,
  OpsGovernanceMerchant,
  OpsGovernanceListResponse,
  OpsGovernanceMutationResponse,
  OpsPendingFxDataset,
  OpsPendingTaxReview,
  OpsConfirmationListResponse,
  OpsFxDatasetConfirmedResponse,
  OpsTaxReviewResolvedResponse,
  OpsCreateCorrectionDto,
  OpsAuditEntry,
  OpsAuditListResponse,
} from './ops.dto';
