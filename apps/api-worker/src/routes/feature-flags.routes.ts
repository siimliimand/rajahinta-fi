/**
 * Feature-flags route port — Hono re-host of FeatureFlagsController
 * (packages/application-api/src/feature-flags/feature-flags.controller.ts).
 * Missed in the task 3.5–3.8 route ports; found because the frontend's
 * SSR flag bootstrap (lib/api.ts getFeatureFlags → GET /api/v1/feature-flags)
 * failed against the Worker and silently inlined the all-off default,
 * hiding every flag-gated UI feature regardless of the committed vars.
 *
 * GET /api/v1/feature-flags — public read of the resolved flag map for UI
 * gating. Only booleans are exposed (rollout percentages and entity
 * bucketing stay server-side). Like the Nest controller it is deliberately
 * unguarded: a static config read with no PII, the same information already
 * inferable from guarded routes answering 403 vs 200.
 *
 * @module FeatureFlagsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { FeatureFlagService } from '../middleware/feature-flags';

/** Handler — resolve the env-derived flag map (booleans only). */
async function getFlags(c: Context<AppEnv>): Promise<Response> {
  return c.json({ flags: new FeatureFlagService(c.env).resolveFlagMap() });
}

/** Register the public flag-map endpoint (no Nest guards on this route). */
export function registerFeatureFlagsRoutes(app: Hono<AppEnv>): void {
  app.get('/api/v1/feature-flags', getFlags);
}
