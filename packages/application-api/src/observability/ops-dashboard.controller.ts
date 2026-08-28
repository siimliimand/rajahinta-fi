import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OpsDashboardService, DashboardSnapshot } from './ops-dashboard.service';
import { OpsAccessGuard } from './ops-access.guard';

/**
 * Internal operational-health surface. Guarded by OpsAccessGuard
 * (env-configured operator bearer token + IP allowlist; fails closed
 * when unconfigured) — unauthenticated callers receive no findings,
 * coverage, or incident data.
 */
@ApiTags('ops')
@Controller('ops')
@UseGuards(OpsAccessGuard)
export class OpsDashboardController {
  constructor(private readonly dashboard: OpsDashboardService) {}

  @Get('health')
  @ApiOperation({ summary: 'Ops health dashboard — stale data, verified calculations, compliance incidents' })
  @ApiResponse({ status: 200, description: 'Dashboard snapshot' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  getHealth(): DashboardSnapshot {
    return this.dashboard.getDashboardSnapshot();
  }
}
