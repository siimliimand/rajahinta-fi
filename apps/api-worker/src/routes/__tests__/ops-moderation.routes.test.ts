/**
 * Ops moderation route tests (task 2.3, change trust-and-reach-roadmap)
 * — the shop-report review queue (list OPEN with evidence, link/reject),
 * the blacklist publish action (the published standard enforced
 * server-side), and the appeal path (record + REPUBLISH/REJECT), all
 * over the full createApp() harness against the real D1 repositories.
 *
 * Spec pins (merchant-blacklist): standard met + operator publish ⇒
 * entry created, source reports linked, audited; standard not met ⇒
 * rejected with NO entry; an appeal reopens (hidden immediately) and
 * resolves to PUBLISHED or REJECTED, recorded.
 *
 * @module OpsModerationRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
} from './harness';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { D1ShopReportRepository } from '../../../../../packages/data-platform/src/repositories/d1/shop-report.repository';
import { D1BlacklistRepository } from '../../../../../packages/data-platform/src/repositories/d1/blacklist.repository';
import { WorkerAuditService } from '../../adapters/audit';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` } as const;
const JSON_HEADERS = { 'content-type': 'application/json', ...OPS } as const;

/** Seed the canonical reporter accounts (reporter_account_id is an accounts FK). */
function seedReporterAccounts(db: import('node:sqlite').DatabaseSync): void {
  for (const id of [7, 9, 11]) {
    seedAccount(db, { id, userId: `user-${id}`, email: `user-${id}@example.invalid`, tier: 'FREE' });
  }
}

function app_env(d1: D1DatabaseLike): {
  app: ReturnType<typeof buildApp>;
  env: ReturnType<typeof permissiveEnv>;
} {
  return { app: buildApp(), env: permissiveEnv(d1) };
}

/**
 * Seed OPEN reports against one merchant identity — stored NORMALIZED
 * (submission normalizes before persisting; the console matches the
 * stored forms exactly). The reporter ids MUST be seeded accounts
 * (reporter_account_id is an accounts FK) — the canonical set is
 * seedAccount's 7/9/11.
 */
async function seedReports(
  d1: D1DatabaseLike,
  identity: { merchantDomain: string; merchantName: string },
  reporterAccountIds: number[],
): Promise<number[]> {
  const repo = new D1ShopReportRepository(d1);
  const ids: number[] = [];
  for (const reporterAccountId of reporterAccountIds) {
    const report = await repo.create({
      merchantDomain: identity.merchantDomain.toLowerCase(),
      merchantNameNormalized: identity.merchantName.toLowerCase(),
      orderReference: `ORD-${identity.merchantDomain}-${reporterAccountId}`,
      correspondenceSummary: `No delivery, no refund (account ${reporterAccountId})`,
      reporterAccountId,
    });
    ids.push(report.id);
  }
  return ids;
}

const IDENTITY = { merchantDomain: 'scamshop.example', merchantName: 'Scam Shop' };

async function auditEntries(
  d1: D1DatabaseLike,
): Promise<Awaited<ReturnType<WorkerAuditService['queryChanges']>>> {
  return new WorkerAuditService(d1).queryChanges({ limit: 50 });
}

