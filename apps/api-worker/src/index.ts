/**
 * API Worker entry (migrate-to-cloudflare task 3.1) — Hono application
 * skeleton per design D1: router, unified error envelope, request-ID
 * structured logging, zod DTO layer. Route ports start at task 3.5.
 *
 * Scheduled work (design D6, tasks 4.1/4.3): one `triggers.crons` array
 * dispatched by cron pattern (see src/cron/router.ts), and the
 * price-ingestion Queue consumer (see src/queues/ingestion.queue.ts).
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
import type { AppEnv, Env } from './env';
import {
  requestPath,
  respondToError,
  routeNotFoundResponse,
} from './errors';
import { errorBoundary } from './middleware/error-boundary';
import { requestLogging } from './middleware/request-id';
import { registerGuardMiddleware } from './middleware/guards';
import { dispatchScheduled } from './cron/router';
import { handleIngestionBatch } from './queues/ingestion.queue';
import type { IngestionMessageBody } from './queues/ingestion-message';

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

  // Ported Nest guards (task 3.2) — registered after the health route so
  // liveness stays unguarded (HealthController is reviewed-safe). Their
  // scoped routes have no handlers yet (route ports are tasks 3.5–3.8);
  // guards run ahead of the 404 fallback until each handler lands, which
  // fails closed on the protected paths.
  registerGuardMiddleware(app);

  return app;
}

const app = createApp();

/**
 * Cron triggers (design D6, tasks 4.1/4.3) and the price-ingestion Queue
 * consumer, dispatched from one default export.
 *
 * Cron: wrangler fires `scheduled` per `triggers.crons` pattern; the
 * router maps the pattern to its handler set (the 6-hourly pattern
 * carries both the transport-rate refresh and the task-3.4 click-counter
 * flush) and runs each handler in its own waitUntil with per-handler
 * error isolation — a failing handler must not starve the others on the
 * same tick.
 *
 * Queue: batch size is 1 (per-merchant failure isolation); a message is
 * acked when its ingestion completes OR its dedupe key was already
 * processed (idempotent skip), and retried with exponential backoff
 * otherwise — see src/queues/ingestion.queue.ts.
 */
export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    dispatchScheduled(event, env, ctx);
  },
  async queue(
    batch: MessageBatch<IngestionMessageBody>,
    env: Env,
  ): Promise<void> {
    await handleIngestionBatch(batch, env);
  },
};
