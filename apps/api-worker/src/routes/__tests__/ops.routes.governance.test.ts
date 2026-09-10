/**
 * Ops governance route tests (task 2.2, change
 * durable-source-governance-store) — the console governance endpoints
 * against the durable D1 `source_governance` store, over the full
 * createApp() harness with a migrated SQLite D1.
 *
 * Pins (Nest OpsGovernanceService semantics, ported to the worker):
 * - the list joins the merchant registry with the aggregated
 *   `checkPermission` (never overstated: no records → PENDING/0/false);
 * - grant transitions PENDING/EXPIRED → GRANTED or registers a new
 *   GRANTED source, and no-ops (`changed: false`, no audit row) when the
 *   merchant is already fully granted;
 * - both mutations audit through WorkerAuditService (operator identity,
 *   before/after, reason);
 * - revoke requires a reason and ends every source;
 * - the former governanceUnavailable() 503 is GONE — a grant on a valid
 *   merchant over migrated D1 succeeds (no StoreUnavailable path).
 *
 * Response shapes are pinned exactly to the DTOs the console renders
 * (packages/application-api/src/ops/ops.dto.ts ≡
 * apps/frontend/src/lib/types.ts governance types).
 *
 * @module OpsGovernanceRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { D1SourceGovernanceRepository } from '../../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import type { PermissionStatus } from '../../../../../packages/core-domain/src/governance/source-governance.types';
import { WorkerAuditService } from '../../adapters/audit';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` } as const;
const JSON_HEADERS = { 'content-type': 'application/json', ...OPS } as const;

/** Insert a registry merchant row (the governance join key must exist). */
function seedRegistryMerchant(
  db: import('node:sqlite').DatabaseSync,
  merchant: { merchantId: string; name: string; country?: string },
): void {
  db.prepare(
    `INSERT INTO merchant_registry (
       merchant_id, name, country, feed_url, feed_format, polling_interval_ms
     ) VALUES (?, ?, ?, ?, 'json', 3_600_000)`,
  ).run(merchant.merchantId, merchant.name, merchant.country ?? 'SE', 'https://feed.example');
}

/** Register one governance source directly through the D1 repository. */
async function seedSource(
  d1: D1DatabaseLike,
  merchantId: string,
  permissionStatus: PermissionStatus,
  sourceUrl: string,
): Promise<void> {
  await new D1SourceGovernanceRepository(d1).create({
    merchantId,
    acquisitionMethod: 'PERMITTED_FEED',
    permissionStatus,
    sourceUrl,
  });
}

async function governanceAuditEvents(
  d1: D1DatabaseLike,
): Promise<Awaited<ReturnType<WorkerAuditService['queryChanges']>>> {
  const trail = await new WorkerAuditService(d1).queryChanges({ limit: 50 });
  return trail.filter((entry) => entry.entityType === 'source_governance');
}

function app_env(d1: D1DatabaseLike): {
  app: ReturnType<typeof buildApp>;
  env: ReturnType<typeof permissiveEnv>;
} {
  return { app: buildApp(), env: permissiveEnv(d1) };
}

function grant(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof permissiveEnv>,
  merchantId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(app, env, `/ops/console/governance/${merchantId}/grant`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ operator: 'ops-1', ...body }),
  });
}

function revoke(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof permissiveEnv>,
  merchantId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(app, env, `/ops/console/governance/${merchantId}/revoke`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ operator: 'ops-1', ...body }),
  });
}

describe('GET /ops/console/governance — registry × aggregated checkPermission', () => {
  it('joins the registry with aggregated governance state, never overstated', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    seedRegistryMerchant(db, { merchantId: 'lapsed', name: 'Lapsed SE' });
    seedRegistryMerchant(db, { merchantId: 'quiet', name: 'Quiet DE', country: 'DE' });
    await seedSource(d1, 'alko', 'GRANTED', 'https://alko.example/feed.json');
    // GRANTED wins the aggregation, but the EXPIRED source raises hasWarnings.
    await seedSource(d1, 'lapsed', 'GRANTED', 'https://lapsed.example/feed.json');
    await seedSource(d1, 'lapsed', 'EXPIRED', 'https://lapsed.example/old-feed.json');
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/governance', { headers: OPS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      total: number;
    };

    // Exact DTO shape the console renders (items + total, nothing else).
    expect(Object.keys(body).sort()).toEqual(['items', 'total']);
    expect(body.total).toBe(3);
    // Registry order (merchant_id ASC).
    expect(body.items.map((item) => item.merchantId)).toEqual([
      'alko',
      'lapsed',
      'quiet',
    ]);

    // Granted merchant: aggregated status + real source count.
    expect(Object.keys(body.items[0]!).sort()).toEqual([
      'country',
      'feedUrl',
      'hasWarnings',
      'merchantId',
      'name',
      'permissionStatus',
      'sourceCount',
    ]);
    expect(body.items[0]).toEqual({
      merchantId: 'alko',
      name: 'Alko',
      country: 'FI',
      feedUrl: 'https://feed.example',
      permissionStatus: 'GRANTED',
      sourceCount: 1,
      hasWarnings: false,
    });

    // GRANTED wins over EXPIRED, but the warning surfaces.
    expect(body.items[1]).toMatchObject({
      permissionStatus: 'GRANTED',
      sourceCount: 2,
      hasWarnings: true,
    });

    // No governance records → fail-closed PENDING (never overstated).
    expect(body.items[2]).toEqual({
      merchantId: 'quiet',
      name: 'Quiet DE',
      country: 'DE',
      feedUrl: 'https://feed.example',
      permissionStatus: 'PENDING',
      sourceCount: 0,
      hasWarnings: false,
    });
  });
});

