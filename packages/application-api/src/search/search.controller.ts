/**
 * SearchController — product search and discovery endpoints.
 *
 * Groups all product discovery operations under `/api/v1/products`.
 * Full-text search is a Phase 2 enhancement; Phase 1 uses basic filtering
 * by product properties.
 *
 * @module SearchController
 */

import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  NotFoundException,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import type { SortOrder } from '@rajahinta/core-domain';
import { ProductRepository } from '@rajahinta/data-platform';
import type {
  ProductSearchResult,
  ProductSearchItem,
  ProductDetailResponse,
  OfferItem,
} from './search.dto';
import { LaunchGateGuard, LaunchGate, LaunchGateType } from '../feature-flags';

/** Default page size for product listing. */
const DEFAULT_PAGE_SIZE = 20;
/** Maximum page size to prevent abuse. */
const MAX_PAGE_SIZE = 100;
/** Default sort order when none is provided. */
const DEFAULT_SORT: SortOrder = 'ALPHABETICAL';

/**
 * Compare two product items by name for alphabetical sorting.
 */
function compareByName(a: ProductSearchItem, b: ProductSearchItem): number {
  return a.name.localeCompare(b.name, 'fi');
}

@UseGuards(LaunchGateGuard)
@LaunchGate(LaunchGateType.PRICE_DATA)
@ApiTags('products')
@Controller('api/v1/products')
export class SearchController {
  constructor(
    private readonly productRepo: ProductRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/products — search and list products
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Search products with ranking and pagination',
    description:
      'List or search products. Supports optional category filtering and ' +
      'objective sort orders (lowest landed cost, per litre, alphabetical, etc.). ' +
      'Full-text search is pending a dedicated search index in Phase 2.',
  })
  @ApiQuery({ name: 'ids', required: false, description: 'Comma-separated product IDs to fetch' })
  @ApiQuery({ name: 'q', required: false, description: 'Free-text search term (Phase 2 — placeholder)' })
  @ApiQuery({ name: 'category', required: false, description: 'Filter by product category (Phase 2)' })
  @ApiQuery({ name: 'sort', required: false, description: 'Sort order', enum: ['LOWEST_LANDED_COST', 'LOWEST_PER_LITRE', 'LOWEST_PER_UNIT', 'ALPHABETICAL', 'ALCOHOL_PERCENTAGE', 'PRODUCT_CATEGORY'] })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (1-indexed)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Results per page (max 100)' })
  @ApiResponse({ status: 200, description: 'Paginated product list' })
  async search(
    @Query('ids') ids?: string,
    @Query('q') _q?: string,
    @Query('category') _category?: string,
    @Query('sort') sort?: SortOrder,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ProductSearchResult> {
    const pageNum = this.parsePositiveInt(page, 1);
    const limitNum = Math.min(this.parsePositiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const sortBy = sort ?? DEFAULT_SORT;

    try {
      let items: ProductSearchItem[] = [];

      // Phase 1: fetch products by comma-separated IDs when provided.
      // Full-text search index (q, category) is Phase 2.
      if (ids !== undefined && ids.trim().length > 0) {
        const productIds = ids
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n) && n > 0);

        const products = await Promise.all(
          productIds.map((id) => this.productRepo.findById(id)),
        );

        items = products
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .map((p) => ({
            id: p.id,
            name: p.name,
            brand: p.brand,
            category: p.category,
            alcoholByVolume:
              p.alcoholByVolume !== null ? parseFloat(p.alcoholByVolume) : null,
            unitVolume: p.unitVolume,
            containerType: p.containerType,
            lowestPriceCents: null,
            merchantCount: 0,
          }));
      }

      // Apply sort (Phase 1: alphabetical only; SortOrder ranking applies to
      // CalculatorResult, not raw product records).
      if (sortBy !== 'ALPHABETICAL') {
        items.sort(compareByName);
      } else {
        items.sort(compareByName);
      }

      // Paginate
      const start = (pageNum - 1) * limitNum;
      const paginated = items.slice(start, start + limitNum);

      return {
        items: paginated,
        total: items.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(items.length / limitNum),
      };
    } catch (err) {
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Product search failed',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/products/:id — product detail with offers
  // ---------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({
    summary: 'Get product detail with active retail offers',
    description:
      'Returns the product master record and all active retail offers ' +
      'for the given product ID.',
  })
  @ApiResponse({ status: 200, description: 'Product detail with offers' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async getProduct(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductDetailResponse> {
    try {
      const product = await this.productRepo.findById(id);
      if (product === null) {
        throw new NotFoundException(`Product ${id} not found`);
      }

      const offers = await this.productRepo.findOffers(id);

      return {
        product: {
          id: product.id,
          name: product.name,
          manufacturer: product.manufacturer,
          brand: product.brand,
          category: product.category,
          alcoholByVolume:
            product.alcoholByVolume !== null
              ? parseFloat(product.alcoholByVolume)
              : null,
          unitVolume: product.unitVolume,
          containerType: product.containerType,
          regulatoryClassification: product.regulatoryClassification,
          depositSystemStatus: product.depositSystemStatus ?? false,
          ean: product.ean,
        },
        offers: offers.map(
          (o): OfferItem => ({
            id: o.id,
            merchant: o.merchant,
            country: o.country,
            priceCents: o.priceCents,
            currency: o.currency,
            availability: o.availability,
            sourceUrl: o.sourceUrl,
            observedAt:
              o.observedAt instanceof Date
                ? o.observedAt.toISOString()
                : String(o.observedAt),
            reliabilityStatus: o.reliabilityStatus,
          }),
        ),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to fetch product detail',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
}