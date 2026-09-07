/**
 * Declaration route port (task 3.5) — Hono re-host of
 * DeclarationController (packages/application-api/src/declaration/).
 *
 * Guard composition: age gate (prefix, guards.ts) →
 * requireFeature('declaration:summary') → handler. The feature-flag
 * guidance gate (design D5's ADVANCED_FEATURES strip) was removed by
 * decision — the summary always carries its guidance field.
 *
 * The handler is ported faithfully: ExciseDeclarationService over the D1
 * calculation-record query adapter.
 *
 * @module DeclarationRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { ExciseDeclarationService } from '../adapters/core-domain-bridge';
import { D1CalculationRecordQueryAdapter } from '../adapters/d1-domain-ports';

async function prepareDeclaration(c: Context<AppEnv>): Promise<Response> {
  const recordId = parseIntParam(c, 'recordId');

  try {
    const service = new ExciseDeclarationService(
      new D1CalculationRecordQueryAdapter(c.env.DB),
    );
    const summary = await service.prepareDeclaration(recordId);
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

/** Register the declaration handler (guards pre-registered in guards.ts). */
export function registerDeclarationRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // The age gate (class-level prefix) and requireFeature('declaration:summary')
  // (method-level GUARDED_ROUTES entry) are registered by
  // registerGuardMiddleware — this file only appends the handler behind
  // them.
  app.get('/api/v1/declaration/:recordId', prepareDeclaration);
  return app;
}
