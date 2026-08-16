/**
 * AccountController — account management endpoints.
 *
 * Groups account operations under `/api/v1/account`, including
 * the GDPR data-export endpoint.
 *
 * Phase 1: in-memory simulation.  All endpoints require a `userId`
 * header (no auth middleware yet).  When authentication is added,
 * the `userId` param will be derived from the auth context.
 *
 * @module AccountController
 */

import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DataExportService } from './data-export.service';
import type { DataExport } from './data-export.types';

@ApiTags('account')
@Controller('api/v1/account')
export class AccountController {
  constructor(private readonly dataExportService: DataExportService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/account/export — GDPR data portability export
  // ---------------------------------------------------------------------------

  @Get('export')
  @ApiOperation({
    summary: 'Export all user data (GDPR Article 20 — data portability)',
    description:
      'Returns a JSON payload with all personal data the system holds ' +
      'for the requesting user: account details, saved baskets, calculation ' +
      'history, and subscription status.  Supports the right of access ' +
      '(Article 15) and data portability (Article 20) under GDPR.',
  })
  @ApiResponse({
    status: 200,
    description: 'User data export in JSON format',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async exportData(
    @Headers('x-user-id') userId?: string,
  ): Promise<DataExport> {
    if (!userId) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'x-user-id header is required',
        error: 'MissingUserId',
      });
    }

    try {
      return await this.dataExportService.exportUserData(userId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Export generation failed',
      );
    }
  }
}