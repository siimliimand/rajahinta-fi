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
 * - Event-calculator reference data: `CONSUMPTION_NORMS_SEED_ROWS` from
 *   `../consumption-norms.seed` and `CARRIER_BOX_TYPES_SEED` from
 *   `../carrier-box-types.seed` (change eventcalc-reference-seed-wiring).
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
 * - consumption_norms: upsert on (drink_type, event_profile, version_label)
 *   with `DO UPDATE … WHERE status = 'PENDING_CONFIRMATION'` — the exact
 *   contract of seedConsumptionNorms: pending rows refresh in place,
 *   PUBLISHED rows are terminal and can never be rewritten (design D2).
 * - carrier_box_types: plain upsert on (carrier, name), mirroring
 *   seedCarrierBoxTypes (no publication workflow).
 *
 * @module Seed/D1
 */
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { taxRules, transportOffers, productMaster, retailOffers, merchantRegistry, carrierBoxTypes, consumptionNorms } from '../../d1/schema';
import { SEED_RULES } from '../tax-rules.seed';
import { MERCHANT_REGISTRY_SEED } from '../merchant-registry.seed';
import {
  CONSUMPTION_NORMS_SEED_ROWS,
  type ConsumptionNormSeedRow,
} from '../consumption-norms.seed';
import {
  CARRIER_BOX_TYPES_SEED,
  type CarrierBoxTypeSeedRow,
} from '../carrier-box-types.seed';
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

const MERCHANT_REGISTRY_SPEC: StagingTableSpec = {
  tableName: 'merchant_registry',
  properties: ['id', 'merchantId', 'name', 'country', 'feedUrl', 'feedFormat', 'pollingIntervalMs'],
  fromSchemaTable: merchantRegistry,
};

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
 * order: merchant registry → transport offers → products → retail offers →
 * reviews.
 */
export function generateStagingSql(): string {
  const lines: string[] = [
    '-- ===========================================================================',
    '-- D1 seed: merchant registry bootstrap + staging fixture data',
    '-- (task 2.6 and task 2.2 of drop-sweden-eur-only-alko-benchmark).',
    '--',
    '-- Sources of truth: seed/merchant-registry.seed.ts (MERCHANT_REGISTRY_SEED)',
    '-- and infra/staging-data/seed.sql, ported in',
    '-- packages/data-platform/src/seed/d1/staging-fixtures.ts (see that module',
    '-- for the two documented normalizations: container-type vocabulary and',
    '-- EXACT→VERIFIED reliability). Generated by seed/d1/generate.ts —',
    '-- byte-deterministic, regenerate with db:seed:d1:generate.',
    '--',
    '-- Idempotency: every row carries an explicit primary-key id and is',
    '-- inserted with INSERT OR IGNORE — a re-run conflicts on the PK and',
    '-- inserts nothing. Run the merchant purge script BEFORE (re-)seeding an',
    '-- environment that ingested the removed foreign merchant: an unpurged',
    '-- registry row holding id 1 would swallow the bootstrap row and leave',
    '-- the registry without alko. Applies AFTER the D1 migrations (and',
    '-- creates the staging-infra staging_reviews table, mirroring the pg',
    '-- deploy order migrations → staging-reviews.sql → seed).',
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
      MERCHANT_REGISTRY_SPEC,
      MERCHANT_REGISTRY_SEED.map((m, i) => [
        String(i + 1),
        sqlString(m.merchantId),
        sqlString(m.name),
        sqlString(m.country),
        sqlString(m.feedUrl),
        sqlString(m.feedFormat),
        String(m.pollingIntervalMs),
      ]),
      `1. Merchant registry — bootstrap rows from MERCHANT_REGISTRY_SEED (${MERCHANT_REGISTRY_SEED.length} row; created_at/updated_at take column defaults).`,
    ),
  );

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
      `2. Transport offers — carrier rates for common import routes (${STAGING_TRANSPORT_OFFERS.length} rows).`,
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
      `3. Product master — deterministic ids 1–${STAGING_PRODUCTS.length} (retail_offers FK targets).`,
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
      `4. Retail offers — deterministic ids 1–${STAGING_RETAIL_OFFERS.length}.`,
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
      `5. Staging review records (${STAGING_REVIEWS.length} rows).`,
    ),
  );

  return lines.join('\n');
}

/** SQLite form of the schema's ISO_8601_NOW default (d1/schema.ts). */
const ISO_8601_NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// ---------------------------------------------------------------------------
// Files 3 & 4 — event-calculator reference data (change
// eventcalc-reference-seed-wiring): the consumption norms behind
// POST /api/v1/event-calc and the carrier boxes behind the V2 sourcing
// plan. Both were orphaned function seeds before this change wired them
// into the orchestrator.
// ---------------------------------------------------------------------------

