#!/usr/bin/env node
/**
 * History summary backfill (task 1.3, change
 * watermark-isolation-history-backfill; design D3 — the documented
 * manual re-scan path, never a request-path aggregation).
 *
 * Closes `price_history_summaries` coverage gaps the same way the
 * aggregation job itself documents: "manual re-scans can lower the
 * watermark directly" (apps/api-worker/src/cron/time-series-aggregation.ts,
 * protocol step 4). The script only moves the watermark and verifies —
 * the actual bucket writes are done by the aggregation job's own
 * idempotent per-bucket upserts, so re-running converges and the request
 * path is never touched ("charts never recompute raw history").
 *
 * ## The five-step procedure (design D3)
 *
 *   1. Read the persisted watermark (D1 `aggregation_watermarks`, row
 *      `time-series-aggregation` ONLY — the job-scoped read is the
 *      table's contract; the savings-cursor row is never touched).
 *   2. Find the earliest unsummarized observation: products with
 *      `retail_offers` rows in the window but zero `daily` summary
 *      buckets (the coverage verification query, inverted — design D4
 *      measures coverage with the same D1 pair; the R2 observation log
 *      rows mirror these offer appends 1:1 via `retail_offer_id`).
 *   3. Lower the persisted watermark to that observation's ISO-week
 *      Monday (`startOfIsoWeek`, the same pure helper the job's read
 *      path uses) — never forward, only when it strictly lowers.
 *   4. Let the aggregation run — the next 30-minute tick, or the
 *      out-of-band trigger documented in docs/ingestion-runbook.md §7.
 *      Buckets rewrite identically (idempotent upserts); the job
 *      advances the watermark itself after all writes succeed.
 *   5. Restore/verify: the verification query (products with
 *      observations but zero summary buckets in the window → 0) must
 *      pass; the watermark must end at or above the pre-backfill value
 *      (the job's own advance usually supersedes the restore — writing
 *      the older value back would regress it).
 *
 * ## Modes
 *
 *   --plan       (default, read-only) dry-run: read the watermark and
 *                coverage state, print the exact lowering target and
 *                the apply commands. Writes nothing.
 *   --lower      APPLY phase 1: capture the pre-backfill watermark to
 *                a state file, lower the watermark. Idempotent.
 *   --restore    APPLY phase 2: run the verification query; restore the
 *                pre-backfill watermark only where that would not
 *                regress it (see step 5). Refuses to act while the
 *                watermark still sits at the lowered value (the
 *                aggregation has not re-scanned yet) unless --force
 *                aborts the backfill explicitly. Idempotent.
 *   --verify     read-only: the verification query only — the same
 *                check the runbook documents, exit 1 on gaps.
 *
 * There is deliberately no single "--apply" that does everything: the
 * aggregation trigger cannot be fired synchronously by this script, so
 * the apply path is two deliberate operator steps with a documented
 * trigger between them.
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
 * Options: --window-days <n> (default 365, design D3), --state-file
 * <path> (default ./backfill-history-summaries.state.json), -h.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/backfill-history-summaries.ts --remote --env production --plan
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/backfill-history-summaries.ts --remote --env production --lower
 *   # ... trigger the aggregation (runbook §7.4) ...
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/backfill-history-summaries.ts --remote --env production --restore
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// The weekly bucket anchor the aggregation job itself scans from — reused,
// never replicated, so the lowering cannot drift from the job's read path
// (startOfIsoWeek is exported from the module the cron imports it from).
import { startOfIsoWeek } from '../packages/data-platform/src/d1/summary-aggregation';

// ---------------------------------------------------------------------------
// Repo layout — resolved from the invoked script path (process.argv[1]),
// never from cwd (seed-d1.ts convention: `pnpm --filter … exec tsx` makes
// cwd vary).
// ---------------------------------------------------------------------------
const SCRIPTS_DIR = process.argv[1]
  ? dirname(resolve(process.argv[1]))
  : undefined;
if (!SCRIPTS_DIR || basename(SCRIPTS_DIR) !== 'scripts') {
  console.error(
    'FATAL: cannot resolve the repository root from the invoked script path.',
  );
  process.exit(1);
}
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');
const API_WORKER_DIR = join(REPO_ROOT, 'apps', 'api-worker');
const WRANGLER_BIN = join(API_WORKER_DIR, 'node_modules', '.bin', 'wrangler');
const D1_BINDING = 'DB';

/**
 * The aggregating job's watermark row — byte-parity with WATERMARK_KEY
 * in apps/api-worker/src/cron/time-series-aggregation.ts, inlined here
 * (the cron's own precedent: importing the Worker module graph into a
 * script would drag bindings and adapters with it). Only this row is
 * ever read or written; the savings-cursor row the incident exposed is
 * out of scope by construction.
 */
