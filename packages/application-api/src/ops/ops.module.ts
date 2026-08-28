/**
 * Ops Module — the operator console API (task 12.1, change
 * technical-assessment-remediation).
 *
 * A separate auth realm at `/ops/console/**`: every controller sits behind
 * OpsAccessGuard (env-configured bearer token + IP allowlist, fail-closed)
 * and the OPERATOR_CONSOLE feature flag (default OFF per the compliance
 * rule — new UI ships flag-off).
 *
 * Wiring notes:
 * - Governance: the console binds its own SOURCE_GOVERNANCE_REPOSITORY_PORT
 *   (application-api in-memory Phase 1 backing, correction-module
 *   precedent) and its own SourceGovernanceService instance on it. The
 *   shared null-bound singleton the scheduler/pipeline resolve stays
 *   fail-closed until the port is rebound in their module scope —
 *   permission is never overstated anywhere.
 * - FX: FxRateDatasetService is provided here; its repository port
 *   resolves from DataPlatformModule's exported Drizzle-backed adapter.
 * - Tax reviews: RATE_REVIEW_REPOSITORY_PORT is bound to the
 *   data-acquisition in-memory repository in this scope — the operator
 *   resolution path (list/approve/reject) for rate-review entries.
 * - Audit and the idempotency cache are the durable/shared services
 *   (AuditModule is global; IdempotencyModule is imported).
 *
 * @module OpsModule
 */

import { Module } from '@nestjs/common';
import {
  SOURCE_GOVERNANCE_REPOSITORY_PORT,
  SourceGovernanceService,
  FxRateDatasetService,
} from '@rajahinta/core-domain';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { RATE_REVIEW_REPOSITORY_PORT } from '@rajahinta/data-acquisition';
import { IdempotencyModule } from '../idempotency';
import { CorrectionModule } from '../correction';
import { InMemorySourceGovernanceRepository } from './governance/in-memory-source-governance.repository';
import { OpsGovernanceController } from './governance/ops-governance.controller';
import { OpsGovernanceService } from './governance/ops-governance.service';
import { InMemoryRateReviewRepository } from './confirmations/in-memory-rate-review.repository';
import { OpsDatasetConfirmationController } from './confirmations/ops-dataset-confirmation.controller';
import { OpsDatasetConfirmationService } from './confirmations/ops-dataset-confirmation.service';
import { OpsCorrectionQueueController } from './corrections/ops-correction-queue.controller';
import { OpsCorrectionQueueService } from './corrections/ops-correction-queue.service';
import { OpsAuditTrailController } from './audit/ops-audit-trail.controller';
import { OpsAuditTrailService } from './audit/ops-audit-trail.service';

@Module({
  imports: [DataPlatformModule, IdempotencyModule, CorrectionModule],
  providers: [
    // Governance — console-scoped repository + service instance on it.
    InMemorySourceGovernanceRepository,
    { provide: SOURCE_GOVERNANCE_REPOSITORY_PORT, useClass: InMemorySourceGovernanceRepository },
    SourceGovernanceService,

    // FX dataset lifecycle — repository port arrives via DataPlatformModule.
    FxRateDatasetService,

    // Tax rate-review entries — in-memory Phase 1 backing owned by the
    // console (data-acquisition keeps its own instance private); the
    // production swap is a Drizzle adapter behind the same port.
    InMemoryRateReviewRepository,
    { provide: RATE_REVIEW_REPOSITORY_PORT, useClass: InMemoryRateReviewRepository },

    // Console services
    OpsGovernanceService,
    OpsDatasetConfirmationService,
    OpsCorrectionQueueService,
    OpsAuditTrailService,
  ],
  controllers: [
    OpsGovernanceController,
    OpsDatasetConfirmationController,
    OpsCorrectionQueueController,
    OpsAuditTrailController,
  ],
})
export class OpsModule {}
