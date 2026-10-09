/**
 * D1 AccountFavoritesRepository — per-account saved products
 * (task 1.2, change add-product-favorites; design D2/D4). CRUD over
 * `account_favorites` with account scoping on every mutation: an
 * (account, product) pair belonging to another account matches no row
 * instead of deleting cross-account (the price-alert saved-scenario
 * precedent). ISO-8601 TEXT instants convert to Date at the repository
 * boundary (design D2, the price-alert convention).
 *
 * ## Cap before duplicate (design D3)
 *
 * create() counts the account's rows first and raises the cap domain
 * error at FAVORITES_CAP (100) BEFORE any duplicate lookup — the
 * change's risk note demands an over-cap account always gets the cap
 * message, never the duplicate 409. The duplicate guard itself is the
 * (account_id, product_id) UNIQUE index of migration 0030, translated
 * into DuplicateFavoriteError the same way the calculation-outcome
 * repository translates its pair violation (message sniffing on the
 * table-qualified constraint text).
 *
 * ## Saved-price capture and the read model (design D2/D4)
 *
 * savedPriceCents is captured best-effort at create time: the product's
 * newest product-wide daily close (merchant IS NULL) within the closed
 * 7-day freshness window — the SAME window, ascending ordering, and
 * last-row-is-newest selection the PRICE alert sweep's summary lookback
 * uses (apps/api-worker/src/cron/price-alert-evaluation.ts,
 * SUMMARY_LOOKBACK_DAYS = 7). No fresh bucket stores NULL, and capture
 * trouble never fails the create. listByAccount joins the current price
 * with ONE batched IN lookup over the account's product ids (bounded by
 * the cap — the change's read-amplification note) and computes
 * deltaCents = current − saved at read time; deltas are never stored.
 * A row without a fresh summary still lists, with a null current price
 * and no delta.
 *
 * Unknown products are NOT translated here: products are never deleted
 * and the FK violation propagates naturally (the group-order repository
 * precedent) — the route answers 404 from its own existence check
 * (design D5).
 *
 * The abstract class is co-located with the single concrete
 * implementation (the merchant-reliability precedent) — there is no pg
 * counterpart for this table, so no abstracts.ts contract exists to
 * extend.
 *
 * @module D1AccountFavoritesRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Design D3 — the repository-enforced favorites cap; the route translates a rejection into 400 naming the cap. */
export const FAVORITES_CAP = 100;

/**
 * Freshness lookback (days) for both the saved-price capture and the
 * read-model's current price — the PRICE sweep's `SUMMARY_LOOKBACK_DAYS`
 * (7), one shared definition per design D4. Closed whole-day window on
 * period_start, run day inclusive.
 */
const PRICE_FRESHNESS_DAYS = 7;

/** Stored row — the D2 contract shape before read-model enrichment. */
export interface AccountFavoriteRecord {
  readonly id: number;
  readonly accountId: number;
  readonly productId: number;
  /** Daily product-wide close at save time — null when nothing was fresh (design D2). */
  readonly savedPriceCents: number | null;
  readonly createdAt: Date;
}

/**
 * One listByAccount row (design D4): the stored record joined with the
 * read-time current price. deltaCents is current − saved and is null
 * unless BOTH prices exist — deltas are computed, never stored.
 */
export interface AccountFavoriteListItem extends AccountFavoriteRecord {
  /** Null when the product has no fresh daily summary. */
  readonly currentPriceCents: number | null;
  readonly deltaCents: number | null;
}

/**
 * Thrown by create when the account already holds FAVORITES_CAP rows —
 * the repository-enforced cap (design D3); the route maps it to 400.
 * Raised before any duplicate lookup so over-cap always wins.
 */
export class FavoritesCapReachedError extends Error {
  constructor(
    readonly accountId: number,
    readonly cap: number,
  ) {
    super(
      `account ${accountId} already holds ${cap} favorites — the cap must be ` +
        'released before saving more',
    );
    this.name = 'FavoritesCapReachedError';
  }
}

