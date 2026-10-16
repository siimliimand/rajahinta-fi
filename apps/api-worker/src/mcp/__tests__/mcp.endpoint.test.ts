/**
 * Endpoint tests for /mcp (change seo-aeo-agent-surfaces, spec
 * agent-tool-surface) — the full harness composition (createApp + fake
 * D1 + in-memory DOs) driving the real endpoint:
 *
 * - the age-gate contract at the boundary: unconfirmed callers get the
 *   gate error for EVERY MCP method, never figures (spec scenario
 *   "Unconfirmed caller gets the gate, not data");
 * - the closed tool list over the wire, and the unknown-tool contract
 *   error naming the valid tools;
 * - payload parity with the public routes the tools mirror;
 * - the read-only posture: a tool call persists nothing;
 * - house rate limiting (MCP profile) at the boundary.
 *
 * @module McpEndpointTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
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
import { MCP_TOOL_NAMES } from '../tools';

const AGE = { 'x-age-confirmed': 'confirmed' };
const ACCEPT = { accept: 'application/json, text/event-stream' };
const JSON_HEADERS = { 'content-type': 'application/json', ...ACCEPT };

function jsonRpcRequest(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): string {
  return JSON.stringify(
    params === undefined
      ? { jsonrpc: '2.0', id, method }
      : { jsonrpc: '2.0', id, method, params },
  );
}

const INIT_BODY = jsonRpcRequest(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-endpoint-test', version: '0.0.0' },
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

describe('/mcp boundary: the age gate (spec: gate semantics preserved)', () => {
  it('an unconfirmed initialize gets the gate error, not server metadata', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await mcpPost(app, permissiveEnv(d1), INIT_BODY);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 403,
      code: 'AGE_GATE_REQUIRED',
      message:
        'Age confirmation required. Please confirm your age via the age-gate prompt.',
    });
    expect(JSON.stringify(body)).not.toContain('rajahinta-api');
  });

  it('an unconfirmed calculate_landed_cost call gets the gate — never figures', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await mcpPost(
      app,
      permissiveEnv(d1),
      jsonRpcRequest(7, 'tools/call', {
        name: 'calculate_landed_cost',
        arguments: { productId: 1, quantity: 1, destination: 'FI' },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'AGE_GATE_REQUIRED' });
    // No computed figures ride the rejection.
    const raw = JSON.stringify(body);
    for (const figure of ['totalCents', 'itemizedCosts', 'excise', 'result']) {
      expect(raw).not.toContain(figure);
    }
  });

  it('the cookie jar counts as confirmation, exactly like the routes', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await mcpPost(app, permissiveEnv(d1), INIT_BODY, {
      cookie: 'age_confirmed=1',
    });
    expect(res.status).toBe(200);
  });
});

describe('/mcp closed tool surface (spec: closed set over the wire)', () => {
  it('tools/list returns exactly the pinned three tools with input schemas', async () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const res = await mcpPost(app, env, jsonRpcRequest(2, 'tools/list'), AGE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('an unknown tool name is rejected with the contract error naming the valid tools', async () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const res = await mcpPost(
      app,
      env,
      jsonRpcRequest(3, 'tools/call', { name: 'fetch_account', arguments: {} }),
      AGE,
    );
    expect(res.status).toBe(200); // protocol-level error, in-band
    const body = (await res.json()) as {
      error?: { code: number; message: string };
    };
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe(-32602);
    for (const name of MCP_TOOL_NAMES) {
      expect(body.error!.message).toContain(name);
    }
  });

  it('GET is not a registered method on the stateless JSON surface', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/mcp', {
      method: 'GET',
      headers: { ...ACCEPT, ...AGE },
    });
    // House 404 envelope — no server-initiated stream exists to listen on.
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: 'Not Found' });
  });
});

describe('/mcp payload parity with the public routes', () => {
  it('get_product returns the page-equivalent public payload for a seeded product', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', depositSystemStatus: 0 });
    seedMerchant(db, { merchantId: 'alko', name: 'Alko' });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'alko',
      priceCents: 350,
      observedAt: '2026-08-06T10:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'kauppa',
      priceCents: 320,
      observedAt: '2026-08-06T11:00:00.000Z',
    });

    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const routeRes = await request(app, env, '/api/v1/products/1', {
      headers: AGE,
    });
    expect(routeRes.status).toBe(200);
    const routePayload = (await routeRes.json()) as unknown;

    const toolRes = await mcpPost(
      app,
      env,
      jsonRpcRequest(4, 'tools/call', { name: 'get_product', arguments: { id: 1 } }),
      AGE,
    );
    expect(toolRes.status).toBe(200);
    const toolBody = (await toolRes.json()) as {
      result: { content: { type: string; text: string }[] };
    };
    const toolPayload = JSON.parse(toolBody.result.content[0]!.text) as unknown;

    expect(toolPayload).toEqual(routePayload);
    assertNoAccountScopedFields(toolPayload);
  });

  it('get_product not-found carries the route-parity message as a tool error', async () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const toolRes = await mcpPost(
      app,
      env,
      jsonRpcRequest(5, 'tools/call', {
        name: 'get_product',
        arguments: { id: 999 },
      }),
      AGE,
    );
    const toolBody = (await toolRes.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(toolBody.result.isError).toBe(true);
    expect(toolBody.result.content[0]!.text).toBe('Product 999 not found');

    const routeRes = await request(app, env, '/api/v1/products/999', {
      headers: AGE,
    });
    expect(routeRes.status).toBe(404);
    expect(((await routeRes.json()) as { message: string }).message).toBe(
      'Product 999 not found',
    );
  });

  it('search_products mirrors the public search payload (q path and browse)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Koff III' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    seedOffer(db, { id: 21, productId: 2, priceCents: 310 });

    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    for (const [args, routePath] of [
      [{ q: 'karhu' }, '/api/v1/products?q=karhu'],
      [{}, '/api/v1/products'],
      [{ sort: 'ALPHABETICAL', limit: 1 }, '/api/v1/products?sort=ALPHABETICAL&limit=1'],
    ] as const) {
      const routeRes = await request(app, env, routePath, { headers: AGE });
      expect(routeRes.status).toBe(200);
      const routePayload = (await routeRes.json()) as unknown;

      const toolRes = await mcpPost(
        app,
        env,
        jsonRpcRequest(6, 'tools/call', {
          name: 'search_products',
          arguments: args as Record<string, unknown>,
        }),
        AGE,
      );
      const toolBody = (await toolRes.json()) as {
        result: { content: { text: string }[] };
      };
      expect(JSON.parse(toolBody.result.content[0]!.text)).toEqual(
        routePayload,
      );
    }
  });

  it('calculate_landed_cost mirrors the calculator payload and persists nothing', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, depositSystemStatus: 0 });
    seedOffer(db, {
      id: 11,
      productId: 1,
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
    // The calibrated ladder — the tool's margin embed must equal the
    // route's read-time composition over the same snapshot.
    await seedMarginLadder(db, d1);

    const env = permissiveEnv(d1);
    const app = buildApp();
    await handshake(app, env);

    const calcBody = JSON.stringify({
      productId: 1,
      quantity: 1,
      destination: 'FI',
    });

    const routeRes = await request(app, env, '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: calcBody,
    });
    expect(routeRes.status).toBe(200);
    const routePayload = (await routeRes.json()) as Record<string, any>;

    // Read-only baseline BEFORE the tool call: the ladder fixtures plus
    // the route POST's record (seedMarginLadder seeds records 81–83).
    const countRecords = async (): Promise<number | undefined> =>
      (
        await d1
          .prepare('SELECT COUNT(*) AS n FROM calculation_records')
          .first<{ n: number }>()
      )?.n;
    const beforeTool = await countRecords();
    expect(beforeTool).toBe(4);

    const toolRes = await mcpPost(
      app,
      env,
      jsonRpcRequest(8, 'tools/call', {
        name: 'calculate_landed_cost',
        arguments: { productId: 1, quantity: 1, destination: 'FI' },
      }),
      AGE,
    );
    const toolBody = (await toolRes.json()) as {
      result: { content: { text: string }[] };
    };
    const toolPayload = JSON.parse(
      toolBody.result.content[0]!.text,
    ) as Record<string, any>;

    // Normalize the per-compute clock reads (the calculator suite's
    // volatile fields) on BOTH sides, then require equality.
    const normalize = (clone: Record<string, any>): void => {
      clone.metadata.calculationTimestamp = '';
      for (const line of clone.itemizedCosts ?? []) {
        if (line.category === 'importVatEstimate') line.calculatedAt = '';
      }
    };
    normalize(routePayload);
    normalize(toolPayload);

    // The route reports the persisted record's id; the tool persisted
    // nothing, so the key is absent on its side. Strip before parity.
    expect(routePayload).toHaveProperty('calculationRecordId');
    expect(toolPayload).not.toHaveProperty('calculationRecordId');
    delete routePayload.calculationRecordId;

    expect(toolPayload).toEqual(routePayload);
    assertNoAccountScopedFields(toolPayload);

    // Read-only pin: the tool call wrote no calculation record.
    expect(await countRecords()).toBe(beforeTool);
  });
});

describe('/mcp house rate limiting (spec: rate-limited tool surface)', () => {
  it('excessive calls are rejected with the house 429 shape until the window resets', async () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1);
    const app = buildApp();

    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) {
      last = await mcpPost(app, env, INIT_BODY, AGE);
      if (i < 30) expect(last.status).toBe(200);
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
    const body = (await last!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 429,
      error: 'TooManyRequests',
    });
    expect(String(body.message)).toContain('Rate limit exceeded');
  });
});
