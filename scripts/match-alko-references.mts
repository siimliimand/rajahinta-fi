#!/usr/bin/env node
/**
 * Alko reference-linking matching pass (task 2.1, change
 * alko-reference-matching-pipeline; design D2/D5).
 *
 * Walks the FOREIGN side of the two disjoint product universes (every
 * `product_master` row joined to a `retail_offers` offer whose merchant is
 * not 'alko' — kippis FI included — and without a CONFIRMED reference link,
 * which marks the product done), assembles each row into a
 * `NormalizedProduct` through the task-1.3 adapter
 * (`normalizedProductFromMasterRow`), scores the blocked Alko-side
 * candidates through `ProductMatcherService`, and enqueues the best
 * candidate pair into `match_review` — EVERY graded pair, EXACT and HIGH
 * included. Nothing links autonomously.
 *
 * ## Why the enqueue goes through the repository, not the matcher (D2)
 *
 * `ProductMatcherService.findMatch` auto-enqueues MEDIUM-and-below results
 * through its `ManualReviewService` dependency. Design D2 overrides that
 * routing for reference linking: the matcher's internal review service is
 * constructed INERT here (a no-op `IManualReviewRepository` — its `create`
 * persists nothing), and this script takes the matcher's RESULT (best
 * candidate id + score + confidence + method) and calls
 * `D1MatchReviewRepository.enqueue` itself with both sides' identity
 * fields. One enqueue per foreign product per run; a scored-but-
 * below-threshold pair (confidence NONE with candidates present) is still
 * reviewable data and lands in the queue; a product with ZERO scored
 * candidates is skipped with a counter, never a queue row. The result: no
 * product_reference_links row can exist in CONFIRMED status as a result of
 * this pass alone — only an operator confirm through the guarded console
 * promotes a queued candidate (attribution + audit, the norms-queue trust
 * pattern).
 *
 * ## Why candidates are filtered to the Alko universe
 *
 * `IProductMasterQuery.findCandidates` scans the whole `product_master`
 * table (one table, both universes) — unfiltered, a foreign seed's own row
 * returns as its own best candidate at score ~100 and the enqueue dies on
 * the self-pair guard (probe-verified). `AlkoSideCandidateFilter` below
 * wraps the task-1.3 D1 adapter and keeps only rows carrying a
 * merchant-'alko' offer, so the scored set is exactly the 18.9M-pair math
 * of design D3 (foreign × Alko). `findByEan` is filtered the same way (the
 * Alko side carries zero EANs today, so the EAN path is inert by data, not
 * by code).
 *
 * ## Identity fields and scales
 *
 * Alko-side identity fields come from the candidate records the scorer
 * itself saw (the adapter caches them), so the frozen review context is
 * exactly the scoring input — never a re-read. ABV is stored in PERCENT on
 * both sides (the scorer's and the port's scale; `abvPercentFromStored`
 * maps the stored fraction), volumes in litres; blank brands are stored as
 * NULL. `match_method` maps the matcher's 'none' (scored-no-match) results
 * onto 'fuzzy' — the score is fuzzy-derived and the column CHECK admits
 * 'ean' | 'fuzzy' only.
 *
 * ## Idempotency (D5)
 *
 * `enqueue` is idempotent per (foreign, alko) pair: created | refreshed |
 * skipped. Re-runs refresh PENDING rows in place and never touch
 * CONFIRMED/REJECTED decisions — the pass converges; the queue is the only
 * write surface (this script never constructs the reference-link
 * repository).
 *
 * ## D1 binding — local only, wrangler stays the remote surface
 *
 * The pass binds to a LIVE SQLite database through the same structural
 * D1 interface the repositories consume (the committed test-harness shim,
 * mirrored script-local):
 *
 *   --db-file <path>   a plain SQLite file. Created and migrated
 *                      (0000 → 0026) when missing — fixtures, CI, scratch
 *                      runs.
 *   --local            the wrangler/miniflare local D1 state of
 *                      apps/api-worker (the data `pnpm dev` actually
 *                      serves). Stop `wrangler dev` first — SQLite is a
 *                      single writer.
 *
 * Remote D1 is deliberately NOT bound here: the house discipline routes
 * every remote D1 touch through wrangler (seed-d1.ts, and the artifact +
 * `wrangler d1 execute DB --remote --env <env>` pattern of the backfill
 * scripts), and this pass's per-pair read-modify-write enqueue cannot be
 * expressed as a blind artifact. Pilot against `--local` or a `--db-file`
 * copy of production (a future slice may add the D1 HTTP API binding —
 * deliberately out of scope until then).
 *
 * ## Pilot-first guidance (D5)
 *
 * Run `--stats` BEFORE any write pass: it computes the full walk — every
 * match decision, zero I/O — and reports the yield by confidence grade.
 * Review the grade mix (and the candidate-cap truncations) before spending
 * a write pass, and start write passes on one category with `--limit`:
 *
 *   # Yield report, nothing written (fixtures or CI):
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     --tsconfig ../../packages/core-domain/tsconfig.json \
 *     scripts/match-alko-references.mts --db-file /tmp/opencode/pilot.sqlite \
 *     --stats --category beer --limit 200
 *
 *   # Write pass against the local dev D1 (pilot; stop wrangler dev first):
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     --tsconfig ../../packages/core-domain/tsconfig.json \
 *     scripts/match-alko-references.mts --local --category beer --limit 100
 *
 *   # Review the queue (ops console, bearer-guarded):
 *   GET /ops/console/match-review?status=PENDING
 *
 * Per-product isolation: one failing product is logged and counted, never
 * drops the run (house invariant). Scheduled re-matching is a deliberate
 * follow-up (design D5) — this pass precedes it as an operator-executed
 * script.
 *
 * Exit codes: 0 = pass completed (per-product failures counted and
 * listed); 1 = usage or fatal (binding, schema, enumeration) error.
 */
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type {
  CanonicalCategory,
  NormalizedProduct,
} from '../packages/core-domain/src/normalization/normalization.types.ts';
import type { MatchConfidence, ProductMatchResult } from '../packages/core-domain/src/normalization/product-matcher.types.ts';
import type {
  IProductMasterQuery,
  ProductMasterRecord,
} from '../packages/core-domain/src/normalization/ports/product-master-query.port.ts';
import type { IManualReviewRepository } from '../packages/core-domain/src/normalization/ports/manual-review-repository.port.ts';
import { ProductMatcherService } from '../packages/core-domain/src/normalization/product-matcher.service.ts';
import { ManualReviewService } from '../packages/core-domain/src/normalization/manual-review.service.ts';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../packages/data-platform/src/d1/executor.ts';
import type {
  MatchReviewEnqueueInput,
  MatchReviewEnqueueOutcome,
} from '../packages/data-platform/src/abstracts.ts';
import {
  D1MatchReviewRepository,
} from '../packages/data-platform/src/repositories/d1/match-review.repository.ts';
import {
  D1ProductMasterQueryRepository,
  FIND_CANDIDATES_LIMIT,
  STORED_CATEGORY_TO_CANONICAL,
  abvPercentFromStored,
  normalizedProductFromMasterRow,
  volumeLitresFromStored,
  type D1ProductMasterQueryRow,
} from '../packages/data-platform/src/repositories/d1/product-master-query.repository.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The Alko merchant literal — parity with savings-snapshots' ALKO_MERCHANT. */
const ALKO_MERCHANT = 'alko';

