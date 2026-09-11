/**
 * Ops merchant-registration route tests — POST /ops/console/merchants,
 * the "add a site" console action with the owner's auto-grant policy
 * (2026-09-11): registering a merchant asserts permission for its public
 * feed, so a merchant with NO governance records is auto-granted and the
 * next producer pass starts ingesting without a second console action.
 *
 * Pins:
 * - a new merchant is upserted into merchant_registry AND auto-granted
 *   (GRANTED source over the registered feed URL, audited twice);
 * - an existing merchant re-registers as `registered: 'updated'` and its
 *   governance records are NEVER touched — a REVOKED merchant stays
 *   revoked (the kill switch survives re-registration), an already
 *   GRANTED merchant is not double-granted;
 * - the optional acquisitionMethod is honored, defaulting to
 *   RETAILER_API (the public store-API onboarding pattern);
 * - validation: operator, merchantId, name, country, feedUrl required;
   acquisitionMethod must be in the domain union; pollingIntervalMs must
 *   be a positive integer.
 *
 * @module OpsMerchantRegistrationRoutesTest
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
import { D1MerchantRegistryRepository } from '../../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import { D1SourceGovernanceRepository } from '../../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import { WorkerAuditService } from '../../adapters/audit';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` } as const;
const JSON_HEADERS = { 'content-type': 'application/json', ...OPS } as const;

const VALID_BODY = {
  merchantId: 'alks',
  name: 'Alks',
  country: 'DE',
  feedUrl: 'https://alks.fi/feed.json',
  operator: 'ops-1',
};

function register(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof permissiveEnv>,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(app, env, '/ops/console/merchants', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Audit entries for one entity type, newest-first (WorkerAuditService). */
async function auditFor(
  d1: D1DatabaseLike,
  entityType: string,
): Promise<Awaited<ReturnType<WorkerAuditService['queryChanges']>>> {
  const trail = await new WorkerAuditService(d1).queryChanges({ limit: 50 });
  return trail.filter((entry) => entry.entityType === entityType);
}

