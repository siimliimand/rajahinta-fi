/**
 * OutboundRedirectController — merchant-link redirect endpoint.
 *
 * GET /api/v1/outbound/:offerId looks up a retail offer by its ID,
 * records a click via the durable Redis-backed click counters, then issues
 * a 302 redirect to the merchant's source URL.
 *
 * ## Durable analytics (task 4.3, design D8)
 *
 * - Clicks are counted in Redis so counters survive rollouts and are shared
 *   across replicas. The in-memory ClickAnalyticsService remains bound in
 *   the module for tests only.
 * - `recordClick` is fire-and-forget by contract (it never throws), and the
 *   redirect deliberately does NOT await it — click accounting must never
 *   add Redis latency (or an outage) to the redirect hot path.
 *
 * ## Phase 1 constraints
 *
 * - No purchase or commission tracking (deferred to Phase 2).
 * - Rate-limited via the shared RateLimitGuard (DEFAULT profile).
 * - Returns 404 when the offer ID does not exist or has no source URL.
 *
 * @module OutboundRedirectController
 */

import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  NotFoundException,
  UseGuards,
  Redirect,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductRepository } from '@rajahinta/data-platform';
import { RedisClickAnalyticsService } from '../audit/redis-click-analytics.service';
import { RateLimitGuard, RateLimit } from '../rate-limiting';

@ApiTags('outbound')
@Controller('api/v1/outbound')
@UseGuards(RateLimitGuard)
export class OutboundRedirectController {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly clickAnalytics: RedisClickAnalyticsService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/outbound/:offerId
  // ---------------------------------------------------------------------------

  @Get(':offerId')
  @RateLimit('DEFAULT')
  @Redirect()
  @ApiOperation({
    summary: 'Redirect to merchant product page',
    description:
      'Records a click for the given retail offer and redirects (302) ' +
      'to the merchant\'s source URL.  Returns 404 when the offer ID ' +
      'is unknown or has no source URL.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to merchant product page — click recorded.',
  })
  @ApiResponse({
    status: 404,
    description: 'Offer not found or missing source URL.',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded.',
  })
  async redirect(
    @Param('offerId', ParseIntPipe) offerId: number,
  ): Promise<{ url: string; statusCode: number }> {
    const offer = await this.productRepo.findRetailOfferById(offerId);

    if (offer === null || !offer.sourceUrl) {
      throw new NotFoundException(
        `Offer ${offerId} not found or has no source URL`,
      );
    }

    // Fire-and-forget: never awaited on the redirect hot path. The service
    // swallows its own errors — lost analytics must not break a redirect.
    void this.clickAnalytics.recordClick(offer.merchant, offer.sourceUrl);

    return { url: offer.sourceUrl, statusCode: HttpStatus.FOUND };
  }
}
