/**
 * Report export DTO types — request vocabulary and response shapes for the
 * reports API (task 3.3, change phase2-advanced-features).
 *
 * Reports serialize persisted calculation records; every figure in every
 * format comes verbatim from the record (design D2 — a report can never
 * diverge from the calculation the user saw).
 *
 * @module ReportsDto
 */

import type { CalculationRecordData } from '@rajahinta/core-domain';

/** Export formats supported by GET /api/v1/reports/:recordId. */
export type ReportFormat = 'json' | 'csv' | 'html';

/**
 * JSON report response — lossless mirror of the persisted record plus export
 * metadata.  The `record` field carries everything the calculation-record
 * query port returns: figures, disclaimer, confidence, classification, and
 * dataset-version provenance.
 */
export interface JsonReport {
  /** Always `'json'` — lets consumers distinguish format without headers. */
  readonly format: 'json';
  /** ID of the persisted calculation record this report mirrors. */
  readonly recordId: number;
  /** When the export document was generated (ISO 8601). */
  readonly generatedAt: string;
  /** The persisted calculation record, verbatim — never recomputed. */
  readonly record: CalculationRecordData;
}
