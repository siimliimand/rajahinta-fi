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
 * Query parameter (import-filing-assistant task 2.3):
 * - `dispatchDate` (optional, ISO calendar date YYYY-MM-DD) — the planned
 *   dispatch date anchoring the dated pre-dispatch filing checklist
 *   (design D2: a request parameter, never persisted). Absent and empty
 *   values normalize to null; malformed values pass through for the
 *   service's strict calendar-date parse, which degrades them to the
 *   undated checklist — never an error, never a guessed date. The response
 *   carries the checklist additively (cited steps incl. the
 *   reference-number capture step, guarantee figure with availability and
 *   reliability status, ESTIMATED return-due estimate when dated, and the
 *   DATED / POST_DEADLINE / UNDATED deadline state); all pre-existing
 *   fields and semantics are unchanged.
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
  // Optional planned dispatch date — read-only request parameter (design
  // D2). Absent/empty → null; malformed values reach the service's strict
  // parse and degrade to the undated checklist (no 400: a missing or
  // unparseable optional date is a factual state, not a client error).
  const plannedDispatchDate = c.req.query('dispatchDate') ?? null;

  try {
    const service = new ExciseDeclarationService(
      new D1CalculationRecordQueryAdapter(c.env.DB),
    );
    const summary = await service.prepareDeclaration(recordId, {
      plannedDispatchDate,
    });
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
