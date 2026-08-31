#!/usr/bin/env node
/**
 * One-time cutover ETL: PostgreSQL → D1 + R2 (task 6.6, change
 * migrate-to-cloudflare; design D10, D4 as amended by G1).
 *
 * Reads every row from the source Postgres database and emits
 * byte-deterministic import artifacts:
 *
 *   - 18 D1 tables → `NN-<table>.d1.sql` (or `.d1.jsonl` with
 *     `--format jsonl` for `wrangler d1 import`), in FK-safe registry
 *     order, batched multi-row `INSERT OR IGNORE` with explicit ids
 *     preserved (explicit-id preservation is what keeps cross-table
 *     references valid — D1 does not re-number anything).
 *   - `price_observations` → R2-layout JSONL files
 *     `observations/YYYY-MM-DD.jsonl` (the task 2.3 layout from
 *     `packages/data-platform/src/d1/observation-log.ts` — its serializer
 *     is reused verbatim; these files upload to R2 with
 *     `wrangler r2 object put`, they never enter D1).
 *   - `00-manifest.json` — per-table in/out row counts + sha256 of every
 *     emitted file (the verification contract).
 *   - `99-verify.sql` — post-import per-table COUNT(*) query to run
 *     against D1 after `wrangler d1 import`.
 *
 * ## Transform rules (design D2)
 *
 *   pg timestamptz/timestamp → ISO-8601 TEXT (UTC, `Date.toISOString()`)
 *   pg boolean               → INTEGER 0/1 (tri-state null stays NULL)
 *   pg jsonb                 → JSON TEXT (canonical JSON.stringify)
 *   pg numeric               → REAL (validated decimal text, exact)
 *   pg date                  → TEXT 'YYYY-MM-DD'
 *   money columns            → INTEGER cents on BOTH sides (pass-through,
 *                              integrality enforced)
 *
 * ## Loud validation (no silent enum mapping)
 *
 * Every D1 CHECK-constrained column is validated against the migration
 * value set BEFORE emission — most importantly `product_master.container_type`
 * against the migration-0002 widened set. Any row carrying an unexpected
 * value FAILS the run and lists the offending rows (table, column, PK,
 * value). `transport_offers.package_tier` is deliberately NOT validated:
 * migration 0003 dropped that CHECK because tiers carry the container-type
 * vocabulary in real data.
 *
 * ## Determinism
 *
 * Output is a pure function of the source data: fixed registry order,
 * PK-ordered reads, stable JSON key serialization, no wall-clock in any
 * artifact. Re-running against an unchanged database reproduces identical
 * bytes (sha256-verified in the manifest).
 *
 * ## Idempotency
 *
 * `INSERT OR IGNORE` + explicit ids: importing twice never duplicates.
 * `--table` re-runs a subset incrementally; `--dry-run` validates and
 * counts without writing any file.
 *
 * ## Usage (run through data-platform's tsx, mirroring seed-d1.ts —
 * `--filter … exec` runs from packages/data-platform, hence the `../../`
 * script path; no `--tsconfig` needed, tsx finds the package's config)
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/etl-pg-to-d1.ts --pg-url $TEST_DATABASE_URL --dry-run
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/etl-pg-to-d1.ts --out /tmp/etl
 *
 * Connection: `--pg-url` flag, else $TEST_DATABASE_URL, else
 * $DATABASE_URL. Credentials are never printed — only host/database.
 *
 * @module EtlPgToD1
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  serializeObservationLine,
  observationObjectKey,
  type ObservationLogRecord,
} from '../packages/data-platform/src/d1/observation-log';

// ---------------------------------------------------------------------------
// CHECK value sets — mirror the D1 migrations exactly (0000 + 0002; 0003
// deliberately has no packageTier entry). Keep in sync with
// packages/data-platform/src/d1/schema.ts.
// ---------------------------------------------------------------------------

/** Migration 0002 widened set (core-domain ContainerType ∪ fixture spellings). */
export const CONTAINER_TYPES = ['glass', 'plastic', 'metal', 'carton', 'other', 'can', 'bottle'] as const;
export const RELIABILITY_VALUES = ['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'] as const;
export const CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const TAX_TYPE_VALUES = ['excise', 'container_duty'] as const;
export const TIER_VALUES = ['FREE', 'PREMIUM'] as const;
export const FX_STATUS_VALUES = ['PENDING_CONFIRMATION', 'PUBLISHED'] as const;
export const AUDIT_ACTION_VALUES = ['created', 'updated', 'deleted', 'confirmed'] as const;
export const GRANULARITY_VALUES = ['daily', 'weekly'] as const;

/**
 * (table → column → allowed values) validated BEFORE emission. A value
 * outside its set is a hard error listing the offending rows — the ETL
 * never invents a mapping for an unknown enum/CHECK value.
 */
export const CHECK_VALUE_SETS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  product_master: { container_type: CONTAINER_TYPES },
  retail_offers: { reliability_status: RELIABILITY_VALUES },
  transport_offers: { reliability_status: RELIABILITY_VALUES },
  merchant_terms: { reliability_status: RELIABILITY_VALUES },
  price_history_summaries: {
    granularity: GRANULARITY_VALUES,
    strictest_reliability: RELIABILITY_VALUES,
  },
  calculation_records: { confidence: CONFIDENCE_VALUES },
  basket_calculation_records: { confidence: CONFIDENCE_VALUES },
  tax_rules: { tax_type: TAX_TYPE_VALUES },
  accounts: { tier: TIER_VALUES },
  fx_rate_datasets: { status: FX_STATUS_VALUES },
  audit_events: { action: AUDIT_ACTION_VALUES },
};

