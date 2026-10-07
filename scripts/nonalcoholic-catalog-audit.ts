#!/usr/bin/env node
/**
 * Non-alcoholic catalog audit (task 3.3, change
 * nonalcoholic-catalog-hygiene; design D4 — the cleanup is an audited
 * dry-run-first script, not a migration).
 *
 * The merchant-feed category mapping used to admit anything it could not
 * classify, so energy drinks, mineral waters, and juices sit in
 * `product_master` under canonical alcohol categories with no alcohol in
 * them: the 2026-10-04 observation counted 80 products at 0.0 % ABV and
 * 42 with unknown ABV in the first 300 `other_fermented` rows — roughly
 * 120 production rows overall. Those rows are outside the listing
 * universe since the shared read-side predicate landed (task 3.2:
 * alcohol-category product ⇒ ABV > 0 AND not held), but the rows
 * themselves are still unflagged. This script enumerates them and —
 * only on the explicit `--apply` — holds them for review:
 *
 *   review_hold_reason = 'nonalcoholic_in_alcohol_category'
 *
 * (the core-domain NONALCOHOLIC_HOLD_REASON token — imported, never
 * re-worded, so the audit cannot drift from the ingestion guard).
 *
 * Design D1: hold for review, never delete. Nothing is deleted, no
 * existing hold is lifted, and `updated_at` is deliberately not touched
 * (the reclassify-category backfill precedent: the UPDATE fires the FTS
 * rebuild trigger, but a review flag must not churn the freshness
 * timestamp). The affected set is data-dependent, so this is a script
 * the operator runs against an environment, not a migration: the
 * correction queue — not the schema — owns review state (design D4).
 *
 * Affected set — the exact complement of the shared listing universe's
 * ABV clause over unheld rows (`PRODUCT_LISTING_UNIVERSE_SQL`,
 * product-search.repository.ts): every canonical product category is an
 * alcohol category, so a row is affected when
 *
 *   review_hold_reason IS NULL
 *   AND (alcohol_by_volume IS NULL OR alcohol_by_volume <= 0)
 *
 * Already-held rows are outside the enumeration by construction, which
 * is what makes `--apply` idempotent: re-running after an apply
 * enumerates zero rows and writes nothing. Zero affected rows is a
 * SUCCESS (exit 0) — honest shrinkage is the expected end state, not an
 * error.
 *
 * ## Modes
 *
 *   (default)    dry-run: enumerate the affected rows and print the
 *                review summary (totals, per-category counts, sample
 *                rows) plus what apply would change. Writes nothing.
 *   --apply      hold exactly the enumerated rows (idempotent; see
 *                above), print the same summary plus the applied count
 *                and a re-enumeration check.
 *
 * ## Target selection (same conventions as scripts/seed-d1.ts)
 *
 *   --local                  apps/api-worker's local wrangler D1
 *   --remote --env <name>    a remote D1 environment (staging |
 *                            production) — the deliberate, documented
 *                            operator action; wrangler auth only, no
 *                            credentials are read or printed
 *   --db-file <path>         a plain SQLite file through node:sqlite —
 *                            local fixture/CI, no wrangler
 *
 * Options: --sample <n> (default 10, 0 disables the sample listing),
 * -h, --help.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/nonalcoholic-catalog-audit.ts --remote --env production
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/nonalcoholic-catalog-audit.ts --remote --env production --apply
 *
 * Operator procedure: docs/ingestion-runbook.md §8.
 *
 * Exit codes: 0 = success, including zero affected rows; 1 = connection
 * or execution failure; 2 = usage error.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
// The hold-reason token single-sourced from the ingestion guard's mapper
// (its import chain is loader-safe; the core-domain barrel is not — it
// drags parameter decorators plain esbuild cannot strip).
import { NONALCOHOLIC_HOLD_REASON } from '../packages/core-domain/src/normalization/source-category.mapper';

// ---------------------------------------------------------------------------
// SQL — the enumeration mirrors the shared listing-universe predicate
// ---------------------------------------------------------------------------

/**
 * The affected-set condition. `<= 0` (not `= 0`) keeps the enumeration
 * the exact complement of `PRODUCT_LISTING_UNIVERSE_SQL`'s
 * `alcohol_by_volume IS NOT NULL AND alcohol_by_volume > 0` clause: a
 * corrupt negative value would be as invisible to the catalog as a zero.
 * Held rows are excluded by the first conjunct — the idempotence.
 */
const AFFECTED_WHERE = `review_hold_reason IS NULL \
AND (alcohol_by_volume IS NULL OR alcohol_by_volume <= 0)`;

/** One row per affected product, stable order for the sample and the apply. */
const ENUMERATE_AFFECTED_SQL = `
  SELECT id, name, category, alcohol_by_volume, ean
    FROM product_master
   WHERE ${AFFECTED_WHERE}
   ORDER BY id ASC`;