/**
 * Thrown by create when the (account, product) pair already exists —
 * the migration 0030 UNIQUE index as duplicate guard; the route maps
 * it to 409 exactly like the alerts triple.
 */
export class DuplicateFavoriteError extends Error {
  constructor(
    readonly accountId: number,
    readonly productId: number,
  ) {
    super(
      `product ${productId} is already favorited by account ${accountId} — ` +
        'one favorite per (account, product)',
    );
    this.name = 'DuplicateFavoriteError';
  }
}

/** Account-favorites management contract (design D2/D4), shared by the favorites routes (task 1.3). */
@Injectable()
export abstract class AccountFavoritesRepository {
  /**
   * Save one product for one account. Rejects with FavoritesCapReachedError
   * when the account is at cap (checked first — over-cap wins) and with
   * DuplicateFavoriteError on the (account, product) unique constraint.
   * The saved-price capture is best-effort: no fresh summary stores null.
   */
  abstract create(accountId: number, productId: number): Promise<AccountFavoriteRecord>;

  /** All of one account's favorites with read-model price fields, deterministic order. */
  abstract listByAccount(accountId: number): Promise<AccountFavoriteListItem[]>;

  /** Account-scoped delete; false when the row is absent or foreign (route: 404). */
  abstract delete(accountId: number, productId: number): Promise<boolean>;
}

/** Raw D1 account_favorites row. */
interface D1AccountFavoriteRow {
  readonly id: number;
  readonly account_id: number;
  readonly product_id: number;
  readonly saved_price_cents: number | null;
  readonly created_at: string;
}

function toContractFavorite(row: D1AccountFavoriteRow): AccountFavoriteRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    savedPriceCents: row.saved_price_cents,
    createdAt: new Date(row.created_at),
  };
}

/**
 * The closed [fromDay, toDay] daily-period window the freshness lookback
 * covers — byte-for-byte the PRICE sweep's lookbackWindow: whole-day
 * anchors, the run day inclusive, exactly PRICE_FRESHNESS_DAYS back.
 */
function freshnessWindow(now: Date): { fromDay: string; toDay: string } {
  return {
    toDay: now.toISOString().slice(0, 10),
    fromDay: new Date(now.getTime() - PRICE_FRESHNESS_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10),
  };
}

/** product-wide daily close columns for one product id — the price sweep's latestClose semantics. */
interface SummaryCloseRow {
  readonly product_id: number;
  readonly price_close_cents: number;
}

/**
 * One batched freshness read over many products (design D4's anti-N+1
 * bound). Product-wide daily buckets only (merchant IS NULL — the range
 * read's binary semantics), closed freshness window, ascending period
 * order so the LAST row per product is the newest bucket — the same
 * selection the PRICE sweep's latestMaterializedPriceCents makes. The
 * cap bounds the IN list (≤ 100 ids).
 */
const FRESH_CLOSE_SQL_PREFIX = `
  SELECT product_id, price_close_cents
    FROM price_history_summaries
   WHERE granularity = 'daily'
     AND merchant IS NULL
     AND period_start >= ? AND period_start <= ?
     AND product_id IN (`;

function freshCloseSql(productCount: number): string {
  const placeholders = Array.from({ length: productCount }, () => '?').join(', ');
  return `${FRESH_CLOSE_SQL_PREFIX}${placeholders})
   ORDER BY period_start ASC`;
}

// The favorites columns in SELECT/RETURNING order.
const FAVORITE_COLUMNS = `
  id, account_id, product_id, saved_price_cents, created_at`;

const COUNT_BY_ACCOUNT_SQL = `
  SELECT COUNT(*) AS favorite_count FROM account_favorites WHERE account_id = ?`;

// created_at rides the column default (migration 0030) like price_alerts' stamps.
const INSERT_SQL = `
  INSERT INTO account_favorites (account_id, product_id, saved_price_cents)
  VALUES (?, ?, ?)
  RETURNING ${FAVORITE_COLUMNS}`;

