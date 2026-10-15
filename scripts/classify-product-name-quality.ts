#!/usr/bin/env node
/**
 * Catalog-wide product-name quality classification (task 1.1, change
 * product-name-quality-gate).
 *
 * Runs the name-quality gate over EVERY product_master row — the same
 * classification future ingestions will apply — and reports how the
 * 2026-10-14 client-audit findings extend to the full 20,070-row
 * catalog. The predicates are IMPORTED, never re-implemented:
 * `classifyNameQuality` and `stripNameAnnotation` come from the
 * canonical module packages/data-acquisition/src/services/name-quality.ts
 * (task 2.2) so this backfill and the ingestion gate (task 2.3)
 * classify byte-identically — rule drift here would make the backfill
 * disagree with what the next upsert stores.
 *
 *   - quarantined: empty after trimming, or fewer than 3 alphabetic
 *     characters survive the ABV/ volume/ pack/ numeric strips
 *     (spec: Name informativeness gate at ingestion).
 *   - annotated: a merchant-commentary parenthetical was found; the
 *     stripped display name and annotation metadata are the write
 *     (spec: Merchant annotation stripping). Annotated rows stay 'ok'.
 *
 * The printed counts compare against the 1,425-row live sample
 * (2026-10-15, proposal): empty 0.07 %, non-informative 0.14 %,
 * annotated 0.21 % — rates diverging more than 3x from the sample are
 * flagged before anything is applied.
 *
 * ## Modes
 *
 *   --stats      read-only classification + counts. No artifact, no SQL.
 *   --dry-run    everything --stats does, PLUS the classification
 *                artifact (JSON) and the generated SQL file for review.
 *                Nothing is executed.
 *   apply        (default when no mode flag is given, or explicit
 *                --apply) everything --dry-run does, PLUS executing the
 *                generated UPDATEs and running a post-write verification
 *                SELECT (counts by name_quality). Requires --yes:
 *                without it the run degrades to --dry-run and writes
 *                nothing to D1.
 *
 * Production execution is a deliberate operator act (task 4.1) — this
 * script is built and validated here, run against production only with
 * explicit approval.
 *
 * ## Targets (seed-d1.ts / backfill-history-summaries.ts conventions)
 *
 *   --local                  apps/api-worker's local wrangler D1
 *   --remote --env <name>    a remote D1 environment (staging |
 *                            production) — the deliberate, documented
 *                            operator action; wrangler auth only, no
 *                            credentials are read or printed
 *   --db-file <path>         a plain SQLite file through node:sqlite —
 *                            local fixture/CI, no wrangler
 *
 * Reads are paged by id cursor (READ_PAGE_SIZE) — the full catalog
 * never rides on a single D1 response. Writes are batched: quarantine
 * rows go out as `UPDATE … SET name_quality = 'quarantined' WHERE id
 * IN (…)` with CHUNK_IDS ids per statement; annotated rows are per-row
 * `UPDATE … SET name = …, name_annotation = …` (every row carries
 * different values). Statements execute in EXEC_CHUNK_STATEMENTS-sized
 * `wrangler d1 execute --file` calls, well inside wrangler/D1 limits.
 *
 * ## Scope and idempotency
 *
 * The script ONLY ever writes name, name_quality, and name_annotation
 * — never updated_at (backfill precedent: any UPDATE already fires the
 * FTS rebuild trigger; the freshness timestamp must not churn). The
 * statements are a DIFF against the stored state, so re-running apply
 * after a successful pass emits zero statements; the ARTIFACT remains
 * the full classification baseline (every classified row), which task
 * 4.1 verifies the production counts against. A row classified
 * quarantined AND annotated gets both writes — disjoint column sets,
 * matching what the ingestion gate will store for it (stripped display
 * name, annotation metadata, quarantined quality).
 *
 * ## Artifact
 *
 * JSON at --out (default scripts/out/classify-product-name-quality.json,
 * gitignored via the repo-wide `out/` rule): generatedAt, target,
 * classifier provenance, sourceCounts (total / empty / nonInformative /
 * quarantined / annotated / ok / skippedMalformed), sampleComparison,
 * quarantinedProductIds (number[]), annotatedProductIds
 * ({id, annotation, displayName}[]). The generated SQL sits next to it
 * as classify-product-name-quality.sql for the audit trail.
 *
 * ## Usage (tsx from the data-platform workspace, per seed-d1.ts)
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/classify-product-name-quality.ts --db-file catalog.db --stats
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/classify-product-name-quality.ts --local --dry-run
 *
 *   # Production (task 4.1, operator-only; token inline, never echoed):
 *   CLOUDFLARE_API_TOKEN="$(cat /root/.cloudflare-token)" \
 *     pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/classify-product-name-quality.ts --remote --env production --apply --yes
 *
 * Options: --out <path>, --yes, -h/--help.
 *
 * Exit codes: 0 = success (verification matched); 1 = runtime or
 * verification failure; 2 = usage error.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
// The canonical gate — task 2.2's module, the SAME functions the
// ingestion pipeline will call (task 2.3). Import, never re-implement:
// one convention, two callers, zero rule drift.
import {
  classifyNameQuality,
  stripNameAnnotation,
} from '../packages/data-acquisition/src/services/name-quality';

// ---------------------------------------------------------------------------
// Repo layout — resolved from the module's own location (import.meta.url),
// never from cwd (`pnpm --filter … exec tsx` makes cwd vary) and never from
// argv[1] (which is the test runner's path when vitest imports the module).
// ---------------------------------------------------------------------------
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');
const API_WORKER_DIR = join(REPO_ROOT, 'apps', 'api-worker');
const WRANGLER_BIN = join(API_WORKER_DIR, 'node_modules', '.bin', 'wrangler');
const D1_BINDING = 'DB';

/** Default artifact home — gitignored via the repo-wide `out/` rule. */
const DEFAULT_OUT_PATH = join(
  SCRIPTS_DIR,
  'out',
  'classify-product-name-quality.json',
);
/** SQL twin of the artifact, written beside it. */
const SQL_BASENAME = 'classify-product-name-quality.sql';

