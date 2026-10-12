/**
 * Shared test harness for the D1 repositories — emulates the Cloudflare
 * D1 binding over `node:sqlite` (in-memory) with the committed migrations
 * applied, the same shape the spike harness proved
 * (scripts/spikes/cloudflare/search-parity/src/run.ts).
 *
 * The shim maps the binding's prepare/bind/all/first/run surface onto
 * StatementSync; lastInsertRowid surfaces through `run().meta` while the
 * repositories read assigned ids from `RETURNING`, so both paths are
 * exercised the way real D1 behaves.
 *
 * @module D1TestHarness
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../d1/executor';

/**
 * Locate the committed migrations directory. The package's TypeScript
 * config compiles with `module: commonjs` (import.meta is unavailable),
 * so resolution goes through process.cwd() with both the package-local
 * and the repo-root invocation covered; a clear error fires otherwise.
 */
function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src/d1/migrations'),
    path.resolve(process.cwd(), 'packages/data-platform/src/d1/migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, '0000_supreme_bucky.sql'))) {
      return candidate;
    }
  }
  throw new Error(
    `Cannot locate d1 migrations from cwd ${process.cwd()} (tried ${candidates.join(', ')})`,
  );
}

/** Open a fresh in-memory database with every migration applied in order. */
export function openMigratedD1(): { db: DatabaseSync; d1: D1DatabaseLike } {
  const db = new DatabaseSync(':memory:');
  const migrationsDir = resolveMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    applyMigration(db, readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  return { db, d1: createD1Shim(db) };
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

/** Wrap a node:sqlite database in the D1 binding's structural shape. */
export function createD1Shim(db: DatabaseSync): D1DatabaseLike {
  /** Set while a batch transaction is open — serializes concurrent batches. */
  let batchActive = false;
  /**
   * Each prepared statement's SQL, remembered for {@link batch}: the real
   * binding returns every statement's full result (rows for SELECTs,
   * changes-meta for writes), while node:sqlite can produce one or the
   * other per call (`all()` vs `run()`). The product-page batch read
   * (task 2.1, change product-page-cold-latency) depends on the rows
   * half, so batch routes per statement; `run()`/`all()` themselves stay
   * exactly as the repositories call them.
   */
  const preparedSql = new WeakMap<D1PreparedStatementLike, string>();
  function prepare(query: string): D1PreparedStatementLike {
    const statement = db.prepare(query);
    let params: unknown[] = [];
    // node:sqlite's parameter type is narrower than the binding's
    // `unknown[]` surface; the repositories only bind null/number/string.
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
    preparedSql.set(bound, query);
    return bound;
  }
  return {
    prepare,
    // Sequential execution inside one BEGIN/COMMIT pair — the same
    // all-or-nothing semantics the binding's batch() provides (the
    // session rotate and FX dataset appends depend on it). Concurrent
    // batch() calls serialize: D1's single-writer execution gives the
    // same ordering, and the concurrency tests rely on it.
    async batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]> {
      while (batchActive) {
        await Promise.resolve();
      }
      batchActive = true;
      const results: D1ResultLike[] = [];
      db.exec('BEGIN');
      try {
        for (const statement of statements) {
          // The binding's batch result contract: SELECT-shaped statements
          // come back WITH their rows (writes report only changes meta —
          // node:sqlite cannot produce both from one execution). A
          // statement not minted by this shim falls back to run().
          const isRead = /^\s*(select|with)\b/i.test(
            preparedSql.get(statement) ?? '',
          );
          results.push(
            isRead
              ? { ...(await statement.all()), meta: {} }
              : await statement.run(),
          );
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        batchActive = false;
      }
      return results;
    },
  };
}