describe('POST /ops/console/governance/:merchantId/grant', () => {
  it('transitions PENDING → GRANTED and audits the change (action updated, before/after)', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    await seedSource(d1, 'alko', 'PENDING', 'https://alko.example/feed.json');
    const repo = new D1SourceGovernanceRepository(d1);
    const { app, env } = app_env(d1);

    const res = await grant(app, env, 'alko', {
      acquisitionMethod: 'RETAILER_API',
      sourceUrl: 'https://alko.example/api',
      note: 'contract signed',
    });
    expect(res.status).toBe(200);
    // Exact OpsGovernanceMutationResponse shape.
    expect(await res.json()).toEqual({
      merchantId: 'alko',
      permissionStatus: 'GRANTED',
      updatedSources: 1,
      changed: true,
    });

    // The store really transitioned (durable, not echoed).
    const rows = await repo.findByMerchantId('alko');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      permissionStatus: 'GRANTED',
      statusReason: 'contract signed',
    });

    const events = await governanceAuditEvents(d1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: 'source_governance',
      entityId: 'alko',
      action: 'updated',
      author: 'ops-1',
      reason: 'contract signed',
    });
    expect(events[0]!.previousValue).toEqual({ permissionStatus: 'PENDING' });
    // The audit carries the transitioned RECORD's provenance (Nest
    // auditGrant parity) — not the request's acquisitionMethod/sourceUrl,
    // which only matter for the register-new path.
    expect(events[0]!.newValue).toEqual({
      permissionStatus: 'GRANTED',
      acquisitionMethod: 'PERMITTED_FEED',
      sourceUrl: 'https://alko.example/feed.json',
    });
  });

  it('transitions EXPIRED → GRANTED with the true before status audited', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    await seedSource(d1, 'alko', 'EXPIRED', 'https://alko.example/feed.json');
    const { app, env } = app_env(d1);

    const res = await grant(app, env, 'alko', {
      acquisitionMethod: 'PERMITTED_FEED',
      sourceUrl: 'https://alko.example/feed.json',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ permissionStatus: 'GRANTED', changed: true });

    const events = await governanceAuditEvents(d1);
    expect(events[0]!.action).toBe('updated');
    expect(events[0]!.previousValue).toEqual({ permissionStatus: 'EXPIRED' });
    // No note → the default console reason.
    expect(events[0]!.reason).toBe('Governance permission granted via operator console');
  });

  it('registers a new GRANTED source when the merchant has no records (the 503 is gone)', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'systembolaget', name: 'Systembolaget' });
    const repo = new D1SourceGovernanceRepository(d1);
    const { app, env } = app_env(d1);

    // Over migrated D1 a valid grant MUST succeed — no StoreUnavailable path.
    const res = await grant(app, env, 'systembolaget', {
      acquisitionMethod: 'LICENSED_PROVIDER',
      sourceUrl: 'https://systembolaget.example/api',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      merchantId: 'systembolaget',
      permissionStatus: 'GRANTED',
      updatedSources: 1,
      changed: true,
    });

    const rows = await repo.findByMerchantId('systembolaget');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      permissionStatus: 'GRANTED',
      acquisitionMethod: 'LICENSED_PROVIDER',
      sourceUrl: 'https://systembolaget.example/api',
      statusReason: null,
    });

    // Registration audits action 'created' with no previous state.
    const events = await governanceAuditEvents(d1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: 'source_governance',
      entityId: 'systembolaget',
      action: 'created',
      author: 'ops-1',
    });
    expect(events[0]!.previousValue).toBeUndefined();
    expect(events[0]!.newValue).toEqual({
      permissionStatus: 'GRANTED',
      acquisitionMethod: 'LICENSED_PROVIDER',
      sourceUrl: 'https://systembolaget.example/api',
    });
  });

  it('no-ops (changed: false) when every source is already GRANTED — and writes no audit row', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    await seedSource(d1, 'alko', 'GRANTED', 'https://alko.example/feed.json');
    const repo = new D1SourceGovernanceRepository(d1);
    const { app, env } = app_env(d1);

    const res = await grant(app, env, 'alko', {
      acquisitionMethod: 'RETAILER_API',
      sourceUrl: 'https://alko.example/api',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      merchantId: 'alko',
      permissionStatus: 'GRANTED',
      updatedSources: 0,
      changed: false,
    });

    // The store is untouched — no second source was registered.
    const rows = await repo.findByMerchantId('alko');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      permissionStatus: 'GRANTED',
      sourceUrl: 'https://alko.example/feed.json',
    });

    expect(await governanceAuditEvents(d1)).toEqual([]);
  });

  it('validates before the store: 400 invalid acquisition method / missing sourceUrl / operator', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    const { app, env } = app_env(d1);

    const badMethod = await grant(app, env, 'alko', {
      acquisitionMethod: 'SCRAPING',
      sourceUrl: 'https://alko.example/api',
    });
    await expectEnvelope(badMethod, 400, {
      message: expect.stringContaining('acquisitionMethod must be one of'),
    });

    const noUrl = await grant(app, env, 'alko', { acquisitionMethod: 'RETAILER_API' });
    await expectEnvelope(noUrl, 400, {
      message: 'sourceUrl must be a non-empty string',
    });

    const noOperator = await request(
      app,
      env,
      '/ops/console/governance/alko/grant',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          acquisitionMethod: 'RETAILER_API',
          sourceUrl: 'https://alko.example/api',
        }),
      },
    );
    await expectEnvelope(noOperator, 400, {
      message: expect.stringContaining('operator must be a non-empty string'),
    });
  });

  it('404s a merchant that is not in the registry', async () => {
    const { d1 } = openMigratedD1();
    const { app, env } = app_env(d1);

    const res = await grant(app, env, 'ghost', {
      acquisitionMethod: 'RETAILER_API',
      sourceUrl: 'https://ghost.example/api',
    });
    await expectEnvelope(res, 404, {
      message: 'Merchant "ghost" is not in the registry',
      error: 'Not Found',
    });
  });
});

