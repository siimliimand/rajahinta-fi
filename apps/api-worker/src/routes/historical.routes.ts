/**
 * Historical price-history route port (task 3.6) — Hono re-host of
 * HistoricalDataController (packages/application-api/src/historical/).
 *
 * Guard/rate-limit composition (Nest decoration order preserved):
 *   GET /api/v1/products/:id/price-history
 *     RateLimit(HISTORICAL) → FeatureFlag(HISTORICAL_PRICE_INTELLIGENCE) → AgeGate
 *
 * Chart series serve strictly from the materialized D1
 * price_history_summaries buckets (never raw aggregation on the request
 * path). Read-time tax-change attribution runs over the R2 observation
 * log (design D4/G1 — raw observations live in R2, not D1): the range is
 * scanned day-partition by day-partition and grouped per merchant exactly
 * like the D1 findByProductRange contract (ordered by observedAt, id).
 *
 * @module HistoricalRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { ageGate } from '../middleware/age-gate';
import { requireFeatureFlag, FeatureFlag } from '../middleware/feature-flags';
import {
  TaxChangeAttributionService,
  TAX_TYPES,
  normaliseCategory,
} from '../adapters/core-domain-bridge';
import type { PriceObservation } from '../../../../packages/core-domain/src/history/price-observation.types';
import type { TaxRuleEffectiveWindow } from '../../../../packages/core-domain/src/history/services/tax-change-attribution.service';
import type { TaxRuleVersionSnapshot } from '../../../../packages/core-domain/src/history/price-observation.types';
import type { ObservationInputReliability } from '../../../../packages/core-domain/src/history/price-observation.types';
import type { ConfidenceLevel } from '../../../../packages/core-domain/src/reliability/confidence-framework.types';
import type { ReliabilityStatus } from '../../../../packages/core-domain/src/reliability/reliability.types';
import { D1PriceHistorySummaryRepository } from '../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import { D1TaxRateRepository } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import {
  observationKeysToScan,
  parseObservationLine,
  OBSERVATION_LOG_PREFIX,
  type ObservationLogRecord,
} from '../../../../packages/data-platform/src/d1/observation-log';
import { observationLogStore, type ObservationLogReader } from '../adapters/r2-observation-log.store';

/** Maximum requested range width in days (inclusive endpoints). */
const MAX_RANGE_DAYS = 365;
/** Milliseconds in one UTC day — from/to are date-only, range math is UTC. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Container-duty rules use a single product-category key (engine parity). */
const CONTAINER_DUTY_PRODUCT_CATEGORY = 'all_beverages';
/** API granularity vocabulary → the summary-row discriminator. */
const GRANULARITY_TO_SUMMARY: Record<string, string> = { day: 'daily', week: 'weekly' };

// ---------------------------------------------------------------------------
// Query validation — verbatim port of validateQuery
// ---------------------------------------------------------------------------

interface ValidatedQuery {
  metric: 'price' | 'landed-cost';
  granularity: 'day' | 'week';
  from: string;
  to: string;
  merchant: string | null;
}

/** Strictly parse 'YYYY-MM-DD' as a UTC-midnight Date; null when invalid. */
function parseIsoDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? date
    : null;
}

