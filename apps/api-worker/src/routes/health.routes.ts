/**
 * Health endpoints (task 6.4, design D8) — Hono port of the Nest
 * HealthController + ReadinessService
 * (packages/application-api/src/index.ts, src/observability/).
 *
 * - GET /api/v1/health — liveness. Cheap and process-only: no binding or
 *   dependency access, so a brief dependency outage never restarts a
 *   healthy Worker ({ status: 'ok', timestamp }, HealthController.check
 *   parity).
 * - GET /api/v1/health/ready — readiness. A D1 roundtrip plus a DO ping
 *   under short timeouts; the body carries overall + per-dependency
 *   status and answers 503 when any dependency is down.
 *
 * Kubernetes/Docker probe parity is replaced by Workers routing: external
 * uptime monitors (and rollout gating) key off `/ready`, so a Worker with
 * a dead dependency is not reported ready; `/health` remains the
 * restart-decision signal only.
 *
 * Error shapes: a down dependency is NOT an envelope error — the 503 body
 * is the readiness document itself, exactly like the Nest controller
 * (per-dependency status must be readable from the probe response).
 * Anything unexpected thrown while assembling it surfaces through the
 * unified error envelope (src/errors.ts) via the app error boundary.
 *
 * Both routes are deliberately unguarded (HealthController is
 * reviewed-safe) and registered ahead of the guard middleware in
 * index.ts.
 *
 * @module HealthRoutes
 */

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../env';
import { checkReadiness } from '../services/readiness';

/** Register the liveness and readiness endpoints. */
export function registerHealthRoutes(app: Hono<AppEnv>): void {
  // Liveness — process-only and cheap (no dependency calls). Kept
  // byte-identical to the task-3.1 placeholder.
  app.get('/api/v1/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness — dependency-aware (D1 + DO); 503 when any check is down
  // (HttpStatus.SERVICE_UNAVAILABLE parity).
  app.get('/api/v1/health/ready', async (c) => {
    const result = await checkReadiness(c.env);
    const status: ContentfulStatusCode = result.status === 'ok' ? 200 : 503;
    return c.json(result, status);
  });
}
