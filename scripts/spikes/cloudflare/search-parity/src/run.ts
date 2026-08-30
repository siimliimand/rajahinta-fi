/**
 * G2 search parity spike — runner.
 *
 * Seeds a local SQLite (D1 engine) with the search-test product fixtures,
 * runs every query the search tests pin plus realistic Finnish/Swedish
 * product-name queries through the FTS5+LIKE candidate query, and records
 * per-query: expected product, rank returned, hit/miss (top-k, k=5).
 *
 * Exit code 0 = every golden/fixture expectation found within top-5.
 * Writes results/search-parity.json for the spike report.
 *
 * Run: pnpm spike  (from this directory)
 *
 * @module G2SpikeRun
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSchema } from './schema.ts';
import { FIXTURES, type ProductFixture } from './fixtures.ts';
import { searchRanked, listAlphabetical, type ProductRow } from './query.ts';

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const K = 5; // top-k gate from task 1.2
const MAX_PAGE_SIZE = 100; // SearchController's ranked-search limit
const CREATED = '2026-01-01T00:00:00.000Z';

function seed(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL'); // same mode the real platform uses
  createSchema(db);

  const insert = db.prepare(
    `INSERT INTO product (
       id, name, manufacturer, brand, category, alcohol_by_volume,
       unit_volume, container_type, regulatory_classification,
       deposit_system_status, ean, created_at, updated_at
     ) VALUES (
       @id, @name, @manufacturer, @brand, @category, @alcoholByVolume,
       @unitVolume, @containerType, @regulatoryClassification,
       @depositSystemStatus, @ean, @createdAt, @updatedAt
     )`,
  );

  const rows = db.transaction((fixtures: readonly ProductFixture[]) => {
    for (const f of fixtures) {
      insert.run({
        ...f,
        depositSystemStatus:
          f.depositSystemStatus === null ? null : f.depositSystemStatus ? 1 : 0,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
    }
  });
  rows(FIXTURES);

  // Sync-trigger sanity: the external-content index must equal the table.
  const integrity = db
    .prepare(`SELECT count(*) AS n FROM product_fts`)
    .get() as { n: number };
  if (integrity.n !== FIXTURES.length) {
    throw new Error(
      `FTS sync broken: ${integrity.n} index rows for ${FIXTURES.length} products`,
    );
  }
  return db;
}

// ---------------------------------------------------------------------------
// Query cases — expectations from the search tests + realistic extras
// ---------------------------------------------------------------------------

interface QueryCase {
  readonly id: string;
  /** The literal query string ('' exercises the blank passthrough). */
  readonly query: string;
  /** Where the query/expectation comes from. */
  readonly source: string;
  /** Expected product ids that must ALL appear within top-k. */
  readonly expectInTopK: readonly number[];
  /** Optional: the product that must rank FIRST (relevance contract). */
  readonly expectFirst?: number;
}

const CASES: readonly QueryCase[] = [
  {
    id: 'Q1',
    query: 'karhu',
    source:
      'search.controller.test.ts "karhu" ranked case — name match (Karhu III) and brand-only match (Tumma Lager)',
    expectInTopK: [30, 31],
    expectFirst: 30, // pg contract: name match ahead of brand-only match
  },
  {
    id: 'Q2',
    query: 'karh',
    source:
      'product-search.db.test.ts partial-word case — ILIKE recall must still match',
    expectInTopK: [30, 31, 40, 41],
  },
  {
    id: 'Q3',
    query: 'KARHU',
    source:
      'ILIKE is case-insensitive on the pg side — unicode61 folding must match',
    expectInTopK: [30, 31, 40, 41],
    expectFirst: 30,
  },
  {
    id: 'Q4',
    query: 'le coq',
    source: 'realistic multi-token brand phrase (A. Le Coq Premium)',
    expectInTopK: [20],
    expectFirst: 20,
  },
  {
    id: 'Q5',
    query: 'koff',
    source: 'product-search.db.test.ts seed brand (Koff III rows)',
    expectInTopK: [42, 55],
  },
  {
    id: 'Q6',
    query: 'olut',
    source: 'realistic Finnish generic word inside product names',
    expectInTopK: [10, 55],
  },
  {
    id: 'Q7',
    query: 'lager',
    source: 'realistic name token (Tumma Lager variants)',
    expectInTopK: [31, 41],
  },
  {
    id: 'Q8',
    query: 'sandels',
    source: 'realistic Finnish brand query',
    expectInTopK: [50],
    expectFirst: 50,
  },
  {
    id: 'Q9',
    query: 'norrlands',
    source: 'realistic Swedish brand token',
    expectInTopK: [51],
    expectFirst: 51,
  },
  {
    id: 'Q10',
    query: 'Öltermanni',
    source: 'realistic non-ASCII (Ö) product-name query',
    expectInTopK: [10],
    expectFirst: 10,
  },
  {
    id: 'Q11',
    query: 'öl',
    source: 'realistic Swedish/Finnish short prefix query',
    expectInTopK: [10],
  },
  {
    id: 'Q12',
    query: 'hartwall',
    source: 'manufacturer-only recall (pg searches manufacturer too)',
    // Four pinned Hartwall fixtures must surface in top-5; the seeded
    // set has six Hartwall rows, so two necessarily fall outside k=5 —
    // that is recall saturation, not a parity failure.
    expectInTopK: [30, 31, 40, 52],
  },
  {
    id: 'Q13',
    query: 'long drink',
    source: 'realistic two-token Finnish product phrase (Long Drink Original)',
    expectInTopK: [53],
    expectFirst: 53,
  },
];

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