/** Repo layout resolved from the invoked script path, never from cwd. */
const SCRIPT_DIR = process.argv[1] ? dirname(resolve(process.argv[1])) : undefined;
const REPO_ROOT = SCRIPT_DIR ? resolve(SCRIPT_DIR, '..') : undefined;
const LOCAL_D1_DIR = REPO_ROOT
  ? resolve(REPO_ROOT, 'apps/api-worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  : '';
const MIGRATIONS_DIR = REPO_ROOT
  ? resolve(REPO_ROOT, 'packages/data-platform/src/d1/migrations')
  : '';

/** Confidence grades — fixed order for the yield report. */
const CONFIDENCE_GRADES: readonly MatchConfidence[] = [
  'EXACT',
  'HIGH',
  'MEDIUM',
  'LOW',
  'NONE',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  stats: boolean;
  limit: number | null;
  category: string | null;
  dbFile: string | null;
  local: boolean;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: tsx scripts/match-alko-references.mts (--db-file <path> | --local) [options]',
    '',
    'Walks the foreign product universe, scores the blocked Alko-side',
    'candidates per product through ProductMatcherService, and enqueues the',
    'best pair into match_review — every graded candidate, EXACT/HIGH',
    'included (design D2). NEVER creates a CONFIRMED reference link: the',
    'operator console is the only path to confirmation.',
    '',
    'D1 binding (exactly one):',
    '  --db-file <path>   plain SQLite file (created + migrated when missing)',
    '  --local            wrangler/miniflare local D1 state of apps/api-worker',
    '',
    'Options:',
    '  --stats            compute everything, write NOTHING — yield report',
    '                     by confidence grade (run this first)',
    '  --limit <n>        first n foreign products, id ASC (pilot runs)',
    '  --category <key>   restrict the foreign side to one stored category:',
    `                     ${Object.keys(STORED_CATEGORY_TO_CANONICAL).join(' | ')}`,
    '  -h, --help',
    '',
    'Remote D1 is reached only through wrangler (house discipline); this',
    'script binds to local SQLite files only.',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    stats: false,
    limit: null,
    category: null,
    dbFile: null,
    local: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stats') {
      options.stats = true;
    } else if (arg === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit expects a positive integer, got "${argv[i]}"`);
      }
      options.limit = n;
    } else if (arg === '--category') {
      const key = (argv[++i] ?? '').trim();
      if (!(key in STORED_CATEGORY_TO_CANONICAL)) {
        throw new Error(
          `--category must be one of ${Object.keys(STORED_CATEGORY_TO_CANONICAL).join(' | ')} — got "${key}"`,
        );
      }
      options.category = key;
    } else if (arg === '--db-file') {
      options.dbFile = argv[++i] ?? '';
      if (options.dbFile === '') {
        throw new Error('--db-file requires a file path');
      }
    } else if (arg === '--local') {
      options.local = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`unknown option "${arg}"`);
    }
  }
  if (options.help) return options;
  if (options.dbFile !== null && options.local) {
    throw new Error('--db-file and --local are mutually exclusive — pick one binding');
  }
  if (options.dbFile === null && !options.local) {
    throw new Error('pick a D1 binding: --db-file <path> or --local');
  }
  return options;
}

// ---------------------------------------------------------------------------
// node:sqlite → D1 binding shim (mirror of the committed test harness)
// ---------------------------------------------------------------------------

/** Wrap a node:sqlite database in the D1 binding's structural shape. */
export function createD1Shim(db: DatabaseSync): D1DatabaseLike {
  function prepare(query: string): D1PreparedStatementLike {
    const statement = db.prepare(query);
    let params: unknown[] = [];
    // node:sqlite's parameter type is narrower than the binding's
    // `unknown[]` surface; the repositories only bind null/number/string
    // (the committed harness makes the same narrowing).
    const bindable = (): Parameters<StatementSync['all']> =>
      params as Parameters<StatementSync['all']>;
    const bound: D1PreparedStatementLike = {
      bind(...values: unknown[]) {
        params = values;
        return bound;
      },
      async all<T>(): Promise<D1ResultLike<T>> {
        return {
          results: statement.all(...bindable()) as T[],
          success: true,
          meta: {},
        };
      },
      async first<T>(): Promise<T | null> {
        return (statement.get(...bindable()) as T | undefined) ?? null;
      },
      async run(): Promise<D1ResultLike> {
        const result = statement.run(...bindable());
        return {
          results: [],
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      },
    };
    return bound;
  }
  return {
    prepare,
    // Sequential execution inside one BEGIN/COMMIT pair — the same
    // all-or-nothing semantics the binding's batch() provides. (The
    // match-review path never batches; the shim keeps the interface whole
    // for any repository the pass constructs.)
    async batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]> {
      const results: D1ResultLike[] = [];
      db.exec('BEGIN');
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return results;
    },
  };
}

/** Split on drizzle's statement-breakpoint markers and execute each chunk. */
function applyMigration(db: DatabaseSync, sql: string): void {
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      db.exec(trimmed);
    }
  }
}

/** Apply the committed migrations (sorted, 0000 → 0026) to a fresh file. */
function applyCommittedMigrations(db: DatabaseSync, migrationsDir: string): void {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    applyMigration(db, readFileSync(`${migrationsDir}/${file}`, 'utf8'));
  }
}

/** The two 0026 tables the pass reads and writes — present = migrated. */
function assertMigratedSchema(db: DatabaseSync, origin: string): void {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN ('product_reference_links', 'match_review')`,
    )
    .all() as Array<{ name: string }>;
  if (tables.length !== 2) {
    throw new Error(
      `${origin} is missing the migration-0026 tables (product_reference_links, match_review) — apply migrations 0000–0026 first (wrangler d1 migrations apply DB, or delete a stale --db-file so it is recreated)`,
    );
  }
}

