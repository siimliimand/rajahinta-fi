/**
 * AccountController — account management endpoints.
 *
 * Groups account operations under `/api/v1/account`, including
 * the GDPR data-export endpoint, saved-basket CRUD, calculation-history
 * lookup, and subscription-status retrieval. Phase 2 adds saved-scenario
 * CRUD (named calculator input sets), gated behind the ADVANCED_FEATURES
 * feature flag — the pre-existing endpoints are deliberately NOT gated.
 *
 * Session authentication (task 2.2, design D3): every route is guarded by
 * `SessionAuthGuard`, which derives the account from the opaque token in
 * the httpOnly `rajahinta_session` cookie and rejects the retired
 * `x-user-id` header outright. Handlers receive the server-derived
 * identity via `@CurrentUser()` — identity is never client-supplied.
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
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DataExportService } from './data-export.service';
import { AccountService } from './account.service';
import type { DataExport } from './data-export.types';
import type { Basket, BasketItem, SavedScenario, SaveScenarioRequest } from './account.types';
import { SessionAuthGuard } from './session-auth.guard';
import { CurrentUser, type AuthenticatedAccount } from './current-user.decorator';
import { isValidEmailFormat } from './email-verification';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../feature-flags';

/** Allowed values of `inputs.transportArrangement` (core-domain TransportArrangement). */
const TRANSPORT_ARRANGEMENTS: readonly string[] = [
  'SELLER_ARRANGED',
  'INDEPENDENT_CARRIER',
  'PERSONAL',
];

@ApiTags('account')
@ApiBearerAuth()
@Controller('api/v1/account')
@UseGuards(SessionAuthGuard)
export class AccountController {
  constructor(
    private readonly dataExportService: DataExportService,
    private readonly accountService: AccountService,
  ) {}

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
  @ApiResponse({
    status: 401,
    description: 'No/invalid session cookie, or a legacy x-user-id header was presented',
  })
  async exportData(
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<DataExport> {
    const uid = user.userId;

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
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  async listBaskets(
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<Basket[]> {
    return this.accountService.getSavedBaskets(user.userId);
  }

  // ---------------------------------------------------------------------------
  // 7.1 — POST /api/v1/account/baskets — save a new basket
  // ---------------------------------------------------------------------------

  @Post('baskets')
  @ApiOperation({ summary: 'Save a new basket for the authenticated user' })
  @ApiResponse({ status: 201, description: 'Basket saved' })
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  async saveBasket(
    @Body() body: { name: string; items: BasketItem[] },
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<void> {
    const uid = user.userId;

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
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  @ApiResponse({ status: 404, description: 'Basket not found' })
  async deleteBasket(
    @CurrentUser() user: AuthenticatedAccount,
    @Param('basketId', ParseUUIDPipe) basketId?: string,
  ): Promise<void> {
    const uid = user.userId;

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
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  @ApiResponse({ status: 403, description: 'ADVANCED_FEATURES flag is disabled' })
  async listScenarios(
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<SavedScenario[]> {
    return this.accountService.getScenarios(user.userId);
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
  @ApiResponse({ status: 400, description: 'Body validation failed' })
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  @ApiResponse({ status: 403, description: 'ADVANCED_FEATURES flag is disabled' })
  async saveScenario(
    @Body() body: SaveScenarioRequest,
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<SavedScenario> {
    const uid = user.userId;

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
  @ApiResponse({ status: 400, description: 'id is not an integer' })
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  @ApiResponse({ status: 403, description: 'ADVANCED_FEATURES flag is disabled' })
  @ApiResponse({ status: 404, description: 'Scenario not found for this account' })
  async deleteScenario(
    @Param('id', ParseIntPipe) scenarioId: number,
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<void> {
    const uid = user.userId;

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
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  async getHistory(
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<number[]> {
    // DB path reads the calculation records claimed by the account
    // (session_id = userId) — the in-memory account object's list is
    // always empty there.
    return this.accountService.getCalculationHistory(user.userId);
  }

  // ---------------------------------------------------------------------------
  // 7.2 — POST /api/v1/account/history — append a calculation record
  // ---------------------------------------------------------------------------

  @Post('history')
  @ApiOperation({ summary: 'Append a calculation record ID to history' })
  @ApiResponse({ status: 201, description: 'Calculation record appended' })
  @ApiResponse({ status: 400, description: 'Valid recordId required' })
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  async addHistory(
    @Body() body: { recordId: number },
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<{ success: boolean; recordId: number }> {
    const uid = user.userId;

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
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  async getSubscription(
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<{ userId: string; plan: string; active: boolean }> {
    const account = await this.accountService.getAccount(user.userId);
    return account.subscription;
  }

  // ---------------------------------------------------------------------------
  // 2.4 — POST /api/v1/account/verify-email — anonymous → verified upgrade
  // ---------------------------------------------------------------------------

  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify an email on the authenticated account (groundwork)',
    description:
      'Upgrades an anonymous account to a verified one by persisting the ' +
      'verified email on the account row (the existing verified-email ' +
      'column). The current session keeps authenticating the account ' +
      'unchanged. Until verification, account data is DISPOSABLE and not ' +
      'protected by identity guarantees. Groundwork only: real email ' +
      'delivery/provider round-trip is out of scope for this change.',
  })
  @ApiResponse({ status: 200, description: 'Account upgraded; the same session continues to authenticate it' })
  @ApiResponse({ status: 400, description: 'email missing or malformed' })
  @ApiResponse({ status: 401, description: 'No/invalid session cookie, or a legacy x-user-id header was presented' })
  async verifyEmail(
    @Body() body: { email: string },
    @CurrentUser() user: AuthenticatedAccount,
  ): Promise<{ verified: true; email: string }> {
    if (typeof body?.email !== 'string' || !isValidEmailFormat(body.email)) {
      throw new BadRequestException({
        statusCode: 400,
        message: '"email" is required and must be a valid email address',
        error: 'InvalidEmail',
      });
    }

    await this.accountService.verifyEmail(user.userId, body.email);
    return { verified: true, email: body.email };
  }
}