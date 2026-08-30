/**
 * Deterministic D1 seed SQL generator (task 2.6, change
 * migrate-to-cloudflare).
 *
 * Emits plain `.sql` files for `wrangler d1 execute --file` AND the string
 * inputs for the node:sqlite apply path — both consume the exact same
 * generated text, so there is one seed artifact, not two.
 *
 * Sources of truth (nothing is duplicated here):
 * - Tax rules: `SEED_RULES` from `../tax-rules.seed` (v1.0-2024 … v3.0-2026).
 * - Staging data: `./staging-fixtures` (ported from infra/staging-data/seed.sql).
 * - Column names: derived at runtime from the sqliteTable definitions in
 *   `../../d1/schema` via drizzle's getTableColumns — a schema rename fails
 *   this generator loudly instead of silently mis-seeding.
 *
 * Determinism: output is a pure function of the sources above — no
 * wall-clock timestamps, no Math.random, stable iteration order. Two runs
 * produce byte-identical files (asserted by the test suite), so CI can
 * regenerate before every apply and diff with confidence.
 *
 * Idempotency (re-running never duplicates the versioned tax dataset):
 * - tax_rules: whole-version guard. Each version label's rows are inserted
 *   under `WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE version_label =
 *   …)` — mirrors seedTaxRules on the pg side: a present label is skipped
 *   entirely; existing rows are never mutated or repaired (append-only
 *   dataset policy).
 * - staging tables: explicit primary-key ids + `INSERT OR IGNORE`, so a
 *   re-run hits the PK conflict and inserts nothing.
 *
 * @module Seed/D1
 */
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { taxRules, transportOffers, productMaster, retailOffers } from '../../d1/schema';
import { SEED_RULES } from '../tax-rules.seed';
import {
  STAGING_PRODUCTS,
  STAGING_RETAIL_OFFERS,
  STAGING_REVIEWS,
  STAGING_TRANSPORT_OFFERS,
} from './staging-fixtures';

// ---------------------------------------------------------------------------
// SQL text helpers
// ---------------------------------------------------------------------------

/** Escape a string for a single-quoted SQL literal. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Emit a REAL literal from the seed's numeric-string rate ("28.75" → 28.75). */
function sqlNumericString(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`seed rate is not a plain numeric string: "${value}"`);
  }
  return value;
}

function sqlNullable<T>(value: T | null | undefined, render: (v: T) => string): string {
  return value === null || value === undefined ? 'NULL' : render(value);
}

function sqlBool(value: boolean): string {
  return value ? '1' : '0';
}

/**
 * Map drizzle column property names → physical SQL column names for a D1
 * schema table. Throws when a property does not exist, so any drift
 * between this generator and src/d1/schema.ts fails at generation time.
 */
function sqlColumns(table: SQLiteTable, properties: readonly string[]): string[] {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return properties.map((property) => {
    const column = columns[property];
    if (!column) {
      throw new Error(
        `D1 schema table has no column property "${property}" — ` +
          `update seed/d1/generate.ts to match src/d1/schema.ts`,
      );
    }
    return column.name;
  });
}

/** Render a column list: `"tax_type", "product_category", …`. */
function columnList(names: string[]): string {
  return names.map((n) => `"${n}"`).join(', ');
}

// ---------------------------------------------------------------------------
// File 1 — versioned tax rules (version-guarded, whole-label insert)
// ---------------------------------------------------------------------------

/** Column properties of a tax_rules seed row, in emission order. */
const TAX_RULE_PROPERTIES = [
  'id',
  'taxType',
  'productCategory',
  'rate',
  'effectiveFrom',
  'effectiveTo',
  'exemptionConditions',
  'calculationFormulaReference',
  'officialSource',
  'verificationDate',
  'versionLabel',
] as const;

/**
 * Group SEED_RULES by version label preserving first-seen order, with each
 * rule's deterministic explicit id (position in SEED_RULES + 1).
 */
function groupedTaxRules(): Array<{ versionLabel: string; rows: Array<{ id: number; rule: (typeof SEED_RULES)[number] }> }> {
  const groups = new Map<string, Array<{ id: number; rule: (typeof SEED_RULES)[number] }>>();
  SEED_RULES.forEach((rule, index) => {
    const group = groups.get(rule.versionLabel) ?? [];
    group.push({ id: index + 1, rule });
    groups.set(rule.versionLabel, group);
  });
  return Array.from(groups, ([versionLabel, rows]) => ({ versionLabel, rows }));
}

