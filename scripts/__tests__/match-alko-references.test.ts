/**
 * Matching-pass script tests (task 2.2, change
 * alko-reference-matching-pipeline) — the integration suite over the
 * exported units of scripts/match-alko-references.mts on the committed
 * node:sqlite harness pattern (real migrations 0000 → 0026 applied to a
 * real SQLite file, then the pass runs against it through its own D1
 * shim, exactly as a `--db-file` operator run would).
 *
 * Load-bearing cases:
 * - German scrape noise (embedded `%`/`l`, the split decimal `"0. 7 l"`,
 *   zero/null volumes, a percentage-scale ABV straggler) passes clean and
 *   every pair lands PENDING with the reviewer-facing identity: ABV in
 *   PERCENT, volumes in litres, blank brands NULL, scored-no-match
 *   methods mapped onto 'fuzzy'.
 * - Blocking windows bind the pass end to end: out-of-window Alko rows
 *   never enqueue even when a name would score them top; unusable seed
 *   numerics WIDEN the window instead (design D3) so the numerically-far
 *   twin still pairs — degraded, never dropped.
 * - `AlkoSideCandidateFilter` keeps the scored set inside the
 *   Alko-merchant offer universe: a foreign product's own row never wins
 *   as its own candidate (the self-pair contamination the filter exists
 *   for), and foreign–foreign noise never scores.
 * - Queue idempotency on re-run (design D5): created → refreshed, no
 *   duplicate pairs, and a CONFIRMED-linked product is excluded at
 *   enumeration — its decided queue row is never touched again.
 * - Decision immutability (design D2): CONFIRMED and REJECTED rows come
 *   out of a re-run byte-identical (skipped outcomes).
 * - `--stats` is no-write: the identical walk and scoring, byte-identical
 *   database file, unchanged row counts.
 * - Per-product isolation: a seam-injected failure is logged and counted,
 *   the run continues.
 *
 * @module MatchAlkoReferencesTest
 */
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlkoSideCandidateFilter,
  buildForeignEnumerationSql,
  createD1Shim,
  decisionFromResult,
  evaluateForeignProduct,
  parseArgs,
  runMatchingPass,
} from '../match-alko-references.mts';
import { D1MatchReviewRepository } from '../../packages/data-platform/src/repositories/d1/match-review.repository';
import {
  D1ProductMasterQueryRepository,
  FIND_CANDIDATES_LIMIT,
  type D1ProductMasterQueryRow,
} from '../../packages/data-platform/src/repositories/d1/product-master-query.repository';
import type { MatchReviewEnqueueInput } from '../../packages/data-platform/src/abstracts';
import { ProductMatcherService } from '../../packages/core-domain/src/normalization/product-matcher.service';
import { ManualReviewService } from '../../packages/core-domain/src/normalization/manual-review.service';
import type { ProductMatchResult } from '../../packages/core-domain/src/normalization/product-matcher.types';
import type { IManualReviewRepository } from '../../packages/core-domain/src/normalization/ports/manual-review-repository.port';

// ---------------------------------------------------------------------------
// Harness — the committed d1-test-harness pattern, file-backed (the pass
// opens its own connection per run, so fixtures live in a real file).
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../packages/data-platform/src/d1/migrations', import.meta.url),
);
mkdirSync('/tmp/opencode', { recursive: true });
const WORK_DIR = mkdtempSync(join('/tmp/opencode', 'match-alko-'));

function applyCommittedMigrations(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    for (const chunk of readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split(
      '--> statement-breakpoint',
    )) {
      const trimmed = chunk.trim();
      if (trimmed.length > 0) db.exec(trimmed);
    }
  }
}

/** Fresh migrated file database — seed it, close it, then run the pass. */
function openSeededDb(fileName: string): { path: string; db: DatabaseSync } {
  const path = join(WORK_DIR, fileName);
  const db = new DatabaseSync(path);
  applyCommittedMigrations(db);
  return { path, db };
}

function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  applyCommittedMigrations(db);
  return db;
}

