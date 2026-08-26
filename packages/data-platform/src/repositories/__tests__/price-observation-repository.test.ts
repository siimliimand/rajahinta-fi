import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import type {
  PriceObservation,
  IPriceObservationPort,
} from '@rajahinta/core-domain';
import { DrizzlePriceObservationRepository } from '../price-observation.repository';

// ---------------------------------------------------------------------------
// Test harness
//
// The package test convention is no-DB unit tests (see
// tax-rate-repository.test.ts). Instead of mirroring the SQL semantics in a
// hand-written predicate (which can drift from the real query), this suite
// captures the exact drizzle builder calls the repository makes with a chain
// stub, then REPLAYS them against a real (never-connected) drizzle instance
// and asserts on the generated SQL via `.toSQL()`. pg.Pool connects lazily,
// so no network touch happens; queries are only rendered, never executed.
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Chainable db stub: records every builder method call and resolves to
 * `rows` when the builder is awaited.
 */
function createRecordingDb(rows: () => unknown): {
  db: DrizzleDatabase;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const stub: unknown = new Proxy(
    {},
    {
      get(_target, prop, _receiver) {
        if (prop === 'then') {
          return (resolve: unknown, reject: unknown) =>
            Promise.resolve()
              .then(rows)
              .then(resolve as never, reject as never);
        }
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return stub;
        };
      },
    },
  );
  return { db: stub as DrizzleDatabase, calls };
}

/** Lazy, never-connected pool — only used to render builders to SQL. */
const renderPool = new Pool({
  connectionString: 'postgres://rajahinta:rajahinta@127.0.0.1:5432/rajahinta_test',
});
const renderDb = drizzle(renderPool);

/** Replay captured builder calls on a real drizzle instance and render SQL. */
function renderSql(calls: RecordedCall[]): { sql: string; params: unknown[] } {
  let builder: Record<string, unknown> = renderDb as unknown as Record<string, unknown>;
  for (const { method, args } of calls) {
    // .apply preserves `this` — drizzle builders are class methods that
    // read this.session / this.config while chaining.
    const fn = builder[method] as (...a: unknown[]) => unknown;
    builder = fn.apply(builder, args) as Record<string, unknown>;
  }
  return (builder as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FROM = new Date('2026-06-01T00:00:00.000Z');
const TO = new Date('2026-07-01T00:00:00.000Z');

const fullObservation: PriceObservation = {
  productId: 7,
  merchant: 'systembolaget',
  retailOfferId: 55,
  observedAt: new Date('2026-06-15T08:00:00.000Z'),
  foreignRetailPriceCents: 1099,
  transportOfferId: 12,
  transportCostCents: 890,
  exciseRuleVersion: { ruleId: 31, versionLabel: '2026-01' },
  containerDutyRuleVersion: { ruleId: 32, versionLabel: '2026-01' },
  landedCostCents: 2531,
  inputReliability: {
    retailPrice: 'VERIFIED',
    transport: 'VERIFIED',
    exciseRule: 'VERIFIED',
    containerDutyRule: 'ESTIMATED',
  },
  confidence: 'MEDIUM',
};

function makeRepo(rows: () => unknown): {
  repo: DrizzlePriceObservationRepository;
  calls: RecordedCall[];
} {
  const { db, calls } = createRecordingDb(rows);
  return { repo: new DrizzlePriceObservationRepository(db), calls };
}

// ---------------------------------------------------------------------------
// append — domain → row mapping (insert only)
// ---------------------------------------------------------------------------

describe('DrizzlePriceObservationRepository.append', () => {
  it('inserts into price_observations and returns the assigned id', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 42 }]);

    const result = await repo.append(fullObservation);

    expect(result).toEqual({ id: 42 });
    expect(calls[0].method).toBe('insert');
    expect(renderSql(calls).sql).toContain('insert into "price_observations"');
    expect(renderSql(calls).sql).toContain('returning "id"');
  });

  it('maps rule-version snapshots to FK ids and drops versionLabel', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.append(fullObservation);

    const values = calls.find((c) => c.method === 'values')!.args[0];
    // toEqual asserts the EXACT key set — a leaked versionLabel key fails.
    expect(values).toEqual({
      productId: 7,
      merchant: 'systembolaget',
      retailOfferId: 55,
      observedAt: fullObservation.observedAt,
      foreignRetailPriceCents: 1099,
      transportOfferId: 12,
      transportCostCents: 890,
      exciseRuleVersionId: 31,
      containerDutyRuleVersionId: 32,
      landedCostCents: 2531,
      inputReliability: fullObservation.inputReliability,
      confidence: 'MEDIUM',
    });
  });

  it('maps null snapshots and missing transport to null FKs', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 2 }]);

    await repo.append({
      ...fullObservation,
      transportOfferId: null,
      exciseRuleVersion: null,
      containerDutyRuleVersion: null,
    });

    const values = calls.find((c) => c.method === 'values')!.args[0] as Record<string, unknown>;
    expect(values.transportOfferId).toBeNull();
    expect(values.exciseRuleVersionId).toBeNull();
    expect(values.containerDutyRuleVersionId).toBeNull();
  });

  it('exposes no update or delete operations', () => {
    const { repo } = makeRepo(() => []);
    expect(typeof repo.append).toBe('function');
    expect((repo as unknown as Record<string, unknown>)['update']).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>)['delete']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Port conformance — the repository IS the IPriceObservationPort adapter
// ---------------------------------------------------------------------------

describe('IPriceObservationPort conformance', () => {
  it('satisfies the port contract (compile-time) and appends through it', async () => {
    const { repo } = makeRepo(() => [{ id: 9 }]);
    const port: IPriceObservationPort = repo;
    await expect(port.append(fullObservation)).resolves.toEqual({ id: 9 });
  });
});

// ---------------------------------------------------------------------------
// Range reads — half-open [from, to) construction
// ---------------------------------------------------------------------------

describe('findByProductRange', () => {
  it('filters by product over a half-open observedAt range, no merchant filter', async () => {
    const rows = [{ id: 1 }];
    const { repo, calls } = makeRepo(() => rows);

    const result = await repo.findByProductRange(7, FROM, TO);

    expect(result).toBe(rows);
    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_observations"."product_id" = $1');
    expect(sql).toContain('"price_observations"."observed_at" >= $2');
    expect(sql).toContain('"price_observations"."observed_at" < $3');
    // from inclusive, to exclusive — bucket-boundary observations land in
    // exactly one aggregation window.
    expect(sql).not.toContain('<= $');
    // the merchant column may appear in the unqualified select list, but
    // there must be no merchant PREDICATE without a merchant filter
    expect(sql).not.toContain('"price_observations"."merchant"');
    // the pg timestamp encoder renders Date params as ISO strings
    expect(params).toEqual([7, FROM.toISOString(), TO.toISOString()]);
  });

  it('adds a merchant filter when one is given', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByProductRange(7, FROM, TO, 'alko');

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_observations"."merchant" = $4');
    expect(params).toEqual([7, FROM.toISOString(), TO.toISOString(), 'alko']);
  });
});

