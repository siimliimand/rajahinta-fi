/**
 * AnalyticsController — lightweight click-analytics endpoints.
 *
 * Recording goes through the durable Redis-backed click counters (task 4.3,
 * design D8) so counts survive restarts and are shared across replicas; the
 * in-memory ClickAnalyticsService stays bound in the module for tests only.
 * No purchase or commission tracking in Phase 1: the single endpoint
 * `POST /api/v1/analytics/click` records a merchant-link click and rejects
 * any payload that suggests affiliate, commission, or purchase intent.
 *
 * @module AnalyticsController
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RedisClickAnalyticsService } from '../audit/redis-click-analytics.service';

/** Fields that are disallowed in Phase 1 click payloads. */
const FORBIDDEN_FIELDS = new Set([
  'commission',
  'affiliate',
  'purchase',
  'transactionId',
  'orderId',
]);

@ApiTags('analytics')
@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(
    private readonly clickAnalyticsService: RedisClickAnalyticsService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/analytics/click
  // ---------------------------------------------------------------------------

  @Post('click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a merchant-link click',
    description:
      'Increments the durable Redis-backed click count for a merchant–URL ' +
      'pair.  Rejects any payload that contains commission, affiliate, ' +
      'purchase, transactionId, or orderId fields (Phase 1 policy).',
  })
  @ApiResponse({
    status: 200,
    description: 'Click recorded.  Returns the updated count.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid payload — either missing required fields or contains ' +
      'disallowed fields (commission, affiliate, purchase, etc.).',
  })
  async recordClick(
    @Body()
    body: Record<string, unknown>,
  ): Promise<{ success: true; count: number }> {
    // Reject forbidden fields before any other validation
    for (const key of Object.keys(body)) {
      if (FORBIDDEN_FIELDS.has(key)) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Field "${key}" is not allowed in click analytics payload`,
          error: 'ForbiddenField',
        });
      }
    }

    // Validate required fields
    if (typeof body.merchantId !== 'string' || body.merchantId.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: '"merchantId" is required and must be a non-empty string',
        error: 'ValidationError',
      });
    }

    if (typeof body.url !== 'string' || body.url.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: '"url" is required and must be a non-empty string',
        error: 'ValidationError',
      });
    }

    // recordClick never throws (fire-and-forget contract), so this endpoint
    // can safely await persistence before reporting the updated count.
    await this.clickAnalyticsService.recordClick(body.merchantId, body.url);
    const counts = await this.clickAnalyticsService.getClickCounts();
    const merchantClicks = counts[body.merchantId];
    const count = merchantClicks?.[body.url] ?? 0;

    return { success: true, count };
  }
}