function validateQuery(
  metric: string | undefined,
  granularity: string | undefined,
  from: string | undefined,
  to: string | undefined,
  merchant: string | undefined,
): ValidatedQuery {
  const errors: string[] = [];

  let metricValue: ValidatedQuery['metric'] = 'price';
  if (metric !== undefined && metric !== 'price' && metric !== 'landed-cost') {
    errors.push('metric must be one of: price, landed-cost');
  } else if (metric !== undefined) {
    metricValue = metric;
  }

  let granularityValue: ValidatedQuery['granularity'] = 'day';
  if (granularity !== undefined && granularity !== 'day' && granularity !== 'week') {
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

  if (errors.length === 0 && from !== undefined && to !== undefined) {
    const fromMs = parseIsoDate(from)!.getTime();
    const toMs = parseIsoDate(to)!.getTime();
    if (toMs < fromMs) {
      errors.push('to must not be before from');
    } else if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) {
      errors.push(`requested range must not exceed ${MAX_RANGE_DAYS} days`);
    }
  }

  if (merchant !== undefined && (merchant.length === 0 || merchant.length > 128)) {
    errors.push('merchant must be a non-empty string of at most 128 characters');
  }

  if (errors.length > 0) {
    throw new ApiHttpError(400, {
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
// R2-backed raw-observation range read (the D1 repository contract, ported)
// ---------------------------------------------------------------------------

/** Raw-observation projection (PriceObservationRecord shape parity). */
interface ObservationRow {
  readonly productId: number;
  readonly merchant: string;
  readonly retailOfferId: number;
  readonly observedAt: Date;
  readonly foreignRetailPriceCents: number;
  readonly transportOfferId: number | null;
  readonly transportCostCents: number;
  readonly exciseRuleVersionId: number | null;
  readonly containerDutyRuleVersionId: number | null;
  readonly landedCostCents: number;
  readonly inputReliability: ObservationInputReliability;
  readonly confidence: ConfidenceLevel;
}

/** Scan the R2 day partitions overlapping [from, to) for one product. */
async function findObservationsByProductRange(
  env: AppEnv['Bindings'],
  productId: number,
  from: Date,
  to: Date,
  merchant: string | null,
): Promise<ObservationRow[]> {
  const reader: ObservationLogReader = observationLogStore(env);
  const allKeys = await reader.listKeys(OBSERVATION_LOG_PREFIX);
  // Partitions at or after the range's opening day; per-line filtering
  // below enforces the exact bounds (watermark-scan parity).
  const keys = observationKeysToScan(allKeys, from).filter((key) => {
    const day = key.slice(OBSERVATION_LOG_PREFIX.length, OBSERVATION_LOG_PREFIX.length + 10);
    return day <= to.toISOString().slice(0, 10);
  });

  const rows: ObservationRow[] = [];
  for (const key of keys) {
    const body = await reader.readObject(key);
    if (body === null) continue;
    for (const line of body.split('\n')) {
      if (line.trim().length === 0) continue;
      let record: ObservationLogRecord;
      try {
        record = parseObservationLine(line);
      } catch {
        continue; // A torn tail line never fails a read (JSONL framing).
      }
      if (record.product_id !== productId) continue;
      const observedAt = new Date(record.observed_at);
      if (observedAt < from || observedAt >= to) continue;
      if (merchant !== null && record.merchant !== merchant) continue;
      rows.push({
        productId: record.product_id,
        merchant: record.merchant,
        retailOfferId: record.retail_offer_id,
        observedAt,
        foreignRetailPriceCents: record.foreign_retail_price_cents,
        transportOfferId: record.transport_offer_id,
        transportCostCents: record.transport_cost_cents,
        exciseRuleVersionId: record.excise_rule_version_id,
        containerDutyRuleVersionId: record.container_duty_rule_version_id,
        landedCostCents: record.landed_cost_cents,
        inputReliability: narrowInputReliability(record.input_reliability),
        confidence: narrowConfidence(record.confidence),
      });
    }
  }

  rows.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  return rows;
}

/** Earliest observedAt for a product (optionally merchant-filtered). */
async function findEarliestObservedAt(
  env: AppEnv['Bindings'],
  productId: number,
  merchant: string | null,
): Promise<Date | null> {
  const reader: ObservationLogReader = observationLogStore(env);
  const keys = await reader.listKeys(OBSERVATION_LOG_PREFIX);
  let earliest: Date | null = null;
  for (const key of keys) {
    const body = await reader.readObject(key);
    if (body === null) continue;
    for (const line of body.split('\n')) {
      if (line.trim().length === 0) continue;
      let record: ObservationLogRecord;
      try {
        record = parseObservationLine(line);
      } catch {
        continue;
      }
      if (record.product_id !== productId) continue;
      if (merchant !== null && record.merchant !== merchant) continue;
      const observedAt = new Date(record.observed_at);
      if (earliest === null || observedAt < earliest) earliest = observedAt;
    }
  }
  return earliest;
}

// ---------------------------------------------------------------------------
// Attribution plumbing (controller parity)
// ---------------------------------------------------------------------------

/** Narrow a persisted reliability string; unknown/legacy degrades to ESTIMATED. */
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

/** Map a repository rule record onto the attribution window shape. */
function toEffectiveWindow(rule: {
  readonly id: number;
  readonly versionLabel: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}): TaxRuleEffectiveWindow {
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
  return window !== undefined ? { ruleId, versionLabel: window.versionLabel } : null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function getPriceHistory(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const query = validateQuery(
    c.req.query('metric'),
    c.req.query('granularity'),
    c.req.query('from'),
    c.req.query('to'),
    c.req.query('merchant'),
  );

  try {
    const product = await new D1ProductSearchRepository(c.env.DB).findById(id);
    if (product === null) {
      throw new ApiHttpError(404, `Product ${id} not found`);
    }

    // Date-only range: from UTC midnight opening `from` to the UTC
    // midnight AFTER `to` (inclusive end date).
    const fromDate = parseIsoDate(query.from)!;
    const toExclusive = new Date(parseIsoDate(query.to)!.getTime() + DAY_MS);

    // ---- Series: summaries only --------------------------------------
    const summaries = await new D1PriceHistorySummaryRepository(c.env.DB).findByProductRange(
      id,
      GRANULARITY_TO_SUMMARY[query.granularity]!,
      query.from,
      query.to,
      query.merchant,
    );
    const series = summaries.map((row) => {
      const open = query.metric === 'price' ? row.priceOpenCents : row.landedCostOpenCents;
      const close = query.metric === 'price' ? row.priceCloseCents : row.landedCostCloseCents;
      const min = query.metric === 'price' ? row.priceMinCents : row.landedCostMinCents;
      const max = query.metric === 'price' ? row.priceMaxCents : row.landedCostMaxCents;
      const avg = query.metric === 'price' ? row.priceAvgCents : row.landedCostAvgCents;
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
    });

    // ---- Earliest available observation date --------------------------
    const earliest = await findEarliestObservedAt(c.env, id, query.merchant);

    // ---- Attribution: read-time, from immutable inputs -----------------
    const exciseCategory = normaliseCategory(product.category);
    const taxRepo = new D1TaxRateRepository(c.env.DB);
    const [exciseRules, containerDutyRules] = await Promise.all([
      taxRepo.findHistoryRates(TAX_TYPES.excise, exciseCategory, fromDate, toExclusive),
      taxRepo.findHistoryRates(
        TAX_TYPES.containerDuty,
        CONTAINER_DUTY_PRODUCT_CATEGORY,
        fromDate,
        toExclusive,
      ),
    ]);
    const exciseWindows = exciseRules.map(toEffectiveWindow);
    const containerDutyWindows = containerDutyRules.map(toEffectiveWindow);

    const records = await findObservationsByProductRange(
      c.env,
      id,
      fromDate,
      toExclusive,
      query.merchant,
    );

    const attribution: unknown[] = [];
    if (records.length >= 2) {
      // Group into per-merchant series — never interleaved.
      const seriesByMerchant = new Map<string, PriceObservation[]>();
      for (const record of records) {
        const list = seriesByMerchant.get(record.merchant) ?? [];
        list.push({
          productId: record.productId,
          merchant: record.merchant,
          retailOfferId: record.retailOfferId,
          observedAt: record.observedAt,
          foreignRetailPriceCents: record.foreignRetailPriceCents,
          transportOfferId: record.transportOfferId,
          transportCostCents: record.transportCostCents,
          exciseRuleVersion: resolveSnapshot(record.exciseRuleVersionId, exciseWindows),
          containerDutyRuleVersion: resolveSnapshot(
            record.containerDutyRuleVersionId,
            containerDutyWindows,
          ),
          landedCostCents: record.landedCostCents,
          inputReliability: record.inputReliability,
          confidence: record.confidence,
        });
        seriesByMerchant.set(record.merchant, list);
      }

      const attributionService = new TaxChangeAttributionService();
      for (const [seriesMerchant, observations] of seriesByMerchant) {
        const steps = attributionService.attribute({
          observations,
          exciseRuleWindows: exciseWindows,
          containerDutyRuleWindows: containerDutyWindows,
        });
        for (const step of steps) {
          if (step.classification === 'UNCHANGED') continue;
          attribution.push({
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

      attribution.sort((a, b) => {
        const entryA = a as { toObservedAt: string; merchant: string };
        const entryB = b as { toObservedAt: string; merchant: string };
        const byTime = entryA.toObservedAt.localeCompare(entryB.toObservedAt);
        return byTime !== 0 ? byTime : entryA.merchant.localeCompare(entryB.merchant);
      });
    }

    return c.json({
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
    });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to fetch price history',
    );
  }
}

/** Register the price-history handler with its own guard set. */
export function registerHistoricalRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Nest class guards: RateLimit(HISTORICAL) is registered ahead of the
  // task-3.2 guard blocks in index.ts; flag + age gate here, in order.
  app.on(
    'GET',
    '/api/v1/products/:id/price-history',
    requireFeatureFlag(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
    ageGate(),
  );
  app.get('/api/v1/products/:id/price-history', getPriceHistory);
  return app;
}
