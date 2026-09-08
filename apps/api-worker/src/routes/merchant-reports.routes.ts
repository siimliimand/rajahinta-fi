/**
 * Shop-blacklist report submission (task 2.2, change
 * trust-and-reach-roadmap) — `POST /api/v1/reports`.
 *
 * Guard composition (GUARDED_ROUTES, middleware/guards.ts — Nest guard
 * order: rate limit first, then authentication):
 *
 *   POST /api/v1/reports    requireRateLimit('AUTH') → sessionAuth()
 *
 * The AUTH limiter is the abuse defence for a public write surface (the
 * credential-route precedent); reports are bound to the authenticated
 * account — the reporter id comes from the server-resolved session,
 * never from the body.
 *
 * Evidence validation is core-domain's `validateBlacklistReport`: a
 * missing/blank order reference or correspondence summary, or an
 * unusable merchant domain/name, throws the typed validation error and
 * NOTHING is stored (spec merchant-blacklist: incomplete evidence is
 * rejected outright). The mapped status is 400 with the module's
 * rejection reason.
 *
 * Every accepted report appends an audit event (audit-trail parity with
 * the credential and ops writes) carrying the merchant identity and the
 * evidence PRESENCE — never the evidence contents, which stay in the
 * moderation queue's own table.
 *
 * @module MerchantReportsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { validateBlacklistReport } from '../../../../packages/core-domain/src/blacklist/blacklist';
import { InvalidBlacklistReportError } from '../../../../packages/core-domain/src/blacklist/blacklist.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseDto } from './support';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import { WorkerAuditService } from '../adapters/audit';
import { D1ShopReportRepository } from '../../../../packages/data-platform/src/repositories/d1/shop-report.repository';

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

const DOMAIN_MESSAGE = 'merchantDomain must be a non-empty string';
const NAME_MESSAGE = 'merchantName must be a non-empty string';
const ORDER_MESSAGE = 'orderReference must be a non-empty string';
const SUMMARY_MESSAGE = 'correspondenceSummary must be a non-empty string';

const reportSchema = z.object({
  merchantDomain: z
    .string({ required_error: DOMAIN_MESSAGE, invalid_type_error: DOMAIN_MESSAGE })
    .min(1, DOMAIN_MESSAGE),
  merchantName: z
    .string({ required_error: NAME_MESSAGE, invalid_type_error: NAME_MESSAGE })
    .min(1, NAME_MESSAGE),
  orderReference: z
    .string({ required_error: ORDER_MESSAGE, invalid_type_error: ORDER_MESSAGE })
    .min(1, ORDER_MESSAGE),
  correspondenceSummary: z
    .string({ required_error: SUMMARY_MESSAGE, invalid_type_error: SUMMARY_MESSAGE })
    .min(1, SUMMARY_MESSAGE),
});

async function createReport(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const body = await parseDto(c, reportSchema);

  // Core-domain evidence gate — throws the typed error before any I/O,
  // mapped to the 400 ValidationError envelope with the module's reason.
  let validated: ReturnType<typeof validateBlacklistReport>;
  try {
    validated = validateBlacklistReport({
      reporterAccountId: String(user.accountId),
      merchantDomain: body.merchantDomain,
      merchantName: body.merchantName,
      orderReference: body.orderReference,
      correspondenceSummary: body.correspondenceSummary,
    });
  } catch (err) {
    if (err instanceof InvalidBlacklistReportError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: err.reason,
      });
    }
    throw err;
  }

  const report = await new D1ShopReportRepository(c.env.DB).create({
    merchantDomain: validated.merchantIdentity.domain,
    merchantNameNormalized: validated.merchantIdentity.name,
    orderReference: validated.evidence.orderReference,
    correspondenceSummary: validated.evidence.correspondenceSummary,
    reporterAccountId: user.accountId,
  });

  // Audit event — identity + evidence shape, never the evidence text.
  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'shop_report',
    entityId: String(report.id),
    action: 'created',
    author: user.userId,
    reason: 'Shop report submitted via API',
    newValue: {
      merchantDomain: report.merchantDomain,
      merchantNameNormalized: report.merchantNameNormalized,
      status: report.status,
    },
  });

  return c.json(
    {
      id: report.id,
      merchantDomain: report.merchantDomain,
      merchantNameNormalized: report.merchantNameNormalized,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    },
    201,
  );
}

/** Register the report handler (guards ride the GUARDED_ROUTES entry). */
export function registerMerchantReportsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post('/api/v1/reports', createReport);
  return app;
}

export { InvalidBlacklistReportError };