/** Physical pg column of price_observations carrying the CHECKed confidence. */
const OBSERVATION_CONFIDENCE_COLUMN = 'confidence';

// ---------------------------------------------------------------------------
// Table registry — FK-safe emission order
// ---------------------------------------------------------------------------

/** The special table routed to the R2 observation log instead of D1. */
export const OBSERVATIONS_TABLE = 'price_observations';

interface TableSpec {
  /** Physical table name — identical on both sides (schema.ts docblock). */
  name: string;
  /**
   * Physical column names in emission order (the D1 schema's definition
   * order). Pinned here rather than derived at runtime: `scripts/` cannot
   * import drizzle-orm (it is a data-platform dependency, not a root one).
   * Three loud checks keep the pin honest — the test suite compares these
   * lists against the D1 migration DDL, every run compares them against
   * the live pg column set (drift fails before any emission), and the
   * D1 import itself rejects unknown columns.
   */
  columns: readonly string[];
  /** Physical PK columns; the read ORDER BY and emission order. */
  orderBy: readonly string[];
}

/**
 * All 18 D1 tables in dependency order (parents before children;
 * `sessions` additionally rotation-ordered at emission time — see
 * `orderSessionsByRotation`). Adding a 19th table to the D1 schema
 * requires a registry entry here, or the ETL fails the schema-drift check.
 */
export const TABLE_REGISTRY: readonly TableSpec[] = [
  {
    name: 'merchant_registry',
    columns: ['id', 'merchant_id', 'name', 'country', 'feed_url', 'feed_format', 'polling_interval_ms', 'created_at', 'updated_at'],
    orderBy: ['id'],
  },
  {
    name: 'product_master',
    columns: ['id', 'name', 'manufacturer', 'brand', 'category', 'alcohol_by_volume', 'unit_volume', 'container_type', 'regulatory_classification', 'deposit_system_status', 'ean', 'created_at', 'updated_at'],
    orderBy: ['id'],
  },
  {
    name: 'tax_rules',
    columns: ['id', 'tax_type', 'product_category', 'rate', 'effective_from', 'effective_to', 'exemption_conditions', 'calculation_formula_reference', 'official_source', 'verification_date', 'version_label', 'created_at'],
    orderBy: ['id'],
  },
  {
    name: 'transport_offers',
    columns: ['id', 'carrier', 'origin_country', 'destination_country', 'weight_min_kg', 'weight_max_kg', 'package_tier', 'price_cents', 'currency', 'seller_involvement_indicator', 'observed_at', 'refreshed_at', 'reliability_status'],
    orderBy: ['id'],
  },
  {
    name: 'retail_offers',
    columns: ['id', 'merchant', 'country', 'product_id', 'price_cents', 'currency', 'original_price_cents', 'original_currency', 'fx_dataset_version', 'availability', 'source_url', 'observed_at', 'reliability_status'],
    orderBy: ['id'],
  },
  {
    name: 'fx_rate_datasets',
    columns: ['id', 'version_label', 'source_name', 'source_url', 'reference_date', 'status', 'effective_from', 'effective_to', 'confirmed_by', 'confirmed_at', 'created_at'],
    orderBy: ['id'],
  },
  {
    name: 'fx_rates',
    columns: ['id', 'dataset_id', 'base_currency', 'quote_currency', 'rate', 'created_at'],
    orderBy: ['id'],
  },
  {
    name: 'accounts',
    columns: ['id', 'user_id', 'email', 'tier', 'created_at', 'last_active_at'],
    orderBy: ['id'],
  },
  {
    name: 'sessions',
    columns: ['id', 'token_hash', 'account_id', 'rotated_from_id', 'created_at', 'expires_at', 'revoked_at'],
    orderBy: ['id'],
  },
  {
    name: 'saved_baskets',
    columns: ['id', 'account_id', 'name', 'created_at', 'items'],
    orderBy: ['id'],
  },
  {
    name: 'saved_scenarios',
    columns: ['id', 'account_id', 'name', 'inputs', 'created_at', 'updated_at'],
    orderBy: ['id'],
  },
  {
    name: 'merchant_terms',
    columns: ['id', 'merchant_id', 'minimum_order_value_cents', 'currency', 'source_url', 'reliability_status', 'observed_at'],
    orderBy: ['id'],
  },
  {
    name: 'calculation_records',
    columns: ['id', 'product_master_id', 'retail_offer_ids', 'transport_offer_id', 'excise_rule_version_id', 'container_duty_rule_version_id', 'total_cents', 'breakdown', 'confidence', 'quantity', 'destination', 'disclaimer', 'session_id', 'calculated_at'],
    orderBy: ['id', 'calculated_at'],
  },
  {
    name: 'basket_calculation_records',
    columns: ['id', 'session_id', 'destination', 'transport_arrangement', 'input_basket', 'shipment_breakdown', 'total_cents', 'confidence', 'disclaimer', 'created_at'],
    orderBy: ['id', 'created_at'],
  },
  {
    name: 'price_history_summaries',
    columns: ['id', 'granularity', 'period_start', 'product_id', 'merchant', 'price_open_cents', 'price_close_cents', 'price_min_cents', 'price_max_cents', 'price_avg_cents', 'landed_cost_open_cents', 'landed_cost_close_cents', 'landed_cost_min_cents', 'landed_cost_max_cents', 'landed_cost_avg_cents', 'observation_count', 'strictest_reliability'],
    orderBy: ['id'],
  },
  {
    name: 'aggregation_watermarks',
    columns: ['id', 'job_name', 'watermark', 'updated_at'],
    orderBy: ['id'],
  },
  {
    name: 'audit_events',
    columns: ['id', 'entity_type', 'entity_id', 'action', 'author', 'reason', 'occurred_at', 'previous_value', 'new_value'],
    orderBy: ['id'],
  },
  {
    name: 'click_counter_snapshots',
    columns: ['id', 'merchant_id', 'url', 'click_count', 'captured_at'],
    orderBy: ['id'],
  },
];

