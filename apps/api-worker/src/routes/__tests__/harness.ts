/**
 * Shared harness for the route-port parity tests (tasks 3.5–3.8).
 *
 * Composes the FULL createApp() (guards + routes + error envelope) over
 * the fake-D1 harness (node:sqlite in-memory + committed migrations) and
 * in-memory Durable Object namespaces for RateLimiterDO / IdempotencyDO /
 * ClickCounterDO, then drives it with app.request() exactly like the
 * guard-middleware harnesses. Fixtures seed the real D1 repositories'
 * tables.
 *
 * @module RouteTestHarness
 */

import type { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';
import type { AppEnv, Env } from '../../env';
import { createApp } from '../../index';
import { RateLimiterDO } from '../../do/rate-limiter.do';
import { IdempotencyDO } from '../../do/idempotency.do';
import { ClickCounterDO } from '../../do/click-counter.do';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { FAKE_OPS_TOKEN, mintOpaqueToken } from '../../middleware/__tests__/guard-test-fixtures';
import { hashToken } from '../../auth/session-resolver';
import { D1SessionRepository } from '../../../../../packages/data-platform/src/repositories/d1/session.repository';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

export { openMigratedD1 };
export { FAKE_OPS_TOKEN };

// ---------------------------------------------------------------------------
// In-memory DO namespace — the structural binding shape the DO client uses
// ---------------------------------------------------------------------------

interface DoState {
  readonly storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
}

function createMemoryState(): DoState {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    async get<T>(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    async put<T>(key: string, value: T) {
      map.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return map.delete(key);
    },
    async list<T>(options?: { prefix?: string }) {
      const result = new Map<string, T>();
      for (const [key, value] of map) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, structuredClone(value) as T);
        }
      }
      return result;
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(time: number) {
      alarm = time;
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
  return { storage };
}

/**
 * One DO class instance per idFromName, constructed lazily on first fetch
 * — the namespace/stub surface do/client.ts drives.
 */
export function createDoNamespace<
  T extends { fetch(request: Request): Promise<Response> },
>(makeInstance: (state: DoState) => T): {
  idFromName(name: string): { name: string };
  get(id: { name: string }): { fetch(request: Request): Promise<Response> };
} {
  const instances = new Map<string, T>();
  return {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      let instance = instances.get(id.name);
      if (instance === undefined) {
        instance = makeInstance(createMemoryState());
        instances.set(id.name, instance);
      }
      return { fetch: (request: Request) => instance!.fetch(request) };
    },
  };
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

/** Permissive env — gates open, flags on, ops configured, DOs bound. */
export function permissiveEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return {
    DB: d1 as unknown as Env['DB'],
    LOG_LEVEL: 'error',
    LAUNCH_GATES_OVERRIDE: 'true',
    FF_BASKET_OPTIMIZATION: 'true',
    FF_ADVANCED_FEATURES: 'true',
    FF_HISTORICAL_PRICE_INTELLIGENCE: 'true',
    FF_OPERATOR_CONSOLE: 'true',
    OPS_BEARER_TOKEN: FAKE_OPS_TOKEN,
    RATE_LIMITER: rateLimiterNamespace(),
    IDEMPOTENCY: idempotencyNamespace(),
    CLICK_COUNTER: clickCounterNamespace(),
    ...overrides,
  } as Env;
}

/** Locked-down env — gates closed, flags off, DOs still bound. */
export function lockedEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, {
    LAUNCH_GATES_OVERRIDE: undefined,
    FF_BASKET_OPTIMIZATION: undefined,
    FF_ADVANCED_FEATURES: undefined,
    FF_HISTORICAL_PRICE_INTELLIGENCE: undefined,
    FF_OPERATOR_CONSOLE: undefined,
    OPS_BEARER_TOKEN: undefined,
    ...overrides,
  });
}

// Fresh DO namespaces per harness call — tests construct envs per case.
export function rateLimiterNamespace(): unknown {
  return createDoNamespace((state) => new RateLimiterDO(state as never, {}));
}

export function idempotencyNamespace(): unknown {
  return createDoNamespace((state) => new IdempotencyDO(state as never, {}));
}

export function clickCounterNamespace(): unknown {
  return createDoNamespace((state) => new ClickCounterDO(state as never, {}));
}

// ---------------------------------------------------------------------------
// App + request
// ---------------------------------------------------------------------------

/** Build the full app with a per-request env override hook. */
export function buildApp(): ReturnType<typeof createApp> {
  return createApp();
}

export { createApp };

export async function request(
  app: ReturnType<typeof createApp>,
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return (await app.request(path, init, env)) as Response;
}

/** Assert the unified error envelope (ApiErrorFilter parity). */
export async function expectEnvelope(
  res: Response,
  status: number,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    statusCode: status,
    timestamp: expect.any(String),
    path: expect.any(String),
    ...fields,
  });
  return body;
}

// ---------------------------------------------------------------------------
// Session seeding — real D1 session repository (guard-harness parity)
// ---------------------------------------------------------------------------

export function seedAccount(
  db: DatabaseSync,
  account: { id: number; userId: string; email: string; tier: string },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, user_id, email, tier, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(account.id, account.userId, account.email, account.tier, now, now);
}

