import { Injectable } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { KpiCategory, MetricType } from './kpi.types';

/**
 * Higher-level instrumentation facade for the four KPI categories.
 *
 * Each method captures a specific domain event, records it via KpiService,
 * and provides a semantic API that controllers and services call without
 * knowing the metric shape details.
 */
@Injectable()
export class InstrumentationService {
  constructor(private readonly kpi: KpiService) {}

  // -------------------------------------------------------------------------
  // PRODUCT — calculation counts, API latency, error rates
  // -------------------------------------------------------------------------

  /** Record that a landed-cost or excise calculation completed. */
  recordCalculation(success: boolean, durationMs: number): void {
    this.kpi.record(
      KpiCategory.PRODUCT,
      'calculation.count',
      1,
      { success: String(success) },
      MetricType.COUNTER,
    );
    this.kpi.record(
      KpiCategory.PRODUCT,
      'calculation.duration_ms',
      durationMs,
      { success: String(success) },
      MetricType.HISTOGRAM,
    );
  }

  /** Record an API call with its method, path, status code, and duration. */
  recordApiCall(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const tags = {
      method: method.toUpperCase(),
      path,
      status: String(statusCode),
      statusGroup: `${Math.floor(statusCode / 100)}xx`,
    };

    this.kpi.record(
      KpiCategory.PRODUCT,
      'api.request.count',
      1,
      tags,
      MetricType.COUNTER,
    );
    this.kpi.record(
      KpiCategory.PRODUCT,
      'api.request.duration_ms',
      durationMs,
      tags,
      MetricType.HISTOGRAM,
    );
  }

  // -------------------------------------------------------------------------
  // COMMERCIAL — cost per calculation, revenue attribution, merchant usage
  // -------------------------------------------------------------------------

  /** Record a cost incurred (e.g. third-party API fee, compute cost). */
  recordCost(costAmount: number, attributionTag: string): void {
    this.kpi.record(
      KpiCategory.COMMERCIAL,
      'cost.amount',
      costAmount,
      { attribution: attributionTag },
      MetricType.GAUGE,
    );
  }

  /** Track usage attributed to a specific merchant or integration. */
  recordMerchantUsage(merchantId: string, action: string, count: number): void {
    this.kpi.record(
      KpiCategory.COMMERCIAL,
      'merchant.usage',
      count,
      { merchantId, action },
      MetricType.COUNTER,
    );
  }

  // -------------------------------------------------------------------------
  // DATA — stale-data rate, data freshness, ingestion lag
  // -------------------------------------------------------------------------

  /** Record how stale a data source was at access time (ms since last refresh). */
  recordStaleness(source: string, lagMs: number): void {
    this.kpi.record(
      KpiCategory.DATA,
      'data.staleness_ms',
      lagMs,
      { source },
      MetricType.GAUGE,
    );
  }

  /** Record a freshness check outcome for a data source. */
  recordFreshnessCheck(source: string, isFresh: boolean): void {
    this.kpi.record(
      KpiCategory.DATA,
      'data.freshness_check',
      isFresh ? 1 : 0,
      { source, fresh: String(isFresh) },
      MetricType.COUNTER,
    );
  }

  /** Record ingestion pipeline lag for a given source. */
  recordIngestionLag(source: string, lagMs: number): void {
    this.kpi.record(
      KpiCategory.DATA,
      'data.ingestion_lag_ms',
      lagMs,
      { source },
      MetricType.GAUGE,
    );
  }

  // -------------------------------------------------------------------------
  // COMPLIANCE — verified calculation percentage, compliance incidents,
  //              audit trail completeness
  // -------------------------------------------------------------------------

  /** Record whether a calculation carried a verified (fully traced) flag. */
  recordVerifiedCalculation(isVerified: boolean): void {
    this.kpi.record(
      KpiCategory.COMPLIANCE,
      'compliance.verified_calculation',
      isVerified ? 1 : 0,
      { verified: String(isVerified) },
      MetricType.COUNTER,
    );
  }

  /** Record a compliance incident (e.g. untraceable result, stale rate used). */
  recordIncident(type: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.kpi.record(
      KpiCategory.COMPLIANCE,
      'compliance.incident',
      1,
      { type, severity },
      MetricType.COUNTER,
    );
  }

  /** Record audit trail completeness at calculation time. */
  recordAuditTrailComplete(isComplete: boolean): void {
    this.kpi.record(
      KpiCategory.COMPLIANCE,
      'compliance.audit_trail_complete',
      isComplete ? 1 : 0,
      { complete: String(isComplete) },
      MetricType.COUNTER,
    );
  }
}