/** Column properties of a consumption_norms seed row, in emission order. */
const CONSUMPTION_NORM_PROPERTIES = [
  'versionLabel',
  'drinkType',
  'eventProfile',
  'normValuePerGuestPerHour',
  'sourceCitation',
  'effectiveFrom',
  'effectiveTo',
] as const;

/** Column properties of a carrier_box_types seed row, in emission order. */
const CARRIER_BOX_PROPERTIES = [
  'carrier',
  'name',
  'internalHeightMm',
  'internalWidthMm',
  'internalDepthMm',
  'maxWeightG',
  'source',
  'observedAt',
] as const;

function consumptionNormValueRow(row: ConsumptionNormSeedRow): string {
  return [
    sqlString(row.versionLabel),
    sqlString(row.drinkType),
    sqlString(row.eventProfile),
    String(row.normValuePerGuestPerHour),
    sqlString(row.sourceCitation),
    sqlString(row.effectiveFrom),
    sqlNullable(row.effectiveTo, sqlString),
  ].join(', ');
}

function carrierBoxValueRow(row: CarrierBoxTypeSeedRow): string {
  return [
    sqlString(row.carrier),
    sqlString(row.name),
    String(row.internalHeightMm),
    String(row.internalWidthMm),
    String(row.internalDepthMm),
    String(row.maxWeightG),
    sqlString(row.source),
    sqlString(row.observedAt),
  ].join(', ');
}

/**
 * Generate the consumption-norms seed file: the curated dataset as ONE
 * multi-row upsert — the statement-shape mirror of seedConsumptionNorms's
 * transactional batch. `id`, `status`, `confirmed_by`, `confirmed_at` and
 * `created_at` are omitted and take their column defaults / lifecycle
 * values, exactly like the function seed's insert column list. The
 * conflict target and the `DO UPDATE … WHERE` guard are the schema's
 * UNIQUE (drink_type, event_profile, version_label) and the seed's
 * refresh-pending-only contract (design D2): a PUBLISHED row fails the
 * update's WHERE and the insert is silently skipped — immutable history.
 */
export function generateConsumptionNormsSql(): string {
  const columnNames = sqlColumns(consumptionNorms, CONSUMPTION_NORM_PROPERTIES);
  return [
    '-- ===========================================================================',
    '-- D1 seed: curated consumption norms for the event calculator',
    '-- (task 4.1, change product-roadmap-phases-1-4; wired by',
    '-- eventcalc-reference-seed-wiring).',
    '--',
    '-- Source of truth: packages/data-platform/src/seed/consumption-norms.seed.ts',
    '-- (CONSUMPTION_NORMS_SEED_ROWS). Generated by',
    '-- packages/data-platform/src/seed/d1/generate.ts. Output is',
    '-- byte-deterministic (no timestamps) — regenerate with the',
    '-- db:seed:d1:generate script; never edit by hand.',
    '--',
    '-- Idempotency: upsert on (drink_type, event_profile, version_label) that',
    '-- refreshes PENDING_CONFIRMATION rows only. PUBLISHED rows are terminal',
    '-- (append-only dataset: a correction is a NEW version) — the DO UPDATE',
    '-- WHERE guard makes rewriting them impossible, so this file can be',
    '-- re-applied after operator publication without touching history.',
    '-- Rows land PENDING_CONFIRMATION: publication is the operator console\'s',
    '-- manual confirmation step, never the seed\'s. Applies AFTER the D1',
    '-- migrations.',
    '-- ===========================================================================',
    '',
    `INSERT INTO "consumption_norms" (${columnList(columnNames)})`,
    `VALUES`,
    CONSUMPTION_NORMS_SEED_ROWS.map((row) => `  (${consumptionNormValueRow(row)})`).join(',\n'),
    `ON CONFLICT ("drink_type", "event_profile", "version_label") DO UPDATE SET`,
    `  "norm_value_per_guest_per_hour" = excluded."norm_value_per_guest_per_hour",`,
    `  "source_citation" = excluded."source_citation",`,
    `  "effective_from" = excluded."effective_from",`,
    `  "effective_to" = excluded."effective_to"`,
    `WHERE "consumption_norms"."status" = 'PENDING_CONFIRMATION';`,
    '',
  ].join('\n');
}

/**
 * Generate the carrier-box-types seed file: the curated PostNord + DHL
 * catalogue as ONE multi-row plain upsert on the schema's
 * UNIQUE (carrier, name) — the statement-shape mirror of
 * seedCarrierBoxTypes's batch (no publication workflow; a re-run replaces
 * the curated columns in place).
 */