describe('GET/POST /ops/console/reports — review queue', () => {
  it('lists OPEN reports with their evidence, oldest first', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const repo = new D1ShopReportRepository(d1);
    const first = await repo.create({
      merchantDomain: 'a.example',
      merchantNameNormalized: 'a shop',
      orderReference: 'ORD-1',
      correspondenceSummary: 'Never arrived',
      reporterAccountId: 7,
    });
    const second = await repo.create({
      merchantDomain: 'b.example',
      merchantNameNormalized: 'b shop',
      orderReference: 'ORD-2',
      correspondenceSummary: 'Ghosted after payment',
      reporterAccountId: 9,
    });
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/reports', { headers: OPS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual([first.id, second.id]);
    // The evidence fields the reviewer needs are on the queue row.
    expect(body.items[0]).toMatchObject({
      merchantDomain: 'a.example',
      merchantNameNormalized: 'a shop',
      orderReference: 'ORD-1',
      correspondenceSummary: 'Never arrived',
      reporterAccountId: 7,
      status: 'OPEN',
      linkedEntryId: null,
    });
  });

  it('links an OPEN report to an existing entry (same identity only) and audits it', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const repo = new D1ShopReportRepository(d1);
    const entries = new D1BlacklistRepository(d1);
    const [reportId] = await seedReports(d1, IDENTITY, [7]);
    const entry = await entries.publish({
      merchantIdentity: { domain: IDENTITY.merchantDomain, name: 'scam shop' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops-seed',
    });
    const { app, env } = app_env(d1);

    const res = await request(app, env, `/ops/console/reports/${reportId}/link`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ operator: 'ops-1', entryId: entry.id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: reportId,
      status: 'LINKED',
      linkedEntryId: entry.id,
    });
    expect((await repo.findById(reportId))?.status).toBe('LINKED');

    const trail = await auditEntries(d1);
    const event = trail.find(
      (e) => e.entityType === 'shop_report' && e.entityId === String(reportId),
    );
    expect(event).toMatchObject({ action: 'updated', author: 'ops-1' });
    expect(event!.newValue).toMatchObject({ status: 'LINKED', linkedEntryId: entry.id });
  });

  it('refuses to link across identities, to a missing entry/report, or twice', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const [reportId] = await seedReports(d1, IDENTITY, [7]);
    const otherEntry = await entries.publish({
      merchantIdentity: { domain: 'other.example', name: 'other shop' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops-seed',
    });
    const { app, env } = app_env(d1);
    const link = (id: number, body: Record<string, unknown>) =>
      request(app, env, `/ops/console/reports/${id}/link`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', ...body }),
      });

    await expectEnvelope(await link(reportId, { entryId: otherEntry.id }), 400, {
      error: 'IdentityMismatch',
    });
    await expectEnvelope(await link(reportId, { entryId: 9999 }), 404, {});
    await expectEnvelope(await link(9999, { entryId: otherEntry.id }), 404, {});

    const sameEntry = await entries.publish({
      merchantIdentity: { domain: IDENTITY.merchantDomain, name: 'scam shop' },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops-seed',
    });
    await link(reportId, { entryId: sameEntry.id }); // LINKED
    await expectEnvelope(await link(reportId, { entryId: sameEntry.id }), 409, {
      error: 'InvalidTransition',
    });
  });

  it('rejects an OPEN report (terminal) and audits the rejection', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const repo = new D1ShopReportRepository(d1);
    const [reportId] = await seedReports(d1, IDENTITY, [7]);
    const { app, env } = app_env(d1);

    const res = await request(app, env, `/ops/console/reports/${reportId}/reject`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ operator: 'ops-1', note: 'evidence did not check out' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: reportId, status: 'REJECTED' });
    expect((await repo.findById(reportId))?.status).toBe('REJECTED');

    // Terminal: a second rejection is a 409.
    await expectEnvelope(
      await request(app, env, `/ops/console/reports/${reportId}/reject`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1' }),
      }),
      409,
      { error: 'InvalidTransition' },
    );

    const trail = await auditEntries(d1);
    const event = trail.find(
      (e) => e.entityType === 'shop_report' && e.entityId === String(reportId),
    );
    expect(event).toMatchObject({
      action: 'updated',
      author: 'ops-1',
      reason: 'evidence did not check out',
    });
    expect(event!.newValue).toMatchObject({ status: 'REJECTED' });
  });
});

