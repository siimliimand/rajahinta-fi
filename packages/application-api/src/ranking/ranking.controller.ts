/**
 * RankingController — ranking methodology and metadata endpoint.
 *
 * Exposes structured ranking methodology data consumed by the frontend
 * ranking page. Delegates to {@link RankingService} for descriptions and
 * composes the structured JSON response matching the `RankingMethodology`
 * frontend interface.
 *
 * @module RankingController
 */

import { Controller, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RankingService } from '@rajahinta/core-domain';
import type { SortOrder } from '@rajahinta/core-domain';
import { AgeGateGuard } from '../age-gate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SortOrderDescription {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

export interface RankingMethodology {
  readonly introduction: string;
  readonly sortOrders: readonly SortOrderDescription[];
  readonly tiebreaker: string;
  readonly deterministic: boolean;
}

// ---------------------------------------------------------------------------
// Sort-order labels
// ---------------------------------------------------------------------------

const SORT_LABEL: Record<string, string> = {
  LOWEST_LANDED_COST: 'Lowest landed cost',
  LOWEST_PER_LITRE: 'Lowest per litre',
  LOWEST_PER_UNIT: 'Lowest per unit',
  ALPHABETICAL: 'Alphabetical (A–Z)',
  ALCOHOL_PERCENTAGE: 'Alcohol percentage (highest first)',
  PRODUCT_CATEGORY: 'Category',
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('ranking')
@Controller('api/v1/ranking')
@UseGuards(AgeGateGuard)
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/ranking/methodology — structured methodology data
  // ---------------------------------------------------------------------------

  @Get('methodology')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Return structured ranking methodology',
    description:
      'Returns the complete ranking methodology as structured JSON, ' +
      'including the neutrality statement, all available sort orders with ' +
      'descriptions, tiebreaker rules, and determinism guarantee.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ranking methodology',
  })
  getMethodology(): RankingMethodology {
    const sortOrders: SortOrderDescription[] = [
      'LOWEST_LANDED_COST',
      'LOWEST_PER_LITRE',
      'LOWEST_PER_UNIT',
      'ALPHABETICAL',
      'ALCOHOL_PERCENTAGE',
      'PRODUCT_CATEGORY',
    ].map((name) => ({
      name,
      label: SORT_LABEL[name] ?? name.replace(/_/g, ' ').toLowerCase(),
      description: this.rankingService.describeSortOrder(name as SortOrder),
    }));

    return {
      introduction:
        "Rajahinta uses only objective, non-commercial factors to sort " +
        "products. No merchant payment, promotional flag, or manual boost " +
        "can affect any product's position.",
      sortOrders,
      tiebreaker:
        'All sort orders use the product name as a tiebreaker when the ' +
        'primary sort values are equal.',
      deterministic: true,
    };
  }
}