describe('POST /ops/console/merchants — register + auto-grant', () => {
  it('registers a new merchant, auto-grants it, and audits both changes', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const res = await register(app, env, VALID_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      merchantId: 'alks',
      name: 'Alks',
      registered: 'created',
      autoGranted: true,
      permissionStatus: 'GRANTED',
      sourceCount: 1,
    });

    // The registry row exists with the submitted commercial columns.
    const merchant = await new D1MerchantRegistryRepository(d1).findByMerchantId('alks');
    expect(merchant).not.toBeNull();
    expect(merchant?.feedUrl).toBe('https://alks.fi/feed.json');

    // The auto-grant: exactly one GRANTED source over the feed URL.
    const check = await new D1SourceGovernanceRepository(d1).checkPermission('alks');
    expect(check.permissionStatus).toBe('GRANTED');
    expect(check.hasWarnings).toBe(false);
    expect(check.sources).toHaveLength(1);
    expect(check.sources[0].sourceUrl).toBe('https://alks.fi/feed.json');
    // Merchant sites onboard through their public store APIs (the alks
    // pattern) — RETAILER_API is the default acquisition method.
    expect(check.sources[0].acquisitionMethod).toBe('RETAILER_API');

    // Two audit rows: the registry creation and the governance grant.
    const registryAudit = await auditFor(d1, 'merchant_registry');
    expect(registryAudit).toHaveLength(1);
    expect(registryAudit[0].action).toBe('created');
    const governanceAudit = await auditFor(d1, 'source_governance');
    expect(governanceAudit).toHaveLength(1);
    expect(governanceAudit[0].action).toBe('created');
    expect(governanceAudit[0].newValue).toMatchObject({
      permissionStatus: 'GRANTED',
      sourceUrl: 'https://alks.fi/feed.json',
    });
  });

  it('honors an explicit acquisitionMethod and pollingIntervalMs', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const res = await register(app, env, {
      ...VALID_BODY,
      merchantId: 'example-shop',
      acquisitionMethod: 'RETAILER_API',
      pollingIntervalMs: 1_800_000,
      feedFormat: 'xml',
    });
    expect(res.status).toBe(200);

    const merchant = await new D1MerchantRegistryRepository(d1).findByMerchantId(
      'example-shop',
    );
    expect(merchant?.pollingIntervalMs).toBe(1_800_000);
    expect(merchant?.feedFormat).toBe('xml');
    const check = await new D1SourceGovernanceRepository(d1).checkPermission(
      'example-shop',
    );
    expect(check.sources[0].acquisitionMethod).toBe('RETAILER_API');
  });

  it('re-registration updates the row but never touches governance — REVOKED survives', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    // First registration (created + auto-granted), then an operator
    // revokes the merchant, then the same merchant re-registers.
    await register(app, env, VALID_BODY);
    const revokeRes = await request(
      app,
      env,
      '/ops/console/governance/alks/revoke',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', reason: 'merchant asked' }),
      },
    );
    expect(revokeRes.status).toBe(200);

    const res = await register(app, env, {
      ...VALID_BODY,
      name: 'Alks GmbH',
      feedUrl: 'https://alks.fi/new-feed.json',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      merchantId: 'alks',
      name: 'Alks GmbH',
      registered: 'updated',
      autoGranted: false,
      permissionStatus: 'REVOKED',
      sourceCount: 1,
    });

    // The registry commercial columns refreshed; the governance record is
    // still the single REVOKED source — re-registration is not a re-grant.
    const merchant = await new D1MerchantRegistryRepository(d1).findByMerchantId('alks');
    expect(merchant?.name).toBe('Alks GmbH');
    expect(merchant?.feedUrl).toBe('https://alks.fi/new-feed.json');
    const check = await new D1SourceGovernanceRepository(d1).checkPermission('alks');
    expect(check.permissionStatus).toBe('REVOKED');
    expect(check.hasWarnings).toBe(true);
    expect(check.sources[0].sourceUrl).toBe('https://alks.fi/feed.json');

    // Exactly two governance audit entries total — the initial auto-grant
    // ('created') and the revoke ('updated'); the re-registration
    // appended none (only the merchant_registry update).
    const governanceAudit = await auditFor(d1, 'source_governance');
    expect(governanceAudit).toHaveLength(2);
    expect(governanceAudit[0].action).toBe('updated'); // revoke, newest first
    expect(governanceAudit[1].action).toBe('created'); // auto-grant
  });

  it('re-registration of an already-GRANTED merchant is a no-op grant-wise', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    await register(app, env, VALID_BODY);
    const res = await register(app, env, { ...VALID_BODY, name: 'Alks 2' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { autoGranted: boolean; permissionStatus: string };
    expect(body.autoGranted).toBe(false);
    expect(body.permissionStatus).toBe('GRANTED');

    // Still exactly one source — no duplicate GRANTED row.
    const check = await new D1SourceGovernanceRepository(d1).checkPermission('alks');
    expect(check.sources).toHaveLength(1);
  });
});

describe('POST /ops/console/merchants — validation', () => {
  it.each([
    ['missing operator', { ...VALID_BODY, operator: undefined }, 'operator'],
    ['blank merchantId', { ...VALID_BODY, merchantId: '  ' }, 'merchantId'],
    ['missing name', { ...VALID_BODY, name: undefined }, 'name'],
    ['missing country', { ...VALID_BODY, country: undefined }, 'country'],
    ['missing feedUrl', { ...VALID_BODY, feedUrl: undefined }, 'feedUrl'],
    [
      'unknown acquisitionMethod',
      { ...VALID_BODY, acquisitionMethod: 'TELEPATHY' },
      'acquisitionMethod',
    ],
    [
      'non-positive pollingIntervalMs',
      { ...VALID_BODY, pollingIntervalMs: 0 },
      'pollingIntervalMs',
    ],
  ])('rejects %s with 400', async (_label, body, field) => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const res = await register(app, env, body as Record<string, unknown>);
    const message = (await expectEnvelope(res, 400, {})) as { message: string };
    expect(message.message).toContain(field);

    // Nothing was written.
    expect(
      await new D1MerchantRegistryRepository(d1).findByMerchantId('alks'),
    ).toBeNull();
  });
});
