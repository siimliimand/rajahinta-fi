/**
 * Integration tests for /mcp (change seo-aeo-agent-surfaces, task 3.2) —
 * the agent journey over the mounted endpoint with a harness-seeded D1
 * corpus, complementing (not repeating) the 3.1 boundary suites:
 *
 * - 3.1 (mcp.endpoint.test.ts) pins the boundary contract on minimal
 *   seeds via tool↔route parity; if both compositions drifted the same
 *   way, parity alone would stay green.
 * - This suite pins ABSOLUTE values on a richer corpus: the tools/list
 *   schemas' required fields and closed property sets, a name query
 *   that FINDS exactly the seeded product (with a second product as the
 *   negative control), registry-backed vs fail-open merchant names, a
 *   multi-unit basket computed line-for-line with the route and zero
 *   calculation_records written across the call, the gate on EVERY MCP
 *   method, and the mixed-method journey tripping the MCP rate limit.
 *
 * @module McpIntegrationTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedMarginLadder,
  seedMerchant,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../routes/__tests__/harness';
import type { Env } from '../../env';
import { MCP_SERVER_INFO, MCP_TOOL_NAMES } from '../tools';

const AGE = { 'x-age-confirmed': 'confirmed' };
const ACCEPT = { accept: 'application/json, text/event-stream' };
const JSON_HEADERS = { 'content-type': 'application/json', ...ACCEPT };

let rpcId = 0;
function jsonRpcRequest(
  method: string,
  params?: Record<string, unknown>,
): string {
  rpcId += 1;
  return JSON.stringify(
    params === undefined
      ? { jsonrpc: '2.0', id: rpcId, method }
      : { jsonrpc: '2.0', id: rpcId, method, params },
  );
}

const INIT_BODY = jsonRpcRequest('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-integration-test', version: '0.0.0' },
});

async function mcpPost(
  app: ReturnType<typeof buildApp>,
  env: Env,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(app, env, '/mcp', {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body,
  });
}

/** The confirmed MCP handshake: initialize, then the notification. */
async function handshake(
  app: ReturnType<typeof buildApp>,
  env: Env,
): Promise<void> {
  const init = await mcpPost(app, env, INIT_BODY, AGE);
  expect(init.status).toBe(200);
  const notified = await mcpPost(
    app,
    env,
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    AGE,
  );
  expect(notified.status).toBe(202);
}

async function callTool(
  app: ReturnType<typeof buildApp>,
  env: Env,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const res = await mcpPost(
    app,
    env,
    jsonRpcRequest('tools/call', { name, arguments: args }),
    AGE,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { isError?: boolean; content: { type: string; text: string }[] };
  };
  return {
    isError: body.result.isError === true,
    text: body.result.content[0]!.text,
  };
}