/**
 * The 1,425-row live sample the proposal measures (2026-10-15, via
 * GET /api/v1/products) — the rates the catalog-wide counts compare
 * against. The comparison is advisory: diverge >3x and the run flags
 * it, it never refuses.
 */
const RUN_SAMPLE = {
  rows: 1425,
  emptyRatePct: 0.07,
  nonInformativeRatePct: 0.14,
  annotatedRatePct: 0.21,
} as const;

/** Divergence factor that flags a catalog-wide rate against the sample. */
const DIVERGENCE_FACTOR = 3;

/** ids per quarantine `UPDATE … WHERE id IN (…)` statement. */
export const CHUNK_IDS = 100;

/** SQL statements per write execution (wrangler/D1 headroom). */
const EXEC_CHUNK_STATEMENTS = 50;

/** Rows per read page — the catalog never rides one D1 response. */
const READ_PAGE_SIZE = 5000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Which D1 the run targets. Exactly one per run — the artifact records
 * it so the task-4.1 verification compares like with like.
 */
export type Target =
  | { kind: 'local' }
  | { kind: 'remote'; env: string }
  | { kind: 'db-file'; dbFile: string };

export interface CliOptions {
  /** apply is the default — the destructive mode is --yes-gated. */
  mode: 'stats' | 'dry-run' | 'apply';
  /** Apply's explicit confirmation; without it apply stays dry. */
  yes: boolean;
  target: Target;
  outPath: string;
}

export class UsageError extends Error {}

function targetLabel(target: Target): string {
  switch (target.kind) {
    case 'local':
      return 'local';
    case 'remote':
      return `remote:${target.env}`;
    case 'db-file':
      return `db-file:${target.dbFile}`;
  }
}

