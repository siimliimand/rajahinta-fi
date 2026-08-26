/**
 * HistoricalDataController — historical price-intelligence endpoint.
 *
 * GET /api/v1/products/:id/price-history serves chart series strictly from
 * the materialized `price_history_summaries` buckets — raw observations are
 * never aggregated on the request path (architecture rule; spec requirement
 * "Charts never recompute raw history"). Raw observations are read only for
 * read-time tax-change attribution, which is computed from immutable stored
 * inputs (design decision 4) and bounded by the same 365-day range cap.
 *
 * Guardrails:
 * - every series point carries the strictest reliability of its source
 *   observations (spec requirement "Data freshness surfaced");
 * - attribution entries are evidence (moved inputs + bounding rule-version
 *   labels), never conclusions; merchant series treatment stays neutral —
 *   no ranking or comparison semantics anywhere in the response;
 * - gated behind the `enable_historical_price_intelligence` feature flag
 *   (default OFF ⇒ 403 from FeatureFlagGuard) and rate-limited.
 *
 * @module HistoricalDataController
 */

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  TAX_RULE_REPOSITORY_PORT,
  TAX_TYPES,
  TaxChangeAttributionService,
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
  TaxRuleEffectiveWindow,
  TaxRuleVersionSnapshot,
  ObservationInputReliability,
  ConfidenceLevel,
  ReliabilityStatus,
  PriceObservation,
  normaliseCategory,
} from '@rajahinta/core-domain';
import {
  PriceHistorySummaryRepository,
  PriceHistorySummaryRecord,
  PriceObservationRepository,
  PriceObservationRecord,
  ProductRepository,
} from '@rajahinta/data-platform';
import type {
  PriceHistoryAttribution,
  PriceHistoryGranularity,
  PriceHistoryMetric,
  PriceHistoryPoint,
  PriceHistoryResponse,
} from './historical.dto';
import { RateLimitGuard, RateLimit } from '../rate-limiting';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../feature-flags';
import { AgeGateGuard } from '../age-gate';

/** Maximum requested range width in days (inclusive endpoints). */
const MAX_RANGE_DAYS = 365;
/** Milliseconds in one UTC day — from/to are date-only, range math is UTC. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Container-duty rules use a single product-category key regardless of the
 * beverage (mirrors ContainerDutyService's lookup — Finnish Tax
 * Administration sets one rate for all standard beverage containers).
 */
const CONTAINER_DUTY_PRODUCT_CATEGORY = 'all_beverages';

/** Map API granularity vocabulary to the summary-row discriminator. */
const GRANULARITY_TO_SUMMARY: Record<PriceHistoryGranularity, string> = {
  day: 'daily',
  week: 'weekly',
};

@ApiTags('products')
@Controller('api/v1/products')
@UseGuards(RateLimitGuard, FeatureFlagGuard, AgeGateGuard)
@FeatureFlagDec(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE)
export class HistoricalDataController {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly summaryRepo: PriceHistorySummaryRepository,
    private readonly observationRepo: PriceObservationRepository,
    private readonly attributionService: TaxChangeAttributionService,
    @Inject(TAX_RULE_REPOSITORY_PORT)
    private readonly taxRepo: ITaxRuleRepositoryPort,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/products/:id/price-history
  // ---------------------------------------------------------------------------

