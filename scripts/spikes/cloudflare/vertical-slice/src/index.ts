/**
 * G3 vertical slice spike — Worker entry (Hono).
 *
 * One route: POST /api/v1/calculator, mirroring the DTO and response
 * shape of packages/application-api/src/calculator/ (CalculateRequest →
 * CalculatorResult), behind a DO rate limiter. Guards/idempotency are
 * out of scope for the slice: the endpoint is un-gated (golden data has
 * no launch/age gate dependencies) and X-Cache is always MISS because
 * the IdempotencyDO is task 3.3/3.4 work.
 *
 * Error mapping mirrors CalculatorController.calculate:
 *   ProductNotFound / NoRetailOffers        → 404
 *   ClassificationGateRejectionError        → 422 {error, productId, reason}
 *   anything else                           → 500
 *
 * @module G3SpikeWorker
 */

// NestJS decorators need the Reflect metadata polyfill loaded before any
// core-domain module is evaluated.
import 'reflect-metadata';

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import {
  ClassificationGateRejectionError,
  ProductNotFoundError,
  NoRetailOffersError,
  type CalculatorInput,
  type TransportArrangement,
} from './core-domain.ts';
import { buildLandedCostCalculator } from './calculator.ts';
import { RateLimiterDO } from './rate-limiter.ts';

interface Env {
  DB: D1Database;
  RATE_LIMITER: DurableObjectNamespace;
  /** Rate-limit ceiling override — the load script raises it. */
  RATE_LIMIT_MAX?: string;
}

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /api/v1/calculator
// ---------------------------------------------------------------------------

app.post('/api/v1/calculator', async (c) => {
  // ---- Rate limit (per client, DO-backed sliding window) ----
  const clientIp =
    c.req.header('CF-Connecting-IP') ?? '127.0.0.1'; // local dev: loopback
  const limiterId = c.env.RATE_LIMITER.idFromName(clientIp);
  const limiter = c.env.RATE_LIMITER.get(limiterId);
  const rlResponse = await limiter.fetch('https://rate-limiter/check', {
    method: 'POST',
    body: JSON.stringify({
      key: clientIp,
      windowMs: 60_000,
      max: Number(c.env.RATE_LIMIT_MAX ?? 60),
    }),
  });
  if (rlResponse.status === 429) {
    return c.json({ statusCode: 429, message: 'Too Many Requests' }, 429);
  }

  // ---- DTO validation (stub level — zod layer is task 3.1) ----
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ statusCode: 400, message: 'Request body must be JSON' }, 400);
  }
  const parsed = parseCalculateRequest(raw);
  if (!parsed.ok) {
    return c.json({ statusCode: 400, message: parsed.message }, 400);
  }
  const dto = parsed.value;

  // ---- Calculation over the real engines + D1 ports ----
  const db = drizzle(c.env.DB);
  const calculator = buildLandedCostCalculator(db);

  const input: CalculatorInput = {
    productId: dto.productId,
    quantity: dto.quantity,
    destination: dto.destination,
    ...(dto.transportMethod !== undefined
      ? { transportMethod: dto.transportMethod }
      : {}),
    ...(dto.transportArrangement !== undefined
      ? { transportArrangement: dto.transportArrangement }
      : {}),
    ...(dto.sessionId !== undefined ? { sessionId: dto.sessionId } : {}),
  };

  try {
    const result = await calculator.calculate(input);
    // Idempotency cache is out of scope for the slice — always MISS.
    c.header('X-Cache', 'MISS');
    return c.json(result);
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof NoRetailOffersError) {
      return c.json({ statusCode: 404, message: (err as Error).message }, 404);
    }
    if (err instanceof ClassificationGateRejectionError) {
      return c.json(
        {
          statusCode: 422,
          message: err.message,
          error: 'ClassificationGateRejection',
          productId: err.productId,
          reason: err.reason,
        },
        422,
      );
    }
    return c.json(
      {
        statusCode: 500,
        message:
          err instanceof Error ? err.message : 'Unexpected calculation error',
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CalculateRequestDto = {
  productId: number;
  quantity: number;
  destination: string;
  transportMethod?: string;
  transportArrangement?: TransportArrangement;
  sessionId?: string;
};

const ARRANGEMENTS: readonly TransportArrangement[] = [
  'SELLER_ARRANGED',
  'INDEPENDENT_CARRIER',
  'PERSONAL',
];

/** Minimal DTO guard for the mirrored CalculateRequest shape. */
function parseCalculateRequest(
  raw: unknown,
): { ok: true; value: CalculateRequestDto } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Request body must be an object' };
  }
  const b = raw as Record<string, unknown>;
  if (
    typeof b.productId !== 'number' ||
    !Number.isInteger(b.productId) ||
    b.productId <= 0
  ) {
    return { ok: false, message: 'productId must be a positive integer' };
  }
  if (
    typeof b.quantity !== 'number' ||
    !Number.isInteger(b.quantity) ||
    b.quantity <= 0
  ) {
    return { ok: false, message: 'quantity must be a positive integer' };
  }
  if (typeof b.destination !== 'string' || !/^[A-Z]{2}$/.test(b.destination)) {
    return {
      ok: false,
      message: 'destination must be an ISO 3166-1 alpha-2 code (e.g. "FI")',
    };
  }
  if (
    b.transportMethod !== undefined &&
    typeof b.transportMethod !== 'string'
  ) {
    return { ok: false, message: 'transportMethod must be a string' };
  }
  if (
    b.transportArrangement !== undefined &&
    !ARRANGEMENTS.includes(b.transportArrangement as TransportArrangement)
  ) {
    return {
      ok: false,
      message:
        'transportArrangement must be SELLER_ARRANGED, INDEPENDENT_CARRIER, or PERSONAL',
    };
  }
  if (b.sessionId !== undefined && typeof b.sessionId !== 'string') {
    return { ok: false, message: 'sessionId must be a string' };
  }
  return {
    ok: true,
    value: {
      productId: b.productId,
      quantity: b.quantity,
      destination: b.destination,
      ...(b.transportMethod !== undefined
        ? { transportMethod: b.transportMethod as string }
        : {}),
      ...(b.transportArrangement !== undefined
        ? { transportArrangement: b.transportArrangement as TransportArrangement }
        : {}),
      ...(b.sessionId !== undefined
        ? { sessionId: b.sessionId as string }
        : {}),
    },
  };
}

export default {
  fetch: app.fetch,
};

export { RateLimiterDO };
