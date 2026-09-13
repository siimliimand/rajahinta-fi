import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { ProductRepository } from '../../abstracts';
import { DrizzleProductRepository } from '../product.repository';

// ---------------------------------------------------------------------------
// Test harness
//
// The package test convention is no-DB unit tests (see
// price-observation-repository.test.ts): pg.Pool connects lazily, so queries
// are only rendered, never executed. This suite differs from that harness in
// one way: findOffers composes its latest-per-merchant filter from a
// SUB-QUERY, and the sub-query's builder must be alive when the outer query
// renders (drizzle embeds it through the recorded `where` argument), so a
// post-hoc replay of a plain recording stub cannot render the composed SQL.
// Each recorded builder call is therefore FORWARDED to a real drizzle builder
// as it happens, and only the await is faked: `then` resolves the canned rows
// without touching the network. Rendering then replays the recorded calls the
// same way price-observation-repository.test.ts does.
//
// The canned rows stand in for the DB OUTPUT of the rendered idiom (the
// harness cannot execute pg SQL); the SQL assertions pin the mechanism that
// produces exactly those rows.
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** Lazy, never-connected pool — only used to render builders to SQL. */
const renderPool = new Pool({
  connectionString: 'postgres://rajahinta:rajahinta@127.0.0.1:5432/rajahinta_test',
});
const renderDb = drizzle(renderPool);

/**
 * Methods drizzle itself calls on embedded sub-queries while rendering —
 * never part of the repository's own chain-building, so not recorded.
 * Without this skip list, rendering would pollute the recording and break
 * the per-query call splitting.
 */
const RENDER_ONLY = new Set(['getSQL', 'shouldOmitSQLParens']);

function createForwardingDb(rows: () => unknown): {
  db: DrizzleDatabase;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const wrap = (real: unknown): unknown =>
    new Proxy(real as Record<string, unknown>, {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve: unknown, reject: unknown) =>
            Promise.resolve()
              .then(rows)
              .then(resolve as never, reject as never);
        }
        const value = Reflect.get(target, prop, target);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            if (typeof prop === 'string' && !RENDER_ONLY.has(prop)) {
              calls.push({ method: prop, args });
            }
            const result = (value as (...a: unknown[]) => unknown).apply(
              target,
              args,
            );
            return result !== null && typeof result === 'object'
              ? wrap(result)
              : result;
          };
        }
        return value;
      },
    });
  return { db: wrap(renderDb) as DrizzleDatabase, calls };
}

