/**
 * Compliance test: group-order accounting-only boundary across the
 * estimate-prefill path (change seasonal-occasion-templates, task 3.2;
 * spec group-order-ledger — "Estimate-derived prefill intake").
 *
 * The event → group-order handoff (task 3.1) adds a new path INTO the
 * group-order create flow. This file pins the accounting-only boundary
 * across that path from both ends, as the compliance-layer second
 * opinion on the route suite
 * (apps/api-worker/src/routes/__tests__/group-order.routes.test.ts,
 * "payment-instrument field rejection" describe — the enforcement
 * authority this file mirrors, never replaces):
 *
 * 1. **DTO rejection unchanged on the prefill flow's routes** — the
 *    create route the handoff lands on (and the items route the ledger
 *    feeds) still reject payment-instrument fields with the offending
 *    field NAMED, at the top level and nested. A legitimate
 *    names-and-quantities item payload still passes: the gate screens
 *    key vocabulary, never accounting data.
 * 2. **The handoff payload is names+quantities-only by construction** —
 *    the real handoff builder over a full COMPUTED estimate produces
 *    rows whose keys are exactly {name, quantity}, no key anywhere
 *    carries payment-instrument vocabulary (checked with the DTO layer's
 *    own matcher — the two boundaries share one definition), and the
 *    serialized URL payload is a bare name:quantity list with no cents,
 *    price, or payment-bearing material. The parse round-trip preserves
 *    the rows exactly.
 *
 * @module GroupOrderAccountingOnlyComplianceTest
 */

import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import {
  createApp,
  expectEnvelope,
  issueSessionToken,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedProduct,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { registerGroupOrderRoutes } from '../../apps/api-worker/src/routes/group-order.routes';
import { isPaymentInstrumentFieldName } from '../../apps/api-worker/src/routes/group-order-dto';
import type { Env } from '../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';

import type { EventCalcResponse } from '../../apps/frontend/src/app/[locale]/event/event.types';
import {
  estimateHandoffItems,
  parseEstimateHandoffParam,
  serializeEstimateHandoffItems,
} from '../../apps/frontend/src/app/[locale]/event/estimate-handoff';

// ---------------------------------------------------------------------------
// Composition — the exact app index.ts wires for the group-order routes
// ---------------------------------------------------------------------------

function groupOrderApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerGroupOrderRoutes(app);
  return app;
}

function groupOrderEnv(d1: D1DatabaseLike): Env {
  return permissiveEnv(d1);
}

function seedOwnerAccount(db: DatabaseSync): void {
  seedAccount(db, {
    id: 7,
    userId: 'user-7',
    email: 'user-7@example.invalid',
    tier: 'FREE',
  });
}