function taxRuleValueRow(id: number, rule: (typeof SEED_RULES)[number]): string {
  return [
    String(id),
    sqlString(rule.taxType),
    sqlString(rule.productCategory),
    sqlNumericString(rule.rate),
    sqlString(rule.effectiveFrom.toISOString()),
    sqlNullable(rule.effectiveTo, (d) => sqlString(d.toISOString())),
    sqlNullable(rule.exemptionConditions, (json) => sqlString(JSON.stringify(json))),
    sqlString(rule.calculationFormulaReference),
    sqlString(rule.officialSource),
    sqlNullable(rule.verificationDate, (d) => sqlString(d.toISOString())),
    sqlString(rule.versionLabel),
  ].join(', ');
}

/**
 * Generate the tax-rules seed file: one version-guarded INSERT per version
 * label, rows carrying explicit deterministic ids in SEED_RULES order.
 * `created_at` is omitted and takes the column default, exactly like the
 * pg-side seed.
 */
export function generateTaxRulesSql(): string {
  const columnNames = sqlColumns(taxRules, TAX_RULE_PROPERTIES);
  const lines: string[] = [
    '-- ===========================================================================',
    '-- D1 seed: versioned Finnish excise + container-duty tax rules',
    '-- Task 2.6 (change migrate-to-cloudflare).',
    '--',
    '-- Source of truth: packages/data-platform/src/seed/tax-rules.seed.ts (SEED_RULES).',
    '-- Generated by packages/data-platform/src/seed/d1/generate.ts. Output is',
    '-- byte-deterministic (no timestamps) — regenerate with the',
    '-- db:seed:d1:generate script; never edit by hand.',
    '--',
    '-- Idempotency: each version label is inserted only when the label is',
    '-- absent from tax_rules (whole-version guard, mirroring seedTaxRules).',
    '-- Present labels are never mutated, repaired, or duplicated — append-only',
    '-- dataset policy. Applies AFTER the D1 migrations.',
    '-- ===========================================================================',
    '',
  ];

  for (const { versionLabel, rows } of groupedTaxRules()) {
    lines.push(
      `INSERT INTO "tax_rules" (${columnList(columnNames)})`,
      `SELECT * FROM (VALUES`,
      rows.map(({ id, rule }) => `  (${taxRuleValueRow(id, rule)})`).join(',\n'),
      `)`,
      `WHERE NOT EXISTS (`,
      `  SELECT 1 FROM "tax_rules" WHERE "version_label" = ${sqlString(versionLabel)}`,
      `);`,
      '',
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File 2 — staging data (explicit ids + INSERT OR IGNORE)
// ---------------------------------------------------------------------------

interface StagingTableSpec {
  /** Physical table name (staging_reviews is staging-infra, not in schema.ts). */
  tableName: string;
  /** Column properties in emission order — names resolved from schema.ts where the table exists there. */
  properties: readonly string[];
  /** `false` for staging_reviews: column names are given literally. */
  fromSchemaTable?: SQLiteTable;
}

const TRANSPORT_SPEC: StagingTableSpec = {
  tableName: 'transport_offers',
  properties: ['id', 'carrier', 'originCountry', 'destinationCountry', 'weightMinKg', 'weightMaxKg', 'packageTier', 'priceCents', 'currency', 'sellerInvolvementIndicator', 'refreshedAt', 'reliabilityStatus'],
  fromSchemaTable: transportOffers,
};

const PRODUCT_SPEC: StagingTableSpec = {
  tableName: 'product_master',
  properties: ['id', 'name', 'manufacturer', 'brand', 'category', 'alcoholByVolume', 'unitVolume', 'containerType', 'regulatoryClassification', 'depositSystemStatus', 'ean'],
  fromSchemaTable: productMaster,
};

const RETAIL_OFFER_SPEC: StagingTableSpec = {
  tableName: 'retail_offers',
  properties: ['id', 'merchant', 'country', 'productId', 'priceCents', 'currency', 'availability', 'sourceUrl', 'reliabilityStatus'],
  fromSchemaTable: retailOffers,
};

const STAGING_REVIEW_SPEC: StagingTableSpec = {
  // Staging-infra table — no Drizzle equivalent (see staging-fixtures.ts);
  // column names mirror infra/staging-data/staging-reviews.sql.
  tableName: 'staging_reviews',
  properties: ['id', 'reviewLabel', 'previousVersionId', 'proposedVersionId', 'reviewer', 'status', 'createdAt'],
};

/**
 * Emit one idempotent multi-row INSERT OR IGNORE for a staging table.
 * Values are supplied as a render callback per row so each fixture type
 * keeps its own property→literal mapping explicit.
 */
function emitInsertOrIgnore(
  spec: StagingTableSpec,
  rows: string[][],
  renderComment: string,
): string[] {
  const columnNames = spec.fromSchemaTable
    ? sqlColumns(spec.fromSchemaTable, spec.properties)
    : spec.properties.map((property) =>
        // staging_reviews: camelCase property → snake_case column, 1:1 with the pg DDL.
        property.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      );
  return [
    `-- ${renderComment}`,
    `INSERT OR IGNORE INTO "${spec.tableName}" (${columnList(columnNames)})`,
    `VALUES`,
    rows.map((cells) => `  (${cells.join(', ')})`).join(',\n') + ';',
    '',
  ];
}

/**
 * Generate the staging seed file: the staging-infra `staging_reviews` DDL
 * (SQLite form of infra/staging-data/staging-reviews.sql, which the pg
 * deploy applies after migrations) followed by the fixture data in FK-safe
 * order: transport offers → products → retail offers → reviews.
 */
export function generateStagingSql(): string {
  const lines: string[] = [
    '-- ===========================================================================',
    '-- D1 seed: staging fixture data (task 2.6, change migrate-to-cloudflare).',
    '--',
    '-- Source of truth: infra/staging-data/seed.sql, ported in',
    '-- packages/data-platform/src/seed/d1/staging-fixtures.ts (see that module',
    '-- for the two documented normalizations: container-type vocabulary and',
    '-- EXACT→VERIFIED reliability). Generated by seed/d1/generate.ts —',
    '-- byte-deterministic, regenerate with db:seed:d1:generate.',
    '--',
    '-- Idempotency: every row carries an explicit primary-key id and is',
    '-- inserted with INSERT OR IGNORE — a re-run conflicts on the PK and',
    '-- inserts nothing. Applies AFTER the D1 migrations (and creates the',
    '-- staging-infra staging_reviews table, mirroring the pg deploy order',
    '-- migrations → staging-reviews.sql → seed).',
    '-- ===========================================================================',
    '',
    '-- ---------------------------------------------------------------------------',
    '-- 0. staging_reviews — staging-infra table (no Drizzle ORM equivalent).',
    '--    SQLite form of infra/staging-data/staging-reviews.sql.',
    '-- ---------------------------------------------------------------------------',
    'CREATE TABLE IF NOT EXISTS "staging_reviews" (',
    '  "id" INTEGER PRIMARY KEY,',
    '  "review_label" TEXT(128) NOT NULL,',
    '  "previous_version_id" INTEGER,',
    '  "proposed_version_id" INTEGER,',
    '  "reviewer" TEXT(256),',
    '  "status" TEXT(32) NOT NULL DEFAULT \'pending\',',
    '  "summary" TEXT,',
    `  "created_at" TEXT NOT NULL DEFAULT (${ISO_8601_NOW_SQL}),`,
    '  "reviewed_at" TEXT',
    ');',
    'CREATE INDEX IF NOT EXISTS "idx_staging_reviews_status" ON "staging_reviews" ("status");',
    '',
  ];

  lines.push(
    ...emitInsertOrIgnore(
      TRANSPORT_SPEC,
      STAGING_TRANSPORT_OFFERS.map((t) => [
        String(t.id),
        sqlString(t.carrier),
        sqlString(t.originCountry),
        sqlString(t.destinationCountry),
        String(t.weightMinKg),
        String(t.weightMaxKg),
        sqlString(t.packageTier),
        String(t.priceCents),
        sqlString(t.currency),
        sqlBool(t.sellerInvolvementIndicator),
        sqlString(t.refreshedAt),
        sqlString(t.reliabilityStatus),
      ]),
      `1. Transport offers — carrier rates for common import routes (${STAGING_TRANSPORT_OFFERS.length} rows).`,
    ),
  );

  lines.push(
    ...emitInsertOrIgnore(
      PRODUCT_SPEC,
      STAGING_PRODUCTS.map((p) => [
        String(p.id),
        sqlString(p.name),
        sqlString(p.manufacturer),
        sqlString(p.brand),
        sqlString(p.category),
        sqlNullable(p.alcoholByVolume, String),
        String(p.unitVolume),
        sqlString(p.containerType),
        sqlString(p.regulatoryClassification),
        sqlBool(p.depositSystemStatus),
        sqlNullable(p.ean, sqlString),
      ]),
      `2. Product master — deterministic ids 1–${STAGING_PRODUCTS.length} (retail_offers FK targets).`,
    ),
  );

  lines.push(
    ...emitInsertOrIgnore(
      RETAIL_OFFER_SPEC,
      STAGING_RETAIL_OFFERS.map((o) => [
        String(o.id),
        sqlString(o.merchant),
        sqlString(o.country),
        String(o.productId),
        String(o.priceCents),
        sqlString(o.currency),
        sqlString(o.availability),
        sqlString(o.sourceUrl),
        sqlString(o.reliabilityStatus),
      ]),
      `3. Retail offers — deterministic ids 1–${STAGING_RETAIL_OFFERS.length}.`,
    ),
  );

  lines.push(
    ...emitInsertOrIgnore(
      STAGING_REVIEW_SPEC,
      STAGING_REVIEWS.map((r) => [
        String(r.id),
        sqlString(r.reviewLabel),
        sqlNullable(r.previousVersionId, String),
        sqlNullable(r.proposedVersionId, String),
        sqlNullable(r.reviewer, sqlString),
        sqlString(r.status),
        sqlString(r.createdAt),
      ]),
      `4. Staging review records (${STAGING_REVIEWS.length} rows).`,
    ),
  );

  return lines.join('\n');
}

/** SQLite form of the schema's ISO_8601_NOW default (d1/schema.ts). */
const ISO_8601_NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// ---------------------------------------------------------------------------
// Verification contract — shared by the node:sqlite path and the wrangler
// --json path, so both apply modes assert the same thing.
// ---------------------------------------------------------------------------

/** Sanitize a version label into a SQL result field name ("v1.0-2024" → "v1_0_2024"). */
function versionFieldName(versionLabel: string): string {
  return `tax_rules_${versionLabel.replace(/[^A-Za-z0-9]/g, '_')}`;
}

/** Expected row counts, derived from the same sources as the emitted SQL. */
export interface SeedExpectations {
  /** Total tax_rules rows across all version labels. */
  taxRulesTotal: number;
  /** Per-version-label tax_rules counts (append-only dataset policy). */
  taxRulesPerVersion: Record<string, number>;
  transportOffers: number;
  productMaster: number;
  retailOffers: number;
  stagingReviews: number;
  /** Rows in the FTS5 external-content index after trigger sync. */
  ftsIndexedProducts: number;
  /**
   * Spot check: the latest version's beer mid-band rate row must exist
   * exactly once (proves the *values*, not just counts, of the current
   * dataset landed).
   */
  spotBeerRateRows: { fieldName: string; expected: number };
}

export function buildExpectations(): SeedExpectations {
  const perVersion: Record<string, number> = {};
  for (const rule of SEED_RULES) {
    perVersion[rule.versionLabel] = (perVersion[rule.versionLabel] ?? 0) + 1;
  }

  return {
    taxRulesTotal: SEED_RULES.length,
    taxRulesPerVersion: perVersion,
    transportOffers: STAGING_TRANSPORT_OFFERS.length,
    productMaster: STAGING_PRODUCTS.length,
    retailOffers: STAGING_RETAIL_OFFERS.length,
    stagingReviews: STAGING_REVIEWS.length,
    ftsIndexedProducts: STAGING_PRODUCTS.length,
    spotBeerRateRows: {
      fieldName: 'spot_beer_rate_rows',
      expected: 1, // SELECT COUNT(*) with that exact (label, category, rate) filter
    },
  };
}

/**
 * Filter parameters of the value spot check: the latest version label
 * (last in SEED_RULES order — append-only convention) and its non-zero
 * beer mid-band rate. Kept separate from SeedExpectations because these
 * parameterize the verification QUERY, not the expected row counts.
 */
export function buildSpotCheck(): { latestLabel: string; beerRate: number } {
  const latestLabel = SEED_RULES[SEED_RULES.length - 1].versionLabel;
  const beerMid = SEED_RULES.find(
    (r) => r.versionLabel === latestLabel && r.productCategory === 'beer' && r.rate !== '0.00',
  );
  if (!beerMid) {
    throw new Error('SEED_RULES has no non-zero beer band in the latest version — spot check is unbuildable');
  }
  return { latestLabel, beerRate: Number(beerMid.rate) };
}

/**
 * The single-row verification query. One statement so both node:sqlite
 * (`prepare().get()`) and `wrangler d1 execute --json --command` consume it
 * unchanged. Field for field aligned with SeedExpectations.
 */
export function buildVerifySql(): string {
  const expectations = buildExpectations();
  const spot = buildSpotCheck();
  const perVersionSelects = Object.keys(expectations.taxRulesPerVersion)
    .map(
      (label) =>
        `  (SELECT COUNT(*) FROM "tax_rules" WHERE "version_label" = ${sqlString(label)}) AS "${versionFieldName(label)}"`,
    )
    .join(',\n');

  return `SELECT
  (SELECT COUNT(*) FROM "tax_rules") AS "tax_rules_total",
${perVersionSelects},
  (SELECT COUNT(*) FROM "tax_rules" WHERE "version_label" = ${sqlString(spot.latestLabel)} AND "product_category" = 'beer' AND "rate" = ${spot.beerRate}) AS "spot_beer_rate_rows",
  (SELECT COUNT(*) FROM "transport_offers") AS "transport_offers_total",
  (SELECT COUNT(*) FROM "product_master") AS "product_master_total",
  (SELECT COUNT(*) FROM "retail_offers") AS "retail_offers_total",
  (SELECT COUNT(*) FROM "staging_reviews") AS "staging_reviews_total",
  (SELECT COUNT(*) FROM "product_master_fts") AS "fts_indexed_products"`;
}

/**
 * Assert a verification row (field → actual count) against the expected
 * counts. Throws a SeedVerificationError listing EVERY mismatch — the
 * loud-failure contract of the seed pipeline.
 */
export function assertVerificationRow(row: Record<string, unknown>): void {
  const expectations = buildExpectations();
  const expected: Record<string, number> = {
    tax_rules_total: expectations.taxRulesTotal,
    ...Object.fromEntries(
      Object.entries(expectations.taxRulesPerVersion).map(([label, count]) => [
        versionFieldName(label),
        count,
      ]),
    ),
    spot_beer_rate_rows: expectations.spotBeerRateRows.expected,
    transport_offers_total: expectations.transportOffers,
    product_master_total: expectations.productMaster,
    retail_offers_total: expectations.retailOffers,
    staging_reviews_total: expectations.stagingReviews,
    fts_indexed_products: expectations.ftsIndexedProducts,
  };

  const mismatches: string[] = [];
  for (const [field, want] of Object.entries(expected)) {
    const got = row[field];
    if (typeof got !== 'number' || got !== want) {
      mismatches.push(`  ${field}: expected ${want}, got ${String(got)}`);
    }
  }
  // Unknown extra fields are fine (forward compatibility), missing ones are
  // the mismatches above (typeof undefined !== 'number').

  if (mismatches.length > 0) {
    throw new SeedVerificationError(
      `D1 seed verification FAILED — ${mismatches.length} field(s) mismatched:\n${mismatches.join('\n')}`,
    );
  }
}

/** Thrown when the post-seed verification query does not match expectations. */
export class SeedVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedVerificationError';
  }
}

// ---------------------------------------------------------------------------
// File emission
// ---------------------------------------------------------------------------

/** Logical seed file names → generator, in apply order. */
export const SEED_SQL_FILES: ReadonlyArray<{ name: string; generate: () => string }> = [
  { name: 'tax-rules.d1.sql', generate: generateTaxRulesSql },
  { name: 'staging.d1.sql', generate: generateStagingSql },
];

/** Generate all seed files as an ordered name → SQL text record. */
export function generateSeedSqlFiles(): Array<{ name: string; sql: string }> {
  return SEED_SQL_FILES.map(({ name, generate }) => ({ name, sql: generate() }));
}

/** Result of writing the seed files to disk. */
export interface WrittenSeedFile {
  file: string;
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * Write the generated seed files into `outDir` (created if missing).
 * Returns paths plus sha256 so callers can log reproducible fingerprints.
 */
export function writeSeedSqlFiles(outDir: string): WrittenSeedFile[] {
  mkdirSync(outDir, { recursive: true });
  return generateSeedSqlFiles().map(({ name, sql }) => {
    const path = join(outDir, name);
    const body = Buffer.from(sql, 'utf8');
    writeFileSync(path, body);
    return {
      file: name,
      path,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  });
}
