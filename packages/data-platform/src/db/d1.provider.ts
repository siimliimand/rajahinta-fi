/**
 * Drizzle D1 connection provider — typed factory over a Workers D1 binding.
 *
 * Cloudflare counterpart of `drizzle.provider.ts` (task 2.4, change
 * migrate-to-cloudflare): the Worker passes its `env.DB` binding (design
 * D2) and gets a fully-typed Drizzle ORM instance that references the
 * translated SQLite schema in `src/d1/schema.ts`.
 *
 * The Workers surface is limited to the `D1Database` *type shape*, which is
 * declared locally as a minimal structural interface — the domain package
 * carries no dependency on wrangler or `@cloudflare/workers-types`, and the
 * factory is testable with any object that satisfies the shape (see
 * `__tests__/d1.provider.test.ts`).
 *
 * ## Usage (Worker side)
 *
 * ```typescript
 * import { getDrizzleD1 } from '../db/d1.module';
 *
 * const db = getDrizzleD1(env.DB); // one drizzle instance per isolate
 * ```
 *
 * @module DrizzleD1Provider
 */
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { d1Schema } from '../d1/index';

/** Injection token for the D1-backed Drizzle instance (mirrors `DRIZZLE`). */
export const DRIZZLE_D1 = Symbol('DRIZZLE_D1');

/**
 * Minimal structural view of a Workers `D1Database` binding — exactly the
 * surface `drizzle-orm/d1` drives (`prepare` + `batch`). The real binding
 * satisfies this structurally, so callers pass `env.DB` without casts.
 */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>;
}

/** Minimal structural view of a D1 prepared statement. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<T>;
  all<T = unknown>(): Promise<T>;
  raw<T = unknown>(): Promise<T>;
}

/**
 * Fully-typed Drizzle instance over D1.
 *
 * Carries the translated D1 schema (`d1Schema`) so queries are checked
 * against the real SQLite table definitions.
 */
export type DrizzleD1 = DrizzleD1Database<typeof d1Schema>;

/**
 * Create a Drizzle ORM instance bound to the canonical D1 schema.
 *
 * Pure factory — no globals, no environment reads: tests pass any object
 * satisfying {@link D1DatabaseLike} (the runtime binding does too), so a
 * misconfigured binding fails at the first query instead of hiding behind
 * a constructor-side environment check.
 */
export function createDrizzleD1(client: D1DatabaseLike): DrizzleD1 {
  // The cast crosses the Workers/Node type boundary only: at runtime the
  // drizzle D1 driver drives exactly the prepare/batch surface declared
  // by D1DatabaseLike.
  return drizzle(client as unknown as Parameters<typeof drizzle>[0], {
    schema: d1Schema,
  }) as DrizzleD1;
}