describe('POST /ops/console/governance/:merchantId/revoke', () => {
  it('ends every source and audits the revocation with reason and before/after', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    await seedSource(d1, 'alko', 'GRANTED', 'https://alko.example/feed.json');
    await seedSource(d1, 'alko', 'PENDING', 'https://alko.example/api');
    const repo = new D1SourceGovernanceRepository(d1);
    const { app, env } = app_env(d1);

    const res = await revoke(app, env, 'alko', { reason: 'merchant agreement ended' });
    expect(res.status).toBe(200);
    // Exact OpsGovernanceMutationResponse shape.
    expect(await res.json()).toEqual({
      merchantId: 'alko',
      permissionStatus: 'REVOKED',
      updatedSources: 2,
      changed: true,
    });

    // Every source ended, each carrying the reason.
    const rows = await repo.findByMerchantId('alko');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.permissionStatus).toBe('REVOKED');
      expect(row.statusReason).toBe('merchant agreement ended');
    }

    const events = await governanceAuditEvents(d1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: 'source_governance',
      entityId: 'alko',
      action: 'updated',
      author: 'ops-1',
      reason: 'merchant agreement ended',
    });
    // Aggregated before status (GRANTED wins) → REVOKED with the count.
    expect(events[0]!.previousValue).toEqual({ permissionStatus: 'GRANTED' });
    expect(events[0]!.newValue).toEqual({
      permissionStatus: 'REVOKED',
      revokedSources: 2,
    });
  });

  it('requires a reason (400 when missing or whitespace)', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    const { app, env } = app_env(d1);

    const missing = await revoke(app, env, 'alko', {});
    await expectEnvelope(missing, 400, {
      message: 'reason is required for revocation',
    });

    const blank = await revoke(app, env, 'alko', { reason: '   ' });
    await expectEnvelope(blank, 400, {
      message: 'reason is required for revocation',
    });
  });

  it('404s an unknown merchant and a registry merchant with no governance records', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'quiet', name: 'Quiet DE', country: 'DE' });
    const { app, env } = app_env(d1);

    await expectEnvelope(await revoke(app, env, 'ghost', { reason: 'any' }), 404, {
      message: 'Merchant "ghost" is not in the registry',
    });
    await expectEnvelope(await revoke(app, env, 'quiet', { reason: 'any' }), 404, {
      message: 'Merchant "quiet" has no governance records to revoke',
    });
  });

  it('re-revoking an already-revoked merchant is changed: false (skipped rows), still audited', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    await seedSource(d1, 'alko', 'REVOKED', 'https://alko.example/feed.json');
    const repo = new D1SourceGovernanceRepository(d1);
    const { app, env } = app_env(d1);

    const res = await revoke(app, env, 'alko', { reason: 'second stop' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      merchantId: 'alko',
      permissionStatus: 'REVOKED',
      updatedSources: 0,
      changed: false,
    });

    const rows = await repo.findByMerchantId('alko');
    expect(rows).toHaveLength(1);
    // Already-REVOKED rows are skipped wholesale (reference parity) — the
    // new reason is NOT written onto them.
    expect(rows[0]).toMatchObject({
      permissionStatus: 'REVOKED',
      statusReason: null,
    });

    const events = await governanceAuditEvents(d1);
    expect(events).toHaveLength(1);
    expect(events[0]!.previousValue).toEqual({ permissionStatus: 'REVOKED' });
    expect(events[0]!.newValue).toEqual({
      permissionStatus: 'REVOKED',
      revokedSources: 0,
    });
  });
});
