#!/usr/bin/env node
/**
 * D1 seed orchestrator (task 2.6, change migrate-to-cloudflare).
 *
 * Preserves the deploy pipeline's semantic order from
 * .github/workflows/deploy-staging.yml — migrate → seed (staging only) →
 * verify — with wrangler D1 primitives:
 *
 *   1. generate   byte-deterministic seed SQL (packages/data-platform/src/seed/d1/generate.ts)
 *   2. migrate    `wrangler d1 migrations apply DB` (unless --skip-migrate)
 *   3. seed       `wrangler d1 execute DB --file <tax-rules.d1.sql>` then
 *                 `--file <staging.d1.sql>`
 *   4. verify     row-count / version-presence assertions — the script
 *                 FAILS LOUDLY on any mismatch
 *
 * Usage (run via tsx — see the db:seed:d1:* scripts in
 * apps/api-worker/package.json):
 *
 *   tsx scripts/seed-d1.ts --local
 *       Seed the local wrangler D1 (miniflare state of apps/api-worker).
 *
 *   tsx scripts/seed-d1.ts --remote --env staging
 *       Seed a remote D1 database. `--env` passes through to wrangler
 *       (staging | production; the pipeline seeds staging only —
 *       production seeding is a deliberate, manual act).
 *
 *   tsx scripts/seed-d1.ts --db-file <path>
 *       Seed a plain SQLite file through node:sqlite — same migrations,
 *       same SQL, same verification, no wrangler/credentials. Used by CI
 *       and by the package's own test suite.
 *
 *   tsx scripts/seed-d1.ts --emit-sql-only
 *       Only write the generated .sql files (for `wrangler d1 execute
 *       --file` use without this script, e.g. inside a minimal CI image).
 *
 * Options:
 *   --out <dir>      output directory for the generated files
 *                    (default: packages/data-platform/src/seed/d1/sql)
 *   --skip-migrate   do not apply migrations (schema must already exist)
 *   -h, --help
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import {
  SeedVerificationError,
  assertVerificationRow,
  buildVerifySql,
  writeSeedSqlFiles,
} from '../packages/data-platform/src/seed/d1/generate';
import { applySeedToSqlite } from '../packages/data-platform/src/seed/d1/apply-node-sqlite';

// ---------------------------------------------------------------------------
// Repo layout — resolved from the invoked script path (process.argv[1]),
// never from cwd (the npm scripts run this via `pnpm --filter … exec tsx`,
// so cwd varies). argv[1] is the script path under tsx in both its CJS and
// ESM modes — no import.meta/__dirname fork needed.
// ---------------------------------------------------------------------------
const SCRIPTS_DIR = process.argv[1] ? dirname(resolve(process.argv[1])) : undefined;
if (!SCRIPTS_DIR || basename(SCRIPTS_DIR) !== 'scripts') {
  console.error('FATAL: cannot resolve the repository root from the invoked script path.');
  process.exit(1);
}
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');
const API_WORKER_DIR = join(REPO_ROOT, 'apps', 'api-worker');
const WRANGLER_BIN = join(API_WORKER_DIR, 'node_modules', '.bin', 'wrangler');
const PACKAGE_SRC = join(REPO_ROOT, 'packages', 'data-platform', 'src');
const MIGRATIONS_DIR = join(PACKAGE_SRC, 'd1', 'migrations');
const DEFAULT_OUT_DIR = join(PACKAGE_SRC, 'seed', 'd1', 'sql');
const D1_BINDING = 'DB';

interface CliOptions {
  mode: 'local' | 'remote' | 'db-file' | 'emit-sql-only';
  env?: string;
  dbFile?: string;
  outDir: string;
  skipMigrate: boolean;
}

function usage(): string {
  return [
    'Usage: tsx scripts/seed-d1.ts <mode> [options]',
    '',
    'Modes (exactly one):',
    '  --local                  seed the local wrangler D1 (miniflare state)',
    '  --remote --env <name>    seed a remote D1 environment (staging | production)',
    '  --db-file <path>         seed a SQLite file via node:sqlite (no wrangler)',
    '  --emit-sql-only          only write the generated .sql files',
    '',
    'Options:',
    '  --out <dir>              output dir for generated .sql files',
    `                           (default: ${DEFAULT_OUT_DIR})`,
    '  --skip-migrate           do not apply migrations (schema must exist)',
    '  -h, --help               this help',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = { outDir: DEFAULT_OUT_DIR, skipMigrate: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
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
      case '--emit-sql-only':
        options.mode = 'emit-sql-only';
        break;
      case '--out':
        options.outDir = resolve(argv[++i]);
        break;
      case '--skip-migrate':
        options.skipMigrate = true;
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
    console.error(`Pick a mode: --local | --remote --env <name> | --db-file <path> | --emit-sql-only\n\n${usage()}`);
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
// wrangler plumbing
// ---------------------------------------------------------------------------

/** Run wrangler with inherited stdio; fail loudly on non-zero exit. */
function runWrangler(args: string[], label: string): void {
  if (!existsSync(WRANGLER_BIN)) {
    console.error(`FATAL: wrangler binary not found at ${WRANGLER_BIN}`);
    process.exit(1);
  }
  const result = spawnSync(WRANGLER_BIN, args, {
    cwd: API_WORKER_DIR, // wrangler.jsonc lives here (binding DB, envs)
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`FATAL: ${label} failed (exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}

/**
 * Run the verification query through wrangler --json and assert it.
 * Output shape (wrangler 4): [ { results: [ {field: count, …} ], success, meta } ]
 */
function verifyViaWrangler(modeArgs: string[]): void {
  const result = spawnSync(
    WRANGLER_BIN,
    ['d1', 'execute', D1_BINDING, ...modeArgs, '--json', '--command', buildVerifySql(), '-y'],
    { cwd: API_WORKER_DIR, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(`FATAL: verification query failed (exit ${result.status ?? 'signal'})\n${result.stderr ?? ''}`);
    process.exit(result.status ?? 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    console.error(`FATAL: could not parse wrangler --json output:\n${result.stdout}`);
    process.exit(1);
  }

  const batch = Array.isArray(parsed) ? parsed[0] : parsed;
  const results = (batch as { results?: unknown[] })?.results;
  const row = Array.isArray(results) ? (results[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) {
    console.error(`FATAL: verification query returned no rows:\n${result.stdout}`);
    process.exit(1);
  }
  assertVerificationRow(row);
}

// ---------------------------------------------------------------------------
// Mode runners — every seeding mode ends in verification, by contract
// ---------------------------------------------------------------------------

function runLocal(options: CliOptions, seedFiles: ReturnType<typeof writeSeedSqlFiles>): void {
  console.log(`[seed-d1] mode: wrangler local (cwd ${API_WORKER_DIR})`);
  const modeArgs = ['--local'];

  if (!options.skipMigrate) {
    runWrangler(['d1', 'migrations', 'apply', D1_BINDING, ...modeArgs], 'wrangler d1 migrations apply --local');
  }

  for (const file of seedFiles) {
    runWrangler(['d1', 'execute', D1_BINDING, ...modeArgs, '--file', file.path, '-y'], `wrangler d1 execute --file ${file.file}`);
  }

  verifyViaWrangler(modeArgs);
}

function runRemote(options: CliOptions, seedFiles: ReturnType<typeof writeSeedSqlFiles>): void {
  const env = options.env as string;
  console.log(`[seed-d1] mode: wrangler remote (env ${env})`);
  if (env === 'production') {
    console.log('[seed-d1] NOTE: the pipeline seeds STAGING only (deploy-staging.yml order: migrate → seed → rollout). Production seeding is a deliberate manual step.');
  }
  const modeArgs = ['--remote', '--env', env];

  if (!options.skipMigrate) {
    runWrangler(['d1', 'migrations', 'apply', D1_BINDING, ...modeArgs, '-y'], `wrangler d1 migrations apply --remote --env ${env}`);
  }

  for (const file of seedFiles) {
    runWrangler(['d1', 'execute', D1_BINDING, ...modeArgs, '--file', file.path, '-y'], `wrangler d1 execute --remote --env ${env} --file ${file.file}`);
  }

  verifyViaWrangler(modeArgs);
}

function runDbFile(options: CliOptions, seedFiles: ReturnType<typeof writeSeedSqlFiles>): void {
  const dbFile = resolve(options.dbFile as string);
  console.log(`[seed-d1] mode: node:sqlite (${dbFile})`);
  if (!existsSync(dbFile)) {
    // node:sqlite creates the file but not its parent directories.
    mkdirSync(dirname(dbFile), { recursive: true });
  }
  if (options.skipMigrate && statSync(dbFile, { throwIfNoEntry: false }) === undefined) {
    console.error('FATAL: --skip-migrate with a non-existent --db-file — no schema to skip to.');
    process.exit(2);
  }
  if (!options.skipMigrate && statSync(dbFile, { throwIfNoEntry: false }) !== undefined) {
    // Existing file: migrations are skipped by schema detection inside
    // applySeedToSqlite; seed re-application is idempotent by design.
    console.log('[seed-d1] existing database file — schema detection decides migrations; seed re-applies idempotently');
  }

  const result = applySeedToSqlite(dbFile, {
    migrationsDir: MIGRATIONS_DIR,
    seedSqlFiles: seedFiles.map((f) => ({ name: f.file, path: f.path })),
  });

  console.log(
    `[seed-d1] migrations applied: ${result.migrationsApplied.length ? result.migrationsApplied.join(', ') : '(none — schema present)'}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  // 1. Generate — byte-deterministic; sha256 logged for reproducibility.
  const seedFiles = writeSeedSqlFiles(options.outDir);
  for (const file of seedFiles) {
    console.log(`[seed-d1] wrote ${file.path} (${file.bytes} bytes, sha256 ${file.sha256})`);
  }
  if (options.mode === 'emit-sql-only') {
    console.log('[seed-d1] emit-sql-only — done. Apply with: wrangler d1 execute DB --file <file> (migrations first).');
    return;
  }

  // 2–4. migrate → seed → verify (order preserved from deploy-staging.yml).
  switch (options.mode) {
    case 'local':
      runLocal(options, seedFiles);
      break;
    case 'remote':
      runRemote(options, seedFiles);
      break;
    case 'db-file':
      runDbFile(options, seedFiles);
      break;
  }

  console.log('[seed-d1] verification PASSED — row counts and version presence match the seed sources.');
}

try {
  main();
} catch (error) {
  if (error instanceof SeedVerificationError) {
    console.error(`[seed-d1] ${error.message}`);
  } else {
    console.error(`[seed-d1] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
  }
  process.exit(1);
}