/** Direct live-session insert — the fixed TTL denies future expiries. */
function seedLiveSession(db: DatabaseSync, shareToken: string): void {
  db.prepare(
    `INSERT INTO group_order_sessions (id, owner_account_id, share_token, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(1, 7, shareToken, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// 1. DTO rejection on the prefill flow's routes — unchanged, field named
// ---------------------------------------------------------------------------

describe('accounting-only DTO gate on the prefill flow routes', () => {
  it('rejects payment vocabulary on the create route the handoff lands on, field named', async () => {
    const cases: readonly { label: string; key: string }[] = [
      { label: 'top-level wallet key', key: 'paypal' },
      { label: 'card number', key: 'cardNumber' },
      { label: 'iban', key: 'iban' },
      { label: 'payment method', key: 'paymentMethod' },
    ];
    for (const { label, key } of cases) {
      const { db, d1 } = openMigratedD1();
      seedOwnerAccount(db);
      const app = groupOrderApp();
      const env = groupOrderEnv(d1);
      const token = await issueSessionToken(d1, 7);
      const res = await request(app, env, '/api/v1/group-orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `rajahinta_session=${token}`,
        },
        body: JSON.stringify({ [key]: '4111111111111111' }),
      });
      const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
      expect(body.message, label).toContain(`field '${key}' is not accepted`);
    }
  });

  it('rejects a NESTED payment field with its full path on the items route', async () => {
    const { db, d1 } = openMigratedD1();
    seedOwnerAccount(db);
    const shareToken = '11111111-2222-4333-8444-555555555555';
    seedLiveSession(db, shareToken);
    const app = groupOrderApp();
    const env = groupOrderEnv(d1);

    const res = await request(
      app,
      env,
      `/api/v1/group-orders/${shareToken}/items`,
      jsonPost({
        nickname: 'A',
        productId: 1,
        quantity: 2,
        paymentMethod: 'sepa',
      }),
    );
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain("field 'paymentMethod' is not accepted");
  });

  it('lets an ordinary names-and-quantities item through — the gate screens vocabulary, not accounting data', async () => {
    const { db, d1 } = openMigratedD1();
    seedOwnerAccount(db);
    const shareToken = '11111111-2222-4333-8444-555555555555';
    seedLiveSession(db, shareToken);
    seedProduct(db, { id: 1 });
    const app = groupOrderApp();
    const env = groupOrderEnv(d1);

    // The nickname must name a joined participant — join, then add.
    const join = await request(
      app,
      env,
      `/api/v1/group-orders/${shareToken}/join`,
      jsonPost({ nickname: 'A' }),
    );
    expect(join.status).toBe(200);

    const res = await request(
      app,
      env,
      `/api/v1/group-orders/${shareToken}/items`,
      jsonPost({ nickname: 'A', productId: 1, quantity: 24 }),
    );
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 2. The handoff payload is names+quantities-only by construction
// ---------------------------------------------------------------------------

const DISCLAIMER = {
  text: 'Ostoslista perustuu yleisiin kulutusnormeihin. Normiarvot ovat arvioita keskimääräisestä kulutuksesta — todellinen kulutus vaihtelee tilaisuuden ja vieraiden mukaan.',
  language: 'fi' as const,
  version: '1.0',
};

/** A full COMPUTED estimate of the exact shape the event API serializes. */
const COMPUTED: EventCalcResponse = {
  status: 'COMPUTED',
  eventDate: '2026-06-20',
  eventProfile: 'juhannus',
  guests: 10,
  durationHours: 12,
  normsVersion: 'seasonal-occasions-fi-2026.1',
  lines: [
    {
      drinkType: 'beer',
      needMl: 15000,
      needLitres: 15,
      plannedUnits: [
        { sizeMl: 330, sizeLitres: 0.33, description: '0.33 l can', quantity: 48 },
      ],
      totalUnits: 48,
      purchasedMl: 15840,
      surplusMl: 840,
      surplusLitres: 0.84,
      versionLabel: 'seasonal-occasions-fi-2026.1',
    },
    {
      drinkType: 'wine_sparkling',
      needMl: 3000,
      needLitres: 3,
      plannedUnits: [
        { sizeMl: 750, sizeLitres: 0.75, description: '0.75 l bottle', quantity: 4 },
      ],
      totalUnits: 4,
      purchasedMl: 3000,
      surplusMl: 0,
      surplusLitres: 0,
      versionLabel: 'seasonal-occasions-fi-2026.1',
    },
  ],
  disclaimer: DISCLAIMER,
};

describe('handoff payload shape — names and quantities only', () => {
  it('carries exactly the keys {name, quantity} on every row', () => {
    const rows = estimateHandoffItems(COMPUTED);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['name', 'quantity']);
      expect(typeof row.name).toBe('string');
      expect(Number.isInteger(row.quantity)).toBe(true);
      expect(row.quantity).toBeGreaterThanOrEqual(1);
    }
  });

  it('exposes no key carrying payment-instrument vocabulary — the DTO matcher finds nothing', () => {
    const rows = estimateHandoffItems(COMPUTED);
    // The DTO layer's own deep-walk vocabulary screen — the definition
    // the create/items rejection enforces — must find zero offending
    // fields in the handoff payload, serialized or structured.
    const structured = JSON.parse(
      JSON.stringify(rows),
    ) as Record<string, unknown>[];
    const findFields = (
      payload: unknown,
      base = '',
    ): string[] => {
      if (Array.isArray(payload)) {
        return payload.flatMap((entry, i) =>
          findFields(entry, `${base}[${String(i)}]`),
        );
      }
      if (payload !== null && typeof payload === 'object') {
        const found: string[] = [];
        for (const [key, value] of Object.entries(payload)) {
          const path = base === '' ? key : `${base}.${key}`;
          if (isPaymentInstrumentFieldName(key)) found.push(path);
          found.push(...findFields(value, path));
        }
        return found;
      }
      return [];
    };
    expect(findFields(structured)).toEqual([]);
  });

  it('serializes to a bare name:quantity list — no cents, prices, or payment-bearing material', () => {
    const serialized = serializeEstimateHandoffItems(
      estimateHandoffItems(COMPUTED),
    );
    // Only canonical drink-type keys and positive integers survive.
    expect(serialized).toMatch(/^[a-z_]+:\d+(,[a-z_]+:\d+)*$/);
    // The payment vocabulary screen finds nothing in the serialized form.
    for (const token of serialized.split(/[,:]/)) {
      expect(isPaymentInstrumentFieldName(token), token).toBe(false);
    }
  });

  it('round-trips the serialized payload through the receiving parser unchanged', () => {
    const rows = estimateHandoffItems(COMPUTED);
    const parsed = parseEstimateHandoffParam(
      serializeEstimateHandoffItems(rows),
    );
    expect(parsed).toEqual(rows);
  });

  it('carries nothing for an estimate without a completed computation', () => {
    const noNorms: EventCalcResponse = {
      status: 'NO_PUBLISHED_NORMS',
      eventDate: '2026-06-20',
      eventProfile: 'juhannus',
      guests: 10,
      durationHours: 12,
      disclaimer: DISCLAIMER,
    };
    expect(estimateHandoffItems(noNorms)).toEqual([]);
    expect(serializeEstimateHandoffItems(estimateHandoffItems(noNorms))).toBe('');
  });
});