/** All valid `--table` names: the 18 D1 tables + the R2-routed observations. */
export const KNOWN_TABLES: readonly string[] = [
  ...TABLE_REGISTRY.map((t) => t.name),
  OBSERVATIONS_TABLE,
];

// ---------------------------------------------------------------------------
// pg type-kinds (OIDs) → transform dispatch
// ---------------------------------------------------------------------------

/** The value shapes the ETL must map (design D2 rules). */
export type PgValueKind =
  | 'int'
  | 'float'
  | 'numeric-text'
  | 'text'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'jsonb';

/** pg builtins (pg-types). */
const OID = {
  BOOL: 16,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  JSON: 114,
  FLOAT4: 700,
  FLOAT8: 701,
  BPCHAR: 1042,
  VARCHAR: 1043,
  DATE: 1082,
  TIMESTAMP: 1114,
  NUMERIC: 1700,
  TIMESTAMPTZ: 1184,
  JSONB: 3802,
} as const;

/**
 * Map a pg field OID to the ETL value kind. Unknown OIDs fall through to
 * `text` (pass-through) — a new pg column type on a mapped table shows up
 * as a schema-drift failure at the column-set check, not as mangled data.
 */
export function kindForOid(oid: number): PgValueKind {
  switch (oid) {
    case OID.BOOL:
      return 'boolean';
    case OID.INT2:
    case OID.INT4:
    case OID.INT8:
      return 'int';
    case OID.FLOAT4:
    case OID.FLOAT8:
      return 'float';
    case OID.DATE:
      return 'date';
    case OID.TIMESTAMP:
    case OID.TIMESTAMPTZ:
      return 'timestamp';
    case OID.NUMERIC:
      return 'numeric-text';
    case OID.JSON:
    case OID.JSONB:
      return 'jsonb';
    default:
      return 'text';
  }
}

/** Field descriptor for one column of one table. */
export interface ColumnKind {
  readonly name: string;
  readonly kind: PgValueKind;
}

// ---------------------------------------------------------------------------
// Error reporting — loud, aggregated, capped
// ---------------------------------------------------------------------------

const MAX_LISTED_ROWS = 20;

/** Aggregated ETL failure: every offending row is listed, never just the first. */
export class EtlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtlValidationError';
  }
}

interface OffendingRow {
  readonly table: string;
  readonly column: string;
  readonly rowKey: string;
  readonly value: string;
  readonly reason: string;
}