function usage(): string {
  return [
    'Usage: tsx scripts/classify-product-name-quality.ts [mode] <target> [options]',
    '',
    'Classifies every product_master row through the canonical name-quality gate',
    '(packages/data-acquisition name-quality.ts) and reports quarantine +',
    'annotation counts against the 1,425-row live sample.',
    '',
    'Modes (default apply; exactly one):',
    '  --stats        read-only counts, no artifact, no SQL',
    '  --dry-run      counts + artifact JSON + generated SQL file; nothing executed',
    '  --apply        dry-run + execute the UPDATEs + post-write verification;',
    '                 requires --yes (without it, behaves as --dry-run)',
    '',
    'Targets (exactly one, seed-d1.ts conventions):',
    '  --local                  apps/api-worker local wrangler D1',
    '  --remote --env <name>    remote D1 environment (staging | production)',
    '  --db-file <path>         plain SQLite file via node:sqlite (no wrangler)',
    '',
    'Options:',
    `  --out <path>             artifact JSON path (default ${DEFAULT_OUT_PATH})`,
    '  --yes                    confirm the apply write',
    '  -h, --help               this help',
    '',
    'The script writes ONLY name, name_quality, and name_annotation — never',
    'updated_at. Apply statements are a diff against stored state (idempotent);',
    'the artifact is the full classification baseline.',
  ].join('\n');
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const modeFlags: CliOptions['mode'][] = [];
  let yes = false;
  let target: Target | null = null;
  let outPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--stats':
        modeFlags.push('stats');
        break;
      case '--dry-run':
        modeFlags.push('dry-run');
        break;
      case '--apply':
        modeFlags.push('apply');
        break;
      case '--yes':
        yes = true;
        break;
      case '--local':
        target = { kind: 'local' };
        break;
      case '--remote':
        target = { kind: 'remote', env: '' };
        break;
      case '--env': {
        const env = argv[++i];
        if (env !== 'staging' && env !== 'production') {
          throw new UsageError(`--env expects "staging" or "production", got: ${String(env)}`);
        }
        if (target?.kind !== 'remote') {
          throw new UsageError('--env is only valid together with --remote');
        }
        target.env = env;
        break;
      }
      case '--db-file':
        target = { kind: 'db-file', dbFile: argv[++i] ?? '' };
        break;
      case '--out':
        outPath = argv[++i] ?? '';
        break;
      case '-h':
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new UsageError(`unknown option "${arg}"`);
    }
  }

  if (modeFlags.length > 1) {
    throw new UsageError(
      `modes are mutually exclusive, got: ${modeFlags.map((m) => `--${m}`).join(' ')}`,
    );
  }
  if (target === null) {
    throw new UsageError(
      'pick a target: --local | --remote --env <name> | --db-file <path>',
    );
  }
  if (target.kind === 'remote' && target.env === '') {
    throw new UsageError('--remote requires --env <staging|production>');
  }
  if (target.kind === 'db-file' && target.dbFile === '') {
    throw new UsageError('--db-file requires a path');
  }
  if (outPath === '') {
    throw new UsageError('--out requires a file path');
  }
  if (yes && (modeFlags[0] === 'stats' || modeFlags[0] === 'dry-run')) {
    throw new UsageError(
      `--yes is only meaningful with apply (this run is --${modeFlags[0]})`,
    );
  }

  return {
    // Task contract: apply is the default when no mode flag is given.
    mode: modeFlags[0] ?? 'apply',
    yes,
    target,
    outPath: resolve(outPath ?? DEFAULT_OUT_PATH),
  };
}

// ---------------------------------------------------------------------------
// D1 backends — wrangler (local | remote) and node:sqlite (db-file)
// ---------------------------------------------------------------------------

/** One D1 access path; label identifies the target in reports/artifacts. */
interface D1Backend {
  readonly label: string;
  /** Run one SELECT (or any read), return the result rows. */
  query(sql: string): readonly Record<string, unknown>[];
  /**
   * Execute one batch of statements. `filePath` exists for backends
   * that need a file on disk (wrangler --file); `sqlText` carries the
   * identical content.
   */
  execute(sqlText: string, filePath: string): void;
  close(): void;
}

class WranglerBackend implements D1Backend {
  constructor(
    readonly label: string,
    private readonly modeArgs: readonly string[],
  ) {}

  query(sql: string): readonly Record<string, unknown>[] {
    return this.runWranglerJson(['--command', sql], `query failed: ${sql.slice(0, 80)}…`);
  }

  execute(_sqlText: string, filePath: string): void {
    this.runWranglerJson(['--file', filePath], 'write batch failed');
  }

  close(): void {
    // Nothing held — one wrangler invocation per call.
  }

