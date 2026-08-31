/**
 * Drizzle D1 module — registration helper for the API Worker (task 2.4).
 *
 * Nest containers do not exist in a Worker (design D1), so the
 * `drizzle.module.ts` global-module pattern collapses into one plain
 * function the Worker's Hono code can call: pass the `env.DB` binding,
 * get the singleton {@link DrizzleD1} instance for that binding.
 *
 * Memoization is keyed by the binding object itself (WeakMap). Workers
 * binding objects are stable for the lifetime of an isolate, so each
 * isolate builds its drizzle instance exactly once, while a replaced
 * binding (tests, wrangler reloads) simply produces a fresh instance and
 * lets the old one be garbage-collected.
 *
 * ## Usage
 *
 * ```typescript
 * import { getDrizzleD1 } from '@rajahinta/data-platform/db/d1.module';
 *
 * // anywhere with the worker env in scope:
 * const db = getDrizzleD1(env.DB);
 * ```
 *
 * @module DrizzleD1Module
 */
import {
  createDrizzleD1,
  type D1DatabaseLike,
  type DrizzleD1,
} from './d1.provider';

/** One drizzle instance per distinct D1 binding object, per isolate. */
const instances = new WeakMap<object, DrizzleD1>();

/**
 * Return the Drizzle instance for the given D1 binding, creating it on
 * first use. Safe to call per-request: after the first call this is a
 * WeakMap lookup.
 */
export function getDrizzleD1(db: D1DatabaseLike): DrizzleD1 {
  let instance = instances.get(db);
  if (instance === undefined) {
    instance = createDrizzleD1(db);
    instances.set(db, instance);
  }
  return instance;
}