export async function issueSessionToken(
  d1: D1DatabaseLike,
  accountId: number,
  ttlMs = 3_600_000,
): Promise<string> {
  const token = mintOpaqueToken();
  const repo = new D1SessionRepository(d1);
  await repo.create({
    tokenHash: await hashToken(token),
    accountId,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

// ---------------------------------------------------------------------------
// Domain fixtures
// ---------------------------------------------------------------------------

/** Insert a product_master row and return its id. */
export function seedProduct(
  db: DatabaseSync,
  product: {
    id?: number;
    name?: string;
    manufacturer?: string;
    brand?: string;
    category?: string;
    alcoholByVolume?: number | null;
    unitVolume?: number;
    containerType?: string;
    regulatoryClassification?: string;
    depositSystemStatus?: number | null;
  } = {},
): number {
  const id = product.id ?? 1;
  db.prepare(
    `INSERT INTO product_master (
       id, name, manufacturer, brand, category, alcohol_by_volume,
       unit_volume, container_type, regulatory_classification,
       deposit_system_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    product.name ?? 'Karhu III',
    product.manufacturer ?? 'Hartwall',
    product.brand ?? 'Hartwall',
    product.category ?? 'beer',
    // `=== undefined` (not ??) so an explicit null seeds a real NULL
    // alcohol_by_volume row (the missing-alcohol metric path).
    product.alcoholByVolume === undefined ? 0.047 : product.alcoholByVolume,
    product.unitVolume ?? 0.33,
    product.containerType ?? 'can',
    product.regulatoryClassification ?? 'beer',
    product.depositSystemStatus === undefined ? 1 : product.depositSystemStatus,
  );
  return id;
}

/** Insert a retail_offers row and return its id. */
export function seedOffer(
  db: DatabaseSync,
  offer: {
    id?: number;
    productId: number;
    merchant?: string;
    country?: string;
    priceCents?: number;
    availability?: string;
    sourceUrl?: string | null;
    reliabilityStatus?: string;
    observedAt?: string;
  },
): number {
  const id = offer.id ?? offer.productId * 10 + 1;
  db.prepare(
    `INSERT INTO retail_offers (
       id, merchant, country, product_id, price_cents, currency,
       availability, source_url, observed_at, reliability_status
     ) VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?)`,
  ).run(
    id,
    offer.merchant ?? 'alko',
    offer.country ?? 'FI',
    offer.productId,
    offer.priceCents ?? 350,
    offer.availability ?? 'in_stock',
    offer.sourceUrl === undefined ? 'https://example.invalid/offer' : offer.sourceUrl,
    offer.observedAt ?? new Date().toISOString(),
    offer.reliabilityStatus ?? 'VERIFIED',
  );
  return id;
}

/** Insert an active tax rule and return its id. */
export function seedTaxRule(
  db: DatabaseSync,
  rule: {
    id?: number;
    taxType: string;
    productCategory: string;
    rate: number;
    versionLabel?: string;
    verified?: boolean;
    /** Calculation formula the engine keys on; excise defaults to the
     *  per-centilitre-ethanol formula, container duty to the flat per-litre. */
    formula?: string;
  },
): number {
  const id = rule.id ?? 1;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tax_rules (
       id, tax_type, product_category, rate, effective_from, effective_to,
       exemption_conditions, calculation_formula_reference, official_source,
       verification_date, version_label, created_at
     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'vero.fi', ?, ?, ?)`,
  ).run(
    id,
    rule.taxType,
    rule.productCategory,
    rule.rate,
    '2026-01-01T00:00:00.000Z',
    rule.formula ??
      (rule.taxType === 'container_duty' ? 'FLAT_PER_LITRE' : 'PER_CENTILITRE_ETHANOL'),
    rule.verified === false ? null : now,
    rule.versionLabel ?? 'v3.0-2026',
    now,
  );
  return id;
}

/** Insert a minimal persisted calculation record and return its id. */
export function seedCalculationRecord(
  db: DatabaseSync,
  record: {
    id?: number;
    productMasterId: number;
    totalCents?: number;
    confidence?: string;
    quantity?: number;
    sessionId?: string | null;
    exciseRuleVersionId?: number | null;
    containerDutyRuleVersionId?: number | null;
  },
): number {
  const id = record.id ?? 1;
  const breakdown = JSON.stringify([
    { label: 'Retail price', category: 'foreignRetailPrice', cents: 350, reliability: 'VERIFIED' },
    { label: 'Transport', category: 'transportCost', cents: 500, reliability: 'ESTIMATED' },
    { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 6, reliability: 'VERIFIED' },
    { label: 'Container duty', category: 'containerDutyEstimate', cents: 17, reliability: 'ESTIMATED' },
  ]);
  const disclaimer = JSON.stringify({
    text: 'Hinnat ovat arvioita.',
    language: 'fi',
    version: '1.0',
  });
  db.prepare(
    `INSERT INTO calculation_records (
       id, product_master_id, retail_offer_ids, transport_offer_id,
       excise_rule_version_id, container_duty_rule_version_id, total_cents,
       breakdown, confidence, quantity, destination, disclaimer, session_id,
       calculated_at
     ) VALUES (?, ?, '[]', NULL, ?, ?, ?, ?, ?, ?, 'FI', ?, ?, ?)`,
  ).run(
    id,
    record.productMasterId,
    record.exciseRuleVersionId ?? null,
    record.containerDutyRuleVersionId ?? null,
    record.totalCents ?? 873,
    breakdown,
    record.confidence ?? 'MEDIUM',
    record.quantity ?? 1,
    disclaimer,
    record.sessionId ?? null,
    new Date().toISOString(),
  );
  return id;
}

/** AppEnv typed view for handlers under test. */
export type { AppEnv };