/**
 * Open the D1 binding target: a plain SQLite file (created + migrated when
 * missing) or the wrangler/miniflare local state of apps/api-worker.
 */
export function openD1Target(options: {
  dbFile: string | null;
  local: boolean;
}): { db: DatabaseSync; d1: D1DatabaseLike; origin: string } {
  if (options.dbFile !== null) {
    const path = resolve(options.dbFile);
    const existed = existsSync(path);
    if (!existed) {
      mkdirSync(dirname(path), { recursive: true });
    }
    const db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 5000');
    if (!existed) {
      if (!MIGRATIONS_DIR) {
        throw new Error('cannot resolve the repository root from the invoked script path');
      }
      applyCommittedMigrations(db, MIGRATIONS_DIR);
    }
    assertMigratedSchema(db, path);
    return { db, d1: createD1Shim(db), origin: path };
  }

  if (!LOCAL_D1_DIR || !existsSync(LOCAL_D1_DIR)) {
    throw new Error(
      `no local wrangler D1 state at ${LOCAL_D1_DIR} — run the local dev stack once (pnpm dev:up, or pnpm --filter @rajahinta/data-platform db:seed:d1 equivalents) or use --db-file`,
    );
  }
  const candidates = readdirSync(LOCAL_D1_DIR)
    .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .sort();
  if (candidates.length === 0) {
    throw new Error(
      `no D1 database file under ${LOCAL_D1_DIR} — start wrangler dev once to create it, or use --db-file`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `multiple D1 databases under ${LOCAL_D1_DIR} (${candidates.join(', ')}) — pass an explicit --db-file instead`,
    );
  }
  const path = `${LOCAL_D1_DIR}/${candidates[0]}`;
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  assertMigratedSchema(db, path);
  return { db, d1: createD1Shim(db), origin: path };
}