/** Walk a parsed payload; fail on any account-scoped key anywhere. */
function assertNoAccountScopedFields(value: unknown, path = '$'): void {
  const forbidden = /account|userid|sessionid|session_|email|password|\btoken|favorite|favourite|\balert|apikey|api_key/i;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoAccountScopedFields(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(
        forbidden.test(key),
        `account-scoped key '${key}' leaked at ${path}.${key}`,
      ).toBe(false);
      assertNoAccountScopedFields(child, `${path}.${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Seeded catalog corpus: two products so the name query proves it FINDS
// one (total === 1, negative control excluded), one registry-named
// merchant and one unregistered (display-name fail-open), two offers at
// different prices/reliabilities, and a savings snapshot so the search
// embed + savingsAsOf ride the journey.
// ---------------------------------------------------------------------------

function seedCatalogCorpus(db: Parameters<typeof seedProduct>[0]): void {
  seedProduct(db, {
    id: 1,
    name: 'Kotkan IPA',
    category: 'beer',
    alcoholByVolume: 0.055,
    unitVolume: 0.33,
    containerType: 'can',
    depositSystemStatus: 0,
  });
  seedProduct(db, {
    id: 2,
    name: 'Teerenpeli Single Malt',
    category: 'spirits',
    alcoholByVolume: 0.43,
    unitVolume: 0.5,
    containerType: 'bottle',
    depositSystemStatus: 0,
  });
  seedMerchant(db, { merchantId: 'systembolaget', name: 'Systembolaget' });
  seedOffer(db, {
    id: 11,
    productId: 1,
    merchant: 'systembolaget',
    country: 'SE',
    priceCents: 720,
    observedAt: '2026-08-06T11:00:00.000Z',
  });
  seedOffer(db, {
    id: 12,
    productId: 1,
    merchant: 'postipullo',
    country: 'EE',
    priceCents: 690,
    reliabilityStatus: 'STALE',
    observedAt: '2026-08-06T10:00:00.000Z',
  });
  db.prepare(
    `INSERT INTO savings_snapshots (
       id, as_of, product_id, category, best_merchant, best_merchant_country,
       best_price_cents, best_observed_at, alko_reference_cents,
       alko_observed_at, landed_total_cents, landed_reliability, confidence,
       gap_cents, gap_basis_points, tax_dataset_version
     ) VALUES (1, '2026-10-15', 1, 'beer', 'postipullo', 'EE', 690,
       '2026-08-06T10:00:00.000Z', 350, '2026-08-06T09:00:00.000Z', 873,
       'VERIFIED', 'HIGH', 340, 9714, 'v3.0-2026')`,
  ).run();
}

describe('/mcp integration: agent journey over the mounted endpoint', () => {
  it('walks initialize → tools/list → calls: closed set with schemas, contract rejection, and the seeded product found by name', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalogCorpus(db);
    const env = permissiveEnv(d1);
    const app = buildApp();

    // initialize — the server identity over the wire.
    const init = await mcpPost(app, env, INIT_BODY, AGE);
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as {
      result: {
        serverInfo: { name: string; version: string };
        capabilities: { tools?: unknown };
      };
    };
    expect(initBody.result.serverInfo).toEqual({
      name: MCP_SERVER_INFO.name,
      version: MCP_SERVER_INFO.version,
    });
    expect(initBody.result.capabilities.tools).toBeDefined();
    const notified = await mcpPost(
      app,
      env,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      AGE,
    );
    expect(notified.status).toBe(202);

    // tools/list — exactly the closed three, each schema fully
    // described: object type, additionalProperties false, and the
    // route-mirroring property set with its required fields.
    const list = await mcpPost(
      app,
      env,
      jsonRpcRequest('tools/list'),
      AGE,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      result: {
        tools: {
          name: string;
          inputSchema: {
            type: string;
            additionalProperties: boolean;
            required?: string[];
            properties: Record<string, unknown>;
          };
        }[];
      };
    };
    expect(listBody.result.tools.map((t) => t.name)).toEqual([
      ...MCP_TOOL_NAMES,
    ]);
    const schemaByName = new Map(
      listBody.result.tools.map((t) => [t.name, t.inputSchema] as const),
    );
    const searchSchema = schemaByName.get('search_products')!;
    expect(searchSchema.type).toBe('object');
    expect(searchSchema.additionalProperties).toBe(false);
    expect(searchSchema.required).toBeUndefined();
    expect(Object.keys(searchSchema.properties).sort()).toEqual(
      ['category', 'limit', 'page', 'q', 'sort'].sort(),
    );
    const getSchema = schemaByName.get('get_product')!;
    expect(getSchema.additionalProperties).toBe(false);
    expect(getSchema.required).toEqual(['id']);
    expect(Object.keys(getSchema.properties)).toEqual(['id']);
    const calcSchema = schemaByName.get('calculate_landed_cost')!;
    expect(calcSchema.additionalProperties).toBe(false);
    expect(calcSchema.required).toEqual(['productId', 'quantity', 'destination']);
    expect(Object.keys(calcSchema.properties).sort()).toEqual(
      [
        'productId',
        'quantity',
        'destination',
        'transportArrangement',
        'transportMethod',
      ].sort(),
    );

    // A tool outside the closed set — the contract error names the
    // valid tools, in-band at the protocol layer (no result envelope),
    // even mid-journey.
    const unknownRes = await mcpPost(
      app,
      env,
      jsonRpcRequest('tools/call', { name: 'list_accounts', arguments: {} }),
      AGE,
    );
    expect(unknownRes.status).toBe(200);
    const unknownBody = (await unknownRes.json()) as {
      error?: { code: number; message: string };
    };
    expect(unknownBody.error).toBeDefined();
    expect(unknownBody.error!.code).toBe(-32602);
    for (const name of MCP_TOOL_NAMES) {
      expect(unknownBody.error!.message).toContain(name);
    }

    // search_products by name — FINDS the seeded product: exactly one
    // hit (the spirits control excluded), with the offer aggregates and
    // the seeded savings embed riding the item.
    const search = await callTool(app, env, 'search_products', {
      q: 'kotkan',
    });
    expect(search.isError).toBe(false);
    const payload = JSON.parse(search.text) as {
      items: {
        id: number;
        name: string;
        lowestPriceCents: number | null;
        merchantCount: number;
        eurPerGram: unknown;
        savings?: Record<string, unknown>;
      }[];
      total: number;
      savingsAsOf: string | null;
    };
    expect(payload.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    const item = payload.items[0]!;
    expect(item.id).toBe(1);
    expect(item.name).toBe('Kotkan IPA');
    expect(item.lowestPriceCents).toBe(690);
    expect(item.merchantCount).toBe(2);
    expect(item.eurPerGram).toBeTypeOf('object');
    expect(payload.savingsAsOf).toBe('2026-10-15');
    expect(item.savings).toEqual({
      landedTotalCents: 873,
      alkoReferenceCents: 350,
      gapCents: 340,
      gapBasisPoints: 9714,
      reliability: 'VERIFIED',
      confidence: 'HIGH',
    });
    assertNoAccountScopedFields(payload);
  });

  it('get_product returns the page-equivalent payload: registry names, fail-open raw ids, and the reliability embed', async () => {
    const { db, d1 } = openMigratedD1();
    seedCatalogCorpus(db);
    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const routeRes = await request(app, env, '/api/v1/products/1', {
      headers: AGE,
    });
    expect(routeRes.status).toBe(200);
    const routePayload = (await routeRes.json()) as Record<string, any>;

    const tool = await callTool(app, env, 'get_product', { id: 1 });
    expect(tool.isError).toBe(false);
    const toolPayload = JSON.parse(tool.text) as Record<string, any>;

    // Absolute pins on the corpus the parity check cannot make: the
    // registry merchant resolves its display name, the unregistered one
    // fails open to the raw id, the best price is the cheaper offer,
    // and the reliability embed rides when offers exist.
    const offers = toolPayload.offers as {
      merchant: string;
      merchantName: string;
    }[];
    expect(offers).toHaveLength(2);
    const nameByMerchant = new Map(
      offers.map((o) => [o.merchant, o.merchantName] as const),
    );
    expect(nameByMerchant.get('systembolaget')).toBe('Systembolaget');
    expect(nameByMerchant.get('postipullo')).toBe('postipullo');
    expect(toolPayload.currentBestPriceCents).toBe(690);
    expect(toolPayload).toHaveProperty('merchantReliability');
    expect(toolPayload.product.updatedAt).toBeTypeOf('string');

    // Page equivalence for the same seed — same JSON, key for key.
    expect(toolPayload).toEqual(routePayload);
    assertNoAccountScopedFields(toolPayload);
  });
});

describe('/mcp integration: calculate_landed_cost on a seeded basket', () => {
  it('computes a multi-unit basket line-for-line with POST /api/v1/calculator and writes zero calculation_records', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 3, name: 'Itämeren Lager', depositSystemStatus: 0 });
    seedOffer(db, {
      id: 31,
      productId: 3,
      merchant: 'kauppa',
      country: 'DE',
      priceCents: 250,
      observedAt: '2026-08-06T10:00:00.000Z',
    });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
    });
    db.prepare(
      `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
          package_tier, price_cents, seller_involvement_indicator)
       VALUES (90, 'posti', 'DE', 'FI', 'parcel', 150, 1)`,
    ).run();
    await seedMarginLadder(db, d1);

    const countRecords = async (): Promise<number | undefined> =>
      (
        await d1
          .prepare('SELECT COUNT(*) AS n FROM calculation_records')
          .first<{ n: number }>()
      )?.n;
    const maxRecordId = async (): Promise<number | undefined> =>
      (
        await d1
          .prepare('SELECT MAX(id) AS n FROM calculation_records')
          .first<{ n: number }>()
      )?.n;

    // Baseline: only the ladder's three corpus records — the tool has
    // not run and must not add to this.
    expect(await countRecords()).toBe(3);

    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const basketArgs = { productId: 3, quantity: 6, destination: 'FI' };
    const routeRes = await request(app, env, '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify(basketArgs),
    });
    expect(routeRes.status).toBe(200);
    const routePayload = (await routeRes.json()) as Record<string, any>;

    // The route's one persisted record is the fourth row; its id is
    // exactly what the route reports.
    expect(await countRecords()).toBe(4);
    expect(routePayload.calculationRecordId).toBe(await maxRecordId());

    const tool = await callTool(
      app,
      env,
      'calculate_landed_cost',
      basketArgs,
    );
    expect(tool.isError).toBe(false);
    const toolPayload = JSON.parse(tool.text) as Record<string, any>;

    // A real basket was computed: a positive multi-unit total with an
    // itemized breakdown — not an error shell.
    expect(toolPayload.totalCents).toBeGreaterThan(0);
    expect(Array.isArray(toolPayload.itemizedCosts)).toBe(true);

    // Normalize the per-compute clock reads on BOTH sides, then require
    // line-for-line equality across every itemized cost and metadata
    // field (including the empirical margin embed).
    const normalize = (clone: Record<string, any>): void => {
      clone.metadata.calculationTimestamp = '';
      for (const line of clone.itemizedCosts ?? []) {
        if (line.category === 'importVatEstimate') line.calculatedAt = '';
      }
    };
    normalize(routePayload);
    normalize(toolPayload);
    expect(routePayload).toHaveProperty('calculationRecordId');
    expect(toolPayload).not.toHaveProperty('calculationRecordId');
    const routeRecordId = routePayload.calculationRecordId as number;
    delete routePayload.calculationRecordId;
    expect(toolPayload).toEqual(routePayload);
    assertNoAccountScopedFields(toolPayload);

    // Read-only pin across the tool call: same row count AND same
    // highest id — zero rows written, zero touched.
    expect(await countRecords()).toBe(4);
    expect(await maxRecordId()).toBe(routeRecordId);
  });
});

describe('/mcp integration: gate and rate limit across the journey', () => {
  it('an unconfirmed caller gets the gate envelope on EVERY MCP method, never figures or server metadata', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const gatedBodies: string[] = [];
    for (const body of [
      INIT_BODY,
      jsonRpcRequest('tools/list'),
      jsonRpcRequest('tools/call', {
        name: 'search_products',
        arguments: { q: 'kotkan' },
      }),
      jsonRpcRequest('tools/call', {
        name: 'calculate_landed_cost',
        arguments: { productId: 1, quantity: 6, destination: 'FI' },
      }),
    ]) {
      const res = await mcpPost(app, env, body);
      const envelope = await expectEnvelope(res, 403, {
        code: 'AGE_GATE_REQUIRED',
      });
      gatedBodies.push(JSON.stringify(envelope));
    }
    // No figures, no tool schemas, no server identity anywhere in the
    // rejections — the gate is the whole response.
    for (const raw of gatedBodies) {
      for (const leak of ['totalCents', 'itemizedCosts', 'inputSchema', 'rajahinta-api']) {
        expect(raw).not.toContain(leak);
      }
    }
  });

  it('mixed-method journey traffic trips the MCP rate limit: 30 requests pass, the 31st gets the house 429 with Retry-After', async () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1);
    const app = buildApp();

    // A realistic polling client: handshake, a listing, then repeated
    // calls — every /mcp request shares the one MCP bucket regardless
    // of method. 3 of the 30 are the handshake + list.
    const init = await mcpPost(app, env, INIT_BODY, AGE);
    expect(init.status).toBe(200);
    const notified = await mcpPost(
      app,
      env,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      AGE,
    );
    expect(notified.status).toBe(202);
    const list = await mcpPost(app, env, jsonRpcRequest('tools/list'), AGE);
    expect(list.status).toBe(200);

    // 27 more calls reach the configured 30-per-window budget; missing
    // products still answer 200 (an in-band tool error, counted like
    // any other request).
    for (let i = 0; i < 27; i += 1) {
      const res = await mcpPost(
        app,
        env,
        jsonRpcRequest('tools/call', {
          name: 'get_product',
          arguments: { id: 999 },
        }),
        AGE,
      );
      expect(res.status).toBe(200);
    }

    const rejected = await mcpPost(app, env, INIT_BODY, AGE);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('Retry-After')).toBeTruthy();
    const body = (await rejected.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 429,
      error: 'TooManyRequests',
    });
    expect(String(body.message)).toContain('Rate limit exceeded');
  });
});
