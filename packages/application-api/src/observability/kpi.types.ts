// ---------------------------------------------------------------------------
// KPI metric types for observability instrumentation
// ---------------------------------------------------------------------------

/** The four KPI categories tracked by the platform. */
export enum KpiCategory {
  PRODUCT = 'PRODUCT',
  COMMERCIAL = 'COMMERCIAL',
  DATA = 'DATA',
  COMPLIANCE = 'COMPLIANCE',
}

/** Supported metric shapes. */
export enum MetricType {
  COUNTER = 'COUNTER',
  GAUGE = 'GAUGE',
  HISTOGRAM = 'HISTOGRAM',
}

/** A single KPI observation emitted by instrumentation. */
export interface KpiMetric {
  /** ISO-8601 timestamp of the observation. */
  timestamp: string;
  category: KpiCategory;
  metric: string;
  value: number;
  metricType: MetricType;
  tags: Record<string, string>;
}

/** Free-form tag map attached to metrics. */
export type MetricTags = Record<string, string>;