interface CaseResult {
  readonly id: string;
  readonly query: string;
  readonly source: string;
  readonly expected: readonly number[];
  readonly expectFirst: number | null;
  readonly topKIds: readonly number[];
  /** rank (1-based) of each expected id actually found, or null when absent */
  readonly ranks: Readonly<Record<number, number>>;
  readonly hit: boolean;
  readonly firstOk: boolean;
}

function runRankedCase(
  db: Database.Database,
  c: QueryCase,
  limit: number,
): CaseResult {
  const rows = searchRanked(db, c.query, limit);
  const topKIds = rows.slice(0, K).map((r) => r.id);
  // The gate is strictly top-k: only ranks 1..K can count as hits.
  const ranks: Record<number, number> = {};
  rows.slice(0, K).forEach((row, i) => {
    if (c.expectInTopK.includes(row.id) && ranks[row.id] === undefined) {
      ranks[row.id] = i + 1;
    }
  });
  const missing = c.expectInTopK.filter((id) => ranks[id] === undefined);
  return {
    id: c.id,
    query: c.query,
    source: c.source,
    expected: c.expectInTopK,
    expectFirst: c.expectFirst ?? null,
    topKIds,
    ranks,
    hit: missing.length === 0,
    firstOk: c.expectFirst === undefined || rows[0]?.id === c.expectFirst,
  };
}

// Determinism check — the db-test pins identical order across calls.
function checkDeterminism(db: Database.Database): boolean {
  const a = searchRanked(db, 'karhu', MAX_PAGE_SIZE).map((r) => r.id);
  const b = searchRanked(db, 'karhu', MAX_PAGE_SIZE).map((r) => r.id);
  return JSON.stringify(a) === JSON.stringify(b);
}

// Limit check — the db-test pins searchRanked('karhu', 1).length === 1.
function checkLimit(db: Database.Database): boolean {
  return searchRanked(db, 'karhu', 1).length === 1;
}

// Blank passthrough — the controller test pins: blank/absent q goes to the
// unfiltered alphabetical listing (A. Le Coq Premium sorts first in 'fi').
function checkBlankPassthrough(db: Database.Database): {
  ok: boolean;
  total: number;
  firstId: number | null;
} {
  const rows = listAlphabetical(db, MAX_PAGE_SIZE);
  return {
    ok:
      rows.length === FIXTURES.length &&
      rows[0]?.id === 20 &&
      rows.every(
        (r, i) =>
          i === 0 ||
          rows[i - 1].name.localeCompare(r.name, 'fi') <= 0,
      ),
    total: rows.length,
    firstId: rows[0]?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = seed();

const results: CaseResult[] = CASES.map((c) => runRankedCase(db, c, MAX_PAGE_SIZE));
const determinism = checkDeterminism(db);
const limitOk = checkLimit(db);
const blank = checkBlankPassthrough(db);

// --- Report ---
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
console.log('\nG2 search parity spike — FTS5 + LIKE vs pg_trgm contract (k=%d)\n', K);
console.log(
  `${pad('case', 5)}${pad('query', 14)}${pad('hit', 5)}${pad('rank(expected)', 24)}top-${K} ids`,
);
console.log('-'.repeat(100));
for (const r of results) {
  const rankStr = Object.entries(r.ranks)
    .map(([id, rank]) => `#${id}@${rank}`)
    .join(' ');
  const flags = [r.hit ? 'HIT' : 'MISS', ...(r.expectFirst !== null ? [r.firstOk ? 'first-ok' : 'FIRST-FAIL'] : [])].join('/');
  console.log(
    `${pad(r.id, 5)}${pad(`"${r.query}"`, 14)}${pad(flags, 13)}${pad(rankStr, 24)}${r.topKIds.join(',')}`,
  );
}
console.log('-'.repeat(100));
console.log(`determinism (identical order across calls): ${determinism ? 'OK' : 'FAIL'}`);
console.log(`limit respected (limit=1 → 1 row):          ${limitOk ? 'OK' : 'FAIL'}`);
console.log(
  `blank passthrough (total=${blank.total}, first=${blank.firstId}, alphabetical): ${blank.ok ? 'OK' : 'FAIL'}`,
);

const allHits = results.every((r) => r.hit && r.firstOk);
const pass = allHits && determinism && limitOk && blank.ok;

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');
mkdirSync(outDir, { recursive: true });
const out = {
  generatedAt: new Date().toISOString(),
  k: K,
  fixtures: FIXTURES.length,
  results,
  checks: { determinism, limitOk, blank },
  pass,
};
writeFileSync(path.join(outDir, 'search-parity.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\nresults written to results/search-parity.json`);

const missed = results.filter((r) => !r.hit || !r.firstOk);
if (!pass) {
  console.error(`\nFAILED — missed: ${missed.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
console.log(`\nALL ${results.length} QUERY CASES HIT within top-${K}. Exit 0.`);