const FIND_BY_ACCOUNT_SQL = `
  SELECT ${FAVORITE_COLUMNS} FROM account_favorites WHERE account_id = ? ORDER BY id`;

const DELETE_SQL = `
  DELETE FROM account_favorites WHERE product_id = ? AND account_id = ?`;

/** Narrow the constraint failure onto this table's pair index — the calculation-outcome precedent. */
function isUniqueViolationOnFavoritePair(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes('account_favorites')
  );
}

@Injectable()
export class D1AccountFavoritesRepository extends AccountFavoritesRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /**
   * Newest fresh product-wide daily close per product id, or an empty
   * map when no product has a bucket inside the freshness window. One
   * parameterized query for the whole id set.
   */
  private async latestFreshClosesById(
    productIds: readonly number[],
  ): Promise<Map<number, number>> {
    if (productIds.length === 0) {
      return new Map();
    }
    const { fromDay, toDay } = freshnessWindow(new Date());
    const rows = (
      await this.d1
        .prepare(freshCloseSql(productIds.length))
        .bind(fromDay, toDay, ...productIds)
        .all<SummaryCloseRow>()
    ).results;
    // Ascending period order ⇒ the last row seen per product is the
    // newest bucket (the PRICE sweep's last-row-is-newest selection).
    const latest = new Map<number, number>();
    for (const row of rows) {
      latest.set(row.product_id, row.price_close_cents);
    }
    return latest;
  }

  /** @inheritdoc */
  async create(accountId: number, productId: number): Promise<AccountFavoriteRecord> {
    // Cap BEFORE any duplicate lookup (design D3's risk note: an
    // over-cap account always gets the cap message, never the 409).
    const count = await this.d1
      .prepare(COUNT_BY_ACCOUNT_SQL)
      .bind(accountId)
      .first<{ favorite_count: number }>();
    if ((count?.favorite_count ?? 0) >= FAVORITES_CAP) {
      throw new FavoritesCapReachedError(accountId, FAVORITES_CAP);
    }

    // Best-effort saved-price capture (design D2): no fresh bucket →
    // NULL, and capture trouble must never fail the create.
    let savedPriceCents: number | null = null;
    try {
      const closes = await this.latestFreshClosesById([productId]);
      savedPriceCents = closes.get(productId) ?? null;
    } catch {
      savedPriceCents = null;
    }

    try {
      const row = await this.d1
        .prepare(INSERT_SQL)
        .bind(accountId, productId, savedPriceCents)
        .first<D1AccountFavoriteRow>();
      if (!row) {
        throw new Error('account_favorites INSERT .. RETURNING returned no row');
      }
      return toContractFavorite(row);
    } catch (error) {
      if (isUniqueViolationOnFavoritePair(error)) {
        throw new DuplicateFavoriteError(accountId, productId);
      }
      // FK failures (unknown product) propagate naturally — the route
      // answers 404 from its own existence check (design D5).
      throw error;
    }
  }

  /** @inheritdoc */
  async listByAccount(accountId: number): Promise<AccountFavoriteListItem[]> {
    const rows = (
      await this.d1.prepare(FIND_BY_ACCOUNT_SQL).bind(accountId).all<D1AccountFavoriteRow>()
    ).results;
    if (rows.length === 0) {
      return [];
    }
    // ONE batched summary lookup for the whole page (design D4) — never
    // a query per row; the cap bounds the IN list.
    const closes = await this.latestFreshClosesById(
      rows.map((row) => row.product_id),
    );
    return rows.map((row) => {
      const savedPriceCents = row.saved_price_cents;
      const currentPriceCents = closes.get(row.product_id) ?? null;
      return {
        ...toContractFavorite(row),
        currentPriceCents,
        // Δ renders only when both prices exist — computed, never stored.
        deltaCents:
          savedPriceCents !== null && currentPriceCents !== null
            ? currentPriceCents - savedPriceCents
            : null,
      };
    });
  }

  /** @inheritdoc */
  async delete(accountId: number, productId: number): Promise<boolean> {
    const result = await this.d1.prepare(DELETE_SQL).bind(productId, accountId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}
