/**
 * node:sqlite apply + verify path for the D1 seed pipeline (task 2.6,
 * change migrate-to-cloudflare).
 *
 * The TS-runnable counterpart of `wrangler d1 migrations apply` +
 * `wrangler d1 execute --file` + verification: same migration files, same
 * generated seed SQL, same verification contract — executed against a
 * plain SQLite database through node:sqlite. No Cloudflare credentials,
 * no wrangler state — usable in CI, in tests, and by
 * `scripts/seed-d1.ts --db-file <path>`.
 *
 * Ordering mirrors the deploy pipeline semantics (deploy-staging.yml:
 * migrate Job → seed Job): migrations are applied first, seed files after,
 * verification last. Migrations are applied only when the target does not
 * already have the schema (drizzle-generated migration files are plain
 * CREATE TABLE, not IF NOT EXISTS — a fresh target is a hard requirement
 * for them), while seed files are ALWAYS applied: their idempotency
 * (version-guarded tax inserts, INSERT OR IGNORE fixtures) is what makes
 * re-running this function safe.
 *
 * @module Seed/D1
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertVerificationRow, buildVerifySql } from './generate';

/** Minimal database surface used here — structural, so tests can fake it. */
export interface SqliteExecEngine {
  exec(sql: string): unknown;
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/** Result of a full apply-and-verify run. */
export interface ApplySeedResult {
  /** Migration files applied this run (empty when the schema already existed). */
  migrationsApplied: string[];
  /** Seed files executed (always — they are idempotent by construction). */
  seedFilesApplied: string[];
  /** The verification row (field → actual count) that passed assertion. */
  verification: Record<string, number>;
}

/** Thrown when apply/verify cannot proceed (as opposed to a count mismatch). */
export class SeedApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedApplyError';
  }
}

/**
 * List migration files in `migrationsDir` in filename order — the same
 * order `wrangler d1 migrations` walks (and the drizzle _journal records).
 */
export function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Execute every seed SQL file against `db`, then run the verification
 * query and assert it. Throws SeedVerificationError on any count mismatch
 * and SeedApplyError (or the underlying SQL error) on any other failure —
 * both fail loudly, by contract.
 */
export function applySeedAndVerify(
  db: SqliteExecEngine,
  seedSqlFiles: ReadonlyArray<{ name: string; path: string }>,
): Record<string, number> {
  for (const file of seedSqlFiles) {
    db.exec(readFileSync(file.path, 'utf8'));
  }

  const row = db.prepare(buildVerifySql()).get() as Record<string, unknown> | undefined;
  if (!row) {
    throw new SeedApplyError('verification query returned no row — cannot assert seed state');
  }
  assertVerificationRow(row);
  return row as Record<string, number>;
}

/**
 * Full pipeline against a SQLite database file: apply migrations when the
 * schema is absent, always apply the (idempotent) seed files, verify.
 *
 * @param dbPath — SQLite file to open (created when missing). Use ':memory:'
 *   for an ephemeral database (used by the test suite).
 * @param opts.migrationsDir — D1 migrations directory
 *   (`packages/data-platform/src/d1/migrations`).
 * @param opts.seedSqlFiles — generated seed files, in apply order.
 */
export function applySeedToSqlite(
  dbPath: string,
  opts: { migrationsDir: string; seedSqlFiles: ReadonlyArray<{ name: string; path: string }> },
): ApplySeedResult {
  const db = new DatabaseSync(dbPath);
  try {
    // Fresh-schema detection: drizzle migration files are plain CREATE
    // TABLE (no IF NOT EXISTS), so they can only run on an empty target.
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'tax_rules'`)
      .get() as { c: number | bigint } | undefined;

    const migrationsApplied: string[] = [];
    if (!row || Number(row.c) === 0) {
      for (const file of listMigrationFiles(opts.migrationsDir)) {
        db.exec(readFileSync(join(opts.migrationsDir, file), 'utf8'));
        migrationsApplied.push(file);
      }
    }

    const seedFilesApplied = opts.seedSqlFiles.map((f) => f.name);
    const verification = applySeedAndVerify(db, opts.seedSqlFiles);

    return { migrationsApplied, seedFilesApplied, verification };
  } finally {
    db.close();
  }
}

/**
 * Resolve the migrations directory of this package from a package source
 * root — only valid inside a repo checkout, which is the only supported
 * context for this module (it is a seed pipeline, not a runtime
 * dependency of the Worker).
 */
export function defaultMigrationsDir(packageSrcRoot: string): string {
  const dir = join(packageSrcRoot, 'd1', 'migrations');
  if (!existsSync(dir)) {
    throw new SeedApplyError(`D1 migrations directory not found at ${dir}`);
  }
  return dir;
}