// ---------------------------------------------------------------------------
// Alko-universe candidate filter
// ---------------------------------------------------------------------------

/**
 * Restricts the matcher's candidate reads to the ALKO universe (design D3's
 * 18.9M pair math): the underlying adapter scans all of product_master —
 * one table, both universes — so an unfiltered run would score the foreign
 * seed against itself (score ~100, EXACT) and foreign-foreign noise. The
 * Alko set is the distinct product ids behind merchant-'alko' offers, read
 * once. Candidate records are cached as the scorer saw them, so the review
 * rows' Alko identity fields are exactly the scoring input (frozen context,
 * never a re-read).
 */
export class AlkoSideCandidateFilter implements IProductMasterQuery {
  private alkoIdsPromise: Promise<Set<number>> | null = null;
  private readonly candidateCache = new Map<number, ProductMasterRecord>();

  constructor(
    private readonly inner: IProductMasterQuery,
    private readonly d1: D1DatabaseLike,
  ) {}

  /** Distinct Alko-side product ids, read once (script-local read). */
  private loadAlkoIds(): Promise<Set<number>> {
    this.alkoIdsPromise ??= (async () => {
      const rows = (
        await this.d1
          .prepare(
            `SELECT DISTINCT product_id FROM retail_offers WHERE merchant = ?`,
          )
          .bind(ALKO_MERCHANT)
          .all<{ product_id: number }>()
      ).results;
      return new Set(rows.map((row) => row.product_id));
    })();
    return this.alkoIdsPromise;
  }

