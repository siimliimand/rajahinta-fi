import { Injectable, Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CostEntry {
  calculationId: string;
  costInCents: number;
  merchantId: string;
  category: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CostSummary {
  totalCostInCents: number;
  count: number;
  averageCostInCents: number;
}

export interface CostBreakdown {
  byMerchant: Record<string, CostSummary>;
  byCategory: Record<string, CostSummary>;
  total: CostSummary;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Per-calculation cost attribution.
 *
 * Records infrastructure spend attributed to individual calculations and
 * exposes aggregation views (by merchant, by category, total). Data is
 * stored in-memory and logged as structured JSON lines — same pattern as
 * KpiService — for log-ingestion pipelines to consume.
 */
@Injectable()
export class CostAttributionService {
  private readonly logger = new Logger(CostAttributionService.name);
  private readonly entries: CostEntry[] = [];

  /**
   * Record the infrastructure cost of a single calculation.
   *
   * @param calculationId  Unique calculation identifier
   * @param costInCents    Spend in euro-cents (e.g. 50 = €0.50)
   * @param merchantId     Merchant or tenant that triggered the calculation
   * @param category       Cost bucket (e.g. "compute", "llm", "third-party-api")
   */
  recordCalculationCost(
    calculationId: string,
    costInCents: number,
    merchantId: string,
    category: string,
  ): void {
    const entry: CostEntry = {
      calculationId,
      costInCents,
      merchantId,
      category,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);

    this.logger.log(`[COST] ${JSON.stringify(entry)}`);
  }

  /** Aggregate costs for a specific merchant. */
  getCostByMerchant(merchantId: string): CostSummary {
    return this.summarize(
      this.entries.filter((e) => e.merchantId === merchantId),
    );
  }

  /** Aggregate costs for a specific category. */
  getCostByCategory(category: string): CostSummary {
    return this.summarize(
      this.entries.filter((e) => e.category === category),
    );
  }

  /** Full cost breakdown across all merchants and categories. */
  getTotalInfrastructureCost(): CostBreakdown {
    const byMerchant: Record<string, CostSummary> = {};
    const byCategory: Record<string, CostSummary> = {};

    for (const entry of this.entries) {
      if (!byMerchant[entry.merchantId]) {
        byMerchant[entry.merchantId] = this.getCostByMerchant(entry.merchantId);
      }
      if (!byCategory[entry.category]) {
        byCategory[entry.category] = this.getCostByCategory(entry.category);
      }
    }

    return {
      byMerchant,
      byCategory,
      total: this.summarize(this.entries),
    };
  }

  private summarize(entries: CostEntry[]): CostSummary {
    const totalCostInCents = entries.reduce(
      (sum, e) => sum + e.costInCents,
      0,
    );
    return {
      totalCostInCents,
      count: entries.length,
      averageCostInCents:
        entries.length > 0
          ? Math.round(totalCostInCents / entries.length)
          : 0,
    };
  }
}