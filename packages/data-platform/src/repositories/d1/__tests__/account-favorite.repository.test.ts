/**
 * D1 account-favorites repository — real-SQLite tests (task 1.2,
 * change add-product-favorites) on the node:sqlite harness with the
 * committed migrations applied. Covers the create lifecycle (cap
 * before duplicate per design D3's risk note, best-effort saved-price
 * capture per design D2/D4), the duplicate semantics of the
 * (account_id, product_id) unique index (migration 0030), the
 * account-scoped delete, and the read-model join's freshness window —
 * the PRICE sweep's closed 7-day lookback over product-wide daily
 * buckets only.
 *
 * @module D1AccountFavoritesRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1AccountFavoritesRepository,
  DuplicateFavoriteError,
  FavoritesCapReachedError,
  FAVORITES_CAP,
} from '../account-favorite.repository';

const { db, d1 } = openMigratedD1();
const favorites = new D1AccountFavoritesRepository(d1);

/** Fresh DB per test would be cleaner; ids stay unique per test instead. */
let accountIdSeq = 400;
function seedAccount(): number {
  const id = ++accountIdSeq;
  db.prepare(`INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`).run(
    id,
    `user-${id}@test.invalid`,
    `user-${id}@test.invalid`,
  );
  return id;
}

let productIdSeq = 1200;
function seedProduct(): number {
  const id = ++productIdSeq;
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'm', 'b', 'beer', 0.5, 'can', 'beer')`,
  ).run(id, `product-${id}`);
  return id;
}

/** Direct-row seed — the cap test needs 100 rows without 100 captures. */
function seedFavoriteRow(accountId: number, productId: number): void {
  db.prepare(
    `INSERT INTO account_favorites (account_id, product_id) VALUES (?, ?)`,
  ).run(accountId, productId);
}

/**
 * One product-wide daily summary bucket (merchant NULL) — the only
 * bucket shape the freshness read may see.
 */
function seedDailyClose(
  productId: number,
  periodStart: string,
  priceCloseCents: number,
  merchant: string | null = null,
  granularity: string = 'daily',
): void {
  db.prepare(
    `INSERT INTO price_history_summaries (
        granularity, period_start, product_id, merchant,
        price_open_cents, price_close_cents, price_min_cents, price_max_cents, price_avg_cents,
        landed_cost_open_cents, landed_cost_close_cents, landed_cost_min_cents,
        landed_cost_max_cents, landed_cost_avg_cents,
        observation_count, strictest_reliability
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    granularity,
    periodStart,
    productId,
    merchant,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    1,
    'ESTIMATED',
  );
}