  /** Alko-universe size — surfaced in the report for context. */
  async alkoUniverseSize(): Promise<number> {
    return (await this.loadAlkoIds()).size;
  }

  /** The scorer's view of a candidate — the frozen review identity. */
  candidateById(productId: number): ProductMasterRecord | undefined {
    return this.candidateCache.get(productId);
  }

  /** @inheritdoc — an EAN hit outside the Alko universe is not a match. */
  async findByEan(ean: string): Promise<ProductMasterRecord | null> {
    const record = await this.inner.findByEan(ean);
    if (record === null) return null;
    return (await this.loadAlkoIds()).has(record.id) ? record : null;
  }

  /** @inheritdoc — only Alko-universe rows survive to scoring. */
  async findCandidates(params: {
    brand: string;
    category: CanonicalCategory;
    volumeLitres: number;
    abv: number;
  }): Promise<ProductMasterRecord[]> {
    const rows = await this.inner.findCandidates(params);
    const alkoIds = await this.loadAlkoIds();
    const kept = rows.filter((row) => alkoIds.has(row.id));
    for (const record of kept) {
      this.candidateCache.set(record.id, record);
    }
    return kept;
  }
}

// ---------------------------------------------------------------------------
// The inert ManualReviewService dependency (design D2)
// ---------------------------------------------------------------------------

/**
 * The no-op review repository the matcher's internal ManualReviewService is
 * constructed with: its create persists NOTHING (design D2 routes every
 * enqueue through D1MatchReviewRepository instead, EXACT/HIGH included).
 * The matcher still calls create() for MEDIUM-and-below results — the calls
 * are counted so the summary can prove the inert path stayed inert.
 */
function createInertManualReviewRepository(state: { createCalls: number }): IManualReviewRepository {
  return {
    async create() {
      state.createCalls += 1;
    },
    async findById() {
      return null;
    },
    async findByStatus() {
      return [];
    },
    async updateStatus() {
      // The matcher never resolves reviews on the matching path.
    },
  };
}

// ---------------------------------------------------------------------------
// Foreign-side enumeration (script-local SQL — one-shot tool, kept here)
// ---------------------------------------------------------------------------

/**
 * The foreign universe: product_master rows with at least one offer whose
 * merchant is NOT 'alko' (kippis FI included) and no CONFIRMED reference
 * link (linked products are done — re-runs skip them). Deterministic id ASC
 * so --limit slices a stable prefix and re-runs walk the same order.
 */
export function buildForeignEnumerationSql(options: {
  category: boolean;
  limit: boolean;
}): string {
  return `
  SELECT p.id, p.ean, p.name, p.brand, p.category, p.alcohol_by_volume,
         p.container_type, p.unit_volume
    FROM product_master p
   WHERE EXISTS (SELECT 1 FROM retail_offers o
                  WHERE o.product_id = p.id AND o.merchant <> '${ALKO_MERCHANT}')
     AND NOT EXISTS (SELECT 1 FROM product_reference_links l
                  WHERE l.foreign_product_id = p.id AND l.status = 'CONFIRMED')${
    options.category ? '\n     AND p.category = ?' : ''
  }
   ORDER BY p.id ASC${options.limit ? '\n   LIMIT ?' : ''}`;
}

/**
 * Foreign products that ALSO carry an Alko offer — the universes are
 * disjoint by design, so this counter reads 0 in healthy data; a non-zero
 * value means an ingestion overlap and is surfaced, never silently folded
 * into one universe.
 */
const FOREIGN_ALKO_OVERLAP_SQL = `
  SELECT count(*) AS n FROM product_master p
   WHERE EXISTS (SELECT 1 FROM retail_offers o
                  WHERE o.product_id = p.id AND o.merchant <> '${ALKO_MERCHANT}')
     AND EXISTS (SELECT 1 FROM retail_offers o
                  WHERE o.product_id = p.id AND o.merchant = '${ALKO_MERCHANT}')`;