const JOB_NAME = 'time-series-aggregation';

/** Coverage window (design D3: bounded to the last 365 days). */
const DEFAULT_WINDOW_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// SQL — mirrors the repository contracts exactly
// ---------------------------------------------------------------------------

/** Parity: D1AggregationWatermarkRepository FIND_SQL, job name pinned. */
const WATERMARK_FIND_SQL = `
  SELECT watermark FROM aggregation_watermarks WHERE job_name = '${JOB_NAME}'`;

/**
 * Parity: D1AggregationWatermarkRepository UPSERT_SQL — touches only the
 * job's own row (job_name UNIQUE is a plain single-column key).
 */
function watermarkUpsertSql(watermarkIso: string, nowIso: string): string {
  return `
  INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
  VALUES ('${JOB_NAME}', '${watermarkIso}', '${nowIso}')
  ON CONFLICT (job_name) DO UPDATE SET
    watermark = excluded.watermark,
    updated_at = excluded.updated_at`;
}

/**
 * The coverage measurement (design D4's D1 pair, verification form):
 * products with observations in the window but ZERO daily summary
 * buckets. "Observations" = `retail_offers` rows — the append-only
 * offer-observation table in D1; every R2 observation-log line mirrors
 * one of these appends (`retail_offer_id`), and the cron's own coverage
 * metric (design D4) measures the same D1 pair.
 *
 * Summary-floor semantics: an in-window observation's daily bucket
 * anchor is its own UTC day, so `period_start >= <cutoff day>` covers
 * every daily bucket the job would have written for in-window
 * observations. Weekly rows are redundant for existence — every
 * aggregated span carries daily rows.
 */
function coverageSql(cutoffIso: string, cutoffDay: string): string {
  const summarized = `
    SELECT product_id FROM price_history_summaries
     WHERE granularity = 'daily' AND period_start >= '${cutoffDay}'`;
  return `
  SELECT
    (SELECT COUNT(DISTINCT product_id) FROM retail_offers
      WHERE observed_at >= '${cutoffIso}') AS products_with_observations,
    (SELECT COUNT(DISTINCT product_id) FROM retail_offers
      WHERE observed_at >= '${cutoffIso}'
        AND product_id NOT IN (${summarized})) AS products_missing_summaries,
    (SELECT MIN(observed_at) FROM retail_offers
      WHERE observed_at >= '${cutoffIso}'
        AND product_id NOT IN (${summarized})) AS earliest_unsummarized_observed_at`;
}

/** The gap list behind the counts — plan/verification detail, bounded. */
function gapProductsSql(cutoffIso: string, cutoffDay: string): string {
  const summarized = `
    SELECT product_id FROM price_history_summaries
     WHERE granularity = 'daily' AND period_start >= '${cutoffDay}'`;
  return `
  SELECT product_id, COUNT(*) AS observation_rows,
         MIN(observed_at) AS earliest_observed_at
    FROM retail_offers
   WHERE observed_at >= '${cutoffIso}'
     AND product_id NOT IN (${summarized})
   GROUP BY product_id
   ORDER BY earliest_observed_at ASC
   LIMIT 25`;
}

// ---------------------------------------------------------------------------
// D1 backends — wrangler (local | remote) and node:sqlite (db-file)
// ---------------------------------------------------------------------------

interface CoverageRow {
  readonly products_with_observations: number;
  readonly products_missing_summaries: number;
  readonly earliest_unsummarized_observed_at: string | null;
}

interface GapRow {
  readonly product_id: number;
  readonly observation_rows: number;
  readonly earliest_observed_at: string;
}

/**
 * One D1 access path. `label` identifies the target in the state file so
 * a lower/restore pair cannot straddle two databases.
 */
