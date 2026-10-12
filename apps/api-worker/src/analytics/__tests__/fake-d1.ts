/**
 * Local fake-D1 harness for the click-counter flush integration tests —
 * the established pattern of
 * `packages/data-platform/src/repositories/d1/__tests__/d1-test-harness.ts`
 * (node:sqlite in-memory + committed migrations + prepare/bind/run shim),
 * reproduced here because that helper is package-internal test surface.
 * The migration SQL files are the committed ones, so the flush upsert
 * runs against the real `click_counter_snapshots` DDL.
 *
 * @module FakeD1
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from '../../../../../packages/data-platform/src/d1/executor';

/** Path of the committed drizzle-kit migrations (repo-relative, stable). */
function migrationsDir(): string {
  return new URL(
    '../../../../../packages/data-platform/src/d1/migrations',
    import.meta.url,
  ).pathname;
}

/** Open a fresh in-memory database with every migration applied in order. */
export function openMigratedD1(): { db: DatabaseSync; d1: D1DatabaseLike } {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(migrationsDir())
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    for (const statement of readFileSync(`${migrationsDir()}/${file}`, 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (statement.trim().length > 0) {
        db.exec(statement);
      }
    }
  }
  return { db, d1: createD1Shim(db) };
}

/** Wrap a node:sqlite database in the D1 binding's structural shape. */
export function createD1Shim(db: DatabaseSync): D1DatabaseLike {
  /**
   * Each prepared statement's SQL, remembered for {@link batch}: the real
   * binding returns every statement's full result (rows for SELECTs,
   * changes-meta for writes), while node:sqlite can produce one or the
   * other per call (`all()` vs `run()`). The product-page batch read
   * (task 2.2, change product-page-cold-latency) depends on the rows
   * half, so batch routes per statement; `run()`/`all()` themselves stay
   * exactly as the repositories call them.
   */
  const preparedSql = new WeakMap<D1PreparedStatementLike, string>();
  function prepare(query: string): D1PreparedStatementLike {
    const statement = db.prepare(query);
    let params: unknown[] = [];
    const bindable = (): Parameters<StatementSync['all']> =>
      params as Parameters<StatementSync['all']>;
    const bound: D1PreparedStatementLike = {
      bind(...values: unknown[]) {
        params = values;
        return bound;
      },
      async all<T>(): Promise<D1ResultLike<T>> {
        return { results: statement.all(...bindable()) as T[], success: true, meta: {} };
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
    // One implicit transaction, sequential — the binding's batch() shape.
    // The product-page cold path (task 2.2, change
    // product-page-cold-latency) batches a product read + offers read
    // through here, so SELECT statements must come back WITH their rows.
    async batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]> {
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
      }
      return results;
    },
  };
}