/** Totals in one round-trip: catalog size, already-held, affected. */
const STATS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM product_master) AS total_rows,
    (SELECT COUNT(*) FROM product_master
      WHERE review_hold_reason IS NOT NULL) AS held_rows,
    (SELECT COUNT(*) FROM product_master
      WHERE ${AFFECTED_WHERE}) AS affected_rows`;

/** Review summary's per-category counts (every category is an alcohol one). */
const CATEGORY_COUNTS_SQL = `
  SELECT category, COUNT(*) AS rows
    FROM product_master
   WHERE ${AFFECTED_WHERE}
   GROUP BY category
   ORDER BY rows DESC, category ASC`;

/** Apply chunk size — ~120 rows today; the chunk exists so a larger
 * backlog cannot grow one statement without bound. */
const APPLY_CHUNK = 500;

/** Single-quote SQL literal escaping — values come from fixed vocabularies. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The idempotent apply: set the hold on the enumerated ids only, and
 * re-check `review_hold_reason IS NULL` in the same statement so a row
 * that gained a hold between enumeration and execution is never
 * re-stamped. `updated_at` is deliberately not set (module header).
 */
function buildApplySql(ids: readonly number[]): readonly string[] {
  const chunks: string[] = [];
  for (let i = 0; i < ids.length; i += APPLY_CHUNK) {
    const slice = ids.slice(i, i + APPLY_CHUNK);
    if (slice.length === 0) continue;
    chunks.push(`
  UPDATE product_master
     SET review_hold_reason = ${sqlLiteral(NONALCOHOLIC_HOLD_REASON)}
   WHERE review_hold_reason IS NULL
     AND id IN (${slice.join(', ')})`);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// D1 backends — wrangler (local | remote) and node:sqlite (db-file);
// the backfill-history-summaries.ts precedent
// ---------------------------------------------------------------------------

/**
 * One D1 access path. `execute` returns the backend's changed-row count —
 * informational only: on remote D1, meta.changes includes trigger-driven
 * FTS sync ops, so it must never be reported as the applied-row figure
 * (the summary derives that from the held-row delta instead).
 */
interface D1Backend {
  readonly label: string;
  query(sql: string): readonly Record<string, unknown>[];
  execute(sql: string): number;
  close(): void;
}

function repoLayout(): { repoRoot: string; apiWorkerDir: string; wranglerBin: string } {
  const scriptPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
  const scriptsDir = scriptPath ? dirname(scriptPath) : undefined;
  if (!scriptsDir || basename(scriptsDir) !== 'scripts') {
    throw new Error(
      'cannot resolve the repository root from the invoked script path — run via tsx scripts/nonalcoholic-catalog-audit.ts',
    );
  }
  const repoRoot = resolve(scriptsDir, '..');
  const apiWorkerDir = join(repoRoot, 'apps', 'api-worker');
  return {
    repoRoot,
    apiWorkerDir,
    wranglerBin: join(apiWorkerDir, 'node_modules', '.bin', 'wrangler'),
  };
}

class WranglerBackend implements D1Backend {
  constructor(
    readonly label: string,
    private readonly modeArgs: readonly string[],
    private readonly wranglerBin: string,
    private readonly apiWorkerDir: string,
  ) {}

  private run(sql: string): { results: Record<string, unknown>[]; changes: number } {
    const result = spawnSync(
      this.wranglerBin,
      [
        'd1',
        'execute',
        'DB',
        ...this.modeArgs,
        '--json',
        '-y',
        '--command',
        sql,
      ],
      { cwd: this.apiWorkerDir, encoding: 'utf8' },
    );
    if (result.status !== 0 || result.error !== undefined) {
      console.error(
        `FATAL: wrangler d1 execute failed (exit ${result.status ?? 'signal'})\n${result.stderr ?? ''}`,
      );
      process.exit(1);
    }
    // Output shape (wrangler 4): [ { results: […], success, meta } ]
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      console.error(`FATAL: could not parse wrangler --json output:\n${result.stdout}`);
      process.exit(1);
    }
    const batch = Array.isArray(parsed) ? parsed[0] : parsed;
    const results = (batch as { results?: unknown })?.results;
    if (!Array.isArray(results)) {
      console.error(`FATAL: wrangler --json output carries no results array:\n${result.stdout}`);
      process.exit(1);
    }
    const changes = Number(
      (batch as { meta?: { changes?: unknown } })?.meta?.changes ?? 0,
    );
    return { results: results as Record<string, unknown>[], changes };
  }

  query(sql: string): readonly Record<string, unknown>[] {
    return this.run(sql).results;
  }

  execute(sql: string): number {
    return this.run(sql).changes;
  }

  close(): void {
    // Nothing held — one wrangler invocation per statement.
  }
}

class SqliteBackend implements D1Backend {
  constructor(
    readonly label: string,
    private readonly db: DatabaseSync,
  ) {}

  query(sql: string): readonly Record<string, unknown>[] {
    return this.db.prepare(sql).all() as unknown as Record<string, unknown>[];
  }

  execute(sql: string): number {
    return Number(this.db.prepare(sql).run().changes);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  apply: boolean;
  mode: 'local' | 'remote' | 'db-file';
  env?: string;
  dbFile?: string;
  sample: number;
}

const DEFAULT_SAMPLE = 10;

function usage(): string {
  return [
    'Usage: tsx scripts/nonalcoholic-catalog-audit.ts [--apply] [target] [options]',
    '',
    'Modes (default is a dry-run — it writes nothing):',
    '  (default)                enumerate affected rows, print the review summary',
    '  --apply                  hold exactly the enumerated rows (idempotent)',
    '',
    'Targets (exactly one, seed-d1.ts conventions):',
    '  --local                  apps/api-worker local wrangler D1',
    '  --remote --env <name>    remote D1 environment (staging | production)',
    '  --db-file <path>         plain SQLite file via node:sqlite (no wrangler)',
    '',
    'Options:',
    `  --sample <n>             sample rows listed in the summary (default ${DEFAULT_SAMPLE}, 0 disables)`,
    '  -h, --help               this help',
    '',
    `A row is affected when it is not held and its ABV is zero, negative, or`,
    `unknown — the complement of the shared listing-universe predicate. Apply`,
    `sets review_hold_reason = '${NONALCOHOLIC_HOLD_REASON}' on those rows and nothing else:`,
    `nothing is deleted, no hold is lifted, updated_at is not touched. Zero`,
    `affected rows is success (honest shrinkage). docs/ingestion-runbook.md §8.`,
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: Partial<CliOptions> = { apply: false, sample: DEFAULT_SAMPLE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--local':
        options.mode = 'local';
        break;
      case '--remote':
        options.mode = 'remote';
        break;
      case '--env':
        options.env = argv[++i];
        break;
      case '--db-file':
        options.mode = 'db-file';
        options.dbFile = argv[++i];
        break;
      case '--sample': {
        const raw = argv[++i];
        if (!/^\d+$/.test(raw ?? '')) {
          throw new Error(`--sample needs a non-negative integer, got: ${String(raw)}`);
        }
        options.sample = Number.parseInt(raw, 10);
        break;
      }
      case '-h':
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!options.mode) {
    throw new Error('pick a target: --local | --remote --env <name> | --db-file <path>');
  }
  if (options.mode === 'remote' && !options.env) {
    throw new Error('--remote requires --env <name>');
  }
  if (options.mode === 'db-file' && !options.dbFile) {
    throw new Error('--db-file requires a path');
  }
  return options as CliOptions;
}

function openBackend(options: CliOptions): D1Backend {
  const layout = repoLayout();
  switch (options.mode) {
    case 'local':
      return new WranglerBackend(
        'local',
        ['--local'],
        layout.wranglerBin,
        layout.apiWorkerDir,
      );
    case 'remote':
      return new WranglerBackend(
        `remote:${options.env}`,
        ['--remote', '--env', options.env as string],
        layout.wranglerBin,
        layout.apiWorkerDir,
      );
    case 'db-file': {
      const path = resolve(options.dbFile as string);
      if (!existsSync(path)) {
        console.error(`FATAL: --db-file does not exist: ${path}`);
        process.exit(2);
      }
      return new SqliteBackend(`db-file:${path}`, new DatabaseSync(path));
    }
  }
}

/** The exact apply command for this target — printed by the dry-run. */
function applyCommand(options: CliOptions): string {
  const parts = [
    'pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/nonalcoholic-catalog-audit.ts',
  ];
  if (options.mode === 'local') parts.push('--local');
  if (options.mode === 'remote') parts.push('--remote', `--env ${options.env}`);
  if (options.mode === 'db-file') parts.push(`--db-file ${options.dbFile}`);
  parts.push('--apply');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Enumeration + review summary
// ---------------------------------------------------------------------------

/** One affected product_master row. */
interface AffectedRow {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  /** 0–1 fraction as stored; null = unparseable/unknown. */
  readonly alcoholByVolume: number | null;
  readonly ean: string | null;
}

interface AuditReport {
  readonly totalRows: number;
  readonly heldRows: number;
  readonly affected: readonly AffectedRow[];
  readonly categoryCounts: ReadonlyArray<{ readonly category: string; readonly rows: number }>;
}

function collectAuditReport(backend: D1Backend): AuditReport {
  const stats = backend.query(STATS_SQL)[0];
  if (!stats) {
    throw new Error('stats query returned no row — is product_master migrated?');
  }
  const affected = backend.query(ENUMERATE_AFFECTED_SQL).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    category: String(row.category),
    alcoholByVolume: row.alcohol_by_volume === null ? null : Number(row.alcohol_by_volume),
    ean: typeof row.ean === 'string' ? row.ean : null,
  }));
  const categoryCounts = backend
    .query(CATEGORY_COUNTS_SQL)
    .map((row) => ({ category: String(row.category), rows: Number(row.rows) }));
  return {
    totalRows: Number(stats.total_rows),
    heldRows: Number(stats.held_rows),
    affected,
    categoryCounts,
  };
}

function formatAbv(abv: number | null): string {
  return abv === null ? 'unknown' : String(abv);
}

function printReviewSummary(report: AuditReport, sample: number): void {
  console.log(`  product_master rows: ${report.totalRows} (already held: ${report.heldRows})`);
  console.log(`  affected rows (not held, ABV zero/negative/unknown): ${report.affected.length}`);
  if (report.categoryCounts.length > 0) {
    const counts = report.categoryCounts
      .map((c) => `${c.category}=${c.rows}`)
      .join(', ');
    console.log(`  affected per category: ${counts}`);
  }
  if (sample > 0 && report.affected.length > 0) {
    console.log(`  sample (first ${Math.min(sample, report.affected.length)} of ${report.affected.length}):`);
    for (const row of report.affected.slice(0, sample)) {
      console.log(
        `    id=${row.id} "${row.name}" — ${row.category}, ABV ${formatAbv(row.alcoholByVolume)}, ean ${row.ean ?? '—'}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