  private runWranglerJson(
    execArgs: readonly string[],
    failure: string,
  ): readonly Record<string, unknown>[] {
    if (!existsSync(WRANGLER_BIN)) {
      console.error(`FATAL: wrangler binary not found at ${WRANGLER_BIN}`);
      process.exit(1);
    }
    const result = spawnSync(
      WRANGLER_BIN,
      ['d1', 'execute', D1_BINDING, ...this.modeArgs, '--json', '-y', ...execArgs],
      { cwd: API_WORKER_DIR, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      console.error(`FATAL: ${failure} (exit ${result.status ?? 'signal'})`);
      console.error(result.stderr ?? '');
      process.exit(1);
    }
    // Output shape (wrangler 4): [ { results: […], success, meta }, … ]
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      console.error(`FATAL: could not parse wrangler --json output:\n${result.stdout}`);
      process.exit(1);
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    const statements = batch as Array<{ results?: unknown; success?: unknown }>;
    for (const entry of statements) {
      if (entry.success === false) {
        console.error(`FATAL: ${failure} — wrangler reported success=false`);
        process.exit(1);
      }
    }
    const first = statements[0];
    const results = first?.results;
    if (!Array.isArray(results)) {
      return [];
    }
    return results as Record<string, unknown>[];
  }
}

class SqliteBackend implements D1Backend {
  constructor(
    readonly label: string,
    private readonly db: DatabaseSync,
  ) {}

  query(sql: string): readonly Record<string, unknown>[] {
    return this.db.prepare(sql).all() as Record<string, unknown>[];
  }

  execute(sqlText: string, _filePath: string): void {
    this.db.exec(sqlText);
  }

  close(): void {
    this.db.close();
  }
}

function openBackend(target: Target): D1Backend {
  switch (target.kind) {
    case 'local':
      return new WranglerBackend('local', ['--local']);
    case 'remote':
      return new WranglerBackend(`remote:${target.env}`, [
        '--remote',
        '--env',
        target.env,
      ]);
    case 'db-file': {
      const path = resolve(target.dbFile);
      if (!existsSync(path)) {
        console.error(`FATAL: --db-file does not exist: ${path}`);
        process.exit(2);
      }
      return new SqliteBackend(`db-file:${path}`, new DatabaseSync(path));
    }
  }
}

// ---------------------------------------------------------------------------
// Classification — the canonical gate over stored rows
// ---------------------------------------------------------------------------

/** One product_master row as the read path fetches it. */
export interface RawRow {
  readonly id: number;
  readonly name: string;
  readonly storedQuality: string;
  readonly storedAnnotation: string | null;
}

/** One row through the canonical gate, plus its stored state. */
export interface ClassifiedRow extends RawRow {
  /** Canonical gate verdict over the stored name. */
  readonly quality: 'ok' | 'quarantined';
  /** Reporting-only split: empty after trimming (vs non-informative). */
  readonly empty: boolean;
  /** Stripped display name — the write for annotated rows. */
  readonly displayName: string;
  /** Merchant commentary, or null. Annotation never changes quality. */
  readonly annotation: string | null;
}

export function classifyRow(raw: RawRow): ClassifiedRow {
  const { displayName, annotation } = stripNameAnnotation(raw.name);
  return {
    ...raw,
    quality: classifyNameQuality(raw.name),
    empty: raw.name.trim() === '',
    displayName,
    annotation,
  };
}

export interface CatalogStats {
  /** Rows classified (excludes skipped malformed rows). */
  readonly total: number;
  readonly empty: number;
  readonly nonInformative: number;
  /** empty + nonInformative. */
  readonly quarantined: number;
  readonly annotated: number;
  /** total - quarantined. */
  readonly ok: number;
  /** Rows unreadable as (id, name) — counted, never classified/written. */
  readonly skippedMalformed: number;
}

export function computeStats(rows: readonly ClassifiedRow[], skipped: number): CatalogStats {
  const empty = rows.filter((r) => r.empty).length;
  const quarantined = rows.filter((r) => r.quality === 'quarantined').length;
  const annotated = rows.filter((r) => r.annotation !== null).length;
  return {
    total: rows.length,
    empty,
    nonInformative: quarantined - empty,
    quarantined,
    annotated,
    ok: rows.length - quarantined,
    skippedMalformed: skipped,
  };
}

// ---------------------------------------------------------------------------
// Sample comparison — advisory divergence flag against the 1,425-row sample
// ---------------------------------------------------------------------------

export interface SampleComparison {
  readonly sampleRows: number;
  readonly entries: ReadonlyArray<{
    readonly metric: 'empty' | 'non-informative' | 'annotated';
    readonly catalogCount: number;
    readonly catalogRatePct: number;
    readonly sampleRatePct: number;
    /** catalogRate / sampleRate (Infinity when the sample rate is 0). */
    readonly ratio: number;
    readonly divergent: boolean;
  }>;
  /** True when any entry diverges more than DIVERGENCE_FACTOR. */
  readonly divergent: boolean;
}

export function compareWithSample(stats: CatalogStats): SampleComparison {
  const rate = (count: number): number =>
    stats.total === 0 ? 0 : (count / stats.total) * 100;
  const metrics: ReadonlyArray<readonly [
    metric: 'empty' | 'non-informative' | 'annotated',
    count: number,
    sampleRatePct: number,
  ]> = [
    ['empty', stats.empty, RUN_SAMPLE.emptyRatePct],
    ['non-informative', stats.nonInformative, RUN_SAMPLE.nonInformativeRatePct],
    ['annotated', stats.annotated, RUN_SAMPLE.annotatedRatePct],
  ];
  const entries = metrics.map(([metric, count, sampleRatePct]) => {
    const catalogRatePct = rate(count);
    const ratio = sampleRatePct === 0 ? (catalogRatePct === 0 ? 1 : Infinity) : catalogRatePct / sampleRatePct;
    return {
      metric,
      catalogCount: count,
      catalogRatePct,
      sampleRatePct,
      ratio,
      divergent: catalogRatePct > sampleRatePct * DIVERGENCE_FACTOR,
    };
  });
  return {
    sampleRows: RUN_SAMPLE.rows,
    entries,
    divergent: entries.some((e) => e.divergent),
  };
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export interface ClassificationArtifact {
  readonly generatedAt: string;
  readonly target: string;
  /** The canonical module + functions behind every verdict. */
  readonly classifier: string;
  readonly sourceCounts: CatalogStats;
  readonly sampleComparison: SampleComparison;
  readonly quarantinedProductIds: readonly number[];
  readonly annotatedProductIds: ReadonlyArray<{
    readonly id: number;
    readonly annotation: string;
    readonly displayName: string;
  }>;
}

export function buildArtifact(
  rows: readonly ClassifiedRow[],
  stats: CatalogStats,
  comparison: SampleComparison,
  target: Target,
  generatedAt: string,
): ClassificationArtifact {
  return {
    generatedAt,
    target: targetLabel(target),
    classifier:
      'packages/data-acquisition/src/services/name-quality.ts@classifyNameQuality+stripNameAnnotation',
    sourceCounts: stats,
    sampleComparison: comparison,
    quarantinedProductIds: rows
      .filter((r) => r.quality === 'quarantined')
      .map((r) => r.id),
    annotatedProductIds: rows
      .filter((r) => r.annotation !== null)
      .map((r) => ({ id: r.id, annotation: r.annotation as string, displayName: r.displayName })),
  };
}

export function serializeArtifact(artifact: ClassificationArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Statements — a diff against stored state (idempotent), tightly scoped
// ---------------------------------------------------------------------------

/** Single-quote SQL literal escaping — the only injection surface. */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function chunkIds(ids: readonly number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size) as number[]);
  }
  return chunks;
}