/** Render a value for error messages — bounded, single-line, repr-style. */
function repr(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}…` : value);
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 120);
  return String(value);
}

function throwAggregated(table: string, rows: readonly OffendingRow[]): void {
  if (rows.length === 0) return;
  const listed = rows
    .slice(0, MAX_LISTED_ROWS)
    .map((r) => `  ${r.table}.${r.column} row [${r.rowKey}]: ${r.value} — ${r.reason}`);
  const more = rows.length > MAX_LISTED_ROWS ? `\n  … and ${rows.length - MAX_LISTED_ROWS} more` : '';
  throw new EtlValidationError(
    `ETL validation FAILED — ${rows.length} offending row value(s) in "${table}" ` +
      `(the ETL never maps unknown values silently):\n${listed.join('\n')}${more}`,
  );
}

// ---------------------------------------------------------------------------
// Value transforms — pure, fixture-testable (unit tests feed these directly)
// ---------------------------------------------------------------------------

export interface TransformedValue {
  /** SQL literal text for the emitted INSERT (NULL / number / 'text'). */
  readonly sql: string;
  /** JSONL-native value (numbers unquoted, booleans already 0/1 ints). */
  readonly json: unknown;
}

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseTimestamp(value: unknown, where: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new EtlValidationError(`invalid pg timestamp (NaN Date) at ${where}`);
    }
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new EtlValidationError(`pg timestamp is not parseable: ${repr(value)} at ${where}`);
    }
    return parsed.toISOString();
  }
  throw new EtlValidationError(
    `pg timestamp must be a Date or ISO string, got ${typeof value} (${repr(value)}) at ${where}`,
  );
}

/**
 * Transform one pg value into its D1 representation. Throws
 * EtlValidationError on any value that has no exact D1 counterpart —
 * the caller aggregates per-row errors so a single run reports everything.
 */
export function transformValue(kind: PgValueKind, value: unknown, where: string): TransformedValue {
  if (value === null || value === undefined) {
    return { sql: 'NULL', json: null };
  }
  switch (kind) {
    case 'int': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n) || !Number.isSafeInteger(n)) {
        throw new EtlValidationError(`expected integer, got ${repr(value)} at ${where}`);
      }
      return { sql: String(n), json: n };
    }
    case 'float': {
      const n = typeof value === 'number' ? value : Number(value);
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new EtlValidationError(`expected finite float, got ${repr(value)} at ${where}`);
      }
      return { sql: String(n), json: n };
    }
    case 'numeric-text': {
      // pg numeric arrives as a string (exact decimal). Emit the validated
      // text verbatim as a REAL literal — no float round-trip on the text.
      const text = typeof value === 'number' ? String(value) : value;
      if (typeof text !== 'string' || !PLAIN_DECIMAL.test(text)) {
        throw new EtlValidationError(`pg numeric is not a plain decimal: ${repr(value)} at ${where}`);
      }
      return { sql: text, json: Number(text) };
    }
    case 'text': {
      if (typeof value !== 'string') {
        throw new EtlValidationError(`expected text, got ${typeof value} (${repr(value)}) at ${where}`);
      }
      return { sql: `'${value.replace(/'/g, "''")}'`, json: value };
    }
    case 'boolean': {
      // Tri-state preserved: true→1, false→0, null→NULL (handled above).
      if (typeof value !== 'boolean') {
        throw new EtlValidationError(`expected boolean, got ${typeof value} (${repr(value)}) at ${where}`);
      }
      return { sql: value ? '1' : '0', json: value ? 1 : 0 };
    }
    case 'timestamp':
      return { sql: `'${parseTimestamp(value, where)}'`, json: parseTimestamp(value, where) };
    case 'date': {
      if (value instanceof Date) {
        return { sql: `'${value.toISOString().slice(0, 10)}'`, json: value.toISOString().slice(0, 10) };
      }
      if (typeof value !== 'string' || !PLAIN_DATE.test(value)) {
        throw new EtlValidationError(`pg date must be 'YYYY-MM-DD', got ${repr(value)} at ${where}`);
      }
      return { sql: `'${value}'`, json: value };
    }
    case 'jsonb': {
      // pg jsonb arrives parsed; a raw string is re-parsed so the emitted
      // TEXT is canonical JSON either way.
      let obj: unknown = value;
      if (typeof value === 'string') {
        try {
          obj = JSON.parse(value);
        } catch {
          throw new EtlValidationError(`jsonb string is not valid JSON at ${where}`);
        }
      }
      if (typeof obj !== 'object' || obj === null) {
        throw new EtlValidationError(`jsonb must decode to an object/array, got ${repr(obj)} at ${where}`);
      }
      return { sql: `'${JSON.stringify(obj).replace(/'/g, "''")}'`, json: JSON.stringify(obj) };
    }
  }
}

/**
 * Validate one CHECK-constrained text value against its migration value
 * set. Unknown value → offending-row entry (aggregated, loud).
 */
