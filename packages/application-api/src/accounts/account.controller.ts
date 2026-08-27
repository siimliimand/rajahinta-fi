/**
 * AccountController — account management endpoints.
 *
 * Groups account operations under `/api/v1/account`, including
 * the GDPR data-export endpoint, saved-basket CRUD, calculation-history
 * lookup, and subscription-status retrieval. Phase 2 adds saved-scenario
 * CRUD (named calculator input sets), gated behind the ADVANCED_FEATURES
 * feature flag — the pre-existing endpoints are deliberately NOT gated.
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
  ParseIntPipe,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DataExportService } from './data-export.service';
import { AccountService } from './account.service';
import type { DataExport } from './data-export.types';
import type { Basket, BasketItem, SavedScenario, SaveScenarioRequest } from './account.types';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../feature-flags';

/** Allowed values of `inputs.transportArrangement` (core-domain TransportArrangement). */
const TRANSPORT_ARRANGEMENTS: readonly string[] = [
  'SELLER_ARRANGED',
  'INDEPENDENT_CARRIER',
  'PERSONAL',
];

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
    @Body() body: { name: string; items: BasketItem[] },
    @Headers('x-user-id') userId?: string,
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
  // Phase 2 — GET /api/v1/account/scenarios — list saved scenarios
  // (ADVANCED_FEATURES-gated; the pre-existing endpoints above stay ungated)
  // ---------------------------------------------------------------------------

  @Get('scenarios')
  @UseGuards(FeatureFlagGuard)
  @FeatureFlagDec(FeatureFlag.ADVANCED_FEATURES)
  @ApiOperation({
    summary: 'List saved scenarios for the authenticated user',
    description:
      'Returns the user\'s named calculator input sets (scenarios) with ' +
      'their full inputs so the UI can re-run them against current data. ' +
      'Gated by the ADVANCED_FEATURES feature flag.',
  })
  @ApiResponse({ status: 200, description: 'Array of saved scenarios' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required' })
  @ApiResponse({ status: 403, description: 'ADVANCED_FEATURES flag is disabled' })
  async listScenarios(
    @Headers('x-user-id') userId?: string,
  ): Promise<SavedScenario[]> {
    const uid = this.requireUserId(userId);
    return this.accountService.getScenarios(uid);
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — POST /api/v1/account/scenarios — upsert a scenario by name
  // ---------------------------------------------------------------------------

  @Post('scenarios')
  @UseGuards(FeatureFlagGuard)
  @FeatureFlagDec(FeatureFlag.ADVANCED_FEATURES)
  @ApiOperation({
    summary: 'Create or replace a named scenario (upsert by name)',
    description:
      'Saving under an existing name replaces that scenario\'s inputs ' +
      '(identity is the account + name pair); a new name inserts. Returns ' +
      'the persisted scenario. Gated by the ADVANCED_FEATURES feature flag.',
  })
  @ApiResponse({ status: 201, description: 'Scenario saved (inserted or replaced)' })
  @ApiResponse({ status: 400, description: 'x-user-id header or body validation failed' })
  @ApiResponse({ status: 403, description: 'ADVANCED_FEATURES flag is disabled' })
  async saveScenario(
    @Body() body: SaveScenarioRequest,
    @Headers('x-user-id') userId?: string,
  ): Promise<SavedScenario> {
    const uid = this.requireUserId(userId);

    this.validateScenarioBody(body);
    return this.accountService.saveScenario(uid, body.name, body.inputs);
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — DELETE /api/v1/account/scenarios/:id — delete a scenario
  // ---------------------------------------------------------------------------

  @Delete('scenarios/:id')
  @UseGuards(FeatureFlagGuard)
  @FeatureFlagDec(FeatureFlag.ADVANCED_FEATURES)
  @ApiOperation({
    summary: 'Delete a saved scenario by ID',
    description:
      'Account-scoped: a scenario id that does not belong to the requesting ' +
      'user\'s account is reported as not found, never deleted. Gated by ' +
      'the ADVANCED_FEATURES feature flag.',
  })
  @ApiResponse({ status: 200, description: 'Scenario deleted' })
  @ApiResponse({ status: 400, description: 'x-user-id header is required or id is not an integer' })
  @ApiResponse({ status: 403, description: 'ADVANCED_FEATURES flag is disabled' })
  @ApiResponse({ status: 404, description: 'Scenario not found for this account' })
  async deleteScenario(
    @Param('id', ParseIntPipe) scenarioId: number,
    @Headers('x-user-id') userId?: string,
  ): Promise<void> {
    const uid = this.requireUserId(userId);

    // NotFoundException for a foreign or absent id comes from the service,
    // which owns the account-scoped existence check.
    await this.accountService.deleteScenario(uid, scenarioId);
  }

  // ---------------------------------------------------------------------------
  // Scenario body validation (manual — same style as addHistory)
  // ---------------------------------------------------------------------------

  /**
   * Validate a save-scenario request body.
   *
   * {@code name} must be a non-empty string; {@code inputs} must carry a
   * positive-integer productId and quantity, a non-empty destination string,
   * and — when present — a non-empty transportMethod string and a
   * transportArrangement from the core-domain union.
   */
  private validateScenarioBody(body: SaveScenarioRequest): void {
    const fail = (message: string): never => {
      throw new BadRequestException({
        statusCode: 400,
        message,
        error: 'InvalidScenarioRequest',
      });
    };

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      fail('Request body must be a JSON object with name and inputs');
    }
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      fail('name must be a non-empty string');
    }

    const inputs = body.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
      fail('inputs must be an object');
    }
    if (!Number.isInteger(inputs.productId) || inputs.productId <= 0) {
      fail('inputs.productId must be a positive integer');
    }
    if (!Number.isInteger(inputs.quantity) || inputs.quantity <= 0) {
      fail('inputs.quantity must be a positive integer');
    }
    if (typeof inputs.destination !== 'string' || inputs.destination.trim().length === 0) {
      fail('inputs.destination must be a non-empty string');
    }
    if (
      inputs.transportMethod !== undefined &&
      (typeof inputs.transportMethod !== 'string' || inputs.transportMethod.trim().length === 0)
    ) {
      fail('inputs.transportMethod must be a non-empty string when provided');
    }
    if (
      inputs.transportArrangement !== undefined &&
      !TRANSPORT_ARRANGEMENTS.includes(inputs.transportArrangement)
    ) {
      fail(
        'inputs.transportArrangement must be one of SELLER_ARRANGED, ' +
        'INDEPENDENT_CARRIER, PERSONAL when provided',
      );
    }
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
  // 7.2 — POST /api/v1/account/history — append a calculation record
  // ---------------------------------------------------------------------------

  @Post('history')
  @ApiOperation({ summary: 'Append a calculation record ID to history' })
  @ApiResponse({ status: 201, description: 'Calculation record appended' })
  @ApiResponse({ status: 400, description: 'x-user-id header or valid recordId required' })
  async addHistory(
    @Body() body: { recordId: number },
    @Headers('x-user-id') userId?: string,
  ): Promise<{ success: boolean; recordId: number }> {
    const uid = this.requireUserId(userId);

    if (!Number.isInteger(body.recordId) || body.recordId <= 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'recordId must be a positive integer',
        error: 'InvalidRecordId',
      });
    }

    await this.accountService.addCalculationToHistory(uid, body.recordId);
    return { success: true, recordId: body.recordId };
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