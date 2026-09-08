/**
 * Share-permalink routes (task 6.1, change trust-and-reach-roadmap,
 * design D6) — frozen-copy share links over calculation records.
 *
 *   POST /api/v1/calculations/:id/share   sessionAuth (GUARDED_ROUTES;
 *                                         the prefix's CALCULATOR rate
 *                                         limit registers at index.ts)
 *   GET  /api/v1/share/:publicId          public read of the frozen copy
 *
 * POST composes core-domain sharing: the record is read WITH its owner,
 * ownership is enforced (a foreign or unclaimed record is a 404 —
 * existence never leaks across accounts), the frozen copy is assembled
 * through the closed payload projection, stripped of personal data and
 * ASSERTED clean (PersonalDataFieldError → 500 invariant, nothing
 * stored), and persisted under a fresh 22-character random public id
 * (collision retries are bounded and astronomically unlikely).
 *
 * The snapshot is a COPY: later edits or the record retention prune
 * never affect what the share link renders (spec share-permalinks).
 * GET validates the id shape first — a malformed id 404s without a
 * database round-trip, and an unknown-but-well-formed id 404s
 * identically (no identifier-existence leakage).
 *
 * @module ShareRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  assembleShareSnapshot,
  assertNoPersonalData,
  generatePublicId,
  isValidPublicId,
} from '../../../../packages/core-domain/src/sharing/sharing';
import { PersonalDataFieldError } from '../../../../packages/core-domain/src/sharing/sharing.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import { findOwnedCalculationRecord } from '../adapters/calculation-record-reads';
import { D1ShareSnapshotRepository } from '../../../../packages/data-platform/src/repositories/d1/share-snapshot.repository';

/** Public-id collision retries before giving up (astronomically unlikely). */
const MAX_PUBLIC_ID_ATTEMPTS = 3;

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

async function createShare(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const recordId = parseIntParam(c, 'id');

  const record = await findOwnedCalculationRecord(c.env.DB, recordId);
  // Unclaimed and foreign records are indistinguishable 404s — an
  // unguessable share URL must not double as a record-id oracle.
  if (record === null || record.ownerUserId !== user.userId) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Calculation record ${recordId} not found`,
      error: 'CalculationRecordNotFound',
    });
  }

  const snapshot = assembleShareSnapshot({
    productName: record.productName,
    productBrand: record.productBrand,
    productCategory: record.productCategory,
    quantity: record.quantity,
    totalCents: record.totalCents,
    breakdown: record.breakdown,
    confidence: record.confidence,
    destination: record.destination,
    disclaimer: record.disclaimer,
    calculatedAt: record.calculatedAt.toISOString(),
  });

  // The strip assertion runs on the ASSEMBLED payload — including the
  // free-form breakdown the assembler does not structurally control.
  try {
    assertNoPersonalData(snapshot);
  } catch (err) {
    if (err instanceof PersonalDataFieldError) {
      // Invariant violation, not a client error: refuse loudly, store nothing.
      throw new ApiHttpError(500, {
        statusCode: 500,
        message: err.message,
        error: 'SnapshotPersonalDataViolation',
      });
    }
    throw err;
  }

  const repo = new D1ShareSnapshotRepository(c.env.DB);
  let publicId = '';
  for (let attempt = 0; attempt < MAX_PUBLIC_ID_ATTEMPTS; attempt += 1) {
    publicId = generatePublicId();
    try {
      const created = await repo.create({ publicId, frozenResult: snapshot });
      return c.json(
        {
          publicId: created.publicId,
          createdAt: created.createdAt.toISOString(),
        },
        201,
      );
    } catch (err) {
      // Unique-index collision on the public id — regenerate and retry;
      // any other error propagates.
      const message = err instanceof Error ? err.message : '';
      if (!/UNIQUE constraint failed/.test(message) || attempt === MAX_PUBLIC_ID_ATTEMPTS - 1) {
        throw err;
      }
    }
  }
  // Unreachable — the loop either returned or threw.
  throw new Error('share-snapshot id generation failed');
}

async function getShare(c: Context<AppEnv>): Promise<Response> {
  const publicId = c.req.param('publicId') ?? '';
  // Shape check first: a malformed id can never exist, so no lookup and
  // no distinction between malformed and unknown (spec: no leakage).
  if (!isValidPublicId(publicId)) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: 'Share snapshot not found',
      error: 'ShareSnapshotNotFound',
    });
  }

  const snapshot = await new D1ShareSnapshotRepository(c.env.DB).findByPublicId(publicId);
  if (snapshot === null) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: 'Share snapshot not found',
      error: 'ShareSnapshotNotFound',
    });
  }

  return c.json({
    publicId: snapshot.publicId,
    snapshot: snapshot.frozenResult,
    createdAt: snapshot.createdAt.toISOString(),
  });
}

/** Register the share handlers (sessionAuth rides the GUARDED_ROUTES entry). */
export function registerShareRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post('/api/v1/calculations/:id/share', createShare);
  app.get('/api/v1/share/:publicId', getShare);
  return app;
}
