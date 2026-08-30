/**
 * D1 MerchantRegistryRepository — the Cloudflare-side implementation of
 * the abstract {@link MerchantRegistryRepository} contract (task 2.5,
 * change migrate-to-cloudflare). Signatures and result shapes match the
 * pg DrizzleMerchantRegistryRepository exactly; ISO-8601 TEXT instants
 * convert to Date at the repository boundary (design D2).
 *
 * The only write path is upsert by the unique merchant_id; the conflict
 * arm refreshes the commercial columns and stamps `updated_at` with the
 * current instant — the pg SET clause's `updatedAt: new Date()`.
 *
 * @module D1MerchantRegistryRepository
 */
import { Injectable } from '@nestjs/common';
import { MerchantRegistryRepository, type MerchantRegistryRecord } from '../../abstracts';
import { merchantRegistry } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 merchant_registry row. */
interface D1MerchantRegistryRow {
  readonly id: number;
  readonly merchant_id: string;
  readonly name: string;
  readonly country: string;
  readonly feed_url: string;
  readonly feed_format: string;
  readonly polling_interval_ms: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function toContractRegistry(row: D1MerchantRegistryRow): MerchantRegistryRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    country: row.country,
    feedUrl: row.feed_url,
    feedFormat: row.feed_format,
    pollingIntervalMs: row.polling_interval_ms,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const REGISTRY_COLUMNS = `
  id, merchant_id, name, country, feed_url, feed_format,
  polling_interval_ms, created_at, updated_at`;

const LIST_SQL = `
  SELECT ${REGISTRY_COLUMNS} FROM merchant_registry ORDER BY merchant_id ASC`;

const FIND_BY_MERCHANT_ID_SQL = `
  SELECT ${REGISTRY_COLUMNS} FROM merchant_registry WHERE merchant_id = ?`;

const UPSERT_SQL = `
  INSERT INTO merchant_registry (
    merchant_id, name, country, feed_url, feed_format,
    polling_interval_ms, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (merchant_id) DO UPDATE SET
    name = excluded.name,
    country = excluded.country,
    feed_url = excluded.feed_url,
    feed_format = excluded.feed_format,
    polling_interval_ms = excluded.polling_interval_ms,
    updated_at = excluded.updated_at
  RETURNING ${REGISTRY_COLUMNS}`;

@Injectable()
export class D1MerchantRegistryRepository extends MerchantRegistryRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async list(): Promise<MerchantRegistryRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_SQL).all<D1MerchantRegistryRow>()
    ).results;
    return rows.map(toContractRegistry);
  }

  /** @inheritdoc */
  async findByMerchantId(merchantId: string): Promise<MerchantRegistryRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_MERCHANT_ID_SQL)
      .bind(merchantId)
      .first<D1MerchantRegistryRow>();
    return row ? toContractRegistry(row) : null;
  }

  /** @inheritdoc */
  async upsert(
    record: typeof merchantRegistry.$inferInsert,
  ): Promise<MerchantRegistryRecord> {
    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(UPSERT_SQL)
      .bind(
        record.merchantId,
        record.name,
        record.country,
        record.feedUrl,
        record.feedFormat,
        record.pollingIntervalMs,
        record.createdAt?.toISOString() ?? now,
        // The conflict arm stamps the current instant — pg SET new Date().
        record.updatedAt?.toISOString() ?? now,
      )
      .first<D1MerchantRegistryRow>();
    if (!row) {
      throw new Error('merchant_registry upsert .. RETURNING returned no row');
    }
    return toContractRegistry(row);
  }
}
