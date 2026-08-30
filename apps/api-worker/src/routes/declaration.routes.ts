/**
 * Declaration route port (task 3.5) — Hono re-host of
 * DeclarationController (packages/application-api/src/declaration/).
 *
 * KNOWN PRE-EXISTING NEST BUG — PRESERVED DELIBERATELY (do NOT fix here):
 * the Nest controller composes EntitlementGuard WITHOUT SessionAuthGuard,
 * so no request context is ever attached and the
 * `declaration:summary` entitlement check resolves anonymous (FREE tier)
 * for EVERY caller — the route 403s identically for anonymous callers and
 * valid PREMIUM sessions. The task-3.2 route-coverage suite pins this
 * behavior (`currentTier: 'FREE'` even with a session cookie); this port
 * keeps the faithful composition: age gate (prefix) →
 * requireFeature('declaration:summary') → handler. Fixing the bug means
 * composing sessionAuth on this route — a behavior change for the lead to
 * schedule, not a migration task.
 *
 * The handler behind the guard is ported faithfully anyway:
 * ExciseDeclarationService over the D1 calculation-record query adapter,
 * with the guidance field gated by ADVANCED_FEATURES (flag off strips the
 * key entirely — byte-compatible with pre-guidance payloads).
 *
 * @module DeclarationRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { FeatureFlag, FeatureFlagService } from '../middleware/feature-flags';
import { ExciseDeclarationService } from '../adapters/core-domain-bridge';
import { D1CalculationRecordQueryAdapter } from '../adapters/d1-domain-ports';

async function prepareDeclaration(c: Context<AppEnv>): Promise<Response> {
  const recordId = parseIntParam(c, 'recordId');

  try {
    const service = new ExciseDeclarationService(
      new D1CalculationRecordQueryAdapter(c.env.DB),
    );
    const summary = await service.prepareDeclaration(recordId);

    if (!new FeatureFlagService(c.env).isEnabled(FeatureFlag.ADVANCED_FEATURES)) {
      return c.json(stripGuidance(summary));
    }

    return c.json(summary);
  } catch (err) {
    if (err instanceof Error && err.name === 'CalculationRecordNotFoundError') {
      throw new ApiHttpError(404, err.message);
    }
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to prepare declaration summary',
    );
  }
}

/**
 * Design D5 — the guidance FIELD is gated by ADVANCED_FEATURES while the
 * route stays entitled as before. Flag off: strip guidance so the key is
 * absent (undefined, not null) and the response stays byte-compatible
 * with pre-guidance payloads. Exported for parity tests.
 */
export function stripGuidance<T extends { guidance?: unknown }>(summary: T): Omit<T, 'guidance'> {
  const { guidance: _gatedOff, ...withoutGuidance } = summary;
  return withoutGuidance;
}

/** Register the declaration handler (guards pre-registered by task 3.2). */
export function registerDeclarationRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // The age gate (class-level prefix) and requireFeature('declaration:summary')
  // (method-level GUARDED_ROUTES entry) are registered by
  // registerGuardMiddleware — this file only appends the handler behind
  // them. See the module doc for the pinned always-403 behavior.
  app.get('/api/v1/declaration/:recordId', prepareDeclaration);
  return app;
}
