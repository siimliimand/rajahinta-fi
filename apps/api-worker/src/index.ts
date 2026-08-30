/**
 * API Worker entry (migrate-to-cloudflare task 3.1) — Hono application
 * skeleton per design D1: router, unified error envelope, request-ID
 * structured logging, zod DTO layer. Route ports start at task 3.5.
 *
 * Error semantics mirror packages/application-api/src/common/api-error.filter.ts
 * (see src/errors.ts); logging mirrors the pino bootstrap in
 * apps/backend/src/main.ts, adapted to Workers Logs (see src/logger.ts).
 */

// The @nestjs/common shim's decorators — and core-domain's engine classes
// imported by later tasks — evaluate Reflect metadata APIs; the polyfill
// must load before any of them. Spike-proven pattern (G3).
import 'reflect-metadata';

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { flushClickCounters } from './analytics/click-counter-flusher';
import type { AppEnv, Env } from './env';
import {
  requestPath,
  respondToError,
  routeNotFoundResponse,
} from './errors';
import { errorBoundary } from './middleware/error-boundary';
import { requestLogging } from './middleware/request-id';
import { createLogger } from './logger';

export type { AppEnv, Env } from './env';
export { ApiHttpError } from './errors';

// Durable Object classes must be exported from the entry script so the
// runtime can bind them (wrangler.jsonc migrations + durable_objects;
// tasks 3.3–3.4).
export { RateLimiterDO } from './do/rate-limiter.do';
export { IdempotencyDO } from './do/idempotency.do';
export { ClickCounterDO } from './do/click-counter.do';

/**
 * Application factory. Tests (and later phases: per-route modules from
 * tasks 3.5–3.8) compose on the returned instance before it is served.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Outermost: request-ID stamping + one structured completion line per
  // request. Registered outside the error boundary so error responses are
  // logged exactly like successful ones (pino 'finish' semantics).
  app.use(requestLogging());

  // Root-level error boundary: every thrown error becomes the unified
  // envelope (ApiErrorFilter parity). Hono delivers Error instances to
  // onError at the innermost dispatch frame; the boundary middleware
  // below is the net for non-Error throws compose rethrows outward.
  app.onError((err, c) => respondToError(c, err));
  app.use(errorBoundary());

  // Unknown routes: Nest parity — 404 { message: "Cannot GET /…",
  // error: "Not Found" } envelope.
  app.notFound((c) => {
    const { status, body } = routeNotFoundResponse(
      c.req.method,
      requestPath(c),
    );
    return c.json(body, status as ContentfulStatusCode);
  });

  // Liveness — deliberately process-only and cheap (no dependency calls),
  // so an orchestrator never restarts a healthy Worker over a brief
  // dependency outage; matches HealthController.check in application-api
  // ({ status: 'ok', timestamp }). Dependency-aware readiness (D1
  // roundtrip + DO ping) is task 6.4.
  app.get('/api/v1/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

const app = createApp();

/**
 * Cron-triggered flush of the click-counter snapshots into D1 (design
 * D5, task 3.4; cadence in wrangler.jsonc `triggers.crons`). The DO
 * alarm produces payloads on its own cadence regardless of traffic;
 * this handler is only the mover — see
 * src/analytics/click-counter-flusher.ts for the trigger-path rationale.
 * Failures are logged, never thrown: a missed flush must not mark the
 * cron invocation failed and burn retries on a retryable-by-design
 * window.
 */
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const log = createLogger(env.LOG_LEVEL);
    ctx.waitUntil(
      flushClickCounters(env)
        .then((result) =>
          log.info({
            message: 'Click-counter flush complete',
            snapshotTaken: result.snapshotTaken,
            rowsWritten: result.rowsWritten,
          }),
        )
        .catch((err: unknown) =>
          log.error({
            message: 'Click-counter flush failed',
            error: err instanceof Error ? err.message : 'unknown error',
          }),
        ),
    );
  },
};