/** Replay captured builder calls on a real drizzle instance and render SQL. */
function renderSql(calls: RecordedCall[]): { sql: string; params: unknown[] } {
  let builder: Record<string, unknown> = renderDb as unknown as Record<string, unknown>;
  for (const { method, args } of calls) {
    const fn = builder[method] as (...a: unknown[]) => unknown;
    builder = fn.apply(builder, args) as Record<string, unknown>;
  }
  return (builder as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

// Each awaited repo method produces one contiguous run of recorded calls
// starting at a `select` (findOffers makes two: the sub-query, then the outer
// read). This splits the call log back into per-query runs.
function splitQueryCalls(calls: RecordedCall[]): RecordedCall[][] {
  const slices: RecordedCall[][] = [];
  let current: RecordedCall[] = [];
  for (const call of calls) {
    if (call.method === 'select' && current.length > 0) {
      slices.push(current);
      current = [];
    }
    current.push(call);
  }
  if (current.length > 0) slices.push(current);
  return slices;
}

function makeRepo(rows: () => unknown): {
  repo: DrizzleProductRepository;
  calls: RecordedCall[];
} {
  const { db, calls } = createForwardingDb(rows);
  return { repo: new DrizzleProductRepository(db), calls };
}

/**
 * The max-id-per-merchant sub-query every findOffers read must build: exact
 * pin (not a substring) so the latest-row rule cannot drift — latest is the
 * max id, never a max(observed_at), and nothing else is selected or filtered.
 */
function expectLatestPerMerchantSubquery(
  run: RecordedCall[],
  productId: number,
): void {
  const { sql, params } = renderSql(run);
  expect(sql).toBe(
    'select "merchant", max("id") from "retail_offers" ' +
      'where "retail_offers"."product_id" = $1 ' +
      'group by "retail_offers"."merchant"',
  );
  expect(params).toEqual([productId]);
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------
// findOffers — latest row per (product, merchant)
//
// Mirrors the D1 twin's cases (task 4.1, change
// 2026-09-13-daily-scrape-cadence-current-offers): the table is
// append-per-scrape, so findOffers must collapse the scrape history to one
// row per merchant — the max id, matching the (observed_at, id) recency the
// upsertOffer change detection uses.
// ---------------------------------------------------------------------------

describe('DrizzleProductRepository.findOffers — latest row per (product, merchant)', () => {
  it('returns a single row per merchant on duplicate scrapes — the later id', async () => {
    // Two scrape runs, same (product 31, merchant alko), same price; pg
    // returns only the later row (511).
    const latest = { id: 511, merchant: 'alko', productId: 31, priceCents: 249 };
    const { repo, calls } = makeRepo(() => [latest]);

    const offers = await repo.findOffers(31);

    expect(offers).toEqual([latest]);
    const [subquery, outer] = splitQueryCalls(calls);
    expectLatestPerMerchantSubquery(subquery, 31);
    const { sql } = renderSql(outer);
    expect(sql).toContain(
      '"retail_offers"."id" in (select "merchant", max("id") from "retail_offers" ' +
        'where "retail_offers"."product_id" = $1 group by "retail_offers"."merchant")',
    );
    expect(sql).toContain('order by "retail_offers"."id" asc');
  });

  it('supersedes the older row when the price moves — newest row only', async () => {
    // Price moved 17.99 → 19.99 between scrapes; only the current price row.
    const current = { id: 521, merchant: 'alko', productId: 40, priceCents: 1999 };
    const { repo, calls } = makeRepo(() => [current]);

    const offers = await repo.findOffers(40);

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe(521);
    expect(offers[0].priceCents).toBe(1999);
    const [subquery] = splitQueryCalls(calls);
    expectLatestPerMerchantSubquery(subquery, 40);
  });

  it('returns one latest row for each of two merchants, id ASC', async () => {
    // alko scraped twice (latest 531), eu-import once (532) — one row per
    // merchant, alko's being its latest scrape.
    const rows = [
      { id: 531, merchant: 'alko', productId: 41, priceCents: 299 },
      { id: 532, merchant: 'eu-import', productId: 41, priceCents: 350 },
    ];
    const { repo, calls } = makeRepo(() => rows);

    const offers = await repo.findOffers(41);

    expect(offers).toEqual(rows);
    const [subquery] = splitQueryCalls(calls);
    expectLatestPerMerchantSubquery(subquery, 41);
    const { sql } = renderSql(splitQueryCalls(calls)[1]);
    // Deterministic total order — the caller-visible row order is pinned.
    expect(sql).toContain('order by "retail_offers"."id" asc');
  });

  it('does not leak other products — the sub-query is the only product gate', async () => {
    // Product 42 has no scrape rows; pg returns nothing.
    const { repo, calls } = makeRepo(() => []);

    const offers = await repo.findOffers(42);

    expect(offers).toEqual([]);
    const [subquery, outer] = splitQueryCalls(calls);
    expectLatestPerMerchantSubquery(subquery, 42);
    // The embedded sub-query carries the ONLY product filter, so no row from
    // another product can enter through the outer read.
    const { sql, params } = renderSql(outer);
    expect(sql).toContain('"retail_offers"."product_id" = $1');
    expect(params).toEqual([42]);
  });

  it('satisfies the shared abstract contract — signature unchanged', async () => {
    const { repo } = makeRepo(() => []);
    const abstract: ProductRepository = repo;
    await expect(abstract.findOffers(7)).resolves.toEqual([]);
  });
});
