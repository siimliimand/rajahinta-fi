/**
 * ApiErrorResponse envelope conformance suite (task 3.6, change
 * technical-assessment-remediation; application-api spec "Unified error
 * envelope").
 *
 * Two layers:
 *
 *   1. Wiring — the global APP_FILTER binding on ApplicationApiModule
 *      (both the static module and forRoot) is what makes the envelope
 *      apply to every controller, legacy ones included. Removing the
 *      binding silently reverts the API to partial envelopes, so it is
 *      pinned here, not assumed.
 *   2. Conformance — representative REAL error paths (legacy calculation
 *      validation, session guard 401 variants, ops guard 403, account
 *      404 with domain context, unknown-error 500) are produced by the
 *      actual controllers/guards and pushed through the registered
 *      filter; each must parse as the documented ApiErrorResponse with
 *      consistent fields.
 *
 * @module ApiErrorEnvelopeConformanceTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { APP_FILTER } from '@nestjs/core';
import type { ArgumentsHost } from '@nestjs/common';
import {
  AlcoholExciseService,
  ContainerDutyService,
  type TaxRuleRecordPort,
  type ITaxRuleRepositoryPort,
} from '@rajahinta/core-domain';
import {
  ApplicationApiModule,
  ApiErrorFilter,
  CalculationController,
} from '../index';
import type { ApiErrorResponse } from '../interfaces';
import { OpsAccessGuard } from '../observability/ops-access.guard';
import type { CalculateLandedCostDto } from '../calculations';
import {
  createSessionHarness,
  requestWithSessionCookie,
  executionContext,
  issueSessionViaController,
  type HarnessRequest,
} from '../accounts/__tests__/session-test-harness';

// ---------------------------------------------------------------------------
// Filter driver — run a thrown error through the global filter
// ---------------------------------------------------------------------------

interface CapturedResponse {
  host: ArgumentsHost;
  statusCode(): number;
  body(): Record<string, unknown>;
}

function filterHost(path: string): CapturedResponse {
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

/** The documented envelope contract, applied to any captured error body. */
function expectEnvelope(
  captured: CapturedResponse,
  expectedStatus: number,
  expectedPath: string,
): ApiErrorResponse {
  const body = captured.body() as unknown as ApiErrorResponse;
  expect(captured.statusCode()).toBe(expectedStatus);
  expect(body.statusCode).toBe(expectedStatus);
  expect(typeof body.message).toBe('string');
  expect(body.message.length).toBeGreaterThan(0);
  expect(typeof body.error).toBe('string');
  expect(body.error.length).toBeGreaterThan(0);
  expect(typeof body.timestamp).toBe('string');
  expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  expect(body.path).toBe(expectedPath);
  return body;
}

/** Produce the exception a real error path throws. */
async function captureError(run: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected the error path to throw');
}

// ---------------------------------------------------------------------------
// Minimal real-service fixtures for the legacy calculation controller
// ---------------------------------------------------------------------------

const NO_RULE: TaxRuleRecordPort = {
  id: 1,
  taxType: 'excise',
  productCategory: 'none',
  rate: '0',
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  calculationFormulaReference: 'NONE',
  officialSource: 'fixture',
  verificationDate: new Date('2026-01-02'),
  versionLabel: 'fixture',
  exemptionConditions: null,
};

class EmptyTaxRulePort implements ITaxRuleRepositoryPort {
  async findApplicable(): Promise<TaxRuleRecordPort | null> {
    return NO_RULE;
  }
  async findAllApplicable(): Promise<TaxRuleRecordPort[]> {
    return [];
  }
  async findHistoryRates(): Promise<TaxRuleRecordPort[]> {
    return [];
  }
  async findActiveVersionLabels(): Promise<readonly string[]> {
    return ['fixture'];
  }
}

function legacyCalculationController(): CalculationController {
  const port = new EmptyTaxRulePort();
  return new CalculationController(
    new AlcoholExciseService(port),
    new ContainerDutyService(port),
  );
}

// ---------------------------------------------------------------------------
// 1. Wiring — the filter is globally registered
// ---------------------------------------------------------------------------

describe('ApiErrorFilter wiring', () => {
  it('ApplicationApiModule binds ApiErrorFilter as a global APP_FILTER', () => {
    const providers = (Reflect.getMetadata('providers', ApplicationApiModule) ??
      []) as Array<{ provide?: unknown; useClass?: unknown }>;

    const binding = providers.find((p) => p && p.provide === APP_FILTER);
    expect(binding).toBeDefined();
    expect(binding!.useClass).toBe(ApiErrorFilter);
  });

  it('ApplicationApiModule.forRoot keeps the global APP_FILTER binding', () => {
    const configured = ApplicationApiModule.forRoot({} as never);
    const providers = (configured.providers ?? []) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;

    const binding = providers.find((p) => p && p.provide === APP_FILTER);
    expect(binding).toBeDefined();
    expect(binding!.useClass).toBe(ApiErrorFilter);
  });
});