export interface WritePlan {
  /** Classified-quarantined rows whose stored state still says otherwise. */
  readonly quarantineIds: readonly number[];
  readonly quarantineStatements: readonly string[];
  /** Classified-annotated rows whose stored name/annotation differ. */
  readonly annotatedRows: readonly ClassifiedRow[];
  readonly annotatedStatements: readonly string[];
}

/**
 * The write plan: only rows whose stored state differs from the
 * classification. Re-running after a successful apply yields zero
 * statements; the artifact above stays the full baseline.
 */
export function buildWritePlan(rows: readonly ClassifiedRow[]): WritePlan {
  const quarantineIds = rows
    .filter((r) => r.quality === 'quarantined' && r.storedQuality !== 'quarantined')
    .map((r) => r.id);
  const annotatedRows = rows.filter(
    (r) =>
      r.annotation !== null &&
      (r.storedAnnotation !== r.annotation || r.name !== r.displayName),
  );
  return {
    quarantineIds,
    quarantineStatements: chunkIds(quarantineIds, CHUNK_IDS).map(
      (chunk) =>
        `UPDATE product_master SET name_quality = 'quarantined' WHERE id IN (${chunk.join(', ')});`,
    ),
    annotatedRows,
    annotatedStatements: annotatedRows.map(
      (r) =>
        `UPDATE product_master SET name = ${sqlLiteral(r.displayName)}, `
        + `name_annotation = ${sqlLiteral(r.annotation as string)} WHERE id = ${r.id};`,
    ),
  };
}

/** All statements, apply order: quarantine IN-lists, then per-row strips. */
export function allStatements(plan: WritePlan): string[] {
  return [...plan.quarantineStatements, ...plan.annotatedStatements];
}