// ---------------------------------------------------------------------------
// Per-product evaluation and the D2 enqueue decision
// ---------------------------------------------------------------------------

/** The script-local match decision for one foreign product. */
export type MatchDecision =
  | {
      readonly kind: 'scored';
      readonly confidence: MatchConfidence;
      readonly score: number;
      readonly method: 'ean' | 'fuzzy';
      readonly alkoProductId: number;
      /** The pair the write pass enqueues (null in --stats mode). */
      readonly input: MatchReviewEnqueueInput | null;
    }
  | { readonly kind: 'no-candidates' }
  | { readonly kind: 'self-candidate' };

/** Blank brands store as NULL — the reviewer-facing identity. */
function brandOrNull(brand: string): string | null {
  const trimmed = brand.trim();
  return trimmed === '' ? null : brand;
}

/**
 * The migration CHECK admits 'ean' | 'fuzzy' only: the matcher's scored-
 * no-match results carry method 'none', but their scores are fuzzy-derived
 * — and the EAN path (the only 'ean' source) cannot fire for reference
 * linking today (zero Alko-side EANs).
 */
function reviewMethod(result: ProductMatchResult): 'ean' | 'fuzzy' {
  return result.matchMethod === 'ean' ? 'ean' : 'fuzzy';
}

/**
 * Evaluate one foreign product: assemble the seed through the task-1.3
 * adapter, run the matcher over the Alko-filtered candidates. Throws on
 * repository/scorer failure — the caller isolates.
 */
export async function evaluateForeignProduct(
  row: D1ProductMasterQueryRow,
  matcher: ProductMatcherService,
): Promise<ProductMatchResult> {
  const seed: NormalizedProduct = normalizedProductFromMasterRow(row);
  return matcher.findMatch(seed);
}

/**
 * Map a matcher result onto the D2 enqueue decision. The matcher's RESULT
 * carries only the best candidate's id + score; the Alko identity fields
 * come from the filter's candidate cache (exactly what the scorer saw).
 * Zero candidates → no queue row (the queue is for scored pairs, not for
 * empty candidate sets); a self-candidate → never enqueued (the repository
 * guard would refuse the pair).
 */
