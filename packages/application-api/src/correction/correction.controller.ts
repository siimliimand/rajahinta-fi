/**
 * CorrectionController — endpoints for flagging calculations or data points
 * and tracking their review workflow.
 *
 * Phase 1 uses in-memory storage (a simple Map). Repository wiring comes
 * in a follow-up task.
 *
 * @module CorrectionController
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  NotFoundException,
  InternalServerErrorException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type {
  CreateCorrectionDto,
  CorrectionItem,
  CorrectionListResponse,
} from './correction.dto';

/** In-memory store for correction flags (replaced by repository in task 2.2). */
const store = new Map<number, CorrectionItem>();
let nextId = 1;

@ApiTags('corrections')
@Controller('api/v1/corrections')
export class CorrectionController {
  // ---------------------------------------------------------------------------
  // POST /api/v1/corrections — flag a calculation or data point
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Flag a calculation or data point for review',
    description:
      'Creates a tracked review item with an input snapshot. The flag ' +
      'starts in "open" status until a staff member resolves it.',
  })
  @ApiResponse({ status: 201, description: 'Correction flag created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async create(@Body() dto: CreateCorrectionDto): Promise<CorrectionItem> {
    try {
      const id = nextId++;
      const now = new Date().toISOString();
      const item: CorrectionItem = {
        id,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        status: 'open',
        createdAt: now,
        resolvedAt: null,
        resolution: null,
      };
      store.set(id, item);
      return item;
    } catch (err) {
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to create correction flag',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/corrections — list all correction flags
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'List correction flags',
    description:
      'Returns open and resolved flags with target type and status. ' +
      'Pagination is added in Phase 2.',
  })
  @ApiResponse({ status: 200, description: 'List of correction flags' })
  async list(): Promise<CorrectionListResponse> {
    try {
      const items = Array.from(store.values());
      return { items, total: items.length };
    } catch (err) {
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to list correction flags',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/corrections/:id/resolve — resolve a correction flag
  // ---------------------------------------------------------------------------

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a correction flag',
    description:
      'Records resolution linking back to affected historical calculation ' +
      'records. Once resolved the flag is considered closed.',
  })
  @ApiResponse({ status: 200, description: 'Correction flag resolved' })
  @ApiResponse({ status: 404, description: 'Correction flag not found' })
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution') resolution: string,
  ): Promise<CorrectionItem> {
    try {
      const item = store.get(id);
      if (item === undefined) {
        throw new NotFoundException(`Correction flag ${id} not found`);
      }

      const now = new Date().toISOString();
      const updated: CorrectionItem = {
        ...item,
        status: 'resolved',
        resolvedAt: now,
        resolution: resolution ?? null,
      };
      store.set(id, updated);
      return updated;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to resolve correction flag',
      );
    }
  }
}