// ---------------------------------------------------------------------------
// Reads — paged by id cursor so the catalog never rides one response
// ---------------------------------------------------------------------------

const READ_SQL_TEMPLATE = `
  SELECT id, name, name_quality, name_annotation
    FROM product_master
   WHERE id > %CURSOR%
   ORDER BY id
   LIMIT %PAGE%`;

/**
 * Page through product_master by id cursor. Rows that fail the
 * (id: integer, name: string) shape are counted and listed but never
 * classified or written — the schema makes them impossible; a hit means
 * corruption worth seeing, not smoothing over.
 */
function readCatalog(backend: D1Backend): {
  rows: ClassifiedRow[];
  malformed: Array<{ id: unknown; reason: string }>;
} {
  const classified: ClassifiedRow[] = [];
  const malformed: Array<{ id: unknown; reason: string }> = [];
  let cursor = 0;
  for (;;) {
    const page = backend.query(
      READ_SQL_TEMPLATE.replace('%CURSOR%', String(cursor)).replace('%PAGE%', String(READ_PAGE_SIZE)),
    );
    if (page.length === 0) break;
    let maxId = 0;
    for (const record of page) {
      const id = record.id;
      const name = record.name;
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        malformed.push({ id, reason: `id is not a positive integer (${String(id)})` });
        continue;
      }
      if (typeof name !== 'string') {
        malformed.push({ id, reason: `name is not a string (${String(name)})` });
        continue;
      }
      if (id > maxId) maxId = id;
      classified.push(
        classifyRow({
          id,
          name,
          storedQuality: typeof record.name_quality === 'string' ? record.name_quality : 'ok',
          storedAnnotation: typeof record.name_annotation === 'string' ? record.name_annotation : null,
        }),
      );
    }
    if (maxId <= cursor) break; // defensive: no forward progress
    cursor = maxId;
    if (page.length < READ_PAGE_SIZE) break;
  }
  return { rows: classified, malformed };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pct(value: number): string {
  return `${value.toFixed(4)} %`;
}

