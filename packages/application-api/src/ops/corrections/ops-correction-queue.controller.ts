/**
 * OpsCorrectionQueueController — correction-queue endpoints of the
 * operator console (task 12.1, change technical-assessment-remediation).
 *
 * Lists the queue with evidence, allows opening a correction from the
 * console, and resolves items through CorrectionService. Every mutating
 * action writes a durable audit event with operator identity.
 *
 * @module OpsCorrectionQueueController
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OpsAccessGuard } from '../../observability';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../../feature-flags';
import type { CorrectionItem, CorrectionListResponse } from '../../correction';
import type { OpsCreateCorrectionDto, OperatorActionDto } from '../ops.dto';
import { OpsCorrectionQueueService } from './ops-correction-queue.service';

@ApiTags('ops')
@Controller('ops/console/corrections')
@UseGuards(OpsAccessGuard, FeatureFlagGuard)
@FeatureFlagDec(FeatureFlag.OPERATOR_CONSOLE)
export class OpsCorrectionQueueController {
  constructor(private readonly queue: OpsCorrectionQueueService) {}

  // ---------------------------------------------------------------------------
  // GET /ops/console/corrections — the queue
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Correction queue (operator console)',
    description:
      'Open and resolved correction flags with target, reason, and status — ' +
      'the evidence the operator works from.',
  })
  @ApiResponse({ status: 200, description: 'Correction items' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  async list(): Promise<CorrectionListResponse> {
    return this.queue.listQueue();
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/corrections — open a correction from the console
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a correction flag from the console',
    description: 'Creates a tracked review item; audited with operator identity.',
  })
  @ApiResponse({ status: 201, description: 'Correction created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  async open(@Body() dto: OpsCreateCorrectionDto): Promise<CorrectionItem> {
    this.validateCreate(dto);
    return this.queue.openCorrection(dto);
  }

  // ---------------------------------------------------------------------------
  // POST /ops/console/corrections/:id/resolve
  // ---------------------------------------------------------------------------

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a correction flag',
    description:
      'Records the resolution with the operator identity and timestamp in ' +
      'the durable audit store.',
  })
  @ApiResponse({ status: 200, description: 'Correction resolved' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Unauthenticated, outside the allowlist, or flag off' })
  @ApiResponse({ status: 404, description: 'Correction not found' })
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OperatorActionDto,
  ): Promise<CorrectionItem> {
    this.validateOperator(dto);
    return this.queue.resolveCorrection(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Imperative validation (project-wide pattern)
  // ---------------------------------------------------------------------------

  private validateOperator(dto: OperatorActionDto): void {
    if (
      typeof dto.operator !== 'string' ||
      dto.operator.trim() === '' ||
      dto.operator.trim().length > 128
    ) {
      throw new BadRequestException('operator must be a non-empty string (max 128 chars)');
    }
    if (dto.note !== undefined && typeof dto.note !== 'string') {
      throw new BadRequestException('note must be a string when provided');
    }
  }

  private validateCreate(dto: OpsCreateCorrectionDto): void {
    this.validateOperator(dto);
    if (dto.targetType !== 'calculation' && dto.targetType !== 'data_point') {
      throw new BadRequestException('targetType must be "calculation" or "data_point"');
    }
    if (!Number.isInteger(dto.targetId) || dto.targetId <= 0) {
      throw new BadRequestException('targetId must be a positive integer');
    }
    if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
      throw new BadRequestException('reason must be a non-empty string');
    }
  }
}
