/**
 * Unit tests for the MCP tool layer (change seo-aeo-agent-surfaces, spec
 * agent-tool-surface) — pins the closed tool set, the unknown-tool
 * contract error, and the public-data-only posture of every tool's
 * payload, at the dispatch level (no HTTP).
 *
 * @module McpToolsTest
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  dispatchMcpTool,
  MCP_SERVER_INFO,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
} from '../tools';
import { openMigratedD1 } from '../../routes/__tests__/harness';
import {
  seedMerchant,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../routes/__tests__/harness';
import type { Env } from '../../env';

/** Every response key must avoid the account-scoped vocabulary. */
const FORBIDDEN_KEY = /account|userid|sessionid|session_|email|password|\btoken|favorite|favourite|\balert|apikey|api_key/i;

function assertNoAccountScopedFields(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoAccountScopedFields(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(
        FORBIDDEN_KEY.test(key),
        `account-scoped key '${key}' leaked at ${path}.${key}`,
      ).toBe(false);
      assertNoAccountScopedFields(child, `${path}.${key}`);
    }
  }
}

describe('closed tool set (spec: tool list is the closed set)', () => {
  it('pins the exact three tool names, versioned in code', () => {
    expect([...MCP_TOOL_NAMES]).toEqual([
      'search_products',
      'get_product',
      'calculate_landed_cost',
    ]);
  });

  it('the tools/list payload carries exactly the pinned set with schemas', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('exposes a server identity', () => {
    expect(MCP_SERVER_INFO.name.length).toBeGreaterThan(0);
    expect(MCP_SERVER_INFO.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('unknown tool rejection (spec: contract-level error naming valid tools)', () => {
  it('rejects a tool outside the closed set, naming every valid tool', async () => {
    const { d1 } = openMigratedD1();
    const err = await dispatchMcpTool(
      'send_email',
      {},
      d1 as unknown as Env['DB'],
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(McpError);
    const mcpErr = err as McpError;
    expect(mcpErr.code).toBe(ErrorCode.InvalidParams);
    for (const name of MCP_TOOL_NAMES) {
      expect(mcpErr.message).toContain(name);
    }
    expect(mcpErr.message).toContain('send_email');
  });

  it('rejects look-alike names too — the set is exact, not prefix-matched', async () => {
    const { d1 } = openMigratedD1();
    for (const probe of ['search', 'get_product!', 'calculate_landed_costs', '']) {
      await expect(
        dispatchMcpTool(probe, {}, d1 as unknown as Env['DB']),
      ).rejects.toThrow(McpError);
    }
  });
});

describe('public-data-only payloads (spec: no account surface reachable)', () => {
  it('search_products: no account-scoped fields in the payload', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedOffer(db, { productId: 1 });
    const payload = await dispatchMcpTool(
      'search_products',
      { q: 'karhu' },
      d1 as unknown as Env['DB'],
    );
    assertNoAccountScopedFields(payload);
  });

  it('get_product: no account-scoped fields in the payload', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedMerchant(db, { merchantId: 'alko', name: 'Alko' });
    seedOffer(db, { productId: 1, merchant: 'alko' });
    const payload = await dispatchMcpTool(
      'get_product',
      { id: 1 },
      d1 as unknown as Env['DB'],
    );
    assertNoAccountScopedFields(payload);
  });

  it('calculate_landed_cost: no account-scoped fields and no record pointer', async () => {
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

    const payload = await dispatchMcpTool(
      'calculate_landed_cost',
      { productId: 1, quantity: 1, destination: 'FI' },
      d1 as unknown as Env['DB'],
    );
    assertNoAccountScopedFields(payload);
    // Read-only posture: nothing was persisted, so the pointer key is
    // absent — never a dangling id, never 0.
    expect(payload).not.toHaveProperty('calculationRecordId');
    // The estimate itself is real: itemized costs with a positive total.
    expect(payload.totalCents).toBeGreaterThan(0);
    expect(Array.isArray(payload.itemizedCosts)).toBe(true);
  });
});
