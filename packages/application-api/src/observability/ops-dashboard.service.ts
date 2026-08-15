import { Injectable } from '@nestjs/common';
import { KpiService } from './kpi.service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StaleDataSource {
  source: string;
  lagMs: number;
  isStale: boolean;
}

export interface StaleDataResult {
  rate: number; // 0-100 percentage
  sources: StaleDataSource[];
}

export interface VerifiedCalculationResult {
  total: number;
  verified: number;
  percentage: number;
}

export interface ComplianceIncident {
  type: string;
  severity: string;
  timestamp: string;
}

export interface DashboardSnapshot {
  staleDataRate: number;
  verifiedCalculationPercentage: VerifiedCalculationResult;
  complianceIncidents: ComplianceIncident[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Compute operational health signals from buffered KPI data.
 *
 * Reads metrics from KpiService's in-memory buffer (unflushed observations)
 * and derives aggregate health indicators: stale-data rate, verified-calculation
 * percentage, and open compliance incidents.
 */
@Injectable()
export class OpsDashboardService {
  private staleThresholdMs = 300_000; // 5 minutes

  constructor(private readonly kpi: KpiService) {}

  /** Override the default 5-minute stale threshold. */
  setStaleThreshold(ms: number): void {
    this.staleThresholdMs = ms;
  }

  /** Percentage of tracked data sources whose lag exceeds the threshold. */
  getStaleDataRate(): StaleDataResult {
    const metrics = this.kpi.getMetrics();
    const staleness = metrics.filter((m) => m.metric === 'data.staleness_ms');

    if (staleness.length === 0) return { rate: 0, sources: [] };

    const sources: StaleDataSource[] = staleness.map((m) => ({
      source: m.tags.source ?? 'unknown',
      lagMs: m.value,
      isStale: m.value > this.staleThresholdMs,
    }));

    const staleCount = sources.filter((s) => s.isStale).length;
    return {
      rate: Math.round((staleCount / sources.length) * 100),
      sources,
    };
  }

  /** Percentage of calculations that passed verification (fully traced). */
  getVerifiedCalculationPercentage(): VerifiedCalculationResult {
    const metrics = this.kpi.getMetrics();
    const verified = metrics.filter(
      (m) => m.metric === 'compliance.verified_calculation',
    );

    const total = verified.length;
    const verifiedCount = verified.filter((m) => m.value === 1).length;

    return {
      total,
      verified: verifiedCount,
      percentage: total > 0 ? Math.round((verifiedCount / total) * 100) : 100,
    };
  }

  /** List recent compliance incidents with their severity level. */
  getComplianceIncidents(): ComplianceIncident[] {
    const metrics = this.kpi.getMetrics();
    return metrics
      .filter((m) => m.metric === 'compliance.incident')
      .map((m) => ({
        type: m.tags.type ?? 'unknown',
        severity: m.tags.severity ?? 'low',
        timestamp: m.timestamp,
      }));
  }

  /** Convenience: return all dashboard signals in one object. */
  getDashboardSnapshot(): DashboardSnapshot {
    return {
      staleDataRate: this.getStaleDataRate().rate,
      verifiedCalculationPercentage: this.getVerifiedCalculationPercentage(),
      complianceIncidents: this.getComplianceIncidents(),
      timestamp: new Date().toISOString(),
    };
  }
}