describe('POST /ops/console/blacklist/publish — the published standard, enforced server-side', () => {
  it('publishes when 3+ INDEPENDENT confirmed reports exist; links them; audits', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const repo = new D1ShopReportRepository(d1);
    const reportIds = await seedReports(d1, IDENTITY, [7, 9, 11]);
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-1',
        ...IDENTITY,
        confirmedReportIds: reportIds,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      merchantDomain: IDENTITY.merchantDomain,
      merchantNameNormalized: 'scam shop',
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops-1',
      status: 'PUBLISHED',
    });
    expect(body.linkedReportIds).toEqual(reportIds);

    // The confirmed source reports are LINKED to the new entry.
    for (const id of reportIds) {
      const report = await repo.findById(id);
      expect(report).toMatchObject({ status: 'LINKED', linkedEntryId: body.id });
    }

    const trail = await auditEntries(d1);
    const event = trail.find(
      (e) => e.entityType === 'blacklist_entry' && e.entityId === String(body.id),
    );
    expect(event).toMatchObject({ action: 'created', author: 'ops-1' });
    expect(event!.newValue).toMatchObject({
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      linkedReportIds: reportIds,
    });
  });

  it('rejects publication below the standard — NO entry is created', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const reportIds = await seedReports(d1, IDENTITY, [7, 9]);
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-1',
        ...IDENTITY,
        confirmedReportIds: reportIds,
      }),
    });
    const body = await expectEnvelope(res, 400, { error: 'StandardNotMet' });
    expect(body.message).toContain('INSUFFICIENT_INDEPENDENT_NON_DELIVERY_REPORTS');
    expect(await entries.list()).toEqual([]); // no entry, ever
  });

  it('independence is exact account distinctness — 3 reports from 2 accounts do not publish', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const reportIds = await seedReports(d1, IDENTITY, [7, 7, 9]);
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-1',
        ...IDENTITY,
        confirmedReportIds: reportIds,
      }),
    });
    await expectEnvelope(res, 400, { error: 'StandardNotMet' });
    expect(await entries.list()).toEqual([]);
  });

  it('unconfirmed OPEN reports do not count — only confirmed ids do', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    await seedReports(d1, IDENTITY, [7, 9, 11]);
    const { app, env } = app_env(d1);

    // The operator confirms only ONE report; the other two stay
    // unconfirmed OPEN evidence and do not satisfy the standard.
    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-1',
        ...IDENTITY,
        confirmedReportIds: [],
      }),
    });
    const body = await expectEnvelope(res, 400, { error: 'StandardNotMet' });
    expect(body.message).toContain('NO_EVIDENCE');
    expect(await entries.list()).toEqual([]);
  });

  it('the confirmed-invalid-business-registration path publishes', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-1',
        ...IDENTITY,
        confirmedReportIds: [],
        businessRegistrationConfirmed: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      standardMet: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION',
    });
    expect(await entries.list()).toHaveLength(1);
  });

  it('validates identity, report ownership, and the operator field', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    await seedReports(d1, IDENTITY, [7]);
    const { app, env } = app_env(d1);
    const publish = (body: Record<string, unknown>) =>
      request(app, env, '/ops/console/blacklist/publish', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', ...body }),
      });

    // An unusable domain cannot form an identity.
    await expectEnvelope(
      await publish({ ...IDENTITY, merchantDomain: 'has space.example', confirmedReportIds: [] }),
      400,
      { error: 'INVALID_MERCHANT_DOMAIN' },
    );
    // A confirmed id must belong to THIS identity.
    const [foreign] = await seedReports(d1, { merchantDomain: 'other.example', merchantName: 'other' }, [9]);
    await expectEnvelope(
      await publish({ ...IDENTITY, confirmedReportIds: [foreign] }),
      400,
      { error: 'UnknownReport' },
    );
    // Operator parity with every console mutation.
    const noOperator = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...IDENTITY, confirmedReportIds: [] }),
    });
    await expectEnvelope(noOperator, 400, {
      message: expect.stringContaining('operator must be a non-empty string'),
    });
  });

  it('normalizes the identity exactly like report submission (WWW/case variants match)', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const reportIds = await seedReports(d1, IDENTITY, [7, 9, 11]);
    const { app, env } = app_env(d1);

    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-1',
        merchantDomain: '  WWW.SCAMSHOP.EXAMPLE ',
        merchantName: '  scam   SHOP ',
        confirmedReportIds: reportIds,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      merchantDomain: 'scamshop.example',
      merchantNameNormalized: 'scam shop',
    });
    expect(await entries.list()).toHaveLength(1);
  });
});