// ---------------------------------------------------------------------------
// 2. Conformance — real error paths through the registered filter
// ---------------------------------------------------------------------------

describe('ApiErrorResponse conformance — real error paths', () => {
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

  const filter = new ApiErrorFilter();

  it('legacy POST /api/v1/calculations/excise validation error → 400 envelope', async () => {
    const controller = legacyCalculationController();
    const err = await captureError(() =>
      controller.calculateExcise({
        category: 'beer',
        volumeLitres: -1,
        alcoholByVolume: 0.047,
      }),
    );

    const captured = filterHost('/api/v1/calculations/excise');
    filter.catch(err, captured.host);
    const body = expectEnvelope(captured, 400, '/api/v1/calculations/excise');
    expect(body.error).toBe('ValidationError');
    expect(body.message).toContain('volumeLitres');
  });

  it('legacy POST /api/v1/calculations/landed-cost validation error → 400 envelope', async () => {
    const controller = legacyCalculationController();
    const err = await captureError(() =>
      controller.calculateLandedCost({
        retailPriceCents: -5,
        transportCostCents: 0,
        exciseBase: null,
        containerType: null,
        containerVolumeLitres: null,
        depositSystemVerified: false,
        transactionClass: 'gift',
        // 'gift' is outside the documented union on purpose — the cast
        // lets the invalid literal reach the runtime validation.
      } as unknown as CalculateLandedCostDto),
    );

    const captured = filterHost('/api/v1/calculations/landed-cost');
    filter.catch(err, captured.host);
    const body = expectEnvelope(captured, 400, '/api/v1/calculations/landed-cost');
    expect(body.message).toContain('retailPriceCents');
    expect(body.message).toContain('transactionClass');
  });

  it('SessionAuthGuard without a cookie → 401 SessionRequired envelope', async () => {
    const harness = createSessionHarness();
    const err = await captureError(() =>
      harness.guard.canActivate(executionContext(requestWithSessionCookie(undefined))),
    );

    const captured = filterHost('/api/v1/account/export');
    filter.catch(err, captured.host);
    const body = expectEnvelope(captured, 401, '/api/v1/account/export');
    expect(body.error).toBe('SessionRequired');
  });

  it('SessionAuthGuard with a guessed token → 401 InvalidSession envelope', async () => {
    const harness = createSessionHarness();
    const err = await captureError(() =>
      harness.guard.canActivate(
        executionContext(requestWithSessionCookie('guessed-token-value')),
      ),
    );

    const captured = filterHost('/api/v1/account/baskets');
    filter.catch(err, captured.host);
    const body = expectEnvelope(captured, 401, '/api/v1/account/baskets');
    expect(body.error).toBe('InvalidSession');
  });

  it('SessionAuthGuard with the legacy x-user-id header → 401 envelope', async () => {
    const harness = createSessionHarness();
    const err = await captureError(() =>
      harness.guard.canActivate(
        executionContext(
          requestWithSessionCookie(undefined, { 'x-user-id': 'someone' }),
        ),
      ),
    );

    const captured = filterHost('/api/v1/account/history');
    filter.catch(err, captured.host);
    const body = expectEnvelope(captured, 401, '/api/v1/account/history');
    expect(body.error).toBe('LegacyUserIdHeaderRejected');
  });

  it('OpsAccessGuard unconfigured → 403 envelope with no operational data', async () => {
    const guard = new OpsAccessGuard(); // env cleared in beforeEach
    const err = await captureError(() =>
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ ip: '203.0.113.9' }) }),
      } as never),
    );

    const captured = filterHost('/ops/health');
    filter.catch(err, captured.host);
    expectEnvelope(captured, 403, '/ops/health');
  });

  it('AccountController missing-basket 404 keeps its domain context in the envelope', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);
    const request: HarnessRequest = requestWithSessionCookie(token);
    await harness.guard.canActivate(executionContext(request));

    const missingBasketId = '11111111-2222-3333-4444-555555555555';
    const err = await captureError(() =>
      harness.accountController.deleteBasket(request.user!, missingBasketId),
    );

    const captured = filterHost(`/api/v1/account/baskets/${missingBasketId}`);
    filter.catch(err, captured.host);
    const body = expectEnvelope(
      captured,
      404,
      `/api/v1/account/baskets/${missingBasketId}`,
    );
    // Domain context from the throw site survives alongside the envelope.
    expect(body.error).toBe('BasketNotFound');
    expect(body.message).toContain(missingBasketId);
  });

  it('unknown errors collapse to a generic 500 envelope with no internals', () => {
    const captured = filterHost('/api/v1/somewhere');
    filter.catch(
      new Error('boom: postgres://user:secret@db-host:5432/prod'),
      captured.host,
    );

    const body = expectEnvelope(captured, 500, '/api/v1/somewhere');
    expect(body.message).toBe('Internal server error');
    expect(body.error).toBe('InternalServerError');
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
