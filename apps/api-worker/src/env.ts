/**
 * Worker bindings (wrangler.jsonc) and the Hono environment type.
 *
 * D1/DO bindings are live as of tasks 2.4 and 3.3–3.4 (v1/v2 DO
 * migrations); route ports start at task 3.5.
 */

export interface Env {
  /** D1 database. Binding present; real schemas/providers arrive in task 2.4. */
  readonly DB: D1Database;
  /** RateLimiterDO — task 3.3. */
  readonly RATE_LIMITER?: DurableObjectNamespace;
  /** IdempotencyDO — task 3.3. */
  readonly IDEMPOTENCY?: DurableObjectNamespace;
  /** ClickCounterDO — task 3.4 (migration tag v2; alarm-driven flush). */
  readonly CLICK_COUNTER?: DurableObjectNamespace;
  /** Minimum structured-log level (default "info"). */
  readonly LOG_LEVEL?: string;
}

/** Hono environment: bindings + per-request variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by the request-ID middleware; stamped on every log line. */
    requestId: string;
  };
};