  @Get(':id/price-history')
  @RateLimit('HISTORICAL')
  @ApiOperation({
    summary: 'Historical price / landed-cost series for a product',
    description:
      'Serves daily or weekly chart series from materialized summary buckets ' +
      '(never by aggregating raw observations on the request path). Points carry ' +
      'per-point reliability; changes are attributed to tax-rule version ' +
      'boundaries, merchant price moves, or transport moves with inspectable ' +
      'evidence. The earliest available observation date is included so the UI ' +
      'can show when data starts. Merchant-neutral: requesting a merchant ' +
      'returns that merchant\u2019s own series, never a comparison.',
  })
  @ApiQuery({ name: 'metric', required: false, enum: ['price', 'landed-cost'], description: 'Series to return (default: price)' })
  @ApiQuery({ name: 'granularity', required: false, enum: ['day', 'week'], description: 'Bucket granularity (default: day)' })
  @ApiQuery({ name: 'from', required: true, description: 'Range start, ISO date YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: true, description: 'Range end (inclusive), ISO date YYYY-MM-DD; range capped at 365 days' })
  @ApiQuery({ name: 'merchant', required: false, description: 'Optional merchant filter; omit for the product-wide series' })
  @ApiResponse({ status: 200, description: 'Series points with reliability, change attribution, and earliest available observation date' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters (including ranges wider than 365 days)' })
  @ApiResponse({ status: 403, description: 'Feature flag disabled or age confirmation missing' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async getPriceHistory(
    @Param('id', ParseIntPipe) id: number,
    @Query('metric') metric?: string,
    @Query('granularity') granularity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('merchant') merchant?: string,
  ): Promise<PriceHistoryResponse> {
    const query = this.validateQuery(metric, granularity, from, to, merchant);

    try {
      const product = await this.productRepo.findById(id);
      if (product === null) {
        throw new NotFoundException(`Product ${id} not found`);
      }

      // Dates are date-only, so the range runs from the UTC midnight opening
      // `from` to the UTC midnight AFTER `to` (inclusive end date).
      const fromDate = parseIsoDateOrThrow(from!);
      const toExclusive = new Date(parseIsoDateOrThrow(to!).getTime() + DAY_MS);

      // ---- Series: summaries only --------------------------------------
      const summaries = await this.summaryRepo.findByProductRange(
        id,
        GRANULARITY_TO_SUMMARY[query.granularity],
        query.from,
        query.to,
        query.merchant,
      );
      const series = summaries.map((row) =>
        this.toPoint(row, query.metric),
      );

      // ---- Earliest available observation date --------------------------
      const earliest = await this.observationRepo.findEarliestObservedAt(
        id,
        query.merchant,
      );

      // ---- Attribution: read-time, from immutable inputs -----------------
      const attribution = await this.buildAttribution(
        id,
        product.category,
        fromDate,
        toExclusive,
        query.merchant,
      );

      return {
        productId: id,
        merchant: query.merchant,
        metric: query.metric,
        granularity: query.granularity,
        from: query.from,
        to: query.to,
        series,
        attribution,
        earliestAvailableObservationDate:
          earliest !== null ? earliest.toISOString() : null,
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to fetch price history',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Query validation — manual, mirroring CalculatorController conventions
  // ---------------------------------------------------------------------------

  private validateQuery(
    metric: string | undefined,
    granularity: string | undefined,
    from: string | undefined,
    to: string | undefined,
    merchant: string | undefined,
  ): {
    metric: PriceHistoryMetric;
    granularity: PriceHistoryGranularity;
    from: string;
    to: string;
    merchant: string | null;
  } {
    const errors: string[] = [];

    let metricValue: PriceHistoryMetric = 'price';
    if (metric !== undefined && metric !== 'price' && metric !== 'landed-cost') {
      errors.push('metric must be one of: price, landed-cost');
    } else if (metric !== undefined) {
      metricValue = metric;
    }

    let granularityValue: PriceHistoryGranularity = 'day';
    if (
      granularity !== undefined &&
      granularity !== 'day' &&
      granularity !== 'week'
    ) {
      errors.push('granularity must be one of: day, week');
    } else if (granularity !== undefined) {
      granularityValue = granularity;
    }

    if (from === undefined || parseIsoDate(from) === null) {
      errors.push('from is required and must be an ISO date (YYYY-MM-DD)');
    }
    if (to === undefined || parseIsoDate(to) === null) {
      errors.push('to is required and must be an ISO date (YYYY-MM-DD)');
    }

    if (
      errors.length === 0 &&
      from !== undefined &&
      to !== undefined
    ) {
      const fromMs = parseIsoDate(from)!.getTime();
      const toMs = parseIsoDate(to)!.getTime();
      if (toMs < fromMs) {
        errors.push('to must not be before from');
      } else if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) {
        errors.push(
          `requested range must not exceed ${MAX_RANGE_DAYS} days`,
        );
      }
    }

    if (
      merchant !== undefined &&
      (merchant.length === 0 || merchant.length > 128)
    ) {
      errors.push('merchant must be a non-empty string of at most 128 characters');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: errors.join('; '),
        error: 'ValidationError',
      });
    }

    return {
      metric: metricValue,
      granularity: granularityValue,
      from: from!,
      to: to!,
      merchant: merchant !== undefined ? merchant : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Series mapping
  // ---------------------------------------------------------------------------

  /** Project one summary row into a chart point for the requested metric. */
  private toPoint(
    row: PriceHistorySummaryRecord,
    metric: PriceHistoryMetric,
  ): PriceHistoryPoint {
    const open = metric === 'price' ? row.priceOpenCents : row.landedCostOpenCents;
    const close = metric === 'price' ? row.priceCloseCents : row.landedCostCloseCents;
    const min = metric === 'price' ? row.priceMinCents : row.landedCostMinCents;
    const max = metric === 'price' ? row.priceMaxCents : row.landedCostMaxCents;
    const avg = metric === 'price' ? row.priceAvgCents : row.landedCostAvgCents;

    return {
      periodStart: row.periodStart,
      openCents: open,
      closeCents: close,
      minCents: min,
      maxCents: max,
      avgCents: avg,
      observationCount: row.observationCount,
      reliability: narrowReliability(row.strictestReliability),
    };
  }

  // ---------------------------------------------------------------------------
  // Read-time attribution (design decision 4: computed from immutable inputs)
  // ---------------------------------------------------------------------------

  /**
   * Classify changes between consecutive raw observations of the requested
   * range by joining them against tax-rule effective windows.
   *
   * The pure {@link TaxChangeAttributionService} accepts one
   * (productId, merchant) series, so for product-wide requests the fetched
   * observations are grouped per merchant and each series is attributed on
   * its own — never interleaved across merchants. Only steps where something
   * changed are returned (UNCHANGED steps carry no information for the chart).
   */
  private async buildAttribution(
    productId: number,
    productCategory: string,
    from: Date,
    toExclusive: Date,
    merchant: string | null,
  ): Promise<readonly PriceHistoryAttribution[]> {
    const records = await this.observationRepo.findByProductRange(
      productId,
      from,
      toExclusive,
      merchant,
    );
    if (records.length < 2) {
      return [];
    }

    // Rule windows overlapping the range, using the same canonical
    // (taxType, productCategory) keys the engines resolved observations
    // against — otherwise boundaries would be invisible to the join.
    const exciseCategory = normaliseCategory(productCategory);
    const [exciseRules, containerDutyRules] = await Promise.all([
      this.taxRepo.findHistoryRates(
        TAX_TYPES.excise,
        exciseCategory,
        from,
        toExclusive,
      ),
      this.taxRepo.findHistoryRates(
        TAX_TYPES.containerDuty,
        CONTAINER_DUTY_PRODUCT_CATEGORY,
        from,
        toExclusive,
      ),
    ]);
    const exciseWindows = exciseRules.map(toEffectiveWindow);
    const containerDutyWindows = containerDutyRules.map(toEffectiveWindow);

    // Group the (observedAt, id)-ordered records into per-merchant series.
    const seriesByMerchant = new Map<string, PriceObservation[]>();
    for (const record of records) {
      const list = seriesByMerchant.get(record.merchant) ?? [];
      list.push(
        this.toDomainObservation(record, exciseWindows, containerDutyWindows),
      );
      seriesByMerchant.set(record.merchant, list);
    }

    const entries: PriceHistoryAttribution[] = [];
    for (const [seriesMerchant, observations] of seriesByMerchant) {
      const steps = this.attributionService.attribute({
        observations,
        exciseRuleWindows: exciseWindows,
        containerDutyRuleWindows: containerDutyWindows,
      });

      for (const step of steps) {
        if (step.classification === 'UNCHANGED') continue;
        entries.push({
          merchant: seriesMerchant,
          classification: step.classification,
          fromObservedAt: step.fromObservedAt.toISOString(),
          toObservedAt: step.toObservedAt.toISOString(),
          movedInputs: step.movedInputs,
          exciseRuleBoundary: step.exciseRuleBoundary,
          containerDutyRuleBoundary: step.containerDutyRuleBoundary,
        });
      }
    }

    // Deterministic output order: chronological, merchant name as tiebreaker.
    entries.sort((a, b) => {
      const byTime = a.toObservedAt.localeCompare(b.toObservedAt);
      return byTime !== 0 ? byTime : a.merchant.localeCompare(b.merchant);
    });
    return entries;
  }

  /**
   * Map a raw observation row to the domain shape the pure attribution
   * service consumes. Rule-version labels are not stored on the row (range
   * reads stay join-free); they resolve from the fetched windows, and a rule
   * id outside every fetched window stays null — never a fabricated label.
   */
  private toDomainObservation(
    record: PriceObservationRecord,
    exciseWindows: readonly TaxRuleEffectiveWindow[],
    containerDutyWindows: readonly TaxRuleEffectiveWindow[],
  ): PriceObservation {
    return {
      productId: record.productId,
      merchant: record.merchant,
      retailOfferId: record.retailOfferId,
      observedAt: record.observedAt,
      foreignRetailPriceCents: record.foreignRetailPriceCents,
      transportOfferId: record.transportOfferId,
      transportCostCents: record.transportCostCents,
      exciseRuleVersion: resolveSnapshot(
        record.exciseRuleVersionId,
        exciseWindows,
      ),
      containerDutyRuleVersion: resolveSnapshot(
        record.containerDutyRuleVersionId,
        containerDutyWindows,
      ),
      landedCostCents: record.landedCostCents,
      inputReliability: narrowInputReliability(record.inputReliability),
      confidence: narrowConfidence(record.confidence),
    };
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/** Strictly parse 'YYYY-MM-DD' as a UTC-midnight Date; null when invalid. */
function parseIsoDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  // Roundtrip rejects calendar-invalid strings like 2026-02-30.
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? date
    : null;
}

/** Parse or throw — callers invoke this only after validateQuery succeeded. */
function parseIsoDateOrThrow(raw: string): Date {
  const date = parseIsoDate(raw);
  if (date === null) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'from/to must be an ISO date (YYYY-MM-DD)',
      error: 'ValidationError',
    });
  }
  return date;
}

/** Map a repository rule record onto the attribution service's window shape. */
function toEffectiveWindow(rule: TaxRuleRecordPort): TaxRuleEffectiveWindow {
  return {
    ruleId: rule.id,
    versionLabel: rule.versionLabel,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
  };
}

/** Resolve a stored rule-version FK id to a snapshot via the fetched windows. */
function resolveSnapshot(
  ruleId: number | null,
  windows: readonly TaxRuleEffectiveWindow[],
): TaxRuleVersionSnapshot | null {
  if (ruleId === null) return null;
  const window = windows.find((w) => w.ruleId === ruleId);
  return window !== undefined
    ? { ruleId, versionLabel: window.versionLabel }
    : null;
}

/**
 * Narrow a persisted reliability string to the domain union — unknown or
 * legacy values degrade to ESTIMATED; reliability is never overstated
 * (same policy as ProductDataAdapter).
 */
function narrowReliability(value: unknown): ReliabilityStatus {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}

/** Narrow the JSONB per-input snapshot; missing fields degrade, never overstate. */
function narrowInputReliability(raw: unknown): ObservationInputReliability {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    retailPrice: narrowReliability(record.retailPrice),
    transport: narrowReliability(record.transport),
    exciseRule: narrowReliability(record.exciseRule),
    containerDutyRule: narrowReliability(record.containerDutyRule),
  };
}

/** Narrow a persisted confidence string; unknown values degrade to LOW. */
function narrowConfidence(value: unknown): ConfidenceLevel {
  return value === 'HIGH' || value === 'MEDIUM' ? value : 'LOW';
}
