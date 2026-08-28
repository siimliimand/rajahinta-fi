import { Injectable, Logger } from '@nestjs/common';
import {
  KpiCategory,
  KpiMetric,
  MetricTags,
  MetricType,
} from './kpi.types';

/**
 * In-memory KPI metric buffer with a flush-to-log mechanism.
 *
 * Production note: the in-memory sampler is RETIRED from production
 * paths — it is neither multi-replica coherent nor durable, and
 * structured request logging (pino, apps/backend main.ts) is the
 * production observability channel. The buffer stays active in
 * non-production environments (and behind `KPI_SAMPLER_ENABLED=true`
 * for explicit operator opt-in) so the ops dashboard and tests keep
 * working against it.
 */
@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);
  private readonly buffer: KpiMetric[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** Default flush interval in milliseconds. */
  private static readonly DEFAULT_FLUSH_MS = 10_000;

  /** Maximum buffered metrics before an automatic flush is forced. */
  private static readonly MAX_BUFFER_SIZE = 500;

  /** Whether in-memory sampling is active for this process. */
  private readonly enabled: boolean;

  constructor() {
    this.enabled =
      process.env.NODE_ENV !== 'production' ||
      process.env.KPI_SAMPLER_ENABLED === 'true';
    if (this.enabled) {
      this.startAutoFlush(KpiService.DEFAULT_FLUSH_MS);
    }
  }

  /**
   * Record a KPI observation.
   *
   * @param category  One of PRODUCT, COMMERCIAL, DATA, COMPLIANCE
   * @param metric    Metric name (dot-separated namespacing recommended)
   * @param value     Numeric observation
   * @param tags      Optional key-value metadata
   * @param metricType Metric shape hint (default COUNTER)
   */
  record(
    category: KpiCategory,
    metric: string,
    value: number,
    tags?: MetricTags,
    metricType: MetricType = MetricType.COUNTER,
  ): void {
    if (!this.enabled) return;

    this.buffer.push({
      timestamp: new Date().toISOString(),
      category,
      metric,
      value,
      metricType,
      tags: tags ?? {},
    });

    if (this.buffer.length >= KpiService.MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush buffered metrics to the application log.
   * Each metric is written as a separate structured JSON line prefixed with
   * `[KPI]` for easy filtering in log aggregation systems.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);
    for (const metric of batch) {
      this.logger.log(`[KPI] ${JSON.stringify(metric)}`);
    }
  }

  /**
   * Start automatic periodic flush.
   * Called once from the constructor. Protected for testability (override
   * in test double or call manually).
   */
  protected startAutoFlush(intervalMs: number): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => this.flush(), intervalMs);

    // Allow the Node.js process to exit even if the timer is still active.
    if (this.flushTimer && typeof this.flushTimer === 'object') {
      this.flushTimer.unref();
    }
  }

  /**
   * Return a snapshot of all currently buffered metrics.
   * Used by OpsDashboardService to compute health signals from live KPI data.
   */
  getMetrics(): readonly KpiMetric[] {
    return this.buffer;
  }

  /**
   * Dispose the service — flush remaining metrics and stop the timer.
   * Call during graceful shutdown (e.g. NestJS onApplicationShutdown).
   */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}