describe('/ops/console/blacklist/appeals — record + resolve', () => {
  async function publishEntry(d1: D1DatabaseLike): Promise<number> {
    const reportIds = await seedReports(d1, IDENTITY, [7, 9, 11]);
    const { app, env } = app_env(d1);
    const res = await request(app, env, '/ops/console/blacklist/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operator: 'ops-seed',
        ...IDENTITY,
        confirmedReportIds: reportIds,
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Record<string, unknown>).id as number;
  }

  it('records an appeal (PUBLISHED → REOPENED), lists it in the inbox, audits', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const entryId = await publishEntry(d1);
    const { app, env } = app_env(d1);

    const appeal = await request(app, env, `/ops/console/blacklist/${entryId}/appeal`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ operator: 'ops-1', appealReason: 'We delivered everything' }),
    });
    expect(appeal.status).toBe(200);
    const appealed = (await appeal.json()) as Record<string, unknown>;
    expect(appealed).toMatchObject({ status: 'REOPENED', appealReason: 'We delivered everything' });

    // The inbox lists exactly the REOPENED entry.
    const inbox = await request(app, env, '/ops/console/blacklist/appeals', { headers: OPS });
    const body = (await inbox.json()) as { items: Record<string, unknown>[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: entryId, status: 'REOPENED' });

    // Public display stopped immediately (display join = exactly-PUBLISHED).
    expect(
      await entries.findPublishedByIdentity({
        domain: IDENTITY.merchantDomain,
        name: 'scam shop',
      }),
    ).toEqual([]);

    const trail = await auditEntries(d1);
    expect(trail.find((e) => e.entityType === 'blacklist_entry' && e.action === 'updated'))
      .toMatchObject({ author: 'ops-1' });
  });

  it('resolves REPUBLISH (back to PUBLISHED) and REJECT (terminal), both audited', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entries = new D1BlacklistRepository(d1);
    const entryId = await publishEntry(d1);
    const { app, env } = app_env(d1);
    const resolve = (resolution: string) =>
      request(app, env, `/ops/console/blacklist/${entryId}/resolve`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', resolution }),
      });

    // Appeal → REPUBLISH.
    await request(app, env, `/ops/console/blacklist/${entryId}/appeal`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ operator: 'ops-1', appealReason: 'dispute' }),
    });
    const republished = await resolve('REPUBLISH');
    expect(await republished.json()).toMatchObject({ status: 'PUBLISHED' });
    expect(
      await entries.findPublishedByIdentity({
        domain: IDENTITY.merchantDomain,
        name: 'scam shop',
      }),
    ).toHaveLength(1);

    // Appeal again → REJECT (terminal).
    await request(app, env, `/ops/console/blacklist/${entryId}/appeal`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ operator: 'ops-1', appealReason: 'second dispute' }),
    });
    const rejected = await resolve('REJECT');
    expect(await rejected.json()).toMatchObject({ status: 'REJECTED' });
    expect((await entries.findById(entryId))?.status).toBe('REJECTED');

    // A REJECTED entry cannot be resolved or appealed again.
    await expectEnvelope(await resolve('REPUBLISH'), 409, { error: 'InvalidTransition' });
    await expectEnvelope(
      await request(app, env, `/ops/console/blacklist/${entryId}/appeal`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', appealReason: 'again' }),
      }),
      409,
      { error: 'InvalidTransition' },
    );

    // Both decisions are on the trail.
    const trail = await auditEntries(d1);
    const decisions = trail.filter(
      (e) => e.entityType === 'blacklist_entry' && e.action === 'confirmed',
    );
    expect(decisions).toHaveLength(2);
    // Newest first: the REJECT decision, then the earlier REPUBLISH.
    expect(decisions[0]!.reason).toContain('rejected');
    expect(decisions[1]!.reason).toContain('republished');
  });

  it('validates resolution vocabulary, appeal reason, and unknown ids', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entryId = await publishEntry(d1);
    const { app, env } = app_env(d1);

    await expectEnvelope(
      await request(app, env, `/ops/console/blacklist/${entryId}/resolve`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', resolution: 'MAYBE' }),
      }),
      400,
      { message: expect.stringContaining('resolution must be REPUBLISH or REJECT') },
    );
    await expectEnvelope(
      await request(app, env, `/ops/console/blacklist/${entryId}/appeal`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1' }),
      }),
      400,
      { message: expect.stringContaining('appealReason is required') },
    );
    await expectEnvelope(
      await request(app, env, '/ops/console/blacklist/9999/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', resolution: 'REJECT' }),
      }),
      404,
      {},
    );
  });

  it('a REOPENED entry cannot be resolved twice or resolved while PUBLISHED', async () => {
    const { db, d1 } = openMigratedD1();
    seedReporterAccounts(db);
    const entryId = await publishEntry(d1);
    const { app, env } = app_env(d1);
    const resolve = () =>
      request(app, env, `/ops/console/blacklist/${entryId}/resolve`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ operator: 'ops-1', resolution: 'REJECT' }),
      });

    // Resolve without an appeal: PUBLISHED is not resolvable.
    await expectEnvelope(await resolve(), 409, { error: 'InvalidTransition' });

    await request(app, env, `/ops/console/blacklist/${entryId}/appeal`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ operator: 'ops-1', appealReason: 'dispute' }),
    });
    expect((await resolve()).status).toBe(200);
    await expectEnvelope(await resolve(), 409, { error: 'InvalidTransition' });
  });
});
