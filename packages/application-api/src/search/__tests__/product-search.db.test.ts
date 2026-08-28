/**
 * Ranked product search — PostgreSQL integration tests (task 5.1/5.3,
 * change technical-assessment-remediation).
 *
 * ## TEST_DATABASE_URL gate
 *
 * The pg_trgm matching and ranking semantics live in SQL, so these tests
 * run only against a real PostgreSQL with the schema applied and the
 * pg_trgm extension available. Without TEST_DATABASE_URL they are
 * skipped with an explanatory message:
 *
 * ```bash
 * docker run -d --name rajahinta-test-pg \
 *   -e POSTGRES_USER=rajahinta -e POSTGRES_PASSWORD=secret \
 *   -e POSTGRES_DB=rajahinta_test -p 5432:5432 postgres:16
 *
 * # Apply schema via Drizzle migrations (single source of truth):
 * for f in packages/data-platform/drizzle/0*.sql; do
 *   sed 's/^--> statement-breakpoint$//' "$f" | \
 *     PGPASSWORD=secret psql -h localhost -U rajahinta -d rajahinta_test
 * done
 *
 * TEST_DATABASE_URL=postgres://rajahinta:secret@localhost:5432/rajahinta_test \
 *   pnpm --filter @rajahinta/application-api test -- --run \
 *   src/search/__tests__/product-search.db.test.ts
 * ```
 *
 * ## What these tests assert
 *
 * 1. "karhu" matches products by name AND by brand (recall over the
 *    three columns) and excludes non-matches.
 * 2. The result order is deterministic across repeated identical calls
 *    (similarity DESC, product id ASC tiebreak).
 * 3. Partial-word queries ("karh") still match via the ILIKE recall
 *    filter even when trigram similarity alone would score them low.
 *
 * Everything goes through the real DrizzleProductRepository — no direct
 * pg/drizzle imports (application-api deliberately depends on
 * data-platform only).
 *
 * @module ProductSearchDbTest
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  DrizzleProvider,
  DrizzleProductRepository,
  type DrizzleDatabase,
} from '@rajahinta/data-platform';

// ---------------------------------------------------------------------------
// PostgreSQL availability guard
// ---------------------------------------------------------------------------

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function pgAvailable(): boolean {
  return !!TEST_DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Fixtures — seeded rows, cleaned up by marker suffix in afterAll
// ---------------------------------------------------------------------------

const MARKER = '(ranked-search-test)';

const SEED_PRODUCTS: readonly {
  name: string;
  manufacturer: string;
  brand: string;
}[] = [
  { name: `Karhu III ${MARKER}`, manufacturer: 'Hartwall', brand: 'Karhu' },
  { name: `Tumma Lager Erityis ${MARKER}`, manufacturer: 'Hartwall', brand: 'Karhu' },
  { name: `Koff III ${MARKER}`, manufacturer: 'Sinebrychoff', brand: 'Koff' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductRepository.searchRanked — pg_trgm matching and ranking', () => {
  if (!pgAvailable()) {
    console.log(
      '\n  ⏭️  Ranked-search DB tests SKIPPED — TEST_DATABASE_URL not set.\n' +
        '  See the module doc above for the docker + migrate + run steps.\n',
    );
    it.skip('requires TEST_DATABASE_URL — all tests skipped', () => {});
    return;
  }

  // The provider factory reads DATABASE_URL — point it at the test DB.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const db: DrizzleDatabase = DrizzleProvider.useFactory();
  const repo = new DrizzleProductRepository(db);

  beforeAll(async () => {
    // Constant DDL (no interpolated input) — the extension is idempotent
    // and required for similarity(); the GIN indexes from migration 0016
    // affect performance only, so tests pass without them.
    await db.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    for (const p of SEED_PRODUCTS) {
      await repo.create({
        name: p.name,
        manufacturer: p.manufacturer,
        brand: p.brand,
        category: 'beer',
        alcoholByVolume: '0.045',
        unitVolume: '0.3300',
        containerType: 'can',
        regulatoryClassification: 'beer',
        depositSystemStatus: true,
        ean: null,
      });
    }
  });

  afterAll(async () => {
    try {
      // Constant marker predicate — no interpolated input.
      await db.execute(
        `DELETE FROM product_master WHERE name LIKE '%${MARKER}%'`,
      );
    } finally {
      // Tear the pool down so vitest does not hang on open handles.
      // $client is the underlying pg client pool; cast because the
      // declared DrizzleDatabase type does not surface it.
      await (db as unknown as { $client: { end: () => Promise<void> } })
        .$client.end();
    }
  });

  it('"karhu" matches by name and by brand, and excludes non-matches', async () => {
    const rows = await repo.searchRanked('karhu', 100);

    const names = rows.map((r) => r.name);
    expect(names).toContain(`Karhu III ${MARKER}`);
    expect(names).toContain(`Tumma Lager Erityis ${MARKER}`);
    expect(names).not.toContain(`Koff III ${MARKER}`);
  });

  it('returns a deterministic order across repeated identical calls', async () => {
    const first = await repo.searchRanked('karhu', 100);
    const second = await repo.searchRanked('karhu', 100);

    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it('partial-word queries still match through the ILIKE recall filter', async () => {
    // "karh" is too short for strong trigram similarity on the long
    // seeded names — the substring recall filter must still find them.
    const rows = await repo.searchRanked('karh', 100);

    const names = rows.map((r) => r.name);
    expect(names).toContain(`Karhu III ${MARKER}`);
    expect(names).toContain(`Tumma Lager Erityis ${MARKER}`);
  });

  it('respects the fetch limit', async () => {
    const rows = await repo.searchRanked('karhu', 1);
    expect(rows).toHaveLength(1);
  });
});