export function generateCarrierBoxTypesSql(): string {
  const columnNames = sqlColumns(carrierBoxTypes, CARRIER_BOX_PROPERTIES);
  return [
    '-- ===========================================================================',
    '-- D1 seed: curated carrier box catalogue (PostNord + DHL standard boxes)',
    '-- (task 3.1, change product-roadmap-phases-1-4; wired by',
    '-- eventcalc-reference-seed-wiring).',
    '--',
    '-- Source of truth: packages/data-platform/src/seed/carrier-box-types.seed.ts',
    '-- (CARRIER_BOX_TYPES_SEED). Generated by',
    '-- packages/data-platform/src/seed/d1/generate.ts. Output is',
    '-- byte-deterministic (no timestamps) — regenerate with the',
    '-- db:seed:d1:generate script; never edit by hand.',
    '--',
    '-- Idempotency: plain upsert on (carrier, name) — a re-run replaces the',
    '-- curated columns in place instead of duplicating rows. Applies AFTER',
    '-- the D1 migrations.',
    '-- ===========================================================================',
    '',
    `INSERT INTO "carrier_box_types" (${columnList(columnNames)})`,
    `VALUES`,
    CARRIER_BOX_TYPES_SEED.map((row) => `  (${carrierBoxValueRow(row)})`).join(',\n'),
    `ON CONFLICT ("carrier", "name") DO UPDATE SET`,
    `  "internal_height_mm" = excluded."internal_height_mm",`,
    `  "internal_width_mm" = excluded."internal_width_mm",`,
    `  "internal_depth_mm" = excluded."internal_depth_mm",`,
    `  "max_weight_g" = excluded."max_weight_g",`,
    `  "source" = excluded."source",`,
    `  "observed_at" = excluded."observed_at";`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Verification contract — shared by the node:sqlite path and the wrangler
// --json path, so both apply modes assert the same thing.
// ---------------------------------------------------------------------------

/** Sanitize a version label into a SQL result field name ("v1.0-2024" → "v1_0_2024"). */
function versionFieldName(versionLabel: string): string {
  return `tax_rules_${versionLabel.replace(/[^A-Za-z0-9]/g, '_')}`;
}

/** Sanitize a merchant id into a SQL result field name ("merchant_registry_alko"). */
function merchantRegistryFieldName(merchantId: string): string {
  return `merchant_registry_${merchantId.replace(/[^A-Za-z0-9]/g, '_')}`;
}

/** Expected row counts, derived from the same sources as the emitted SQL. */
export interface SeedExpectations {
  /** Total tax_rules rows across all version labels. */
  taxRulesTotal: number;
  /** Per-version-label tax_rules counts (append-only dataset policy). */
  taxRulesPerVersion: Record<string, number>;
  /**
   * Per-seed-merchant expected presence (merchantId → 1). The registry is
   * verified by seeded-row presence, not table total: operator-added rows
   * via the documented ops path (longero 4.2, kippis 4.2/5.2) legitimately
   * grow the table past the seed set, and an exact-total gate would fail
   * every post-onboarding deploy.
   */
  merchantRegistryRows: Record<string, number>;
  transportOffers: number;
  productMaster: number;
  retailOffers: number;
  stagingReviews: number;
  /**
   * Consumption norms across {PENDING_CONFIRMATION, PUBLISHED} — the
   * curated seed set is a floor, not an exact total: the dataset is
   * append-only (a correction is a new version), so future versions
   * legitimately grow it past the seed count. Below the floor the seed is
   * missing or the table was wiped (design D3's silent-no-op guard).
   */
  consumptionNormsRows: number;
  /** Carrier box catalogue floor (plain idempotent upsert, no lifecycle). */
  carrierBoxTypesRows: number;
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

  const merchantRows: Record<string, number> = {};
  for (const merchant of MERCHANT_REGISTRY_SEED) {
    merchantRows[merchant.merchantId] = 1;
  }

  return {
    taxRulesTotal: SEED_RULES.length,
    taxRulesPerVersion: perVersion,
    merchantRegistryRows: merchantRows,
    transportOffers: STAGING_TRANSPORT_OFFERS.length,
    productMaster: STAGING_PRODUCTS.length,
    retailOffers: STAGING_RETAIL_OFFERS.length,
    stagingReviews: STAGING_REVIEWS.length,
    consumptionNormsRows: CONSUMPTION_NORMS_SEED_ROWS.length,
    carrierBoxTypesRows: CARRIER_BOX_TYPES_SEED.length,
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
  // Per-seed-merchant presence, not a table total: operator-added registry
  // rows (the documented ops path) must not fail the deploy gate.
  const perMerchantSelects = Object.keys(expectations.merchantRegistryRows)
    .map(
      (merchantId) =>
        `  (SELECT COUNT(*) FROM "merchant_registry" WHERE "merchant_id" = ${sqlString(merchantId)}) AS "${merchantRegistryFieldName(merchantId)}"`,
    )
    .join(',\n');

  return `SELECT
  (SELECT COUNT(*) FROM "tax_rules") AS "tax_rules_total",
${perVersionSelects},
  (SELECT COUNT(*) FROM "tax_rules" WHERE "version_label" = ${sqlString(spot.latestLabel)} AND "product_category" = 'beer' AND "rate" = ${spot.beerRate}) AS "spot_beer_rate_rows",
${perMerchantSelects},
  (SELECT COUNT(*) FROM "transport_offers") AS "transport_offers_total",
  (SELECT COUNT(*) FROM "product_master") AS "product_master_total",
  (SELECT COUNT(*) FROM "retail_offers") AS "retail_offers_total",
  (SELECT COUNT(*) FROM "staging_reviews") AS "staging_reviews_total",
  (SELECT COUNT(*) FROM "consumption_norms" WHERE "status" IN ('PENDING_CONFIRMATION', 'PUBLISHED')) AS "consumption_norms_total",
  (SELECT COUNT(*) FROM "carrier_box_types") AS "carrier_box_types_total",
  (SELECT COUNT(*) FROM "product_master_fts") AS "fts_indexed_products"`;
}

/**
 * Fields asserted at-least (a floor) rather than exact. Two families:
 * tables that ingestion or the curated sync also write (the seed owns its
 * fixture rows as a floor there: staging's hourly producer — merchant
 * feeds — legitimately grows product_master, retail_offers and the FTS
 * index past the fixture counts, and the monthly curated-rate-refresh
 * cron (2026-09-28) legitimately grows transport_offers with the curated
 * carrier datasets — exact equality would fail on every post-sync deploy),
 * and the append-only reference datasets (consumption_norms,
 * carrier_box_types) whose curated seed rows are a floor: future versions
 * and operator additions legitimately append. Seed-owned exact tables
 * (tax rules, staging reviews) stay exact — drift there is seed loss, not
 * growth. The merchant registry is neither: the seed verifies its own rows
 * by presence (per merchantId), while operator-added rows via the
 * documented ops path (longero 4.2, kippis 4.2/5.2 onboarding)
 * legitimately grow the table.
 */
const INGESTION_FLOOR_FIELDS: ReadonlySet<string> = new Set([
  'product_master_total',
  'retail_offers_total',
  'fts_indexed_products',
  'transport_offers_total',
  'consumption_norms_total',
  'carrier_box_types_total',
]);

/**
 * Assert a verification row (field → actual count) against the expected
 * counts. Exact for seed-owned tables, at-least for ingestion-shared
 * staging ones and the append-only reference datasets (see
 * INGESTION_FLOOR_FIELDS), and per-seeded-row presence for the merchant
 * registry. Throws a SeedVerificationError listing EVERY
 * mismatch — the loud-failure contract of the seed pipeline.
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
    ...Object.fromEntries(
      Object.entries(expectations.merchantRegistryRows).map(([merchantId, count]) => [
        merchantRegistryFieldName(merchantId),
        count,
      ]),
    ),
    transport_offers_total: expectations.transportOffers,
    product_master_total: expectations.productMaster,
    retail_offers_total: expectations.retailOffers,
    staging_reviews_total: expectations.stagingReviews,
    consumption_norms_total: expectations.consumptionNormsRows,
    carrier_box_types_total: expectations.carrierBoxTypesRows,
    fts_indexed_products: expectations.ftsIndexedProducts,
  };

  const mismatches: string[] = [];
  for (const [field, want] of Object.entries(expected)) {
    const got = row[field];
    if (typeof got !== 'number') {
      mismatches.push(`  ${field}: expected ${want}, got ${String(got)}`);
      continue;
    }
    if (INGESTION_FLOOR_FIELDS.has(field)) {
      // Below the fixture count the seed is incomplete; above it, the
      // hourly ingestion producer has appended real rows — legitimate.
      if (got < want) {
        mismatches.push(`  ${field}: expected at least ${want}, got ${got}`);
      }
    } else if (got !== want) {
      mismatches.push(`  ${field}: expected ${want}, got ${got}`);
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
  { name: 'consumption-norms.d1.sql', generate: generateConsumptionNormsSql },
  { name: 'carrier-box-types.d1.sql', generate: generateCarrierBoxTypesSql },
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