describe('findByMerchantOfferRange', () => {
  it('filters by merchant + retail offer over a half-open range', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByMerchantOfferRange('alko', 55, FROM, TO);

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_observations"."merchant" = $1');
    expect(sql).toContain('"price_observations"."retail_offer_id" = $2');
    expect(sql).toContain('"price_observations"."observed_at" >= $3');
    expect(sql).toContain('"price_observations"."observed_at" < $4');
    expect(params).toEqual(['alko', 55, FROM.toISOString(), TO.toISOString()]);
  });
});

describe('findByMerchantProductRange', () => {
  it('filters by merchant + product over a half-open range', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByMerchantProductRange('alko', 7, FROM, TO);

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_observations"."merchant" = $1');
    expect(sql).toContain('"price_observations"."product_id" = $2');
    expect(sql).toContain('"price_observations"."observed_at" >= $3');
    expect(sql).toContain('"price_observations"."observed_at" < $4');
    expect(params).toEqual(['alko', 7, FROM.toISOString(), TO.toISOString()]);
  });
});

describe('series ordering', () => {
  it('orders range reads by (observedAt, id) ascending for stable series order', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByProductRange(7, FROM, TO);
    await repo.findByMerchantOfferRange('alko', 55, FROM, TO);
    await repo.findByMerchantProductRange('alko', 7, FROM, TO);

    expect(calls.filter((c) => c.method === 'select')).toHaveLength(3);
    for (const slice of splitQueryCalls(calls)) {
      expect(renderSql(slice).sql).toContain(
        'order by "price_observations"."observed_at" asc, "price_observations"."id" asc',
      );
    }
  });
});

// Each awaited repo method produces one contiguous run of recorded calls
// starting at a `select`. This splits the call log back into per-query runs.
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

// ---------------------------------------------------------------------------
// Incremental watermark scan — activity per product since a cursor
// ---------------------------------------------------------------------------

describe('findProductActivitySince', () => {
  it('groups by product with min/max observedAt over an inclusive lower bound', async () => {
    const rows = [
      { productId: 7, firstObservedAt: FROM, lastObservedAt: TO },
    ];
    const { repo, calls } = makeRepo(() => rows);

    const result = await repo.findProductActivitySince(FROM);

      expect(result).toBe(rows);
      const { sql, params } = renderSql(calls);
      expect(sql).toContain('min("observed_at")');
      expect(sql).toContain('max("observed_at")');
    expect(sql).toContain('"price_observations"."observed_at" >= $1');
    // Inclusive boundary (>=, never >) — the watermark instant is
    // re-scanned so late same-instant appends cannot be skipped.
    expect(sql).not.toContain('> $');
    expect(sql).toContain('group by "price_observations"."product_id"');
    expect(sql).toContain('order by "price_observations"."product_id" asc');
    expect(params).toEqual([FROM.toISOString()]);
  });

  it('returns an empty list when nothing was observed since the cursor', async () => {
    const { repo } = makeRepo(() => []);

    await expect(repo.findProductActivitySince(FROM)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Earliest observation date
// ---------------------------------------------------------------------------

describe('findEarliestObservedAt', () => {
  it('selects min observedAt via ascending index order, limit 1', async () => {
    const earliest = new Date('2026-01-05T00:00:00.000Z');
    const { repo, calls } = makeRepo(() => [{ observedAt: earliest }]);

    const result = await repo.findEarliestObservedAt(7);

    expect(result).toBe(earliest);
    const { sql, params } = renderSql(calls);
    expect(sql).toContain('select "observed_at" from "price_observations"');
    expect(sql).toContain('"price_observations"."product_id" = $1');
    expect(sql).toContain('order by "price_observations"."observed_at" asc');
    expect(sql).toContain('limit $2');
    expect(params).toEqual([7, 1]);
  });

  it('applies the optional merchant filter', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findEarliestObservedAt(7, 'alko');

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_observations"."merchant" = $2');
    expect(params).toEqual([7, 'alko', 1]);
  });

  it('returns null when no observations exist', async () => {
    const { repo } = makeRepo(() => []);

    await expect(repo.findEarliestObservedAt(7)).resolves.toBeNull();
  });
});
