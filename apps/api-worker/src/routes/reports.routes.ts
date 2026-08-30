/**
 * Reports route port (task 3.6) — Hono re-host of ReportsController
 * (packages/application-api/src/reports/).
 *
 * Guard/rate-limit composition (Nest decoration order preserved):
 *   GET /api/v1/reports/:recordId
 *     RateLimit(DECLARATION) → FeatureFlag(ADVANCED_FEATURES) → AgeGate
 *     → Entitlement('calculation:export')
 *
 * The format serializers are the application-api module's pure functions
 * (buildJsonReport / buildCsvReport / buildHtmlReport — RFC-4180
 * escaping, structural disclaimer row, printable HTML), imported from the
 * TypeScript sources with the calculation-record query adapter from
 * src/adapters/d1-domain-ports.ts supplying the shared single-record read.
 *
 * @module ReportsRoutes
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { ageGate } from '../middleware/age-gate';
import { requireFeature } from '../middleware/entitlement';
import { requireFeatureFlag, FeatureFlag } from '../middleware/feature-flags';
import { resolveAccountByToken } from '../auth/session-resolver';
import { SESSION_COOKIE_NAME } from '../middleware/session-auth';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import { D1CalculationRecordQueryAdapter } from '../adapters/d1-domain-ports';
import {
  buildJsonReport,
  buildCsvReport,
  buildHtmlReport,
} from '../../../../packages/application-api/src/reports/report-export.service';

/**
 * Resolve the presented session cookie — when one exists AND is valid —
 * into the user context WITHOUT requiring it. Anonymous callers fall
 * through (the entitlement check then resolves FREE, its documented 403).
 */
const attachOptionalSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (typeof token === 'string' && token.length > 0) {
    const account = await resolveAccountByToken(c.env.DB, token);
    if (account !== null) {
      c.set(USER_CONTEXT_KEY, account);
      c.set('sessionToken', token);
    }
  }
  await next();
};

type ReportFormat = 'json' | 'csv' | 'html';

/**
 * Normalize the format query parameter: absent/empty defaults to json;
 * anything outside the controlled vocabulary is a 400 (controller parity).
 */
function validateFormat(format: string | undefined): ReportFormat {
  if (format === undefined || format === '') {
    return 'json';
  }
  if (format === 'json' || format === 'csv' || format === 'html') {
    return format;
  }
  throw new ApiHttpError(
    400,
    `Unsupported format '${format}'. Supported formats: json, csv, html.`,
  );
}

async function getReport(c: Context<AppEnv>): Promise<Response> {
  const recordId = parseIntParam(c, 'recordId');
  // Validate before any I/O: a bad format on an unknown record is a 400.
  const normalized = validateFormat(c.req.query('format'));

  try {
    // The single read path shared with the declaration feature.
    const adapter = new D1CalculationRecordQueryAdapter(c.env.DB);
    const record = await adapter.findById(recordId);
    if (record === null) {
      throw new ApiHttpError(404, `Calculation record ${recordId} not found`);
    }

    if (normalized === 'json') {
      return c.json(buildJsonReport(record));
    }

    if (normalized === 'csv') {
      const body = buildCsvReport(record);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="rajahinta-calculation-${recordId}.csv"`,
        },
      });
    }

    const body = buildHtmlReport(record);
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to export report',
    );
  }
}

/** Register the reports handlers with the full Nest guard stack. */
export function registerReportsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Class-level stack, Nest order (the DECLARATION-profile rate limit is
  // registered ahead of the guard blocks in index.ts).
  app.use('/api/v1/reports/*', requireFeatureFlag(FeatureFlag.ADVANCED_FEATURES), ageGate());
  // Method-level EntitlementGuard pair. Unlike declaration (whose pinned
  // always-403 composition is preserved), the phase2-advanced-features
  // guard contract for this route is explicit — "PREMIUM allowed; FREE
  // tier and anonymous requests get 403 with the InsufficientEntitlement
  // body; tiers resolve from the account context" — so the presented
  // session cookie, when any, resolves the tier ahead of the check.
  app.on('GET', '/api/v1/reports/:recordId', attachOptionalSession, requireFeature('calculation:export'));
  app.get('/api/v1/reports/:recordId', getReport);
  return app;
}
