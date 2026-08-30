/**
 * Integration test — durability on D1 (task 2.7, change
 * migrate-to-cloudflare). D1 port of
 * tests/integration/durability-restart.test.ts; the pg original stays
 * untouched for the Postgres + Redis stack until cutover.
 *
 * Assertion-intent mapping (pg mechanic → Cloudflare mechanic):
 *
 *   1. Audit durability — "events written before a process restart are
 *      queryable after it": the SAME assertion, against
 *      D1AuditEventRepository on file-backed SQLite storage. The
 *      restart is real for the storage layer: the database is closed and
 *      reopened, and every in-memory instance (repository, service) is
 *      rebuilt from scratch before the events are read back.
 *   2. Click analytics — "snapshots are the durable restore path": the
 *      pg suite's PostgreSQL-snapshot assertions port 1:1 onto
 *      D1ClickCounterSnapshotRepository (idempotent upsert at a capture
 *      instant, counts re-readable after the live store empties).
 *   3. NOT ported here, deliberately: the Redis halves of the pg suite's
 *      suite 1 (shared sliding-window rate limiting across replicas,
 *      live click counters surviving a rollout). On Cloudflare those are
 *      Durable-Object concerns (RateLimiterDO / ClickCounterDO with
 *      alarm-driven snapshot flush into D1 — design D5); their binding
 *      and parity tests land with the phase-3 DO wiring, and the DO units
 *      already carry their own suites under apps/api-worker/src/do.
 *
 * Runs on the node:sqlite D1 harness — no external infrastructure.
 *
 * @module DurabilityRestartD1IntegrationTest
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AuditService } from '@rajahinta/core-domain';

import { D1AuditEventRepository } from '../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import { D1ClickCounterSnapshotRepository } from '../../../packages/data-platform/src/repositories/d1/click-counter-snapshot.repository';
import { openMigratedD1 } from './harness';

// ===========================================================================
// Suite 1 — click analytics snapshots: idempotent capture + durable restore
// ===========================================================================

describe('click analytics snapshots on D1 — idempotent capture, durable restore path', () => {
  const { d1 } = openMigratedD1();
  const snapshots = new D1ClickCounterSnapshotRepository(d1);

  const MERCHANT = 'd1-durability-click-merchant';
  const OFFER_URL = 'https://merchant.example.com/d1-durability-test';

  const rows = async () =>
    (
      (
        await d1
          .prepare(
            `SELECT merchant_id, url, click_count, captured_at
             FROM click_counter_snapshots WHERE merchant_id = ?`,
          )
          .bind(MERCHANT)
          .all()
      ).results as unknown as {
        merchant_id: string;
        url: string;
        click_count: number;
        captured_at: string;
      }[]
    ).map((r) => ({
      merchantId: r.merchant_id,
      url: r.url,
      clickCount: r.click_count,
      capturedAt: r.captured_at,
    }));

  it('snapshots counters idempotently — re-running the same capture instant converges', async () => {
    const at = new Date('2026-08-28T10:00:00.000Z');

    const written = await snapshots.appendBatch([
      { merchantId: MERCHANT, url: OFFER_URL, clickCount: 62, capturedAt: at },
    ]);
    expect(written).toBe(1);

    // Re-running the same capture instant converges (upsert, no dup).
    const rewritten = await snapshots.appendBatch([
      { merchantId: MERCHANT, url: OFFER_URL, clickCount: 62, capturedAt: at },
    ]);
    expect(rewritten).toBe(1);

    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ url: OFFER_URL, clickCount: 62 });
  });

  it('live-store loss does not erase analytics history — counts are re-readable from the D1 snapshots', async () => {
    // On pg this deleted the Redis keys; on Cloudflare the live counters
    // live in ClickCounterDO storage. Either way, the restore path is the
    // snapshot table — simulate the loss by reading ONLY from D1 with no
    // live store involved (exactly what the snapshot-flush consumer does).
    const live: Record<string, unknown> = {}; // the (now empty) live store
    expect(live[MERCHANT]).toBeUndefined();

    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ url: OFFER_URL, clickCount: 62 });
  });

  it('appends an empty batch without writing', async () => {
    expect(await snapshots.appendBatch([])).toBe(0);
  });
});

// ===========================================================================
// Suite 2 — audit events survive a process restart (file-backed D1)
// ===========================================================================

describe('audit events survive a process restart on D1', () => {
  const AUTHOR = 'd1-durability-test-author';
  const ENTITY_TYPE = 'tax_rule';
  const ENTITY_ID = 'd1-durability-entity-1';

  const dir = mkdtempSync(path.join(tmpdir(), 'rajahinta-d1-durability-'));
  const dbFile = path.join(dir, 'durable.sqlite');

  /** One boot: fresh SQLite handle + fresh repository + fresh service. */
  function bootAuditGraph(): {
    audit: AuditService;
    close: () => void;
  } {
    const { db, d1 } = openMigratedD1({ file: dbFile });
    return {
      audit: new AuditService(new D1AuditEventRepository(d1)),
      close: () => db.close(),
    };
  }

  let idsBefore: string[] = [];

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes events through the first process instance', async () => {
    const first = bootAuditGraph();
    try {
      await first.audit.logChange({
        entityType: ENTITY_TYPE,
        entityId: ENTITY_ID,
        action: 'updated',
        author: AUTHOR,
        reason: 'd1 fixture — first change before restart',
        previousValue: { rate: '0.3620' },
        newValue: { rate: '0.4000' },
      });
      await first.audit.logChange({
        entityType: ENTITY_TYPE,
        entityId: ENTITY_ID,
        action: 'confirmed',
        author: AUTHOR,
        reason: 'd1 fixture — confirmation before restart',
      });
      await first.audit.logChange({
        entityType: ENTITY_TYPE,
        entityId: 'd1-durability-entity-2',
        action: 'created',
        author: AUTHOR,
        reason: 'd1 fixture — unrelated entity before restart',
      });

      idsBefore = (await first.audit.queryChanges({ author: AUTHOR })).map(
        (e) => e.id,
      );
      expect(idsBefore).toHaveLength(3);
    } finally {
      // The process "restarts": the storage handle closes and every
      // in-memory instance dies with it.
      first.close();
    }
  });

  it('every event written before the restart is queryable after it', async () => {
    const second = bootAuditGraph();
    try {
      const events = await second.audit.queryChanges({ author: AUTHOR });
      expect(events).toHaveLength(3);
      expect(new Set(events.map((e) => e.id))).toEqual(new Set(idsBefore));
    } finally {
      second.close();
    }
  });

  it('query results stay most-recent-first and payload values round-trip', async () => {
    const second = bootAuditGraph();
    try {
      const events = await second.audit.queryChanges({ author: AUTHOR });
      const times = events.map((e) => e.timestamp);
      expect([...times].sort().reverse()).toEqual(times);

      const update = events.find((e) => e.action === 'updated');
      expect(update).toBeDefined();
      expect(update?.previousValue).toEqual({ rate: '0.3620' });
      expect(update?.newValue).toEqual({ rate: '0.4000' });
      expect(update?.reason).toBe('d1 fixture — first change before restart');
    } finally {
      second.close();
    }
  });

  it('per-entity history is intact after the restart', async () => {
    const second = bootAuditGraph();
    try {
      const history = await second.audit.getChangeHistory(ENTITY_TYPE, ENTITY_ID);
      expect(history).toHaveLength(2);
      expect(
        history.every(
          (e) => e.entityType === ENTITY_TYPE && e.entityId === ENTITY_ID,
        ),
      ).toBe(true);
    } finally {
      second.close();
    }
  });
});