interface D1Backend {
  readonly label: string;
  /** Run one SELECT, return the result rows. */
  query(sql: string): readonly Record<string, unknown>[];
  /** Run one write statement. */
  execute(sql: string): void;
  /** Release any held resources (node:sqlite handle). */
  close(): void;
}

class WranglerBackend implements D1Backend {
  constructor(
    readonly label: string,
    private readonly modeArgs: readonly string[],
  ) {}

  query(sql: string): readonly Record<string, unknown>[] {
    const result = spawnSync(
      WRANGLER_BIN,
      [
        'd1',
        'execute',
        D1_BINDING,
        ...this.modeArgs,
        '--json',
        '-y',
        '--command',
        sql,
      ],
      { cwd: API_WORKER_DIR, encoding: 'utf8' },
    );
    if (result.status !== 0) {
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
    const results = (batch as { results?: unknown[] })?.results;
    if (!Array.isArray(results)) {
      console.error(`FATAL: wrangler --json output carries no results array:\n${result.stdout}`);
      process.exit(1);
    }
    return results as Record<string, unknown>[];
  }

  execute(sql: string): void {
    this.query(sql);
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
    return this.db.prepare(sql).all() as Record<string, unknown>[];
  }

  execute(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

function openBackend(options: CliOptions): D1Backend {
  switch (options.mode) {
    case 'local':
      return new WranglerBackend('local', ['--local']);
    case 'remote':
      return new WranglerBackend(`remote:${options.env}`, [
        '--remote',
        '--env',
        options.env as string,
      ]);
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  /** plan is the default — writes require the explicit --lower/--restore. */
  phase: 'plan' | 'lower' | 'restore' | 'verify';
  force: boolean;
  mode: 'local' | 'remote' | 'db-file';
  env?: string;
  dbFile?: string;
  windowDays: number;
  stateFile: string;
}

function usage(): string {
  return [
    'Usage: tsx scripts/backfill-history-summaries.ts [phase] [target] [options]',
    '',
    'Phases (default --plan):',
    '  --plan        read-only dry-run: watermark + coverage plan (no writes)',
    '  --lower       APPLY 1: record the pre-backfill watermark, lower it',
    '  --restore     APPLY 2: verify coverage, restore the watermark where that',
    '                does not regress it (--force aborts the backfill instead)',
    '  --verify      read-only verification query only (exit 1 on gaps)',
    '',
    'Targets (exactly one, seed-d1.ts conventions):',
    '  --local                  apps/api-worker local wrangler D1',
    '  --remote --env <name>    remote D1 environment (staging | production)',
    '  --db-file <path>         plain SQLite file via node:sqlite (no wrangler)',
    '',
    'Options:',
    `  --window-days <n>        coverage window (default ${DEFAULT_WINDOW_DAYS}, design D3)`,
    '  --state-file <path>      lower/restore state file',
    '                           (default ./backfill-history-summaries.state.json)',
    '  --force                  with --restore: abort the backfill — write the',
    '                           pre-backfill watermark back even while the',
    '                           aggregation has not re-scanned yet',
    '  -h, --help               this help',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    phase: 'plan',
    force: false,
    windowDays: DEFAULT_WINDOW_DAYS,
    stateFile: resolve('backfill-history-summaries.state.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--plan':
        options.phase = 'plan';
        break;
      case '--lower':
        options.phase = 'lower';
        break;
      case '--restore':
        options.phase = 'restore';
        break;
      case '--verify':
        options.phase = 'verify';
        break;
      case '--force':
        options.force = true;
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
      case '--window-days': {
        const raw = argv[++i];
        if (!/^\d+$/.test(raw ?? '')) {
          console.error(`--window-days needs a positive integer, got: ${String(raw)}`);
          process.exit(2);
        }
        options.windowDays = Number.parseInt(raw, 10);
        break;
      }
      case '--state-file':
        options.stateFile = resolve(argv[++i]);
        break;
      case '-h':
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}\n\n${usage()}`);
        process.exit(2);
    }
  }

  if (!options.mode) {
    console.error(
      `Pick a target: --local | --remote --env <name> | --db-file <path>\n\n${usage()}`,
    );
    process.exit(2);
  }
  if (options.mode === 'remote' && !options.env) {
    console.error(`--remote requires --env <name>\n\n${usage()}`);
    process.exit(2);
  }
  if (options.mode === 'db-file' && !options.dbFile) {
    console.error(`--db-file requires a path\n\n${usage()}`);
    process.exit(2);
  }
  return options as CliOptions;
}

// ---------------------------------------------------------------------------
// State file — the resumability contract between --lower and --restore
// ---------------------------------------------------------------------------

interface BackfillState {
  readonly jobName: string;
  /** Which D1 the state belongs to — restore refuses a mismatched target. */
  readonly target: string;
  /** The pre-backfill watermark (null = there was none; nothing lowered). */
  readonly preWatermark: string | null;
  /** The lowered value actually persisted (null = no lowering was needed). */
  readonly loweredTo: string | null;
  readonly windowDays: number;
  readonly loweredAt: string;
}

function readStateFile(path: string): BackfillState {
  if (!existsSync(path)) {
    console.error(
      `FATAL: no state file at ${path} — run --lower first (or pass --state-file).`,
    );
    process.exit(2);
  }
  let state: BackfillState;
  try {
    state = JSON.parse(readFileSync(path, 'utf8')) as BackfillState;
  } catch (error) {
    console.error(
      `FATAL: state file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  if (state.jobName !== JOB_NAME || typeof state.target !== 'string') {
    console.error(`FATAL: ${path} is not a backfill-history-summaries state file.`);
    process.exit(2);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function readWatermark(backend: D1Backend): Date | null {
  const rows = backend.query(WATERMARK_FIND_SQL);
  const raw = rows[0]?.watermark;
  if (typeof raw !== 'string') return null;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) {
    console.error(
      `FATAL: the ${JOB_NAME} watermark is not an ISO instant: '${raw}' — ` +
        'the job-scoped read contract is violated; investigate before backfilling.',
    );
    process.exit(1);
  }
  return instant;
}

function readCoverage(backend: D1Backend, cutoffIso: string, cutoffDay: string): CoverageRow {
  const row = backend.query(coverageSql(cutoffIso, cutoffDay))[0];
  if (!row) {
    console.error('FATAL: coverage query returned no row.');
    process.exit(1);
  }
  return {
    products_with_observations: Number(row.products_with_observations),
    products_missing_summaries: Number(row.products_missing_summaries),
    earliest_unsummarized_observed_at:
      typeof row.earliest_unsummarized_observed_at === 'string'
        ? row.earliest_unsummarized_observed_at
        : null,
  };
}

function readGapProducts(
  backend: D1Backend,
  cutoffIso: string,
  cutoffDay: string,
): readonly GapRow[] {
  return backend.query(gapProductsSql(cutoffIso, cutoffDay)) as unknown as GapRow[];
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function printCoverage(coverage: CoverageRow, cutoffIso: string, windowDays: number): void {
  console.log(`  window: observed_at >= ${cutoffIso} (UTC, ${windowDays}-day design-D3 window)`);
  console.log(`  products with observations:        ${coverage.products_with_observations}`);
  console.log(`  products missing summary buckets:  ${coverage.products_missing_summaries}`);
}

function printGapProducts(gaps: readonly GapRow[]): void {
  if (gaps.length === 0) return;
  console.log('  gap products (earliest first, max 25):');
  for (const gap of gaps) {
    console.log(
      `    product ${gap.product_id}: ${gap.observation_rows} observation row(s), earliest ${gap.earliest_observed_at}`,
    );
  }
}

function scriptCommand(options: CliOptions, phase: string): string {
  const parts = [
    'pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/backfill-history-summaries.ts',
    phase,
  ];
  if (options.mode === 'local') parts.push('--local');
  if (options.mode === 'remote') parts.push('--remote', `--env ${options.env}`);
  if (options.mode === 'db-file') parts.push(`--db-file ${options.dbFile}`);
  if (options.windowDays !== DEFAULT_WINDOW_DAYS) {
    parts.push(`--window-days ${options.windowDays}`);
  }
  parts.push(`--state-file ${options.stateFile}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function runPlan(backend: D1Backend, options: CliOptions): number {
  const now = new Date();
  const cutoff = new Date(now.getTime() - options.windowDays * DAY_MS);
  const coverage = readCoverage(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10));
  const watermark = readWatermark(backend);

  console.log(`[backfill-history] PLAN — target ${backend.label} (read-only, nothing written)`);
  console.log(`  current ${JOB_NAME} watermark: ${watermark?.toISOString() ?? '(none — the job has never completed a scan)'}`);
  printCoverage(coverage, cutoff.toISOString(), options.windowDays);
  if (coverage.products_missing_summaries > 0) {
    printGapProducts(readGapProducts(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10)));
  }

  if (coverage.products_missing_summaries === 0) {
    console.log('[backfill-history] coverage invariant HOLDS — no backfill needed.');
    return 0;
  }

  const earliest = coverage.earliest_unsummarized_observed_at;
  if (earliest === null) {
    console.error(
      'FATAL: missing summaries > 0 but no earliest unsummarized observation — inconsistent coverage read.',
    );
    return 1;
  }
  // Design D3 step 3: the ISO-week Monday of the earliest unsummarized
  // observation — the job re-reads partitions from the watermark's ISO-week
  // Monday and recomputes every overlapped bucket from its FULL contents,
  // so the lowered value preserves the weekly-bucket semantics.
  const lowered = startOfIsoWeek(new Date(earliest));

  console.log(`  earliest unsummarized observation: ${earliest}`);
  console.log(`  lowering target (ISO-week Monday): ${lowered.toISOString()}`);

  if (watermark === null) {
    console.log('[backfill-history] no persisted watermark — the next aggregation tick scans from the');
    console.log('  epoch by contract (initial backfill): no lowering needed.');
    console.log('  Next: trigger the aggregation (docs/ingestion-runbook.md §7.4), then run:');
    console.log(`    ${scriptCommand(options, '--restore')}`);
    return 0;
  }
  if (lowered.getTime() >= watermark.getTime()) {
    console.log('[backfill-history] the current watermark already sits at/below the lowering target —');
    console.log('  the next tick already re-scans the gapped range: no lowering needed.');
    console.log('  Next: trigger the aggregation (docs/ingestion-runbook.md §7.4), then run:');
    console.log(`    ${scriptCommand(options, '--restore')}`);
    return 0;
  }

  console.log('[backfill-history] WOULD lower the watermark (design D3 step 3):');
  console.log(`    ${watermark.toISOString()}  ->  ${lowered.toISOString()}`);
  console.log('  Apply sequence (docs/ingestion-runbook.md §7):');
  console.log(`    1. ${scriptCommand(options, '--lower')}`);
  console.log('    2. trigger the aggregation (§7.4: next */30 tick or the out-of-band trigger)');
  console.log(`    3. ${scriptCommand(options, '--restore')}`);
  return 0;
}

function runLower(backend: D1Backend, options: CliOptions): number {
  // A backfill already open for this target must not be clobbered: the
  // state file is the only record of the pre-backfill watermark, and
  // re-running --lower after the lowering would otherwise overwrite it
  // with the lowered value. Re-running is a no-op — resumable by
  // construction (delete the state file to restart deliberately).
  if (existsSync(options.stateFile)) {
    const open = readStateFile(options.stateFile);
    if (open.target === backend.label) {
      const current = readWatermark(backend);
      const stillLowered =
        open.loweredTo !== null &&
        current !== null &&
        current.getTime() <= new Date(open.loweredTo).getTime();
      if (stillLowered) {
        console.log(
          `[backfill-history] LOWER — a backfill is already open for ${backend.label} (lowered at ${open.loweredAt}).`,
        );
        console.log('  Nothing to do — proceed with the aggregation trigger (docs/ingestion-runbook.md §7.4), then:');
        console.log(`    ${scriptCommand(options, '--restore')}`);
        return 0;
      }
      // Stale state: the watermark is no longer at the lowered value
      // (aborted via --force, restored early, or superseded by the
      // job's own advance) — the recorded lowering is no longer in
      // effect, so a fresh lowering overwrites the state safely.
      console.log(
        `[backfill-history] LOWER — state file holds a stale backfill (lowered at ${open.loweredAt}, watermark since moved to ${current?.toISOString() ?? '(none)'}); starting a fresh lowering.`,
      );
    } else {
      console.error(
        `FATAL: state file ${options.stateFile} holds an open backfill for "${open.target}", but this run targets "${backend.label}" — pass a different --state-file or resolve the open backfill first.`,
      );
      return 2;
    }
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - options.windowDays * DAY_MS);
  const coverage = readCoverage(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10));
  const watermark = readWatermark(backend);

  console.log(`[backfill-history] LOWER — target ${backend.label}`);
  console.log(`  current ${JOB_NAME} watermark: ${watermark?.toISOString() ?? '(none)'}`);
  printCoverage(coverage, cutoff.toISOString(), options.windowDays);

  if (coverage.products_missing_summaries === 0) {
    console.log('[backfill-history] coverage invariant HOLDS — nothing to lower, no state recorded.');
    return 0;
  }
  const earliest = coverage.earliest_unsummarized_observed_at;
  if (earliest === null) {
    console.error(
      'FATAL: missing summaries > 0 but no earliest unsummarized observation — inconsistent coverage read.',
    );
    return 1;
  }
  const lowered = startOfIsoWeek(new Date(earliest));

  if (watermark === null || lowered.getTime() >= watermark.getTime()) {
    // No watermark: the job's own contract scans from the epoch on the
    // next tick. Nothing to lower — record a verify-only state so
    // --restore knows the procedure is still open.
    writeFileSync(
      options.stateFile,
      `${JSON.stringify(
        {
          jobName: JOB_NAME,
          target: backend.label,
          preWatermark: watermark?.toISOString() ?? null,
          loweredTo: null,
          windowDays: options.windowDays,
          loweredAt: now.toISOString(),
        } satisfies BackfillState,
        null,
        2,
      )}\n`,
    );
    console.log(
      watermark === null
        ? '[backfill-history] no persisted watermark — nothing lowered (the next tick scans from the epoch).'
        : `[backfill-history] watermark ${watermark.toISOString()} already at/below the lowering target ${lowered.toISOString()} — nothing lowered.`,
    );
    console.log(`  state recorded: ${options.stateFile} (verify-only)`);
    console.log('  Next: trigger the aggregation (docs/ingestion-runbook.md §7.4), then run:');
    console.log(`    ${scriptCommand(options, '--restore')}`);
    return 0;
  }

  // The one write of phase 1 — repository-parity upsert, job row only.
  backend.execute(watermarkUpsertSql(lowered.toISOString(), now.toISOString()));
  console.log(`[backfill-history] watermark lowered: ${watermark.toISOString()} -> ${lowered.toISOString()}`);

  writeFileSync(
    options.stateFile,
    `${JSON.stringify(
      {
        jobName: JOB_NAME,
        target: backend.label,
        preWatermark: watermark.toISOString(),
        loweredTo: lowered.toISOString(),
        windowDays: options.windowDays,
        loweredAt: now.toISOString(),
      } satisfies BackfillState,
      null,
      2,
    )}\n`,
  );
  console.log(`  state recorded: ${options.stateFile}`);
  console.log('  Next: trigger the aggregation (docs/ingestion-runbook.md §7.4), then run:');
  console.log(`    ${scriptCommand(options, '--restore')}`);
  return 0;
}

function runRestore(backend: D1Backend, options: CliOptions): number {
  const state = readStateFile(options.stateFile);
  if (state.target !== backend.label) {
    console.error(
      `FATAL: state file ${options.stateFile} targets "${state.target}", but this run targets "${backend.label}" — refusing to cross databases.`,
    );
    return 2;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - state.windowDays * DAY_MS);
  const coverage = readCoverage(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10));
  const watermark = readWatermark(backend);
  const pre = state.preWatermark === null ? null : new Date(state.preWatermark);
  const loweredTo = state.loweredTo === null ? null : new Date(state.loweredTo);

  console.log(`[backfill-history] RESTORE — target ${backend.label} (lowered at ${state.loweredAt})`);
  console.log(`  pre-backfill watermark: ${pre?.toISOString() ?? '(none)'}`);
  console.log(`  lowered to:             ${loweredTo?.toISOString() ?? '(nothing was lowered)'}`);
  console.log(`  current watermark:      ${watermark?.toISOString() ?? '(none)'}`);
  printCoverage(coverage, cutoff.toISOString(), state.windowDays);
  if (coverage.products_missing_summaries > 0) {
    printGapProducts(readGapProducts(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10)));
  }

  const verified = coverage.products_missing_summaries === 0;

  if (verified) {
    // The job advanced the watermark itself after its writes succeeded —
    // that value is >= the pre-backfill watermark (the high water is an
    // observed_at, and observations only append). Writing the older
    // pre-backfill value back would REGRESS the watermark and force a
    // pointless re-scan, so the restore is a no-write confirmation there.
    if (
      loweredTo !== null &&
      pre !== null &&
      watermark !== null &&
      watermark.getTime() < pre.getTime()
    ) {
      backend.execute(watermarkUpsertSql(pre.toISOString(), now.toISOString()));
      console.log(`[backfill-history] verification PASSED; watermark restored to the pre-backfill value ${pre.toISOString()} (was below it).`);
    } else {
      console.log(
        '[backfill-history] verification PASSED; the aggregation tick already advanced the watermark to ' +
          `${watermark?.toISOString() ?? '(none)'} — at/above the pre-backfill value, no restore write (never regress).`,
      );
    }
    if (existsSync(options.stateFile)) unlinkSync(options.stateFile);
    console.log(`[backfill-history] backfill COMPLETE — state file removed: ${options.stateFile}`);
    return 0;
  }

  // Verification failed. Diagnose before touching anything.
  const notRescannedYet =
    loweredTo !== null &&
    watermark !== null &&
    watermark.getTime() <= loweredTo.getTime();

  if (notRescannedYet && !options.force) {
    console.error(
      '[backfill-history] verification FAILED — the watermark still sits at the lowered value, so the',
    );
    console.error('  aggregation has NOT re-scanned yet. Wait for the next */30 tick (Workers Logs line');
    console.error('  "Aggregated N summary buckets across M products") or trigger it out-of-band');
    console.error('  (docs/ingestion-runbook.md §7.4), then re-run --restore.');
    console.error('  To ABORT the backfill instead, re-run with --force (writes the pre-backfill watermark back).');
    return 1;
  }

  if (loweredTo !== null && pre !== null && (options.force || (watermark !== null && watermark.getTime() < pre.getTime()))) {
    backend.execute(watermarkUpsertSql(pre.toISOString(), now.toISOString()));
    console.error(`[backfill-history] watermark restored to the pre-backfill value ${pre.toISOString()}.`);
  } else {
    console.error(
      '[backfill-history] watermark left untouched (at/above the pre-backfill value — nothing to restore).',
    );
  }
  console.error(
    `[backfill-history] verification FAILED — ${coverage.products_missing_summaries} product(s) with observations still lack summary buckets. ` +
      'Inspect the aggregation logs (docs/ingestion-runbook.md §7.5).',
  );
  return 1;
}

function runVerify(backend: D1Backend, options: CliOptions): number {
  const now = new Date();
  const cutoff = new Date(now.getTime() - options.windowDays * DAY_MS);
  const coverage = readCoverage(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10));
  const watermark = readWatermark(backend);

  console.log(`[backfill-history] VERIFY — target ${backend.label} (read-only)`);
  console.log(`  current ${JOB_NAME} watermark: ${watermark?.toISOString() ?? '(none)'}`);
  printCoverage(coverage, cutoff.toISOString(), options.windowDays);
  if (coverage.products_missing_summaries > 0) {
    printGapProducts(readGapProducts(backend, cutoff.toISOString(), cutoff.toISOString().slice(0, 10)));
    console.error(
      `[backfill-history] verification FAILED — ${coverage.products_missing_summaries} product(s) with observations lack summary buckets.`,
    );
    return 1;
  }
  console.log('[backfill-history] verification PASSED — products with observations lacking summaries: 0');
  return 0;
}

// ---------------------------------------------------------------------------

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  const backend = openBackend(options);
  try {
    switch (options.phase) {
      case 'plan':
        return runPlan(backend, options);
      case 'lower':
        return runLower(backend, options);
      case 'restore':
        return runRestore(backend, options);
      case 'verify':
        return runVerify(backend, options);
    }
  } finally {
    backend.close();
  }
  return 2;
}

process.exitCode = main();
