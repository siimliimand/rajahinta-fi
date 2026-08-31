/**
 * R2 observation-log layout (design D4 as amended by gate review G1).
 *
 * `price_observations` does not exist on Cloudflare: observations live in
 * R2 as append-only JSONL objects partitioned by UTC calendar day and are
 * batch-read for aggregation, while the summaries materialize into D1.
 * This module is the pure layout contract — object-key scheme, the exact
 * per-line field set the pg `price_observations` row had, the line
 * serializer/parser pair, and the watermark scan over object keys. It has
 * no bindings and no I/O, so the layout is unit-testable in isolation and
 * the R2-backed adapter (repositories/d1/price-observation.repository.ts)
 * plus the later binding wiring stay thin.
 *
 * ## Object-key scheme
 *
 * `observations/YYYY-MM-DD.jsonl` — one object per UTC calendar day,
 * lexicographically ordered by key = ordered by day, which is what makes
 * the watermark scan a range check. Within an object, one JSON object per
 * line (LF-terminated), lines in append order = (observed_at, id)
 * ascending because observations append in ingestion order.
 *
 * ## Field set (1:1 with the pg row)
 *
 * snake_case field names match the SQL columns so the cutover ETL and the
 * aggregation batches map 1:1 — the same convention as src/d1/schema.ts.
 * `observed_at` is ISO-8601 UTC TEXT (design D2 timestamp rule).
 * `input_reliability` carries the domain snapshot object (the pg jsonb
 * content, camelCase keys), never flattened.
 *
 * ## Watermark scan
 *
 * The watermark pattern applies to R2 objects unchanged (design D4,
 * amended): given the listed object keys and the persisted watermark,
 * scan the partitions from the watermark's UTC day onward. Day-grained
 * partitions mean the boundary day is re-scanned from its start — the
 * per-line `>= watermark` filter happens in the aggregation consumer,
 * mirroring the pg `findProductActivitySince` inclusive-lower-bound
 * convention (re-scan is idempotent; skipping could lose rows appended
 * late with the same instant).
 *
 * @module ObservationLog
 */
import type {
  ConfidenceLevel,
  ObservationInputReliability,
} from '@rajahinta/core-domain';

/** R2 key prefix of the append-only observation log. */
export const OBSERVATION_LOG_PREFIX = 'observations/';

const OBJECT_KEY_PATTERN = /^observations\/(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * One serialized observation — the exact field set of the pg
 * `price_observations` row (see packages/data-platform/src/schema.ts).
 * The rule-version snapshots collapse to FK ids exactly like the pg
 * append: `excise_rule_version_id` / `container_duty_rule_version_id`,
 * with `versionLabel` recoverable through taxRules and deliberately not
 * logged.
 */
export interface ObservationLogRecord {
  readonly id: number;
  readonly product_id: number;
  readonly merchant: string;
  readonly retail_offer_id: number;
  /** ISO-8601 UTC instant (design D2 timestamp rule). */
  readonly observed_at: string;
  readonly foreign_retail_price_cents: number;
  readonly transport_cost_cents: number;
  readonly transport_offer_id: number | null;
  readonly excise_rule_version_id: number | null;
  readonly container_duty_rule_version_id: number | null;
  readonly landed_cost_cents: number;
  readonly input_reliability: ObservationInputReliability;
  readonly confidence: ConfidenceLevel;
}

/**
 * The R2-style storage surface the observation log appends through.
 *
 * Constructor-injected into the recorder adapter; the real R2 binding
 * satisfies it structurally once the wrangler wiring lands. Appending is
 * delegated (read-modify-write is a persistence concern) so this module
 * stays pure and the adapter shell carries no storage semantics.
 */
export interface ObservationLogStore {
  /** Append one serialized JSONL line to the date-partitioned object. */
  appendLine(key: string, line: string): Promise<void>;
}

/** The UTC date part (`YYYY-MM-DD`) of an observation's `observed_at`. */
function partitionDay(observedAt: Date | string): string {
  const instant = typeof observedAt === 'string' ? new Date(observedAt) : observedAt;
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError(
      `Invalid observedAt for observation-log partition: ${String(observedAt)}`,
    );
  }
  return instant.toISOString().slice(0, 10);
}

/** The date-partitioned object key for an observation instant. */
export function observationObjectKey(observedAt: Date | string): string {
  return `${OBSERVATION_LOG_PREFIX}${partitionDay(observedAt)}.jsonl`;
}

/** The partition's UTC day for an object key, or null for foreign keys. */
export function observationPartitionDay(key: string): string | null {
  const match = OBJECT_KEY_PATTERN.exec(key);
  return match ? match[1] : null;
}

/** Fixed key order → byte-stable lines (deterministic parity checks). */
const LINE_FIELD_ORDER: readonly (keyof ObservationLogRecord)[] = [
  'id',
  'product_id',
  'merchant',
  'retail_offer_id',
  'observed_at',
  'foreign_retail_price_cents',
  'transport_cost_cents',
  'transport_offer_id',
  'excise_rule_version_id',
  'container_duty_rule_version_id',
  'landed_cost_cents',
  'input_reliability',
  'confidence',
];

/**
 * Serialize one observation as a single JSONL line (no trailing newline).
 * The record is rebuilt in the canonical field order so identical
 * observations always serialize to identical bytes.
 */
export function serializeObservationLine(record: ObservationLogRecord): string {
  const ordered: Record<string, unknown> = {};
  for (const field of LINE_FIELD_ORDER) {
    ordered[field] = record[field];
  }
  return JSON.stringify(ordered);
}

/** Parse one JSONL line back into an observation record. */
export function parseObservationLine(line: string): ObservationLogRecord {
  if (line.trim().length === 0) {
    throw new TypeError('Cannot parse an empty observation-log line');
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new TypeError(
      `Malformed observation-log line (invalid JSON): ${String(error)}`,
    );
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Observation-log line must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  for (const field of LINE_FIELD_ORDER) {
    if (!(field in record)) {
      throw new TypeError(
        `Observation-log line is missing the required field '${field}'`,
      );
    }
  }
  return value as ObservationLogRecord;
}

/** Serialize a batch as JSONL — one LF-terminated line per record. */
export function serializeObservationLog(records: readonly ObservationLogRecord[]): string {
  if (records.length === 0) return '';
  return records.map(serializeObservationLine).join('\n') + '\n';
}

/** Parse a whole JSONL object body; blank lines are ignored. */
export function parseObservationLog(body: string): ObservationLogRecord[] {
  const records: ObservationLogRecord[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    records.push(parseObservationLine(trimmed));
  }
  return records;
}

/**
 * Watermark scan over object keys: return the observation-log partitions
 * that must be scanned for observations at-or-after the watermark.
 *
 * Partitions before the watermark's UTC day are excluded; the watermark's
 * own day is included from its start (see the module header — inclusive
 * lower bound, per-line filtering downstream). Keys outside the
 * observation-log key scheme are skipped: they are not partitions of this
 * log. The result is ascending by partition day — the scan order.
 */
export function observationKeysToScan(
  keys: readonly string[],
  watermark: Date | null,
): string[] {
  const thresholdDay =
    watermark === null ? null : partitionDay(watermark);
  return keys
    .map((key) => ({ key, day: observationPartitionDay(key) }))
    .filter((entry): entry is { key: string; day: string } => entry.day !== null)
    .filter(
      (entry) => thresholdDay === null || entry.day >= thresholdDay,
    )
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((entry) => entry.key);
}
