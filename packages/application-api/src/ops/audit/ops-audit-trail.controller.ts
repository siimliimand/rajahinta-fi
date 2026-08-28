/**
 * OpsAuditTrailController — audit-trail endpoint of the operator console
 * (task 12.1, change technical-assessment-remediation).
 *
 * Surfaces the durable audit store so the trail of console actions
 * (operator, action, target, timestamp) is visible next to the workflows.
 *
 * @module OpsAuditTrailController
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OpsAccessGuard } from '../../observability';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../../feature-flags';
import type { OpsAuditListResponse } from '../ops.dto';
import { OpsAuditTrailService } from './ops-audit-trail.service';

@ApiTags('ops')
@Controller('ops/console/audit')
@UseGuards(OpsAccessGuard, FeatureFlagGuard)
@FeatureFlagDec(FeatureFlag.OPERATOR_CONSOLE)
export class OpsAuditTrailController {
  constructor(private readonly trail: OpsAuditTrailService) {}

  // ---------------------------------------------------------------------------
  // GET /ops/console/audit?limit=25
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Recent audit entries (operator console)',
    description:
      'The most recent durable audit entries, newest first — the trail of ' +
      'console and dataset-governance actions.',
  })
  @ApiResponse({ status: 200, description: 'Recent audit entries' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  async recent(@Query('limit') limit?: string): Promise<OpsAuditListResponse> {
    const parsed = limit === undefined ? undefined : Number.parseInt(limit, 10);
    return this.trail.recentEntries(Number.isNaN(parsed) ? undefined : parsed);
  }
}
