/**
 * Public traveller-allowance reference API (task 4.1, change
 * insight-surfaces) — strictly read-side over the task-5.1
 * D1TravellerAllowancesRepository. No write path exists here: the
 * append/publish lifecycle stays in the operator console, and no
 * endpoint can create, modify, or unpublish a PUBLISHED row.
 *
 * GET /api/v1/allowances?date=YYYY-MM-DD — the PUBLISHED dataset
 * effective on the date (query optional; defaults to today, UTC).
 * Invalid dates are 400; a date no published version covers is an
 * explicit 404 — never a guessed version. PENDING_CONFIRMATION
 * versions are invisible to resolution. The payload carries the
 * version label and effective window with the caps and passes the
 * dataset's and each limit's source citation through verbatim —
 * citations are never paraphrased into conclusions.
 *
 * GET /api/v1/allowances/versions — the published version history with
 * effective windows, superseded versions included and pending ones
 * excluded, newest effective window first.
 *
 * Middleware per route (unitprice/merchants parity — a public read over
 * alcohol reference data): the age gate precedes the handler and the
 * DEFAULT read rate-limit profile applies. No feature flags.
 *
 * @module AllowancesRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireRateLimit } from '../middleware/rate-limit';
import { ageGate } from '../middleware/age-gate';
import { D1TravellerAllowancesRepository } from '../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';

// ---------------------------------------------------------------------------
// Date handling — the repository resolves on ISO YYYY-MM-DD calendar dates
// ---------------------------------------------------------------------------

/**
 * Strictly validate 'YYYY-MM-DD' as a real calendar date; null when
 * malformed or impossible (2026-02-30) — historical.routes parity. The
 * repository compares calendar dates as TEXT, so the string itself is
 * the resolved value.
 */
function parseIsoDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? raw
    : null;
}

/** Today as a UTC calendar date — the query-less default. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getAllowances(c: Context<AppEnv>): Promise<Response> {
  const raw = c.req.query('date') ?? todayIsoDate();
  const date = parseIsoDate(raw);
  if (date === null) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'date must be an ISO calendar date (YYYY-MM-DD)',
      error: 'ValidationError',
    });
  }

  const resolved = await new D1TravellerAllowancesRepository(
    c.env.DB,
  ).findPublishedEffectiveOn(date);
  if (resolved === null) {
    // Explicit not-found — an uncovered date must not silently resolve
    // to a guessed version (the capping surfaces use 409 for the same
    // condition because there a calculation is impossible; this is a
    // reference read, so the standard 404 is the honest answer).
    throw new ApiHttpError(
      404,
      `No published traveller allowance dataset is effective on ${date}`,
    );
  }

  return c.json({
    date,
    dataset: {
      versionLabel: resolved.dataset.versionLabel,
      sourceCitation: resolved.dataset.sourceCitation,
      effectiveFrom: resolved.dataset.effectiveFrom,
      effectiveTo: resolved.dataset.effectiveTo,
    },
    limits: resolved.limits.map((limit) => ({
      category: limit.category,
      volumeCapLitres: limit.volumeCapLitres,
      quantityCap: limit.quantityCap,
      sourceCitation: limit.sourceCitation,
      effectiveFrom: limit.effectiveFrom,
      effectiveTo: limit.effectiveTo,
    })),
  });
}

async function getAllowanceVersions(c: Context<AppEnv>): Promise<Response> {
  const versions = await new D1TravellerAllowancesRepository(
    c.env.DB,
  ).listPublished();

  return c.json({
    versions: versions.map((version) => ({
      versionLabel: version.dataset.versionLabel,
      sourceCitation: version.dataset.sourceCitation,
      effectiveFrom: version.dataset.effectiveFrom,
      effectiveTo: version.dataset.effectiveTo,
      limits: version.limits.map((limit) => ({
        category: limit.category,
        volumeCapLitres: limit.volumeCapLitres,
        quantityCap: limit.quantityCap,
        sourceCitation: limit.sourceCitation,
        effectiveFrom: limit.effectiveFrom,
        effectiveTo: limit.effectiveTo,
      })),
    })),
  });
}

// ---------------------------------------------------------------------------
// Registration (age gate + limiter pre-registered per-route here)
// ---------------------------------------------------------------------------

/** Register both allowance reads behind their gate and limiter. */
export function registerAllowancesRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('GET', '/api/v1/allowances', ageGate());
  app.get('/api/v1/allowances', requireRateLimit('DEFAULT'), getAllowances);
  app.on('GET', '/api/v1/allowances/versions', ageGate());
  app.get(
    '/api/v1/allowances/versions',
    requireRateLimit('DEFAULT'),
    getAllowanceVersions,
  );
  return app;
}
