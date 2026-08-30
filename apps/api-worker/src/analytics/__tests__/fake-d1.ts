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
    return bound;
  }
  return {
    prepare,
    // One implicit transaction, sequential — the binding's batch() shape
    // (unused by the snapshot repository, kept for surface parity).
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
