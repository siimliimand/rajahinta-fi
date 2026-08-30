/**
 * Shared harness for the D1 integration suites (task 2.7, change
 * migrate-to-cloudflare).
 *
 * Scales the proven node:sqlite harness pattern from
 * `packages/data-platform/src/repositories/d1/__tests__/d1-test-harness.ts`
 * up to the flow-level suites: every repository runs against a real SQLite
 * engine with the committed migrations applied, wrapped in the same
 * structural D1-binding shim (reused from that harness — not duplicated).
 * A file-backed variant supports the durability suite, where "restart"
 * means close-and-reopen the same storage with brand-new instances.
 *
 * Why plain vitest + this harness (and not vitest-pool-workers): these
 * suites compose NestJS testing modules, supertest, and the workspace
 * TypeScript import graph — none of which want workerd semantics. The D1
 * behavior under test (SQL surface, batch semantics, ISO-8601 TEXT
 * timestamps, RETURNING ids) is fully exercised by the shim, exactly as
 * the 2.x repository suites proved.
 *
 * The R2 half of the storage design (D4 amended) is covered by
 * {@link R2JsonlObservationStore}: appends go through the REAL
 * R2PriceObservationPort adapter and the 2.3 layout modules
 * (src/d1/observation-log.ts); the read side replays the JSONL objects —
 * the same batch-read the aggregation consumer performs — into the
 * data-platform abstract the pg Drizzle repository used to satisfy. A
 * plain in-memory object map stands in for the R2 binding, which lands
 * with the phase-3 wrangler wiring.
 *
 * @module D1IntegrationHarness
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type {
  IPriceObservationPort,
  PriceObservation,
} from '@rajahinta/core-domain';
import {
  PriceObservationRepository,
  type PriceObservationRecord,
  type ProductActivitySince,
} from '@rajahinta/data-platform';

import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';
import {
  observationKeysToScan,
  parseObservationLog,
  type ObservationLogRecord,
  type ObservationLogStore,
} from '../../../packages/data-platform/src/d1/observation-log';
import { createD1Shim } from '../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import { R2PriceObservationPort } from '../../../packages/data-platform/src/repositories/d1/price-observation.repository';

// ---------------------------------------------------------------------------
// Migrated D1 database
// ---------------------------------------------------------------------------

/** Locate the committed D1 migrations from this file's own location. */
function migrationsDir(): string {
  const candidate = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'data-platform',
    'src',
    'd1',
    'migrations',
  );
  if (!existsSync(path.join(candidate, '0000_supreme_bucky.sql'))) {
    throw new Error(`D1 migrations not found at ${candidate}`);
  }
  return candidate;
}

/**
 * Open a database with every committed migration applied, in filename
 * order — the same set `wrangler d1 migrations apply` runs.
 *
 * @param file  SQLite file path for storage that must survive a
 *              close/reopen cycle (durability suite). Omit for an
 *              in-memory database (default — every other suite). When the
 *              file already carries the schema, migrations are skipped —
 *              the drizzle DDL is plain CREATE TABLE, not IF NOT EXISTS.
 */
export function openMigratedD1(options: { file?: string } = {}): {
  db: DatabaseSync;
  d1: D1DatabaseLike;
} {
  const db = new DatabaseSync(options.file ?? ':memory:');

  // Schema detection: the drizzle DDL is plain CREATE TABLE (not IF NOT
  // EXISTS), so a file that already carries the schema must not be
  // re-migrated — this is what makes a close/reopen cycle idempotent.
  const marker = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'tax_rules'`,
    )
    .get() as { c: number | bigint };

  if (Number(marker.c) === 0) {
    const dir = migrationsDir();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      for (const statement of readFileSync(path.join(dir, file), 'utf8').split(
        '--> statement-breakpoint',
      )) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) {
          db.exec(trimmed);
        }
      }
    }
  }
  return { db, d1: createD1Shim(db) };
}

// ---------------------------------------------------------------------------
// Fixture seeding — direct through the shim, mirroring the 2.x suites
// ---------------------------------------------------------------------------

let fixtureProductSeq = 9_000;

/** Seed a minimal product_master row; returns its id. */
export function seedProductRow(
  d1: D1DatabaseLike,
  name: string,
): Promise<number> {
  const id = ++fixtureProductSeq;
  return d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (?, ?, 'D1 Integration Fixture Brewery', 'D1 Integration Fixture',
               'beer', 0.5, 'can', 'beer')`,
    )
    .bind(id, name)
    .run()
    .then(() => id);
}