afterAll(() => {
  rmSync(WORK_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures — product_master + retail_offers rows as ingestion writes them
// (ABV as a FRACTION; the merchant set defines the two universes).
// ---------------------------------------------------------------------------

interface SeedProductSpec {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  /** Stored fraction (percent / 100) or null — the column's real shape. */
  readonly alcoholByVolume: number | null;
  readonly unitVolume: number;
  readonly ean?: string | null;
  /** Merchants to hang off the product — 'alko' joins the Alko universe. */
  readonly merchants: readonly string[];
}

const COUNTRY_BY_MERCHANT: Readonly<Record<string, string>> = {
  alko: 'FI',
  kippis: 'FI',
  rewe: 'DE',
};

function seedProduct(db: DatabaseSync, spec: SeedProductSpec): void {
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category,
        alcohol_by_volume, unit_volume, container_type,
        regulatory_classification, ean)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'can', ?, ?)`,
  ).run(
    spec.id,
    spec.name,
    spec.brand,
    spec.brand,
    spec.category,
    spec.alcoholByVolume,
    spec.unitVolume,
    spec.category,
    spec.ean ?? null,
  );
  for (const merchant of spec.merchants) {
    db.prepare(
      `INSERT INTO retail_offers (merchant, country, product_id, price_cents)
       VALUES (?, ?, ?, 299)`,
    ).run(merchant, COUNTRY_BY_MERCHANT[merchant] ?? 'FI', spec.id);
  }
}

function seedAll(db: DatabaseSync, specs: readonly SeedProductSpec[]): void {
  for (const spec of specs) seedProduct(db, spec);
}

/** The 0026 row an operator confirm persists (the console's write). */
function seedConfirmedLink(db: DatabaseSync, foreignId: number, alkoId: number): void {
  db.prepare(
    `INSERT INTO product_reference_links (foreign_product_id, alko_product_id,
        status, confirmed_by, confirmed_at)
     VALUES (?, ?, 'CONFIRMED', 'ops-1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  ).run(foreignId, alkoId);
}

/** A REJECTED decision — history, NOT the enumeration exclusion. */
function seedRejectedLink(db: DatabaseSync, foreignId: number, alkoId: number): void {
  db.prepare(
    `INSERT INTO product_reference_links (foreign_product_id, alko_product_id, status)
     VALUES (?, ?, 'REJECTED')`,
  ).run(foreignId, alkoId);
}

// ---------------------------------------------------------------------------
// Pass runner + queue inspection
// ---------------------------------------------------------------------------

interface RawQueueRow {
  readonly id: number;
  readonly foreign_product_id: number;
  readonly alko_product_id: number;
  readonly confidence: string;
  readonly match_method: string;
  readonly score: number;
  readonly foreign_name: string;
  readonly foreign_brand: string | null;
  readonly foreign_abv: number | null;
  readonly foreign_volume: number | null;
  readonly alko_name: string;
  readonly alko_brand: string | null;
  readonly alko_abv: number | null;
  readonly alko_volume: number | null;
  readonly status: string;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function runPass(
  path: string,
  options: { write: boolean; limit?: number; category?: string },
): Promise<{ logs: string[]; summary: Awaited<ReturnType<typeof runMatchingPass>> }> {
  const logs: string[] = [];
  const summary = await runMatchingPass({
    dbFile: path,
    local: false,
    write: options.write,
    limit: options.limit ?? null,
    category: options.category ?? null,
    log: (line: string) => logs.push(line),
  });
  return { logs, summary };
}

function queueRows(db: DatabaseSync): RawQueueRow[] {
  return db.prepare('SELECT * FROM match_review ORDER BY id').all() as unknown as RawQueueRow[];
}

function queueCount(db: DatabaseSync): number {
  return (db.prepare('SELECT count(*) AS n FROM match_review').get() as { n: number }).n;
}

function linkCount(db: DatabaseSync): number {
  return (
    db.prepare('SELECT count(*) AS n FROM product_reference_links').get() as { n: number }
  ).n;
}

/** Decide a queue row through the real repository (the console's path). */
async function decideQueueRow(
  db: DatabaseSync,
  id: number,
  decision: 'CONFIRMED' | 'REJECTED',
  operator: string,
): Promise<void> {
  await new D1MatchReviewRepository(createD1Shim(db)).decide(id, decision, operator);
}

/** Row for one foreign product (the pass enqueues at most one per product). */
function rowFor(db: DatabaseSync, foreignId: number): RawQueueRow {
  const row = queueRows(db).find((r) => r.foreign_product_id === foreignId);
  expect(row, `no queue row for foreign product ${foreignId}`).toBeDefined();
  return row!;
}

// ---------------------------------------------------------------------------
// Unit-support builders
// ---------------------------------------------------------------------------

/** The inert review port the matcher's ManualReviewService is built on. */
function inertReviewPort(): IManualReviewRepository {
  return {
    async create() {
      // Persist nothing — the D2 routing proof is the pass's own counter.
    },
    async findById() {
      return null;
    },
    async findByStatus() {
      return [];
    },
    async updateStatus() {},
  };
}

/** A filter over real seeded rows, with the candidate cache populated. */
async function makeCachedFilter(specs: readonly SeedProductSpec[]): Promise<AlkoSideCandidateFilter> {
  const db = openMemoryDb();
  seedAll(db, specs);
  const d1 = createD1Shim(db);
  const filter = new AlkoSideCandidateFilter(new D1ProductMasterQueryRepository(d1), d1);
  // One fully-widened blocked read — exactly how the pass populates the cache.
  await filter.findCandidates({ brand: 'x', category: 'beer', volumeLitres: 0, abv: 0 });
  return filter;
}

const UNIT_ROW: D1ProductMasterQueryRow = {
  id: 500,
  ean: null,
  name: 'Karhu III 0,33 l  %4.7',
  brand: 'Karhu',
  category: 'beer',
  alcohol_by_volume: 0.047,
  container_type: 'can',
  unit_volume: 0.33,
};

function matchResult(overrides: Partial<ProductMatchResult> = {}): ProductMatchResult {
  return {
    matched: true,
    productId: 601,
    confidence: 'HIGH',
    matchMethod: 'fuzzy',
    candidates: [{ productId: 601, score: 82 }],
    requiresManualReview: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses the full option set onto typed fields', () => {
    expect(
      parseArgs(['--stats', '--limit', '5', '--category', 'beer', '--db-file', '/tmp/x.sqlite']),
    ).toEqual({
      stats: true,
      limit: 5,
      category: 'beer',
      dbFile: '/tmp/x.sqlite',
      local: false,
      help: false,
    });
  });

  it('defaults to a --local write pass when nothing else is given', () => {
    expect(parseArgs(['--local'])).toEqual({
      stats: false,
      limit: null,
      category: null,
      dbFile: null,
      local: true,
      help: false,
    });
  });

  it.each([
    [['--db-file', 'x', '--limit', '0']],
    [['--db-file', 'x', '--limit', '-3']],
    [['--db-file', 'x', '--limit', 'two']],
    [['--db-file', 'x', '--limit', '2.5']],
  ])('rejects a non-positive-integer --limit (%s)', (argv) => {
    expect(() => parseArgs(argv)).toThrow(/--limit/);
  });

  it('rejects a category outside the stored tax keys', () => {
    expect(() => parseArgs(['--db-file', 'x', '--category', 'wine'])).toThrow(/--category/);
    expect(parseArgs(['--db-file', 'x', '--category', 'wine_still']).category).toBe('wine_still');
  });

  it('rejects a dangling --db-file, dual bindings, missing binding, and unknown options', () => {
    expect(() => parseArgs(['--db-file'])).toThrow(/--db-file/);
    expect(() => parseArgs(['--db-file', 'x', '--local'])).toThrow(/mutually exclusive/);
    expect(() => parseArgs(['--stats'])).toThrow(/pick a D1 binding/);
    expect(() => parseArgs(['--db-file', 'x', '--bogus'])).toThrow(/unknown option/);
  });

  it('help short-circuits the binding requirement', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildForeignEnumerationSql
// ---------------------------------------------------------------------------

describe('buildForeignEnumerationSql', () => {
  it('excludes the Alko merchant and CONFIRMED-linked rows, ordered by id', () => {
    const sql = buildForeignEnumerationSql({ category: false, limit: false });
    expect(sql).toContain("o.merchant <> 'alko'");
    expect(sql).toContain("l.status = 'CONFIRMED'");
    expect(sql).toContain('ORDER BY p.id ASC');
    expect(sql).not.toContain('LIMIT');
    expect(sql).not.toContain('p.category = ?');
  });

  it('adds the category predicate and LIMIT only when asked', () => {
    expect(buildForeignEnumerationSql({ category: true, limit: false })).toContain(
      'AND p.category = ?',
    );
    expect(buildForeignEnumerationSql({ category: false, limit: true })).toContain('LIMIT ?');
  });

  it('binds category before limit (positional placeholder order)', () => {
    const sql = buildForeignEnumerationSql({ category: true, limit: true });
    expect(sql.indexOf('p.category = ?')).toBeLessThan(sql.indexOf('LIMIT ?'));
  });
});

// ---------------------------------------------------------------------------
// decisionFromResult — the D2 enqueue decision
// ---------------------------------------------------------------------------

describe('decisionFromResult', () => {
  let cachedFilter: AlkoSideCandidateFilter;
  beforeAll(async () => {
    cachedFilter = await makeCachedFilter([
      { id: 601, name: 'Karhu III', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['alko'] },
      { id: 602, name: 'Karhu IV', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.055, unitVolume: 0.7, merchants: ['alko'] },
    ]);
  });

  it('builds the enqueue input with percent ABV, litre volumes, and the frozen Alko identity', () => {
    const decision = decisionFromResult(
      UNIT_ROW,
      matchResult({
        productId: 602,
        candidates: [{ productId: 602, score: 82 }, { productId: 601, score: 40 }],
      }),
      cachedFilter,
      true,
    );
    expect(decision.kind).toBe('scored');
    if (decision.kind !== 'scored') return;
    expect(decision.alkoProductId).toBe(602);
    expect(decision.score).toBe(82);
    expect(decision.method).toBe('fuzzy');
    expect(decision.input).toEqual({
      foreignProductId: 500,
      alkoProductId: 602,
      confidence: 'HIGH',
      matchMethod: 'fuzzy',
      score: 82,
      foreignName: 'Karhu III 0,33 l  %4.7',
      foreignBrand: 'Karhu',
      foreignAbv: 4.7,
      foreignVolume: 0.33,
      alkoName: 'Karhu IV',
      alkoBrand: 'Karhu',
      alkoAbv: 5.5,
      alkoVolume: 0.7,
    } satisfies MatchReviewEnqueueInput);
  });

  it('stores a blank brand as NULL — the reviewer-facing identity', () => {
    const decision = decisionFromResult(
      { ...UNIT_ROW, brand: '   ' },
      matchResult(),
      cachedFilter,
      true,
    );
    expect(decision.kind === 'scored' && decision.input?.foreignBrand).toBe(null);
  });

  it('maps the matcher’s scored-no-match method onto fuzzy (the column CHECK admits ean|fuzzy)', () => {
    const noneMethod = decisionFromResult(
      UNIT_ROW,
      matchResult({ matchMethod: 'none', matched: false, confidence: 'LOW' }),
      cachedFilter,
      true,
    );
    expect(noneMethod.kind === 'scored' && noneMethod.method).toBe('fuzzy');

    const eanMethod = decisionFromResult(
      UNIT_ROW,
      matchResult({ matchMethod: 'ean', confidence: 'EXACT' }),
      cachedFilter,
      true,
    );
    expect(eanMethod.kind === 'scored' && eanMethod.method).toBe('ean');
  });

  it('NONE-with-candidates is still scored and queued (the queue is the honesty surface)', () => {
    const decision = decisionFromResult(
      UNIT_ROW,
      matchResult({ matched: false, confidence: 'NONE', matchMethod: 'none' }),
      cachedFilter,
      true,
    );
    expect(decision.kind).toBe('scored');
    expect(decision.kind === 'scored' && decision.confidence).toBe('NONE');
    expect(decision.kind === 'scored' && decision.input).not.toBeNull();
  });

  it('stats mode computes the decision but carries no enqueue input', () => {
    const decision = decisionFromResult(UNIT_ROW, matchResult(), cachedFilter, false);
    expect(decision.kind).toBe('scored');
    expect(decision.kind === 'scored' && decision.input).toBeNull();
  });

  it('zero candidates is a counter, never a queue row', () => {
    expect(decisionFromResult(UNIT_ROW, matchResult({ candidates: [] }), cachedFilter, true).kind).toBe(
      'no-candidates',
    );
  });

  it('falls back to the top-ranked candidate when the result names no product', () => {
    const decision = decisionFromResult(
      UNIT_ROW,
      matchResult({ productId: undefined, candidates: [{ productId: 601, score: 50 }] }),
      cachedFilter,
      true,
    );
    expect(decision.kind === 'scored' && decision.alkoProductId).toBe(601);
    expect(decision.kind === 'scored' && decision.score).toBe(50);
  });

  it('never enqueues a self pair — the contamination the Alko filter exists for', () => {
    const decision = decisionFromResult(
      UNIT_ROW,
      matchResult({ productId: 500, candidates: [{ productId: 500, score: 99 }] }),
      cachedFilter,
      true,
    );
    expect(decision.kind).toBe('self-candidate');
  });

  it('refuses to enqueue with reconstructed identity on a cache miss', () => {
    expect(() =>
      decisionFromResult(
        UNIT_ROW,
        matchResult({ productId: 4242, candidates: [{ productId: 4242, score: 90 }] }),
        cachedFilter,
        true,
      ),
    ).toThrow(/no cached scorer record/);
  });
});

// ---------------------------------------------------------------------------
// AlkoSideCandidateFilter — the scored set is the Alko-merchant universe
// ---------------------------------------------------------------------------

describe('AlkoSideCandidateFilter', () => {
  const specs: readonly SeedProductSpec[] = [
    { id: 100, name: 'Kippis Olut', brand: 'B', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
    { id: 200, name: 'Alko Olut', brand: 'B', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
    { id: 300, name: 'Molemmat Olut', brand: 'B', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis', 'alko'] },
  ];

  it('counts the Alko universe as the products behind merchant-alko offers', async () => {
    const db = openMemoryDb();
    seedAll(db, specs);
    const d1 = createD1Shim(db);
    expect(
      await new AlkoSideCandidateFilter(new D1ProductMasterQueryRepository(d1), d1).alkoUniverseSize(),
    ).toBe(2);
  });

  it('keeps only Alko-universe rows — a foreign seed’s own row never survives to scoring', async () => {
    const db = openMemoryDb();
    seedAll(db, specs);
    const d1 = createD1Shim(db);
    const filter = new AlkoSideCandidateFilter(new D1ProductMasterQueryRepository(d1), d1);
    const candidates = await filter.findCandidates({
      brand: 'x',
      category: 'beer',
      volumeLitres: 0,
      abv: 0,
    });
    expect(candidates.map((c) => c.id)).toEqual([200, 300]);
    expect(filter.candidateById(100)).toBeUndefined();
    expect(filter.candidateById(200)?.normalizedName).toBe('Alko Olut');
  });

  it('an EAN hit outside the Alko universe is not a match', async () => {
    const db = openMemoryDb();
    seedAll(db, [
      { ...specs[0]!, ean: '6410000000001' },
      { ...specs[2]!, ean: '6410000000003' },
    ]);
    const d1 = createD1Shim(db);
    const filter = new AlkoSideCandidateFilter(new D1ProductMasterQueryRepository(d1), d1);
    expect(await filter.findByEan('6410000000001')).toBeNull();
    expect((await filter.findByEan('6410000000003'))?.id).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// evaluateForeignProduct — the seed assembly + matcher seam
// ---------------------------------------------------------------------------

describe('evaluateForeignProduct', () => {
  function makeMatcher(specs: readonly SeedProductSpec[]): {
    db: DatabaseSync;
    matcher: ProductMatcherService;
    filter: AlkoSideCandidateFilter;
  } {
    const db = openMemoryDb();
    seedAll(db, specs);
    const d1 = createD1Shim(db);
    const filter = new AlkoSideCandidateFilter(new D1ProductMasterQueryRepository(d1), d1);
    return {
      db,
      filter,
      matcher: new ProductMatcherService(filter, new ManualReviewService(inertReviewPort())),
    };
  }

  it('resolves a clean twin at EXACT confidence and a %-noise twin at HIGH', async () => {
    const { matcher } = makeMatcher([
      { id: 700, name: 'Karhu III 0,33 l', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['kippis'] },
      // The trailing scrape noise (embedded %) costs the name axis enough
      // points to drop the identical twin below the EXACT threshold — the
      // scorer's 90/75 boundary behavior on a real-shaped seed.
      { id: 702, name: 'Karhu III 0,33 l  %4.7', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 800, name: 'Karhu III 0,33 l', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['alko'] },
    ]);
    const clean = await evaluateForeignProduct(
      {
        id: 700,
        ean: null,
        name: 'Karhu III 0,33 l',
        brand: 'Karhu',
        category: 'beer',
        alcohol_by_volume: 0.047,
        container_type: 'can',
        unit_volume: 0.33,
      },
      matcher,
    );
    expect(clean.matched).toBe(true);
    expect(clean.productId).toBe(800);
    expect(clean.confidence).toBe('EXACT');

    const noisy = await evaluateForeignProduct(
      {
        id: 702,
        ean: null,
        name: 'Karhu III 0,33 l  %4.7',
        brand: 'Karhu',
        category: 'beer',
        alcohol_by_volume: 0.047,
        container_type: 'can',
        unit_volume: 0.33,
      },
      matcher,
    );
    expect(noisy.matched).toBe(true);
    expect(noisy.productId).toBe(800);
    expect(noisy.confidence).toBe('HIGH');
  });

  it('tolerates the degenerate row (null ABV, zero volume) without throwing', async () => {
    const { matcher } = makeMatcher([
      { id: 701, name: 'Mystery Mix 0,0 l  %', brand: '', category: 'beer', alcoholByVolume: null, unitVolume: 0, merchants: ['kippis'] },
      { id: 801, name: 'Karhu XXL', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.052, unitVolume: 0.5, merchants: ['alko'] },
    ]);
    const result = await evaluateForeignProduct(
      {
        id: 701,
        ean: null,
        name: 'Mystery Mix 0,0 l  %',
        brand: '',
        category: 'beer',
        alcohol_by_volume: null,
        container_type: 'can',
        unit_volume: 0,
      },
      matcher,
    );
    expect(result.candidates.length).toBeGreaterThan(0); // widened, not crashed
    expect(result.candidates.map((c) => c.productId)).toContain(801);
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — German scrape-noise fixtures (write mode)
// ---------------------------------------------------------------------------

describe('runMatchingPass — German scrape-noise fixtures', () => {
  it('runs clean over embedded %/l, split decimals, zero/null volumes; pairs land PENDING with percent ABV and litres', async () => {
    const { path, db } = openSeededDb('noise.sqlite');
    seedAll(db, [
      // The canonical scrape shapes: unit markers and % embedded in the name.
      { id: 100, name: 'Karhu III 0,33 l', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 101, name: 'Weizenbier dunkel 0. 7 l  %5,4', brand: 'Erdinger', category: 'beer', alcoholByVolume: 0.054, unitVolume: 0.7, merchants: ['rewe'] },
      // Zero volume + null ABV + blank brand — the honesty-surface row.
      { id: 102, name: 'Mystery Mix 0,0 l  %', brand: '', category: 'beer', alcoholByVolume: null, unitVolume: 0, merchants: ['kippis'] },
      // Percentage-scale ABV straggler stored > 1 — used as-is, never ×100.
      { id: 103, name: 'Straggler Lager 0,5 l  %5.2', brand: 'Karhula', category: 'beer', alcoholByVolume: 5.2, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 200, name: 'Karhu III 0,33 l', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['alko'] },
      { id: 201, name: 'Weizenbier dunkel 0. 7 l', brand: 'Erdinger', category: 'beer', alcoholByVolume: 0.054, unitVolume: 0.7, merchants: ['alko'] },
      { id: 202, name: 'Karhu XXL', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.052, unitVolume: 0.5, merchants: ['alko'] },
    ]);
    db.close();

    const { summary } = await runPass(path, { write: true });
    expect(summary.errors).toEqual([]);
    expect(summary.walked).toBe(4);
    expect(summary.created).toBe(4);
    expect(summary.noCandidates).toBe(0);
    // The matcher's inert review service absorbed the MEDIUM-and-below calls
    // while the pass's repository wrote the queue — the D2 routing proof.
    expect(summary.inertReviewCreateCalls).toBeGreaterThanOrEqual(1);

    const reopened = new DatabaseSync(path);
    try {
      // Twin pair: EXACT, ABV percent-scale on BOTH sides, volumes in litres.
      const twin = rowFor(reopened, 100);
      expect(twin).toMatchObject({
        alko_product_id: 200,
        status: 'PENDING',
        confidence: 'EXACT',
        match_method: 'fuzzy',
        foreign_brand: 'Karhu',
        foreign_volume: 0.33,
        alko_volume: 0.33,
      });
      expect(twin.foreign_abv).toBeCloseTo(4.7, 10);
      expect(twin.alko_abv).toBeCloseTo(4.7, 10);

      // "0. 7 l" split decimal → a true 0.7 l litre value, 5.4 % percent.
      const split = rowFor(reopened, 101);
      expect(split.alko_product_id).toBe(201);
      expect(split.foreign_volume).toBe(0.7);
      expect(split.foreign_abv).toBeCloseTo(5.4, 10);
      expect(split.status).toBe('PENDING');

      // Zero-volume, null-ABV, blank-brand row: still queued, identity honest
      // (0 = unknown for matching, NULL brand), scored-no-match mapped onto fuzzy.
      const degenerate = rowFor(reopened, 102);
      expect(degenerate.status).toBe('PENDING');
      expect(degenerate.confidence).toBe('NONE');
      expect(degenerate.match_method).toBe('fuzzy');
      expect(degenerate.foreign_brand).toBeNull();
      expect(degenerate.foreign_abv).toBe(0);
      expect(degenerate.foreign_volume).toBe(0);

      // The straggler's percent-scale ABV passes through unscaled.
      const straggler = rowFor(reopened, 103);
      expect(straggler.foreign_abv).toBeCloseTo(5.2, 10);
      expect(straggler.status).toBe('PENDING');

      expect(linkCount(reopened)).toBe(0); // D2: the pass never links
    } finally {
      reopened.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — blocking windows, integration mirror of the 1.3 suite
// ---------------------------------------------------------------------------

describe('runMatchingPass — candidate blocking windows', () => {
  it('out-of-window Alko rows never enqueue even when the name would score them top', async () => {
    const { path, db } = openSeededDb('windows.sqlite');
    seedAll(db, [
      // Seed: beer, 5.0 % (ABV bucket 10), 0.5 l (volume bucket 10).
      { id: 300, name: 'Karhu Ankkuri', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      // In-window twin — the only candidate.
      { id: 400, name: 'Karhu Ankkuri', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
      // One ABV bucket too far (4.0 % → bucket 8): same name, still blocked.
      { id: 401, name: 'Karhu Ankkuri', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.04, unitVolume: 0.5, merchants: ['alko'] },
      // Volume-blocked (0.33 l → bucket 7).
      { id: 402, name: 'Karhu Ankkuri', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.33, merchants: ['alko'] },
      // Category-blocked (wine with identical numbers).
      { id: 403, name: 'Karhu Ankkuri', brand: 'Karhu', category: 'wine_still', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
    ]);
    db.close();

    const { summary } = await runPass(path, { write: true });
    expect(summary.created).toBe(1);
    expect(summary.candidateCapTruncations).toBe(0);

    const reopened = new DatabaseSync(path);
    try {
      const rows = queueRows(reopened);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        foreign_product_id: 300,
        alko_product_id: 400,
        confidence: 'EXACT',
        status: 'PENDING',
      });
    } finally {
      reopened.close();
    }
  });

  it('unusable seed numerics widen the window: the numerically-far twin still pairs', async () => {
    const { path, db } = openSeededDb('widened.sqlite');
    seedAll(db, [
      // Zero volume + null ABV → both bands dropped, whole category surfaces.
      { id: 310, name: 'Karhu Sirri', brand: 'Karhu', category: 'beer', alcoholByVolume: null, unitVolume: 0, merchants: ['kippis'] },
      // Numerically far (4.0 % bucket 8, 0.33 l bucket 7): unreachable for any
      // usable 5.0 %/0.5 l seed, in-window only through the widening.
      { id: 410, name: 'Karhu Sirri', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.04, unitVolume: 0.33, merchants: ['alko'] },
      // In-window numerics but a weaker name — loses on the scoring axis.
      { id: 411, name: 'Karhu Sirrius', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
    ]);
    db.close();

    const { summary } = await runPass(path, { write: true });
    expect(summary.created).toBe(1);

    const reopened = new DatabaseSync(path);
    try {
      const rows = queueRows(reopened);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        foreign_product_id: 310,
        alko_product_id: 410, // the widened window's exact-name twin won
        confidence: 'HIGH',
      });
      // The numeric mismatch is visible to the reviewer, never hidden.
      expect(rows[0].foreign_volume).toBe(0);
      expect(rows[0].foreign_abv).toBe(0);
    } finally {
      reopened.close();
    }
  });

  it('counts candidate-cap truncations from degenerate seeds and still queues deterministically', async () => {
    const { path, db } = openSeededDb('capped.sqlite');
    // The foreign id sorts AFTER the Alko block: the inner LIMIT 200 is
    // applied before the Alko filter, so the filtered candidate set only
    // reaches the cap when the walked row is not occupying a cap slot.
    seedAll(db, [
      { id: 9000, name: 'Cap Probe', brand: 'Cap', category: 'beer', alcoholByVolume: null, unitVolume: 0, merchants: ['kippis'] },
    ]);
    const rows = Array.from(
      { length: FIND_CANDIDATES_LIMIT + 1 },
      (_, i) =>
        `(${2000 + i}, 'Cap Probe', 'M', 'Cap', 'beer', 0.05, 0.5, 'can', 'beer', NULL)`,
    );
    db.exec(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type,
          regulatory_classification, ean)
       VALUES ${rows.join(', ')}`,
    );
    db.prepare(`INSERT INTO retail_offers (merchant, country, product_id, price_cents)
                SELECT 'alko', 'FI', id, 299 FROM product_master WHERE id >= 2000 AND id < 9000`).run();
    db.close();

    const { summary } = await runPass(path, { write: true });
    expect(summary.candidateCapTruncations).toBe(1);
    expect(summary.created).toBe(1);

    const reopened = new DatabaseSync(path);
    try {
      // Truncation keeps the lowest ids (deterministic); the best tie is the
      // first candidate — id 2000.
      expect(rowFor(reopened, 9000).alko_product_id).toBe(2000);
    } finally {
      reopened.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — the Alko-merchant candidate universe
// ---------------------------------------------------------------------------

describe('runMatchingPass — Alko-universe candidate set', () => {
  it('a product carrying both offers is walked but never pairs with itself', async () => {
    const { path, db } = openSeededDb('overlap.sqlite');
    seedAll(db, [
      { id: 330, name: 'Karhu Mediaani', brand: 'Karhu', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['kippis', 'alko'] },
    ]);
    db.close();

    const { summary } = await runPass(path, { write: true });
    expect(summary).toMatchObject({
      walked: 1,
      selfCandidates: 1,
      created: 0,
      overlap: 1,
      alkoUniverseSize: 1,
    });

    const reopened = new DatabaseSync(path);
    try {
      expect(queueRows(reopened)).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('foreign–foreign noise never enters the scored set: identical foreign twins produce zero candidates', async () => {
    const { path, db } = openSeededDb('foreign-noise.sqlite');
    seedAll(db, [
      { id: 340, name: 'Kaksos Olut', brand: 'B', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 341, name: 'Kaksos Olut', brand: 'B', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
    ]);
    db.close();

    const { summary } = await runPass(path, { write: true });
    // Unfiltered, 340 and 341 would score each other at ~100 (EXACT self-noise).
    expect(summary).toMatchObject({
      walked: 2,
      noCandidates: 2,
      created: 0,
      alkoUniverseSize: 0,
    });
    expect(summary.byConfidence.EXACT).toBe(0);

    const reopened = new DatabaseSync(path);
    try {
      expect(queueRows(reopened)).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('a zero-candidate product increments the counter — never a queue row', async () => {
    const { path, db } = openSeededDb('no-candidates.sqlite');
    seedAll(db, [
      { id: 320, name: 'Mojito Master', brand: 'Sierra', category: 'spirits', alcoholByVolume: 0.32, unitVolume: 0.5, merchants: ['kippis'] },
    ]);
    db.close();

    const { summary } = await runPass(path, { write: true });
    expect(summary.walked).toBe(1);
    expect(summary.noCandidates).toBe(1);
    expect(summary.created).toBe(0);

    const reopened = new DatabaseSync(path);
    try {
      expect(queueCount(reopened)).toBe(0);
    } finally {
      reopened.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — queue idempotency on re-run (design D5)
// ---------------------------------------------------------------------------

describe('runMatchingPass — queue idempotency on re-run', () => {
  function seedTwoPairs(db: DatabaseSync): void {
    seedAll(db, [
      { id: 530, name: 'Aurora Kevyt', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 531, name: 'Aurora Täysi', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.053, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 630, name: 'Aurora Kevyt', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.33, merchants: ['alko'] },
      { id: 631, name: 'Aurora Täysi', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.053, unitVolume: 0.33, merchants: ['alko'] },
    ]);
  }

  it('the second pass refreshes PENDING rows in place: created 0, no duplicate pairs', async () => {
    const { path, db } = openSeededDb('idempotent.sqlite');
    seedTwoPairs(db);
    db.close();

    const first = await runPass(path, { write: true });
    expect(first.summary.created).toBe(2);

    const reopened = new DatabaseSync(path);
    const before = queueRows(reopened);
    expect(before.map((r) => [r.foreign_product_id, r.alko_product_id])).toEqual([
      [530, 630],
      [531, 631],
    ]);
    reopened.close();
    await sleep(15); // strftime timestamps carry ms precision

    const second = await runPass(path, { write: true });
    expect(second.summary).toMatchObject({ created: 0, refreshed: 2, skipped: 0, walked: 2 });

    const verify = new DatabaseSync(path);
    try {
      const after = queueRows(verify);
      expect(after).toHaveLength(2); // converged, never duplicated
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      expect(after.map((r) => r.status)).toEqual(['PENDING', 'PENDING']);
      expect(after.map((r) => r.created_at)).toEqual(before.map((r) => r.created_at));
      for (const [was, now] of before.map((b, i) => [b, after[i]!] as const)) {
        expect(now.updated_at).not.toBe(was.updated_at); // refreshed in place
      }
    } finally {
      verify.close();
    }
  });

  it('a CONFIRMED-linked product is excluded at enumeration: no walk, no queue row, no resurrection', async () => {
    const { path, db } = openSeededDb('confirmed-excluded.sqlite');
    seedTwoPairs(db);
    seedAll(db, [
      { id: 532, name: 'Aurora IPA', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.055, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 533, name: 'Aurora Stout', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.07, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 632, name: 'Aurora IPA', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.055, unitVolume: 0.33, merchants: ['alko'] },
      { id: 633, name: 'Aurora Stout', brand: 'Aurora', category: 'beer', alcoholByVolume: 0.07, unitVolume: 0.33, merchants: ['alko'] },
    ]);
    db.close();

    const first = await runPass(path, { write: true });
    expect(first.summary.created).toBe(4);

    const operate = new DatabaseSync(path);
    try {
      // Operator confirms 531's pair (queue decision + the 0026 link row the
      // console persists); 532's pair carries a REJECTED link — history only.
      const rows = queueRows(operate);
      const confirmedRow = rows.find((r) => r.foreign_product_id === 531)!;
      await decideQueueRow(operate, confirmedRow.id, 'CONFIRMED', 'ops-1');
      seedConfirmedLink(operate, 531, confirmedRow.alko_product_id);
      seedRejectedLink(operate, 532, rows.find((r) => r.foreign_product_id === 532)!.alko_product_id);
    } finally {
      operate.close();
    }

    const second = await runPass(path, { write: true });
    // 531 never walked (CONFIRMED link); the REJECTED link does NOT exclude —
    // 530, 532, 533 all walked and their PENDING rows refreshed.
    expect(second.summary).toMatchObject({ walked: 3, created: 0, refreshed: 3, skipped: 0 });

    const verify = new DatabaseSync(path);
    try {
      expect(queueCount(verify)).toBe(4); // no resurrection, no duplicate
      const confirmed = queueRows(verify).find((r) => r.foreign_product_id === 531)!;
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.decided_by).toBe('ops-1');
      expect(confirmed.decided_at).not.toBeNull();
      expect(linkCount(verify)).toBe(2);
    } finally {
      verify.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — decision immutability (design D2/D5)
// ---------------------------------------------------------------------------

describe('runMatchingPass — CONFIRMED/REJECTED immutability', () => {
  it('a re-run leaves decided rows byte-identical while PENDING rows refresh', async () => {
    const { path, db } = openSeededDb('immutability.sqlite');
    seedAll(db, [
      { id: 540, name: 'Brew One', brand: 'Brewery', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 541, name: 'Brew Two', brand: 'Brewery', category: 'beer', alcoholByVolume: 0.06, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 542, name: 'Brew Three', brand: 'Brewery', category: 'beer', alcoholByVolume: 0.045, unitVolume: 0.33, merchants: ['kippis'] },
      { id: 640, name: 'Brew One', brand: 'Brewery', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
      { id: 641, name: 'Brew Two', brand: 'Brewery', category: 'beer', alcoholByVolume: 0.06, unitVolume: 0.5, merchants: ['alko'] },
      { id: 642, name: 'Brew Three', brand: 'Brewery', category: 'beer', alcoholByVolume: 0.045, unitVolume: 0.33, merchants: ['alko'] },
    ]);
    db.close();

    const first = await runPass(path, { write: true });
    expect(first.summary.created).toBe(3);

    const operate = new DatabaseSync(path);
    let confirmedSnapshot: RawQueueRow;
    let rejectedSnapshot: RawQueueRow;
    let pendingBefore: RawQueueRow;
    try {
      const rows = queueRows(operate);
      const confirmed = rows.find((r) => r.foreign_product_id === 540)!;
      const rejected = rows.find((r) => r.foreign_product_id === 541)!;
      await decideQueueRow(operate, confirmed.id, 'CONFIRMED', 'ops-1');
      await decideQueueRow(operate, rejected.id, 'REJECTED', 'ops-2');
      const afterDecide = queueRows(operate);
      confirmedSnapshot = afterDecide.find((r) => r.id === confirmed.id)!;
      rejectedSnapshot = afterDecide.find((r) => r.id === rejected.id)!;
      pendingBefore = afterDecide.find((r) => r.foreign_product_id === 542)!;
    } finally {
      operate.close();
    }
    await sleep(15);

    const second = await runPass(path, { write: true });
    // Both decided rows surface as skipped outcomes; only PENDING 542 refreshes.
    expect(second.summary).toMatchObject({ created: 0, refreshed: 1, skipped: 2 });

    const verify = new DatabaseSync(path);
    try {
      const after = queueRows(verify);
      expect(after.find((r) => r.foreign_product_id === 540)).toEqual(confirmedSnapshot);
      expect(after.find((r) => r.foreign_product_id === 541)).toEqual(rejectedSnapshot);
      expect(after.find((r) => r.foreign_product_id === 542)?.updated_at).not.toBe(
        pendingBefore.updated_at,
      );
      expect(after.filter((r) => r.status === 'PENDING')).toHaveLength(1);
      expect(after.filter((r) => r.status === 'CONFIRMED')[0]?.decided_by).toBe('ops-1');
      expect(after.filter((r) => r.status === 'REJECTED')[0]?.decided_by).toBe('ops-2');
    } finally {
      verify.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — --stats is no-write
// ---------------------------------------------------------------------------

describe('runMatchingPass — --stats computes without writing', () => {
  it('reports the yield over a written queue with a byte-identical database file', async () => {
    const { path, db } = openSeededDb('stats.sqlite');
    seedAll(db, [
      { id: 550, name: 'NoWrite Lager', brand: 'NW', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 551, name: 'NoWrite Orphan', brand: 'NW', category: 'spirits', alcoholByVolume: 0.32, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 650, name: 'NoWrite Lager', brand: 'NW', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
    ]);
    db.close();

    const write = await runPass(path, { write: true });
    expect(write.summary.created).toBe(1);
    expect(write.summary.noCandidates).toBe(1);

    const reopened = new DatabaseSync(path);
    const bytesBefore = readFileSync(path);
    const queueBefore = queueCount(reopened);
    const linksBefore = linkCount(reopened);
    reopened.close();

    const stats = await runPass(path, { write: false });
    expect(stats.summary).toMatchObject({
      walked: 2,
      created: 0,
      refreshed: 0,
      skipped: 0,
      noCandidates: 1,
      bindingOrigin: path,
    });
    expect(stats.summary.byConfidence.EXACT).toBe(1);
    // runMatchingPass's own no-write marker (the 'NOTHING was written' line is
    // the CLI report in main(), not part of the pass itself).
    expect(stats.logs.join('\n')).toContain('--stats (no writes)');

    const verify = new DatabaseSync(path);
    try {
      expect(readFileSync(path).equals(bytesBefore)).toBe(true); // byte-identical
      expect(queueCount(verify)).toBe(queueBefore);
      expect(linkCount(verify)).toBe(linksBefore);
      expect(linkCount(verify)).toBe(0); // stats AND write passes never link
    } finally {
      verify.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — per-product isolation
// ---------------------------------------------------------------------------

describe('runMatchingPass — per-product isolation', () => {
  it('a seam-injected failure is logged and counted; the run continues', async () => {
    const { path, db } = openSeededDb('isolation.sqlite');
    seedAll(db, [
      { id: 560, name: 'IsoLager One', brand: 'Iso', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 561, name: 'IsoLager Two', brand: 'Iso', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 660, name: 'IsoLager One', brand: 'Iso', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
      { id: 661, name: 'IsoLager Two', brand: 'Iso', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
    ]);
    db.close();

    const repoProto = D1MatchReviewRepository.prototype;
    const originalEnqueue = repoProto.enqueue;
    const spy = vi
      .spyOn(repoProto, 'enqueue')
      .mockImplementation(async function (this: D1MatchReviewRepository, input) {
        if (input.foreignProductId === 561) {
          throw new Error('seam boom');
        }
        return originalEnqueue.call(this, input);
      });
    try {
      const { logs, summary } = await runPass(path, { write: true });
      expect(summary.walked).toBe(2);
      expect(summary.created).toBe(1); // 560 went through, 561 failed
      expect(summary.errors).toEqual([
        { productId: 561, name: 'IsoLager Two', message: 'seam boom' },
      ]);
      expect(logs.join('\n')).toContain('failed (isolated, run continues)');
    } finally {
      spy.mockRestore();
    }

    const verify = new DatabaseSync(path);
    try {
      const rows = queueRows(verify);
      expect(rows.map((r) => r.foreign_product_id)).toEqual([560]);
      expect(rows[0].alko_product_id).toBe(660);
    } finally {
      verify.close();
    }
  });
});

// ---------------------------------------------------------------------------
// runMatchingPass — pilot filters and fresh-file bootstrap
// ---------------------------------------------------------------------------

describe('runMatchingPass — pilot filters and bootstrap', () => {
  it('--limit slices the id-ASC walk and --category restricts the stored key', async () => {
    const { path, db } = openSeededDb('pilot.sqlite');
    seedAll(db, [
      { id: 570, name: 'Pilot Olut A', brand: 'P', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 571, name: 'Pilot Olut B', brand: 'P', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['kippis'] },
      { id: 572, name: 'Pilot Viini', brand: 'P', category: 'wine_still', alcoholByVolume: 0.12, unitVolume: 0.75, merchants: ['kippis'] },
      { id: 670, name: 'Pilot Olut A', brand: 'P', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
      { id: 671, name: 'Pilot Olut B', brand: 'P', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, merchants: ['alko'] },
      { id: 672, name: 'Pilot Viini', brand: 'P', category: 'wine_still', alcoholByVolume: 0.12, unitVolume: 0.75, merchants: ['alko'] },
    ]);
    db.close();

    const limited = await runPass(path, { write: true, limit: 2 });
    expect(limited.summary.walked).toBe(2);
    expect(limited.summary.created).toBe(2);

    const wine = await runPass(path, { write: true, category: 'wine_still' });
    expect(wine.summary.walked).toBe(1);
    expect(wine.summary.created).toBe(1);
  });

  it('a missing --db-file is created and migrated 0000 → 0026 (empty pass converges)', async () => {
    const path = join(WORK_DIR, 'nested', 'fresh.sqlite');
    const { summary } = await runPass(path, { write: true });
    expect(summary.walked).toBe(0);
    expect(summary.alkoUniverseSize).toBe(0);
    expect(summary.bindingOrigin).toBe(path);

    const verify = new DatabaseSync(path);
    try {
      const tables = verify
        .prepare(
          `SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'
           AND name IN ('product_reference_links', 'match_review')`,
        )
        .get() as { n: number };
      expect(tables.n).toBe(2);
    } finally {
      verify.close();
    }
  });
});
