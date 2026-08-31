/**
 * Minimal structural interface for the Cloudflare D1 binding.
 *
 * Deliberately a local, dependency-free declaration: no wrangler or
 * @cloudflare/workers-types import at this layer (the binding wiring
 * lands with the wrangler config in a later task). The real `env.DB`
 * binding satisfies this interface structurally, so the composition
 * root can pass it in unchanged.
 *
 * Test harnesses emulate the same shape over `node:sqlite` — see
 * `src/repositories/d1/__tests__/d1-test-harness.ts` — so every D1
 * repository runs against a real SQLite engine with the committed
 * migrations applied.
 *
 * @module D1Executor
 */

/** Result shape of the D1 binding's `all()` / `run()`. */
export interface D1ResultLike<T = Record<string, unknown>> {
  readonly results: T[];
  readonly success: boolean;
  readonly meta: Record<string, unknown>;
}

/**
 * One prepared statement. `bind()` returns the statement itself
 * (call-chaining), mirroring the binding's API; parameters bind
 * positionally to `?` placeholders.
 */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  /** First row or null when the query matched nothing. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
}

/** The subset of the D1 binding the repositories consume. */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  /**
   * Execute the statements sequentially in one implicit transaction —
   * the binding's `batch()`. Either every statement commits or none
   * does; the multi-statement invariants that pg expressed with
   * `db.transaction` (session rotation, FX dataset + rates append)
   * translate onto this primitive (the same surface
   * `src/db/d1.provider.ts` declares for the drizzle D1 driver).
   */
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
}