export function checkEnumValue(
  table: string,
  column: string,
  allowed: readonly string[],
  value: unknown,
  rowKey: string,
): OffendingRow | null {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return {
      table,
      column,
      rowKey,
      value: repr(value),
      reason: `not in the D1 CHECK set (${allowed.join(', ')})`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row transforms
// ---------------------------------------------------------------------------

export interface TransformedRow {
  /** D1 column names in emission order (from the D1 schema). */
  readonly columns: readonly string[];
  /** SQL value tuples, batch-ready. */
  readonly tuples: readonly (readonly string[])[];
  /** JSONL rows (header/value objects) aligned with `columns`. */
  readonly jsonRows: readonly Record<string, unknown>[];
}

/**
 * Transform a batch of raw pg rows for one table.
 *
 * Fails loudly on:
 *  - schema drift (pg result columns ≠ D1 schema columns), and
 *  - any value that has no exact D1 counterpart, and
 *  - any CHECK-constrained value outside its migration value set.
 */
export function transformRows(
  spec: { name: string; columns: readonly string[] },
  columnKinds: ReadonlyMap<string, PgValueKind>,
  pgRows: readonly Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string,
  /** The pg result's field names — the authority for the drift check
   *  (row keys vanish on an empty table; field metadata does not). */
  pgFields: readonly string[],
): TransformedRow {
  const d1ColumnNames = spec.columns;

  // Schema drift — fail before transforming anything. Compared against the
  // pg FIELD METADATA, not row keys (an empty table still has fields).
  const pgFieldSet = new Set(pgFields);
  const missingInPg = d1ColumnNames.filter((c) => !pgFieldSet.has(c));
  const unexpectedInPg = [...pgFieldSet].filter((c) => !d1ColumnNames.includes(c));
  if (missingInPg.length > 0 || unexpectedInPg.length > 0) {
    throw new EtlValidationError(
      `schema drift for "${spec.name}": D1 columns missing in pg result [${missingInPg.join(', ')}]; ` +
        `pg columns absent from D1 schema [${unexpectedInPg.join(', ')}] — update the ETL registry`,
    );
  }

  const checkSets = CHECK_VALUE_SETS[spec.name] ?? {};
  const offenders: OffendingRow[] = [];
  const tuples: string[][] = [];
  const jsonRows: Record<string, unknown>[] = [];

  for (const row of pgRows) {
    const rowKey = keyOf(row);

    // CHECK validation runs on the RAW pg values (text columns), so an
    // unknown enum value is named exactly as Postgres stored it.
    for (const [column, allowed] of Object.entries(checkSets)) {
      const offender = checkEnumValue(spec.name, column, allowed, row[column], rowKey);
      if (offender) offenders.push(offender);
    }

    const tuple: string[] = [];
    const jsonRow: Record<string, unknown> = {};
    for (const columnName of d1ColumnNames) {
      const kind = columnKinds.get(columnName);
      if (!kind) {
        throw new EtlValidationError(
          `no pg type kind for "${spec.name}"."${columnName}" — the ETL column-kind map is incomplete`,
        );
      }
      try {
        const transformed = transformValue(kind, row[columnName], `${spec.name}.${columnName} [${rowKey}]`);
        tuple.push(transformed.sql);
        jsonRow[columnName] = transformed.json;
      } catch (error) {
        offenders.push({
          table: spec.name,
          column: columnName,
          rowKey,
          value: repr(row[columnName]),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    tuples.push(tuple);
    jsonRows.push(jsonRow);
  }

  throwAggregated(spec.name, offenders);
  return { columns: d1ColumnNames, tuples, jsonRows };
}

/**
 * Deterministic emission order for `sessions`: parent session rows must be
 * INSERTed before the rows referencing them (`rotated_from_id` FK).
 * Rows without a predecessor first (by id), then rows whose parent is
 * already placed — a cycle or a dangling reference is a hard error.
 */
export function orderSessionsByRotation(
  rows: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
  const placed = new Set<number>();
  const ordered: Record<string, unknown>[] = [];

  const emitRow = (row: Record<string, unknown>): void => {
    const id = Number(row['id']);
    if (placed.has(id)) return;
    ordered.push(row);
    placed.add(id);
  };

  // Pass 1 — roots (no predecessor).
  for (const row of rows) {
    if (row['rotated_from_id'] === null || row['rotated_from_id'] === undefined) emitRow(row);
  }
  // Pass 2..n — children whose parent is already placed.
  let progressed = true;
  while (ordered.length < rows.length && progressed) {
    progressed = false;
    for (const row of rows) {
      const id = Number(row['id']);
      if (placed.has(id)) continue;
      const parent = row['rotated_from_id'];
      if (parent === null || parent === undefined || placed.has(Number(parent))) {
        emitRow(row);
        progressed = true;
      }
    }
  }
  if (ordered.length < rows.length) {
    const stuck = rows.filter((r) => !placed.has(Number(r['id']))).map((r) => r['id']);
    throw new EtlValidationError(
      `sessions rotation chain is not orderable (cycle or dangling rotated_from_id) for ids: ${stuck.join(', ')}`,
    );
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// SQL / JSONL emission
// ---------------------------------------------------------------------------

/** Render one row tuple as `(v1, v2, …)`. */
function renderTuple(tuple: readonly string[]): string {
  return `(${tuple.join(', ')})`;
}

/** Multi-row INSERT OR IGNORE statements, at most `batchSize` rows each. */
export function buildInsertStatements(
  tableName: string,
  columns: readonly string[],
  tuples: readonly (readonly string[])[],
  batchSize: number,
): string[] {
  if (tuples.length === 0) return [];
  const columnList = columns.map((c) => `"${c}"`).join(', ');
  const statements: string[] = [];
  for (let i = 0; i < tuples.length; i += batchSize) {
    const chunk = tuples.slice(i, i + batchSize);
    statements.push(
      `INSERT OR IGNORE INTO "${tableName}" (${columnList}) VALUES\n${chunk.map(renderTuple).join(',\n')};`,
    );
  }
  return statements;
}

/** JSONL text for `wrangler d1 import`: header line, then one object per row. */
export function buildImportJsonl(columns: readonly string[], jsonRows: readonly Record<string, unknown>[]): string {
  if (jsonRows.length === 0) return '';
  const header = JSON.stringify(columns);
  return [header, ...jsonRows.map((row) => JSON.stringify(row))].join('\n') + '\n';
}

/** File header comment explaining the artifact's provenance and use. */
function tableFileHeader(spec: TableSpec, rowCount: number, format: 'sql' | 'jsonl'): string {
  return [
    '-- ===========================================================================',
    `-- Cutover ETL artifact: ${spec.name} (${rowCount} rows, ${format}).`,
    '-- Task 6.6 (change migrate-to-cloudflare). Generated by',
    '-- scripts/etl-pg-to-d1.ts from the source Postgres database.',
    '-- Byte-deterministic; explicit ids preserved; INSERT OR IGNORE makes',
    '-- re-imports idempotent. Apply AFTER the D1 migrations, in manifest order.',
    '-- ===========================================================================',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Observations → R2 layout
// ---------------------------------------------------------------------------

/** pg price_observations row → the exact ObservationLogRecord field set. */
export function buildObservationRecord(
  pgRow: Record<string, unknown>,
  where: string,
  /** pg field names for the drift check (defaults to the row's own keys). */
  pgFields: readonly string[] = Object.keys(pgRow),
): ObservationLogRecord {
  const offenders: OffendingRow[] = [];
  const record: Record<string, unknown> = {};

  const setField = (field: keyof ObservationLogRecord, kind: PgValueKind): void => {
    try {
      const transformed = transformValue(kind, pgRow[field], `${OBSERVATIONS_TABLE}.${field} [${where}]`);
      // jsonb values stay structured in the log record (the serializer
      // stringifies the whole line once) — undo the JSON-text form.
      record[field] =
        kind === 'jsonb' && typeof transformed.json === 'string'
          ? JSON.parse(transformed.json)
          : transformed.json;
    } catch (error) {
      offenders.push({
        table: OBSERVATIONS_TABLE,
        column: field,
        rowKey: where,
        value: repr(pgRow[field]),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  setField('id', 'int');
  setField('product_id', 'int');
  setField('merchant', 'text');
  setField('retail_offer_id', 'int');
  setField('observed_at', 'timestamp');
  setField('foreign_retail_price_cents', 'int');
  setField('transport_cost_cents', 'int');
  setField('transport_offer_id', 'int');
  setField('excise_rule_version_id', 'int');
  setField('container_duty_rule_version_id', 'int');
  setField('landed_cost_cents', 'int');
  setField('input_reliability', 'jsonb');
  setField('confidence', 'text');

  // Field-set drift: the record must carry exactly the pg columns.
  const expected = new Set(Object.keys(record));
  const actual = new Set(pgFields);
  const missing = [...expected].filter((f) => !actual.has(f));
  const extra = [...actual].filter((f) => !expected.has(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new EtlValidationError(
      `schema drift for "${OBSERVATIONS_TABLE}": missing [${missing.join(', ')}]; unexpected [${extra.join(', ')}]`,
    );
  }

  const confidence = checkEnumValue(
    OBSERVATIONS_TABLE,
    OBSERVATION_CONFIDENCE_COLUMN,
    CONFIDENCE_VALUES,
    pgRow[OBSERVATION_CONFIDENCE_COLUMN],
    where,
  );
  if (confidence) offenders.push(confidence);

  throwAggregated(OBSERVATIONS_TABLE, offenders);
  return record as unknown as ObservationLogRecord;
}

/** Group observation records into R2 date partitions (insertion-ordered lines). */
export function groupObservationPartitions(
  records: readonly ObservationLogRecord[],
): Map<string, string[]> {
  const partitions = new Map<string, string[]>();
  for (const record of records) {
    const key = observationObjectKey(record.observed_at);
    const lines = partitions.get(key) ?? [];
    lines.push(serializeObservationLine(record));
    partitions.set(key, lines);
  }
  return partitions;
}

// ---------------------------------------------------------------------------
// Verification artifacts
// ---------------------------------------------------------------------------

/**
 * Post-import per-table COUNT(*) query (single row, one field per table).
 * Runs against D1 after `wrangler d1 import` — D1 tables only; the R2
 * observation log has no D1 row count (its verification is the manifest's
 * partition line counts against `wrangler r2 object` sizes).
 */
export function buildVerifySql(tableNames: readonly string[]): string {
  const d1Tables = tableNames.filter((t) => t !== OBSERVATIONS_TABLE);
  if (d1Tables.length === 0) return '-- (no D1 tables selected — nothing to verify in D1)\n';
  const selects = d1Tables
    .map((t, i) => `  (SELECT COUNT(*) FROM "${t}") AS "${t}_total"${i < d1Tables.length - 1 ? ',' : ''}`)
    .join('\n');
  return `SELECT\n${selects}\n`;
}

export interface TableManifestEntry {
  rowsIn: number;
  rowsEmitted: number;
  file: string;
  bytes: number;
  sha256: string;
}

export interface ObservationPartitionEntry {
  lines: number;
  bytes: number;
  sha256: string;
}

export interface EtlManifest {
  source: string;
  format: 'sql' | 'jsonl';
  batchSize: number;
  tables: Record<string, TableManifestEntry>;
  observations: { rowsIn: number; partitions: Record<string, ObservationPartitionEntry> } | null;
}

// ---------------------------------------------------------------------------
// Emission core — reads pg, validates, returns artifacts + manifest
// ---------------------------------------------------------------------------

/** Minimal pg surface this module consumes (structural, for tests). */
export interface PgQueryResult {
  rows: Record<string, unknown>[];
  fields: ReadonlyArray<{ name: string; dataTypeID: number }>;
}

export interface PgClientLike {
  query(text: string): Promise<PgQueryResult>;
}

/**
 * Read one table (PK-ordered) and return raw rows + per-column kinds.
 * `SELECT *` keeps the column set honest — the drift check sees exactly
 * what Postgres has, not what the ETL assumes it has.
 */
async function readTable(client: PgClientLike, spec: TableSpec): Promise<PgQueryResult> {
  const orderClause = spec.orderBy.map((c) => `"${c}" ASC`).join(', ');
  return client.query(`SELECT * FROM "${spec.name}" ORDER BY ${orderClause}`);
}

/** Build the per-column kind map from the pg result field OIDs. */
export function columnKindsFromResult(result: PgQueryResult): Map<string, PgValueKind> {
  return new Map(result.fields.map((f) => [f.name, kindForOid(f.dataTypeID)]));
}

function keyForSpec(spec: TableSpec): (row: Record<string, unknown>) => string {
  return (row) => spec.orderBy.map((c) => String(row[c])).join('@');
}

/** sha256 + byte length of a UTF-8 payload. */
function fingerprint(body: string): { bytes: number; sha256: string } {
  const buf = Buffer.from(body, 'utf8');
  return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

export interface EtlRunOptions {
  format: 'sql' | 'jsonl';
  batchSize: number;
  /** Registry subset to process (default: everything). */
  tables?: readonly string[];
  /** Sanitized source description for the manifest (host/database only). */
  source: string;
}

export interface EtlRunResult {
  manifest: EtlManifest;
  /** file name → body, in apply order (observations are separate keys `observations/…`). */
  files: Map<string, string>;
  verifySql: string;
}

/**
 * Full in-memory ETL run: read → transform → validate → emit. No I/O
 * beyond the pg reads, so the same function serves --dry-run, real runs,
 * and the test suite.
 */
export async function runEtl(client: PgClientLike, options: EtlRunOptions): Promise<EtlRunResult> {
  const selected = TABLE_REGISTRY.filter(
    (t) => !options.tables || options.tables.includes(t.name),
  );
  const includeObservations =
    (!options.tables || options.tables.includes(OBSERVATIONS_TABLE));

  const files = new Map<string, string>();
  const manifestTables: Record<string, TableManifestEntry> = {};
  const verifyTables: string[] = [];

  for (const spec of selected) {
    const result = await readTable(client, spec);
    const kinds = columnKindsFromResult(result);

    // sessions: rotation chains must insert parents before children (FK
    // order) — reorder the raw rows before transformation.
    const sourceRows =
      spec.name === 'sessions' ? orderSessionsByRotation(result.rows) : result.rows;

    const transformed = transformRows(spec, kinds, sourceRows, keyForSpec(spec), result.fields.map((f) => f.name));

    const fileBase = `${String(TABLE_REGISTRY.indexOf(spec) + 1).padStart(2, '0')}-${spec.name}.d1`;
    const body =
      options.format === 'sql'
        ? tableFileHeader(spec, transformed.tuples.length, 'sql') +
          buildInsertStatements(spec.name, transformed.columns, transformed.tuples, options.batchSize).join('\n\n') +
          '\n'
        : buildImportJsonl(transformed.columns, transformed.jsonRows);

    const fileName = options.format === 'sql' ? `${fileBase}.sql` : `${fileBase}.jsonl`;
    files.set(fileName, body);
    manifestTables[spec.name] = {
      rowsIn: result.rows.length,
      rowsEmitted: transformed.tuples.length,
      file: fileName,
      ...fingerprint(body),
    };
    verifyTables.push(spec.name);
  }

  let observationsManifest: EtlManifest['observations'] = null;
  if (includeObservations) {
    const result = await client.query(
      `SELECT * FROM "${OBSERVATIONS_TABLE}" ORDER BY "observed_at" ASC, "id" ASC`,
    );
    const observationFieldNames = result.fields.map((f) => f.name);
    const records = result.rows.map((row, i) =>
      buildObservationRecord(row, `${row['id']}@${String(row['observed_at'])} (#${i})`, observationFieldNames),
    );
    const partitions = groupObservationPartitions(records);
    const partitionEntries: Record<string, ObservationPartitionEntry> = {};
    for (const [key, lines] of [...partitions.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const body = lines.map((l) => `${l}\n`).join('');
      files.set(key, body);
      partitionEntries[key] = { lines: lines.length, ...fingerprint(body) };
    }
    observationsManifest = { rowsIn: result.rows.length, partitions: partitionEntries };
  }

  const manifest: EtlManifest = {
    source: options.source,
    format: options.format,
    batchSize: options.batchSize,
    tables: manifestTables,
    observations: observationsManifest,
  };
  return { manifest, files, verifySql: buildVerifySql(verifyTables) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  pgUrl?: string;
  outDir: string;
  format: 'sql' | 'jsonl';
  batchSize: number;
  tables: string[];
  dryRun: boolean;
}

function usage(): string {
  return [
    'Usage: pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/etl-pg-to-d1.ts [options]',
    '',
    'Connection:',
    '  --pg-url <url>     source Postgres URL (else $TEST_DATABASE_URL, else $DATABASE_URL).',
    '                     Never printed — only host/database appears in output.',
    '',
    'Options:',
    '  --out <dir>        output directory (default: <os tmp>/rajahinta-etl)',
    '  --format <f>       sql (wrangler d1 execute / import) | jsonl (wrangler d1 import). Default: sql',
    '  --table <name>     repeatable; process only these tables (18 D1 names or',
    `                     "${OBSERVATIONS_TABLE}" for the R2 observation log). Default: all`,
    '  --batch-size <n>   rows per INSERT statement (default 100)',
    '  --dry-run          validate + count only; write nothing',
    '  -h, --help         this help',
    '',
    'After a real run: import the NN-*.sql files with `wrangler d1 execute DB --file`',
    '(or `wrangler d1 import` for JSONL), upload observations/*.jsonl to the R2',
    'observation bucket, then run 99-verify.sql against D1 and compare with',
    '00-manifest.json. See docs/cutover-runbook.md.',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    outDir: join(resolve('/tmp'), 'rajahinta-etl'),
    format: 'sql',
    batchSize: 100,
    tables: [],
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--pg-url':
        options.pgUrl = argv[++i];
        break;
      case '--out':
        options.outDir = resolve(argv[++i]);
        break;
      case '--format':
        options.format = argv[++i] as CliOptions['format'];
        if (options.format !== 'sql' && options.format !== 'jsonl') {
          console.error(`--format must be "sql" or "jsonl" (got ${options.format})\n\n${usage()}`);
          process.exit(2);
        }
        break;
      case '--table':
        options.tables.push(argv[++i]);
        break;
      case '--batch-size': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
          console.error(`--batch-size must be an integer in [1, 1000]\n\n${usage()}`);
          process.exit(2);
        }
        options.batchSize = n;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-h':
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}\n\n${usage()}`);
        process.exit(2);
    }
  }
  const unknown = options.tables.filter((t) => !KNOWN_TABLES.includes(t));
  if (unknown.length > 0) {
    console.error(`Unknown --table value(s): ${unknown.join(', ')}\nValid: ${KNOWN_TABLES.join(', ')}\n`);
    process.exit(2);
  }
  return options;
}

/** host/database only — credentials never leave the process. */
export function sanitizePgUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(redacted)';
  }
}

/** pg column type OIDs the driver must NOT post-process into Dates. */
function installPgParsers(pgModule: {
  types: { setTypeParser(id: number, fn: (v: string) => unknown): void };
}): void {
  // pg `date` (1082) → keep the raw 'YYYY-MM-DD' text. The default parser
  // builds a local-midnight Date, which toISOString() can shift across a
  // day boundary in non-UTC environments — the raw string is exact.
  pgModule.types.setTypeParser(OID.DATE, (v: string) => v);
}

/** Resolve data-platform dependencies (pg) from the package's own node_modules. */
const requireFromDataPlatform = createRequire(
  fileURLToPath(new URL('../packages/data-platform/package.json', import.meta.url)),
);

async function loadPgClient(
  url: string,
): Promise<PgClientLike & { end(): Promise<void> }> {
  // `pg` is a data-platform dependency — resolve it from there so the
  // script runs from the repo root without a root-level pg install.
  const pgModule = requireFromDataPlatform('pg') as unknown as Parameters<typeof installPgParsers>[0];
  installPgParsers(pgModule);
  const { Client } = requireFromDataPlatform('pg') as {
    Client: new (config: { connectionString: string }) => PgClientLike & {
      connect(): Promise<void>;
      end(): Promise<void>;
    };
  };
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pgUrl = options.pgUrl ?? process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!pgUrl) {
    console.error('No Postgres URL: pass --pg-url or set TEST_DATABASE_URL / DATABASE_URL.\n');
    process.exit(2);
  }
  process.env['TZ'] = 'UTC'; // pg timestamp (without tz) parsing must be UTC-deterministic.

  console.log(`[etl] source: ${sanitizePgUrl(pgUrl)} (credentials redacted)`);
  const client = await loadPgClient(pgUrl);
  try {
    const started = Date.now();
    const { manifest, files, verifySql } = await runEtl(client, {
      format: options.format,
      batchSize: options.batchSize,
      tables: options.tables.length > 0 ? options.tables : undefined,
      source: sanitizePgUrl(pgUrl),
    });

    console.log('[etl] row counts (in → out):');
    for (const [table, entry] of Object.entries(manifest.tables)) {
      const marker = entry.rowsIn === entry.rowsEmitted ? 'ok' : 'MISMATCH';
      console.log(`  ${marker}  ${table}: ${entry.rowsIn} → ${entry.rowsEmitted} (${entry.file}, sha256 ${entry.sha256.slice(0, 12)}…)`);
    }
    if (manifest.observations) {
      const partitions = Object.entries(manifest.observations.partitions);
      const lines = partitions.reduce((sum, [, p]) => sum + p.lines, 0);
      console.log(
        `  ${manifest.observations.rowsIn === lines ? 'ok' : 'MISMATCH'}  ${OBSERVATIONS_TABLE}: ` +
          `${manifest.observations.rowsIn} → ${lines} JSONL lines across ${partitions.length} R2 partition(s) (R2 layout — never enters D1)`,
      );
      for (const [key, p] of partitions) {
        console.log(`         ${key}: ${p.lines} lines (sha256 ${p.sha256.slice(0, 12)}…)`);
      }
    }

    if (options.dryRun) {
      console.log('[etl] dry-run — validation and counts only, nothing written.');
      return;
    }

    mkdirSync(options.outDir, { recursive: true });
    for (const [name, body] of files) {
      const path = join(options.outDir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(body, 'utf8'));
    }
    const verifyPath = join(options.outDir, '99-verify.sql');
    writeFileSync(verifyPath, Buffer.from(verifySql, 'utf8'));
    const manifestPath = join(options.outDir, '00-manifest.json');
    writeFileSync(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

    console.log(`[etl] wrote ${files.size} data file(s) + manifest + verify query to ${options.outDir}`);
    console.log('[etl] next: apply D1 migrations, import the files in name order, run 99-verify.sql,');
    console.log('[etl] upload observations/*.jsonl to the R2 bucket — full sequence in docs/cutover-runbook.md.');
    console.log(`[etl] done in ${Date.now() - started} ms.`);
  } finally {
    await client.end();
  }
}

/** Run only when invoked directly (tests import the module for its exports). */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (error instanceof EtlValidationError) {
      console.error(`[etl] ${error.message}`);
    } else {
      console.error(`[etl] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
    }
    process.exit(1);
  });
}
