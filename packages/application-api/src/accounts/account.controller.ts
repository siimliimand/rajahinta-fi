/**
 * AccountController — account management endpoints.
 *
 * Groups account operations under `/api/v1/account`, including
 * the GDPR data-export endpoint, saved-basket CRUD, calculation-history
 * lookup, and subscription-status retrieval.
 *
 * Phase 1: in-memory simulation.  All endpoints require a `userId`
 * header (no auth middleware yet).  When authentication is added,
 * the `userId` param will be derived from the auth context.
 *
 * @module AccountController
 */

import { randomUUID } from 'node:crypto';

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Headers,
  Param,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DataExportService } from './data-export.service';
import { AccountService } from './account.service';
import type { DataExport } from './data-export.types';
import type { Basket, BasketItem } from './account.types';

@ApiTags('account')
@Controller('api/v1/account')
export class AccountController {
  constructor(
    private readonly dataExportService: DataExportService,
    private readonly accountService: AccountService,
  ) {}

  // ---------------------------------------------------------------------------
  // Required-header guard
  // ---------------------------------------------------------------------------

  private requireUserId(userId: string | undefined): string {
    if (!userId) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'x-user-id header is required',
        error: 'MissingUserId',
      });
    }
    return userId;
  }

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
    const uid = this.requireUserId(userId);

    try {
      return await this.dataExportService.exportUserData(uid);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Export generation failed',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 7.1 — GET /api/v1/account/baskets — list saved baskets
  // ---------------------------------------------------------------------------

  @Get('baskets')
  @ApiOperation({ summary: 'List saved baskets for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Array of saved baskets' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required' })
  async listBaskets(
    @Headers('x-user-id') userId?: string,
  ): Promise<Basket[]> {
    const uid = this.requireUserId(userId);
    return this.accountService.getSavedBaskets(uid);
  }

  // ---------------------------------------------------------------------------
  // 7.1 — POST /api/v1/account/baskets — save a new basket
  // ---------------------------------------------------------------------------

  @Post('baskets')
  @ApiOperation({ summary: 'Save a new basket for the authenticated user' })
  @ApiResponse({ status: 201, description: 'Basket saved' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required' })
  async saveBasket(
    @Headers('x-user-id') userId?: string,
    @Body() body: { name: string; items: BasketItem[] },
  ): Promise<void> {
    const uid = this.requireUserId(userId);

    const basket: Basket = {
      id: randomUUID(),
      name: body.name,
      createdAt: new Date(),
      items: body.items,
    };

    await this.accountService.saveBasket(uid, basket);
  }

  // ---------------------------------------------------------------------------
  // 7.1 — DELETE /api/v1/account/baskets/:basketId — delete a basket
  // ---------------------------------------------------------------------------

  @Delete('baskets/:basketId')
  @ApiOperation({ summary: 'Delete a saved basket by ID' })
  @ApiResponse({ status: 200, description: 'Basket deleted' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required' })
  @ApiResponse({ status: 404, description: 'Basket not found' })
  async deleteBasket(
    @Headers('x-user-id') userId?: string,
    @Param('basketId', ParseUUIDPipe) basketId?: string,
  ): Promise<void> {
    const uid = this.requireUserId(userId);

    const account = await this.accountService.getAccount(uid);
    const mutable = account as { savedBaskets: Basket[] };
    const index = mutable.savedBaskets.findIndex((b) => b.id === basketId);

    if (index === -1) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Basket "${basketId}" not found`,
        error: 'BasketNotFound',
      });
    }

    mutable.savedBaskets.splice(index, 1);
  }

  // ---------------------------------------------------------------------------
  // 7.2 — GET /api/v1/account/history — calculation history
  // ---------------------------------------------------------------------------

  @Get('history')
  @ApiOperation({ summary: 'Return calculation history IDs for the user' })
  @ApiResponse({ status: 200, description: 'Array of calculation record IDs' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required' })
  async getHistory(
    @Headers('x-user-id') userId?: string,
  ): Promise<number[]> {
    const uid = this.requireUserId(userId);
    const account = await this.accountService.getAccount(uid);
    return account.calculationHistory;
  }

  // ---------------------------------------------------------------------------
  // 7.3 — GET /api/v1/account/subscription — subscription status
  // ---------------------------------------------------------------------------

  @Get('subscription')
  @ApiOperation({ summary: 'Return the subscription status for the user' })
  @ApiResponse({ status: 200, description: 'Subscription status object' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required' })
  async getSubscription(
    @Headers('x-user-id') userId?: string,
  ): Promise<{ userId: string; plan: string; active: boolean }> {
    const uid = this.requireUserId(userId);
    const account = await this.accountService.getAccount(uid);
    return account.subscription;
  }
}