/** UTC day anchor offset from today — matches the repository's window arithmetic. */
function dayFromToday(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe('D1AccountFavoritesRepository.create', () => {
  it('creates the favorite and captures the newest fresh product-wide daily close', async () => {
    const accountId = seedAccount();
    const productId = seedProduct();
    // Inserted newest-first on purpose: the capture must select by
    // period order, not by insertion order.
    seedDailyClose(productId, dayFromToday(-1), 1199);
    seedDailyClose(productId, dayFromToday(-3), 1149);

    const row = await favorites.create(accountId, productId);

    expect(row.id).toBeGreaterThan(0);
    expect(row.accountId).toBe(accountId);
    expect(row.productId).toBe(productId);
    expect(row.savedPriceCents).toBe(1199);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('stores a null saved price when the product has no summaries at all', async () => {
    const accountId = seedAccount();
    const productId = seedProduct();

    const row = await favorites.create(accountId, productId);

    expect(row.savedPriceCents).toBeNull();
  });

  it('stores a null saved price when only stale summaries exist (outside the 7-day window)', async () => {
    const accountId = seedAccount();
    const productId = seedProduct();
    seedDailyClose(productId, dayFromToday(-8), 999);

    const row = await favorites.create(accountId, productId);

    expect(row.savedPriceCents).toBeNull();
  });

  it('captures only product-wide daily buckets — merchant and weekly buckets never feed the saved price', async () => {
    const accountId = seedAccount();
    const productId = seedProduct();
    seedDailyClose(productId, dayFromToday(-1), 777, 'alko'); // merchant bucket
    seedDailyClose(productId, dayFromToday(-1), 555, null, 'weekly'); // wrong granularity
    seedDailyClose(productId, dayFromToday(-2), 1180); // the product-wide daily truth

    const row = await favorites.create(accountId, productId);

    expect(row.savedPriceCents).toBe(1180);
  });

  it('rejects a duplicate (account, product) pair and leaves the original row untouched', async () => {
    const accountId = seedAccount();
    const productId = seedProduct();
    seedDailyClose(productId, dayFromToday(-1), 1199);
    const first = await favorites.create(accountId, productId);

    await expect(favorites.create(accountId, productId)).rejects.toThrowError(
      DuplicateFavoriteError,
    );

    const listed = await favorites.listByAccount(accountId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(first.id);
    expect(listed[0]!.savedPriceCents).toBe(1199);
  });

  it('scopes duplicates per account: another account can favorite the same product', async () => {
    const accountId = seedAccount();
    const otherAccountId = seedAccount();
    const productId = seedProduct();
    await favorites.create(accountId, productId);

    const other = await favorites.create(otherAccountId, productId);

    expect(other.accountId).toBe(otherAccountId);
    expect(other.productId).toBe(productId);
  });

  it('lets an unknown product fail on the FK naturally — the route owns the 404 (design D5)', async () => {
    const accountId = seedAccount();

    await expect(favorites.create(accountId, 987654)).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe('D1AccountFavoritesRepository cap (design D3)', () => {
  it('rejects at cap before any duplicate lookup — an over-cap account gets the cap error even for an already-favorited product', async () => {
    const accountId = seedAccount();
    const firstProductId = seedProduct();
    seedFavoriteRow(accountId, firstProductId); // a duplicate-in-waiting
    for (let i = 0; i < FAVORITES_CAP - 1; i++) {
      seedFavoriteRow(accountId, seedProduct());
    }

    // Over-cap wins over duplicate (the change's risk note)…
    await expect(
      favorites.create(accountId, firstProductId),
    ).rejects.toThrowError(FavoritesCapReachedError);

    // …and over a fresh product too.
    await expect(favorites.create(accountId, seedProduct())).rejects.toThrowError(
      FavoritesCapReachedError,
    );
    // The duplicate-in-waiting was never transformed by the failed creates.
    const listed = await favorites.listByAccount(accountId);
    expect(listed).toHaveLength(FAVORITES_CAP);
  });

  it('counts only the creating account toward the cap — another account still saves the same product', async () => {
    const fullAccountId = seedAccount();
    for (let i = 0; i < FAVORITES_CAP; i++) {
      seedFavoriteRow(fullAccountId, seedProduct());
    }
    const otherAccountId = seedAccount();
    const sharedProductId = seedProduct();

    const row = await favorites.create(otherAccountId, sharedProductId);

    expect(row.accountId).toBe(otherAccountId);
  });
});

describe('D1AccountFavoritesRepository.delete', () => {
  it('removes the account’s own favorite and reports the removal', async () => {
    const accountId = seedAccount();
    const productId = seedProduct();
    await favorites.create(accountId, productId);

    expect(await favorites.delete(accountId, productId)).toBe(true);
    expect(await favorites.listByAccount(accountId)).toHaveLength(0);
    // A repeat matches no row — the route turns false into 404.
    expect(await favorites.delete(accountId, productId)).toBe(false);
  });

  it('is account-scoped: another account’s favorite on the same product is untouchable', async () => {
    const ownerId = seedAccount();
    const foreignId = seedAccount();
    const productId = seedProduct();
    await favorites.create(ownerId, productId);

    expect(await favorites.delete(foreignId, productId)).toBe(false);

    const listed = await favorites.listByAccount(ownerId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.productId).toBe(productId);
  });
});

describe('D1AccountFavoritesRepository.listByAccount (design D4 read model)', () => {
  it('joins the fresh current price and computes Δ = current − saved; rows without a saved price get no Δ', async () => {
    const accountId = seedAccount();
    const pricedId = seedProduct();
    const unsavedPriceId = seedProduct();

    // Saved at 1149, price since rose to 1199.
    seedDailyClose(pricedId, dayFromToday(-2), 1149);
    await favorites.create(accountId, pricedId);
    seedDailyClose(pricedId, dayFromToday(-1), 1199);

    // No summary at save time (null saved), but a fresh price exists now.
    await favorites.create(accountId, unsavedPriceId);
    seedDailyClose(unsavedPriceId, dayFromToday(-1), 900);

    const listed = await favorites.listByAccount(accountId);
    expect(listed).toHaveLength(2);

    const priced = listed.find((row) => row.productId === pricedId)!;
    expect(priced.savedPriceCents).toBe(1149);
    expect(priced.currentPriceCents).toBe(1199);
    expect(priced.deltaCents).toBe(50);

    const unsaved = listed.find((row) => row.productId === unsavedPriceId)!;
    expect(unsaved.savedPriceCents).toBeNull();
    expect(unsaved.currentPriceCents).toBe(900);
    expect(unsaved.deltaCents).toBeNull();
  });

  it('returns the row with a null current price and no Δ when its summary is missing or stale', async () => {
    const accountId = seedAccount();
    const neverPricedId = seedProduct();
    const stalePricedId = seedProduct();

    await favorites.create(accountId, neverPricedId);

    seedDailyClose(stalePricedId, dayFromToday(-9), 1149);
    await favorites.create(accountId, stalePricedId); // capture saw only the stale bucket
    seedDailyClose(stalePricedId, dayFromToday(-8), 1200); // still stale now

    const listed = await favorites.listByAccount(accountId);
    expect(listed).toHaveLength(2);

    const never = listed.find((row) => row.productId === neverPricedId)!;
    expect(never.currentPriceCents).toBeNull();
    expect(never.deltaCents).toBeNull();

    const stale = listed.find((row) => row.productId === stalePricedId)!;
    // The capture ignored the stale bucket too (same 7-day window), so
    // the row carries no saved price — and no current price to Δ against.
    expect(stale.savedPriceCents).toBeNull();
    expect(stale.currentPriceCents).toBeNull();
    expect(stale.deltaCents).toBeNull();
  });

  it('reads the newest product-wide bucket inside the window and orders rows by id, per account only', async () => {
    const accountId = seedAccount();
    const otherAccountId = seedAccount();
    const productId = seedProduct();
    const otherProductId = seedProduct();

    seedDailyClose(productId, dayFromToday(-1), 1050, 'alko'); // never current
    seedDailyClose(productId, dayFromToday(-3), 1000);
    seedDailyClose(productId, dayFromToday(-1), 1010);
    seedDailyClose(otherProductId, dayFromToday(-2), 1300);

    const first = await favorites.create(accountId, productId);
    const second = await favorites.create(accountId, otherProductId);
    await favorites.create(otherAccountId, productId); // foreign row

    const listed = await favorites.listByAccount(accountId);
    expect(listed.map((row) => row.id)).toEqual([first.id, second.id]);

    const priceRow = listed.find((row) => row.productId === productId)!;
    expect(priceRow.currentPriceCents).toBe(1010); // newest product-wide, not the merchant bucket
    expect(priceRow.deltaCents).toBe(0); // captured the same fresh close
  });

  it('returns an empty list for an account without favorites', async () => {
    expect(await favorites.listByAccount(seedAccount())).toEqual([]);
  });
});
