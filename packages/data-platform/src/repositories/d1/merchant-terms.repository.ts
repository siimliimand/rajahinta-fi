/**
 * D1 MerchantTermsRepository — the Cloudflare-side implementation of the
 * abstract {@link MerchantTermsRepository} contract (task 2.5, change
 * migrate-to-cloudflare). Signatures and result shapes match the pg
 * DrizzleMerchantTermsRepository exactly; ISO-8601 TEXT instants convert
 * to Date at the repository boundary (design D2).
 *
 * Upsert semantics preserved: conflict on the unique merchant_id
 * replaces every commercial column, and `observed_at` refreshes from the
 * record (or the current instant when absent) — the pg SET clause's
 * `record.observedAt ?? new Date()` expressed as `excluded.observed_at`
 * with the same fallback bound on the INSERT arm.
 *
 * @module D1MerchantTermsRepository
 */
import { Injectable } from '@nestjs/common';
import { MerchantTermsRepository } from '../../abstracts';
import { merchantTerms } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row type (canonical pg shape — observedAt is a Date). */
type MerchantTermsRecord = typeof merchantTerms.$inferSelect;

/** Raw D1 merchant_terms row. */
interface D1MerchantTermsRow {
  readonly id: number;
  readonly merchant_id: string;
  readonly minimum_order_value_cents: number | null;
  readonly currency: string;
  readonly source_url: string | null;
  readonly reliability_status: string;
  readonly observed_at: string;
}

function toContractTerms(row: D1MerchantTermsRow): MerchantTermsRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    minimumOrderValueCents: row.minimum_order_value_cents,
    currency: row.currency,
    sourceUrl: row.source_url,
    reliabilityStatus: row.reliability_status,
    observedAt: new Date(row.observed_at),
  };
}

const TERMS_COLUMNS = `
  id, merchant_id, minimum_order_value_cents, currency, source_url,
  reliability_status, observed_at`;

const FIND_BY_MERCHANT_SQL = `
  SELECT ${TERMS_COLUMNS} FROM merchant_terms WHERE merchant_id = ?`;

const UPSERT_SQL = `
  INSERT INTO merchant_terms (
    merchant_id, minimum_order_value_cents, currency, source_url,
    reliability_status, observed_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (merchant_id) DO UPDATE SET
    minimum_order_value_cents = excluded.minimum_order_value_cents,
    currency = excluded.currency,
    source_url = excluded.source_url,
    reliability_status = excluded.reliability_status,
    observed_at = excluded.observed_at
  RETURNING ${TERMS_COLUMNS}`;

@Injectable()
export class D1MerchantTermsRepository extends MerchantTermsRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findByMerchant(merchantId: string): Promise<MerchantTermsRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_MERCHANT_SQL)
      .bind(merchantId)
      .first<D1MerchantTermsRow>();
    return row ? toContractTerms(row) : null;
  }

  /** @inheritdoc */
  async upsert(record: typeof merchantTerms.$inferInsert): Promise<MerchantTermsRecord> {
    const row = await this.d1
      .prepare(UPSERT_SQL)
      .bind(
        record.merchantId,
        record.minimumOrderValueCents ?? null,
        record.currency,
        record.sourceUrl ?? null,
        record.reliabilityStatus ?? 'ESTIMATED',
        record.observedAt?.toISOString() ?? new Date().toISOString(),
      )
      .first<D1MerchantTermsRow>();
    if (!row) {
      throw new Error('merchant_terms upsert .. RETURNING returned no row');
    }
    return toContractTerms(row);
  }
}
