/**
 * OpsDashboardController tests — the ops route denies outside the
 * allowlist (task 3.6, change technical-assessment-remediation).
 *
 * The guard itself is unit-tested in ops-access.guard.test.ts; these
 * tests pin the ROUTE contract: GET /ops/health carries OpsAccessGuard,
 * the dashboard snapshot is produced only when the guard admits, and a
 * denial crossed with the global ApiErrorFilter comes out as the
 * documented ApiErrorResponse envelope (statusCode/error/timestamp/path).
 *
 * Direct construction with the real OpsDashboardService over the real
 * KpiService (package convention: real engines, plain context doubles).
 *
 * @module OpsDashboardControllerTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, type ArgumentsHost } from '@nestjs/common';
import { OpsDashboardController } from '../ops-dashboard.controller';
import { OpsDashboardService } from '../ops-dashboard.service';
import { OpsAccessGuard } from '../ops-access.guard';
import { KpiService } from '../kpi.service';
import { ApiErrorFilter } from '../../common/api-error.filter';
import type { ApiErrorResponse } from '../../interfaces';

/** NestJS internal metadata key written by the `@UseGuards` decorator. */
const GUARDS_METADATA = '__guards__';

const OPS_ROUTE_PATH = '/ops/health';

/** Request shape the guard reads (socket address + headers). */
interface OpsRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** Execution context double carrying the request to the guard. */
function guardContext(request: OpsRequest) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

/**
 * Run one request through the route's access pipeline the way the Nest
 * adapter would: guard first, controller only on admission. Returns the
 * dashboard snapshot on success; rethrows the guard's denial.
 */
function requestOpsDashboard(
  guard: OpsAccessGuard,
  controller: OpsDashboardController,
  request: OpsRequest,
): unknown {
  // Throws ForbiddenException on denial — the controller must never run.
  guard.canActivate(guardContext(request));
  return controller.getHealth();
}

/** Response-capturing ArgumentsHost double for the global error filter. */
function filterHost(path: string): {
  host: ArgumentsHost;
  statusCode(): number;
  body(): Record<string, unknown>;
} {
  let statusCode = -1;
  let json: Record<string, unknown> = {};
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (code: number) => {
          statusCode = code;
        },
        json: (b: Record<string, unknown>) => {
          json = b;
        },
      }),
      getRequest: () => ({ url: path }),
    }),
  } as unknown as ArgumentsHost;
  return { host, statusCode: () => statusCode, body: () => json };
}

function createController(): OpsDashboardController {
  return new OpsDashboardController(new OpsDashboardService(new KpiService()));
}

describe('OpsDashboardController — GET /ops/health access', () => {
  const ENV_TOKEN = process.env.OPS_BEARER_TOKEN;
  const ENV_ALLOWLIST = process.env.OPS_IP_ALLOWLIST;

  beforeEach(() => {
    delete process.env.OPS_BEARER_TOKEN;
    delete process.env.OPS_IP_ALLOWLIST;
  });

  afterEach(() => {
    if (ENV_TOKEN === undefined) delete process.env.OPS_BEARER_TOKEN;
    else process.env.OPS_BEARER_TOKEN = ENV_TOKEN;
    if (ENV_ALLOWLIST === undefined) delete process.env.OPS_IP_ALLOWLIST;
    else process.env.OPS_IP_ALLOWLIST = ENV_ALLOWLIST;
  });

  it('carries OpsAccessGuard at the class level (route cannot be mounted unguarded)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OpsDashboardController) as unknown[];
    expect(guards).toContain(OpsAccessGuard);
  });

  it('fails closed when unconfigured — no snapshot, ForbiddenException', () => {
    const guard = new OpsAccessGuard(); // env cleared in beforeEach
    const controller = createController();

    expect(() =>
      requestOpsDashboard(guard, controller, { ip: '127.0.0.1' }),
    ).toThrow(ForbiddenException);
  });

  it('denies a request with no bearer token when a token is configured', () => {
    const guard = new OpsAccessGuard({
      bearerToken: 'ops-secret',
      allowlist: [],
    });
    const controller = createController();

    expect(() =>
      requestOpsDashboard(guard, controller, { ip: '10.0.0.5', headers: {} }),
    ).toThrow(ForbiddenException);
  });

  it('denies a wrong bearer token', () => {
    const guard = new OpsAccessGuard({
      bearerToken: 'ops-secret',
      allowlist: [],
    });
    const controller = createController();

    expect(() =>
      requestOpsDashboard(guard, controller, {
        ip: '10.0.0.5',
        headers: { authorization: 'Bearer not-the-secret' },
      }),
    ).toThrow(ForbiddenException);
  });

  it('denies an IP outside the allowlist even with the correct token', () => {
    const guard = new OpsAccessGuard({
      bearerToken: 'ops-secret',
      allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
    });
    const controller = createController();

    expect(() =>
      requestOpsDashboard(guard, controller, {
        ip: '203.0.113.9',
        headers: { authorization: 'Bearer ops-secret' },
      }),
    ).toThrow(ForbiddenException);
  });

  it('a spoofed X-Forwarded-For does not grant allowlist membership', () => {
    // The guard derives the client address from the socket (`request.ip`)
    // only — the same origin-trust rule the rate limiter applies. A client
    // outside the allowlist cannot header-spoof its way in.
    const guard = new OpsAccessGuard({
      bearerToken: null,
      allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
    });
    const controller = createController();

    expect(() =>
      requestOpsDashboard(guard, controller, {
        ip: '203.0.113.9',
        headers: { 'x-forwarded-for': '10.0.0.5' },
      }),
    ).toThrow(ForbiddenException);
  });

  it('admits a request satisfying both controls and returns the snapshot', () => {
    const guard = new OpsAccessGuard({
      bearerToken: 'ops-secret',
      allowlist: [{ kind: 'cidr', address: (10 << 24) | 0, prefixBits: 24 }],
    });
    const controller = createController();

    const snapshot = requestOpsDashboard(guard, controller, {
      ip: '10.0.0.42',
      headers: { authorization: 'Bearer ops-secret' },
    }) as ReturnType<OpsDashboardService['getDashboardSnapshot']>;

    // Documented DashboardSnapshot shape — operational data reaches only
    // admitted callers.
    expect(typeof snapshot.staleDataRate).toBe('number');
    expect(snapshot.verifiedCalculationPercentage).toMatchObject({
      total: expect.any(Number),
      verified: expect.any(Number),
      percentage: expect.any(Number),
    });
    expect(Array.isArray(snapshot.complianceIncidents)).toBe(true);
    expect(typeof snapshot.timestamp).toBe('string');
  });
});

describe('OpsDashboardController — denial envelope conformance', () => {
  it('a guard denial surfaces as the ApiErrorResponse envelope through the global filter', () => {
    const guard = new OpsAccessGuard(); // unconfigured → fail closed
    const h = filterHost(OPS_ROUTE_PATH);

    let denial: unknown;
    try {
      guard.canActivate(guardContext({ ip: '203.0.113.9' }));
      expect.unreachable('guard must deny');
    } catch (err) {
      denial = err;
    }

    new ApiErrorFilter().catch(denial, h.host);

    expect(h.statusCode()).toBe(403);
    const body = h.body() as unknown as ApiErrorResponse;
    expect(body.statusCode).toBe(403);
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(typeof body.error).toBe('string');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.path).toBe(OPS_ROUTE_PATH);
    // Operational denial must not leak which control failed or any
    // dashboard internals.
    expect(JSON.stringify(body)).not.toContain('staleDataRate');
    expect(JSON.stringify(body)).not.toContain('OPS_BEARER_TOKEN');
  });
});