interface AuditOptions {
  readonly apply: boolean;
  readonly sample: number;
  /** The rendered --apply command, printed by the dry-run hint. */
  readonly applyCommand?: string;
}

function runAudit(backend: D1Backend, options: AuditOptions): number {
  const report = collectAuditReport(backend);
  console.log(
    `[nonalcoholic-audit] ${options.apply ? 'APPLY' : 'DRY-RUN'} — target ${backend.label}` +
      `${options.apply ? '' : ' (read-only, nothing written)'}`,
  );
  printReviewSummary(report, options.sample);

  if (report.affected.length === 0) {
    console.log(
      '[nonalcoholic-audit] affected rows: 0 — nothing to apply (honest shrinkage is expected); exit 0.',
    );
    return 0;
  }

  if (!options.apply) {
    console.log(
      `[nonalcoholic-audit] apply would set review_hold_reason = ${sqlLiteral(NONALCOHOLIC_HOLD_REASON)}`,
    );
    console.log(
      `  on those ${report.affected.length} row(s) — nothing deleted, no hold lifted, updated_at untouched.`,
    );
    console.log('  Apply (explicit, idempotent):');
    console.log(`    ${options.applyCommand ?? applyCommand({ apply: true, sample: options.sample, mode: 'local' })}`);
    return 0;
  }

  const statements = buildApplySql(report.affected.map((row) => row.id));
  for (const statement of statements) {
    backend.execute(statement);
  }
  // The authoritative applied count is the DB's own held-row delta, not
  // the backend's changed-row returns: on remote D1, meta.changes counts
  // trigger-driven FTS sync ops too (observed 5× the true figure on
  // production), so summing execute() returns over-reports.
  const after = collectAuditReport(backend);
  const applied = after.heldRows - report.heldRows;
  const remaining = after.affected.length;
  console.log(
    `[nonalcoholic-audit] applied: ${applied} row(s) now held with ${sqlLiteral(NONALCOHOLIC_HOLD_REASON)}.`,
  );
  if (remaining > 0) {
    // New rows matching the condition appeared mid-run (e.g. a concurrent
    // ingestion pass landed one) — not a failure of this apply; the
    // idempotent re-run catches them.
    console.log(
      `  NOTE: ${remaining} row(s) still match the condition (concurrent ingestion?) — re-run to hold them.`,
    );
  } else {
    console.log('  re-enumeration finds 0 remaining — re-running is a no-op.');
  }
  return 0;
}

// ---------------------------------------------------------------------------

function main(): number {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error(usage());
    return 2;
  }
  const backend = openBackend(options);
  try {
    return runAudit(backend, {
      apply: options.apply,
      sample: options.sample,
      applyCommand: applyCommand(options),
    });
  } finally {
    backend.close();
  }
}

/** Run only when invoked directly (tests import the module for its exports). */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error: unknown) {
    console.error(
      `[nonalcoholic-audit] FATAL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

export type { AffectedRow, AuditReport, CliOptions, D1Backend };
export {
  AFFECTED_WHERE,
  APPLY_CHUNK,
  buildApplySql,
  collectAuditReport,
  DEFAULT_SAMPLE,
  ENUMERATE_AFFECTED_SQL,
  parseArgs,
  runAudit,
  usage,
};