let fixtureOfferSeq = 50_000;
/** Seed a retail_offers row; returns its id. */
export function seedRetailOfferRow(
  d1: D1DatabaseLike,
  productId: number,
  merchant: string,
  sourceUrl: string,
): Promise<number> {
  const id = ++fixtureOfferSeq;
  return d1
    .prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, availability, source_url, reliability_status)
       VALUES (?, ?, 'DE', ?, 199, 'EUR', 'in_stock', ?, 'VERIFIED')`,
    )
    .bind(id, merchant, productId, sourceUrl)
    .run()
    .then(() => id);
}

/**
 * Observation fixture matching the pg data-lifecycle suite's shape —
 * landed cost keeps a +100 ¢ excise stub so aggregation math stays
 * human-checkable.
 */
export function observationFixture(
  productId: number,
  retailOfferId: number,
  merchant: string,
  observedAt: Date,
  priceCents: number,
): PriceObservation {
  return {
    productId,
    merchant,
    retailOfferId,
    observedAt,
    foreignRetailPriceCents: priceCents,
    transportOfferId: null,
    transportCostCents: 0,
    exciseRuleVersion: null,
    containerDutyRuleVersion: null,
    landedCostCents: priceCents + 100,
    inputReliability: {
      retailPrice: 'VERIFIED',
      transport: 'VERIFIED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'VERIFIED',
    },
    confidence: 'HIGH',
  };
}

// ---------------------------------------------------------------------------
// R2 observation log — in-memory store + JSONL read side
// ---------------------------------------------------------------------------

/**
 * In-memory stand-in for the R2 bucket: object key → body text. The real
 * binding satisfies {@link ObservationLogStore} structurally (phase-3
 * wiring); the append semantics mirrored here are read-modify-write of a
 * LF-terminated JSONL body, one object per UTC day.
 */
export class InMemoryR2Bucket implements ObservationLogStore {
  readonly objects = new Map<string, string>();

  async appendLine(key: string, line: string): Promise<void> {
    const existing = this.objects.get(key);
    this.objects.set(key, existing === undefined ? `${line}\n` : `${existing}${line}\n`);
  }

  /** Whole current body of an object (null when absent). */
  body(key: string): string | null {
    return this.objects.get(key) ?? null;
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

/**
 * Observation store over the R2 JSONL layout (design D4 amended): the
 * append path IS the production R2PriceObservationPort (id assignment +
 * canonical serialization + date-partitioned append); the read side
 * replays the log — {@link observationKeysToScan} picks the partitions,
 * {@link parseObservationLog} decodes the lines — and serves the same
 * data-platform abstract (half-open [from, to) ranges, (observedAt, id)
 * series order, inclusive watermark lower bound) the pg Drizzle
 * repository satisfied, so the real aggregation worker and the
 * historical-data controller run against it unchanged.
 */
export class R2JsonlObservationStore
  extends PriceObservationRepository
  implements IPriceObservationPort
{
  readonly bucket: InMemoryR2Bucket;
  private readonly appender: R2PriceObservationPort;
  /** Append-order log of every observation written (stage-1 introspection). */
  private readonly appendedLog: PriceObservationRecord[] = [];

  constructor(nextId?: () => number) {
    super();
    this.bucket = new InMemoryR2Bucket();
    this.appender = new R2PriceObservationPort(this.bucket, nextId);
  }

  async append(observation: PriceObservation): Promise<{ id: number }> {
    const result = await this.appender.append(observation);
    this.appendedLog.push({
      id: result.id,
      productId: observation.productId,
      merchant: observation.merchant,
      retailOfferId: observation.retailOfferId,
      observedAt: observation.observedAt,
      foreignRetailPriceCents: observation.foreignRetailPriceCents,
      transportOfferId: observation.transportOfferId,
      transportCostCents: observation.transportCostCents,
      exciseRuleVersionId: observation.exciseRuleVersion?.ruleId ?? null,
      containerDutyRuleVersionId:
        observation.containerDutyRuleVersion?.ruleId ?? null,
      landedCostCents: observation.landedCostCents,
      inputReliability: observation.inputReliability,
      confidence: observation.confidence,
    });
    return result;
  }

  /** Every appended observation, in append order (the pg suite read its
   * in-memory store's `rows` array — the same insertion-order view). */
  appendedRows(): PriceObservationRecord[] {
    return [...this.appendedLog];
  }

  /**
   * Every record in the log, ascending partition order then line order —
   * the batch-read shape the aggregation consumer gets from R2.
   */
  allRecords(): ObservationLogRecord[] {
    return observationKeysToScan(this.bucket.keys(), null).flatMap((key) =>
      parseObservationLog(this.bucket.body(key)!),
    );
  }

  /** Parsed records for one object key. */
  recordsIn(key: string): ObservationLogRecord[] {
    return parseObservationLog(this.bucket.body(key)!);
  }

  private static toRecord(row: ObservationLogRecord): PriceObservationRecord {
    return {
      id: row.id,
      productId: row.product_id,
      merchant: row.merchant,
      retailOfferId: row.retail_offer_id,
      observedAt: new Date(row.observed_at),
      foreignRetailPriceCents: row.foreign_retail_price_cents,
      transportOfferId: row.transport_offer_id,
      transportCostCents: row.transport_cost_cents,
      exciseRuleVersionId: row.excise_rule_version_id,
      containerDutyRuleVersionId: row.container_duty_rule_version_id,
      landedCostCents: row.landed_cost_cents,
      inputReliability: row.input_reliability,
      confidence: row.confidence,
    };
  }

  private static seriesOrder(a: PriceObservationRecord, b: PriceObservationRecord): number {
    return (
      a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id
    );
  }

  async findByProductRange(
    productId: number,
    from: Date,
    to: Date,
    merchant?: string | null,
  ): Promise<PriceObservationRecord[]> {
    return this.allRecords()
      .map(R2JsonlObservationStore.toRecord)
      .filter(
        (r) =>
          r.productId === productId &&
          r.observedAt.getTime() >= from.getTime() &&
          r.observedAt.getTime() < to.getTime() &&
          (merchant == null || r.merchant === merchant),
      )
      .sort(R2JsonlObservationStore.seriesOrder);
  }

  async findByMerchantOfferRange(
    merchant: string,
    retailOfferId: number,
    from: Date,
    to: Date,
  ): Promise<PriceObservationRecord[]> {
    return this.allRecords()
      .map(R2JsonlObservationStore.toRecord)
      .filter(
        (r) =>
          r.merchant === merchant &&
          r.retailOfferId === retailOfferId &&
          r.observedAt.getTime() >= from.getTime() &&
          r.observedAt.getTime() < to.getTime(),
      )
      .sort(R2JsonlObservationStore.seriesOrder);
  }

  async findByMerchantProductRange(
    merchant: string,
    productId: number,
    from: Date,
    to: Date,
  ): Promise<PriceObservationRecord[]> {
    return this.allRecords()
      .map(R2JsonlObservationStore.toRecord)
      .filter(
        (r) =>
          r.merchant === merchant &&
          r.productId === productId &&
          r.observedAt.getTime() >= from.getTime() &&
          r.observedAt.getTime() < to.getTime(),
      )
      .sort(R2JsonlObservationStore.seriesOrder);
  }

  async findEarliestObservedAt(
    productId: number,
    merchant?: string | null,
  ): Promise<Date | null> {
    const rows = this.allRecords()
      .map(R2JsonlObservationStore.toRecord)
      .filter(
        (r) =>
          r.productId === productId &&
          (merchant == null || r.merchant === merchant),
      )
      .sort(R2JsonlObservationStore.seriesOrder);
    return rows.length > 0 ? rows[0].observedAt : null;
  }

  async findProductActivitySince(since: Date): Promise<ProductActivitySince[]> {
    const byProduct = new Map<number, PriceObservationRecord[]>();
    for (const raw of this.allRecords()) {
      const row = R2JsonlObservationStore.toRecord(raw);
      if (row.observedAt.getTime() < since.getTime()) continue;
      const group = byProduct.get(row.productId);
      if (group) group.push(row);
      else byProduct.set(row.productId, [row]);
    }
    return [...byProduct.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([productId, group]) => ({
        productId,
        firstObservedAt: new Date(
          Math.min(...group.map((r) => r.observedAt.getTime())),
        ),
        lastObservedAt: new Date(
          Math.max(...group.map((r) => r.observedAt.getTime())),
        ),
      }));
  }
}