export function decisionFromResult(
  row: D1ProductMasterQueryRow,
  result: ProductMatchResult,
  filter: AlkoSideCandidateFilter,
  write: boolean,
): MatchDecision {
  if (result.candidates.length === 0) {
    return { kind: 'no-candidates' };
  }
  const bestId = result.productId ?? result.candidates[0].productId;
  if (bestId === row.id) {
    return { kind: 'self-candidate' };
  }
  const best =
    result.candidates.find((candidate) => candidate.productId === bestId) ??
    result.candidates[0];
  const alkoRecord = filter.candidateById(bestId);
  if (alkoRecord === undefined) {
    // Unreachable through the filter (every scored candidate is cached) —
    // the honest branch: report as an error rather than enqueue a row with
    // guessed identity fields.
    throw new Error(
      `candidate ${bestId} has no cached scorer record — refusing to enqueue with reconstructed identity`,
    );
  }
  return {
    kind: 'scored',
    confidence: result.confidence,
    score: best.score,
    method: reviewMethod(result),
    alkoProductId: bestId,
    input: write
      ? {
          foreignProductId: row.id,
          alkoProductId: bestId,
          confidence: result.confidence,
          matchMethod: reviewMethod(result),
          score: best.score,
          foreignName: row.name,
          foreignBrand: brandOrNull(row.brand),
          foreignAbv: abvPercentFromStored(row.alcohol_by_volume),
          foreignVolume: volumeLitresFromStored(row.unit_volume),
          alkoName: alkoRecord.normalizedName,
          alkoBrand: brandOrNull(alkoRecord.normalizedBrand),
          alkoAbv: alkoRecord.alcoholByVolume,
          alkoVolume: alkoRecord.volumeLitres,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface PassCounters {
  /** Foreign products evaluated (the walked rows). */
  walked: number;
  /** Yield by confidence grade over scored products. */
  byConfidence: Record<MatchConfidence, number>;
  /** Queue outcomes (write mode only — stats stays 0/0/0). */
  created: number;
  refreshed: number;
  skipped: number;
  /** Zero scored candidates — nothing reviewable, no queue row. */
  noCandidates: number;
  /** A product surfaced as its own best candidate (universes overlapped). */
  selfCandidates: number;
  /** Candidate sets truncated at the FIND_CANDIDATES_LIMIT cap. */
  candidateCapTruncations: number;
  /** Foreign products that also carry an Alko offer (0 in healthy data). */
  overlap: number;
  /** Distinct Alko-universe products behind merchant-'alko' offers. */
  alkoUniverseSize: number;
  /** Matcher calls that reached the inert review service (proves D2 routing). */
  inertReviewCreateCalls: number;
  /** Per-product failures — logged, counted, never dropping the run. */
  errors: Array<{ productId: number; name: string; message: string }>;
}

export interface PassSummary extends PassCounters {
  readonly bindingOrigin: string;
}

function zeroCounters(): PassCounters {
  return {
    walked: 0,
    byConfidence: { EXACT: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 },
    created: 0,
    refreshed: 0,
    skipped: 0,
    noCandidates: 0,
    selfCandidates: 0,
    candidateCapTruncations: 0,
    overlap: 0,
    alkoUniverseSize: 0,
    inertReviewCreateCalls: 0,
    errors: [],
  };
}

/**
 * Run the matching pass. `write = false` is --stats: the identical walk and
 * scoring, ZERO writes (the enqueue repository is never constructed).
 * Isolation: one failing product logs + counts, the run continues.
 */
export async function runMatchingPass(options: {
  dbFile: string | null;
  local: boolean;
  write: boolean;
  limit: number | null;
  category: string | null;
  log: (line: string) => void;
}): Promise<PassSummary> {
  const { db, d1, origin } = openD1Target(options);
  try {
    const counters = zeroCounters();
    const inertState = { createCalls: 0 };

    const candidateFilter = new AlkoSideCandidateFilter(
      new D1ProductMasterQueryRepository(d1),
      d1,
    );
    const matcher = new ProductMatcherService(
      candidateFilter,
      new ManualReviewService(createInertManualReviewRepository(inertState)),
    );
    // The only write surface of the whole pass (write mode); stats never
    // constructs it.
    const reviews = options.write ? new D1MatchReviewRepository(d1) : null;

    counters.alkoUniverseSize = await candidateFilter.alkoUniverseSize();
    const overlapRow = await d1
      .prepare(FOREIGN_ALKO_OVERLAP_SQL)
      .first<{ n: number }>();
    counters.overlap = overlapRow?.n ?? 0;

    const sql = buildForeignEnumerationSql({
      category: options.category !== null,
      limit: options.limit !== null,
    });
    const args: Array<string | number> = [];
    if (options.category !== null) args.push(options.category);
    if (options.limit !== null) args.push(options.limit);
    const foreignRows = (
      await d1.prepare(sql).bind(...args).all<D1ProductMasterQueryRow>()
    ).results;

    options.log(
      `[match-alko] ${options.write ? 'write pass' : '--stats (no writes)'} on ${origin}: ` +
        `${foreignRows.length} foreign product(s)` +
        `${options.category !== null ? ` in category ${options.category}` : ''}` +
        `${options.limit !== null ? ` (limit ${options.limit})` : ''}, ` +
        `Alko universe ${counters.alkoUniverseSize} product(s)`,
    );

    for (const row of foreignRows) {
      counters.walked += 1;
      if (counters.walked % 500 === 0) {
        options.log(`[match-alko] walked ${counters.walked}/${foreignRows.length}`);
      }
      try {
        const result = await evaluateForeignProduct(row, matcher);
        if (result.candidates.length >= FIND_CANDIDATES_LIMIT) {
          counters.candidateCapTruncations += 1;
        }
        const decision = decisionFromResult(row, result, candidateFilter, options.write);
        if (decision.kind === 'no-candidates') {
          counters.noCandidates += 1;
          continue;
        }
        if (decision.kind === 'self-candidate') {
          counters.selfCandidates += 1;
          continue;
        }
        counters.byConfidence[decision.confidence] += 1;
        if (reviews !== null && decision.input !== null) {
          const outcome: MatchReviewEnqueueOutcome = (
            await reviews.enqueue(decision.input)
          ).outcome;
          counters[outcome] += 1;
        }
      } catch (error) {
        counters.errors.push({
          productId: row.id,
          name: row.name,
          message: error instanceof Error ? error.message : String(error),
        });
        options.log(
          `[match-alko] product ${row.id} "${row.name}" failed (isolated, run continues): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    counters.inertReviewCreateCalls = inertState.createCalls;
    return { ...counters, bindingOrigin: origin };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function yieldLine(counters: PassCounters): string {
  const grades = CONFIDENCE_GRADES.map(
    (grade) => `${grade} ${counters.byConfidence[grade]}`,
  ).join(', ');
  const scored = CONFIDENCE_GRADES.reduce(
    (sum, grade) => sum + counters.byConfidence[grade],
    0,
  );
  return `yield by confidence: ${grades} — scored pairs total ${scored}`;
}

function reportStats(summary: PassSummary, log: (line: string) => void): void {
  log(`[match-alko] --stats over ${summary.walked} foreign product(s) on ${summary.bindingOrigin} — NOTHING was written.`);
  log(`[match-alko]   ${yieldLine(summary)}`);
  log(`[match-alko]   zero-candidate products (skipped, no queue row): ${summary.noCandidates}`);
  log(`[match-alko]   self-candidate anomalies (universes overlapped?): ${summary.selfCandidates}`);
  log(`[match-alko]   candidate sets truncated at the ${FIND_CANDIDATES_LIMIT}-row cap (degenerate seeds): ${summary.candidateCapTruncations}`);
  log(`[match-alko]   foreign∩alko overlap: ${summary.overlap}; Alko universe: ${summary.alkoUniverseSize} product(s)`);
  log(`[match-alko]   per-product errors: ${summary.errors.length}`);
}

function reportWritePass(summary: PassSummary, log: (line: string) => void): void {
  log(`[match-alko] pass complete on ${summary.bindingOrigin}: ${summary.walked} foreign product(s) walked.`);
  log(`[match-alko]   queue rows created: ${summary.created}; refreshed (still PENDING): ${summary.refreshed}; skipped (already decided, untouched): ${summary.skipped}`);
  log(`[match-alko]   ${yieldLine(summary)}`);
  log(`[match-alko]   zero-candidate products: ${summary.noCandidates}; self-candidate anomalies: ${summary.selfCandidates}; per-product errors: ${summary.errors.length}`);
  log(`[match-alko]   matcher's internal review service stayed inert (create calls: ${summary.inertReviewCreateCalls} — all persisted nothing; design D2 routed every enqueue through the match-review repository).`);
  log('[match-alko] NOTHING auto-published (design D2): no product_reference_links row is CONFIRMED as a result of this pass — review the queue through the operator console (GET /ops/console/match-review?status=PENDING; confirm/reject are attributed and audited).');
  log('[match-alko] Re-running is idempotent per pair: PENDING rows refresh in place, CONFIRMED/REJECTED decisions are never touched (design D5).');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error(usage());
    return 1;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!REPO_ROOT) {
    console.error('[match-alko] FATAL: cannot resolve the repository root from the invoked script path.');
    return 1;
  }

  // --stats reports on stdout (the human-facing report, reclassify
  // precedent); the write pass keeps stdout for its end-of-run summary and
  // streams progress on stderr.
  const log = options.stats
    ? (line: string): void => { console.log(line); }
    : (line: string): void => { console.error(line); };

  try {
    const summary = await runMatchingPass({
      dbFile: options.dbFile,
      local: options.local,
      write: !options.stats,
      limit: options.limit,
      category: options.category,
      log,
    });
    if (options.stats) {
      reportStats(summary, log);
    } else {
      reportWritePass(summary, log);
    }
    return 0;
  } catch (error) {
    console.error(`[match-alko] FATAL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** Run only when invoked directly (tests import the module for its exports). */
const invokedDirectly =
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(`[match-alko] FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
