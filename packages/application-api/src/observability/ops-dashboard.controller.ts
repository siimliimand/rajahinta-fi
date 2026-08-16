import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OpsDashboardService, DashboardSnapshot } from './ops-dashboard.service';

@ApiTags('ops')
@Controller('ops')
export class OpsDashboardController {
  constructor(private readonly dashboard: OpsDashboardService) {}

  @Get('health')
  @ApiOperation({ summary: 'Ops health dashboard — stale data, verified calculations, compliance incidents' })
  @ApiResponse({ status: 200, description: 'Dashboard snapshot' })
  getHealth(): DashboardSnapshot {
    return this.dashboard.getDashboardSnapshot();
  }
}