function printStats(stats: CatalogStats, comparison: SampleComparison, report: (line: string) => void): void {
  report(`classified ${stats.total} rows (skipped malformed: ${stats.skippedMalformed})`);
  report(`  quarantined: ${stats.quarantined} (${pct(stats.total === 0 ? 0 : (stats.quarantined / stats.total) * 100)})`);
  report(`    empty:           ${stats.empty}`);
  report(`    non-informative: ${stats.nonInformative}`);
  report(`  annotated (stays ok, name stripped): ${stats.annotated}`);
  report(`  ok: ${stats.ok}`);
  report('');
  report(`sample comparison (${RUN_SAMPLE.rows}-row live sample, 2026-10-15; flag at >${DIVERGENCE_FACTOR}x):`);
  for (const entry of comparison.entries) {
    const flag = entry.divergent ? '  <-- DIVERGES from sample' : '';
    report(
      `    ${entry.metric.padEnd(16)} catalog ${pct(entry.catalogRatePct).padStart(12)}`
        + `  vs sample ${pct(entry.sampleRatePct).padStart(9)}  (${Number.isFinite(entry.ratio) ? `${entry.ratio.toFixed(2)}x` : '∞'})${flag}`,
    );
  }
  if (comparison.divergent) {
    report('');
    report('DIVERGENCE: catalog-wide rates diverge wildly from the sample —');
    report('inspect the artifact before applying (concentrated merchant feeds are a plausible cause).');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`usage: ${error.message}\n\n${usage()}`);
    } else {
      console.error(`usage error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 2;
  }

  // Task contract: apply without --yes behaves as --dry-run.
  const effectiveMode: CliOptions['mode'] =
    options.mode === 'apply' && !options.yes ? 'dry-run' : options.mode;
  if (options.mode === 'apply' && !options.yes) {
    console.error('apply requested without --yes — behaving as --dry-run (nothing will be written).');
    console.error('');
  }

  const backend = openBackend(options.target);
  try {
    console.log(`[name-quality] target ${backend.label}, mode ${effectiveMode}`);
    const { rows, malformed } = readCatalog(backend);
    for (const bad of malformed.slice(0, 10)) {
      console.error(`  malformed row skipped (never classified/written): id=${String(bad.id)} — ${bad.reason}`);
    }
    if (malformed.length > 10) {
      console.error(`  … and ${malformed.length - 10} more malformed rows`);
    }

    const stats = computeStats(rows, malformed.length);
    const comparison = compareWithSample(stats);
    printStats(stats, comparison, (line) => console.log(line));

    if (effectiveMode === 'stats') {
      return 0;
    }

    const artifact = buildArtifact(rows, stats, comparison, options.target, new Date().toISOString());
    const plan = buildWritePlan(rows);
    const statements = allStatements(plan);

    mkdirSync(dirname(options.outPath), { recursive: true });
    const sqlPath = join(dirname(options.outPath), SQL_BASENAME);
    writeFileSync(options.outPath, serializeArtifact(artifact));
    writeFileSync(sqlPath, statements.length > 0 ? `${statements.join('\n')}\n` : '');
    console.log('');
    console.log(`artifact written: ${options.outPath}`);
    console.log(`SQL written:      ${sqlPath} (${statements.length} statement(s); nothing executed yet)`);

    if (effectiveMode === 'dry-run') {
      console.log('dry run: no statements executed.');
      return 0;
    }

    // ---- apply ----
    console.log('');
    console.log(
      `about to write (diff against stored state): `
      + `${plan.quarantineIds.length} quarantine row(s) in ${plan.quarantineStatements.length} IN-list statement(s), `
      + `${plan.annotatedRows.length} annotated row(s) rewritten individually`,
    );
    if (statements.length === 0) {
      console.log('nothing to write — stored state already matches the classification (idempotent no-op).');
    }

    // Execute in EXEC_CHUNK_STATEMENTS-sized batches. Wrangler needs a
    // file on disk (--file); the chunk files live beside the artifact
    // (gitignored) and are removed once their batch succeeds.
    let executed = 0;
    for (let i = 0; i < statements.length; i += EXEC_CHUNK_STATEMENTS) {
      const chunk = statements.slice(i, i + EXEC_CHUNK_STATEMENTS) as string[];
      const chunkPath = `${sqlPath}.chunk${Math.floor(i / EXEC_CHUNK_STATEMENTS) + 1}.sql`;
      const chunkText = `${chunk.join('\n')}\n`;
      try {
        writeFileSync(chunkPath, chunkText);
        backend.execute(chunkText, chunkPath);
      } finally {
        rmSync(chunkPath, { force: true });
      }
      executed += chunk.length;
      console.log(`  executed ${executed}/${statements.length} statement(s)`);
    }

    // Post-write verification — counts by name_quality vs the classification.
    const verifyRows = backend.query(
      'SELECT name_quality, COUNT(*) AS n FROM product_master GROUP BY name_quality ORDER BY name_quality',
    );
    const actual = new Map<string, number>(
      verifyRows.map((r) => [String(r.name_quality), Number(r.n)]),
    );
    const expected: Array<[string, number]> = [
      ['ok', stats.ok],
      ['quarantined', stats.quarantined],
    ];
    console.log('');
    console.log('post-write verification (counts by name_quality):');
    let verified = true;
    for (const [quality, count] of expected) {
      const seen = actual.get(quality) ?? 0;
      const match = seen === count;
      verified = verified && match;
      console.log(`  ${quality.padEnd(12)} expected ${String(count).padStart(6)}  actual ${String(seen).padStart(6)}  ${match ? 'MATCH' : 'MISMATCH'}`);
    }
    for (const [quality, n] of actual) {
      if (quality !== 'ok' && quality !== 'quarantined') {
        console.log(`  ${quality.padEnd(12)} unexpected value present: ${n} row(s)`);
        verified = false;
      }
    }
    const annotatedStored = backend.query(
      'SELECT COUNT(*) AS n FROM product_master WHERE name_annotation IS NOT NULL',
    )[0];
    console.log(
      `  annotated    stored rows with name_annotation: ${Number(annotatedStored?.n ?? 0)}`
        + ` (classified annotated: ${stats.annotated} — a stored surplus means a name changed upstream)`,
    );

    if (!verified) {
      console.error('');
      console.error(
        'verification FAILED — counts by name_quality do not match the classification. '
        + 'Rows may have changed during the run (concurrent ingestion); re-run --stats.',
      );
      return 1;
    }
    console.log('');
    console.log('verification PASSED — stored name_quality matches the classification.');
    return 0;
  } finally {
    backend.close();
  }
}

/** Run only when invoked directly (tests import the module's exports). */
const invokedDirectly =
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = main();
}
