/**
 * OutboundRedirectController — merchant-link redirect endpoint.
 *
 * GET /api/v1/outbound/:offerId looks up a retail offer by its ID,
 * records a click via ClickAnalyticsService, then issues a 302 redirect
 * to the merchant's source URL.
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
import { ClickAnalyticsService } from './click-analytics.service';
import { RateLimitGuard, RateLimit } from '../rate-limiting';

@ApiTags('outbound')
@Controller('api/v1/outbound')
@UseGuards(RateLimitGuard)
export class OutboundRedirectController {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly clickAnalytics: ClickAnalyticsService,
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

    this.clickAnalytics.recordClick(offer.merchant, offer.sourceUrl);

    return { url: offer.sourceUrl, statusCode: HttpStatus.FOUND };
  }
}