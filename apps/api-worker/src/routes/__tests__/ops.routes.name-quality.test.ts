/**
 * Ops console name-quality quarantine listing (task 3.1, change
 * product-name-quality-gate) — the read-only enrichment queue driven
 * against the REAL migrated node:sqlite database: guard fail-closed on
 * the new path, the { items, total } envelope, the raw-name/annotation/
 * merchant/observed shape, the latest-observation merchant attribution,
 * and the oldest-first order with never-observed rows first.
 *
 * @module OpsRoutesNameQualityTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
} from './harness';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };

/** Flip a seeded product to the gate's quarantined state (0037 columns). */
function quarantine(
  db: DatabaseSync,
  id: number,
  { annotation }: { annotation?: string } = {},
): void {
  db.prepare(
    `UPDATE product_master SET name_quality = 'quarantined', name_annotation = ? WHERE id = ?`,
  ).run(annotation ?? null, id);
}

describe('name-quality quarantine listing', () => {
  it('403s without credentials, serves the queue with the bearer', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const locked = await request(app, lockedEnv(d1), '/ops/console/name-quality/quarantined');
    await expectEnvelope(locked, 403, { message: 'Forbidden' });

    const ok = await request(app, permissiveEnv(d1), '/ops/console/name-quality/quarantined', {
      headers: OPS,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('lists quarantined rows with raw name, annotation, latest merchant and observed_at; ok rows stay out', async () => {
    const { db, d1 } = openMigratedD1();
    const app = buildApp();

    // Token-only name, two merchants — the LATEST observation attributes
    // the merchant (eu-import is newer than alko here).
    seedProduct(db, { id: 1, name: '40 %' });
    quarantine(db, 1);
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', observedAt: '2026-10-01T10:00:00.000Z' });
    seedOffer(db, { id: 12, productId: 1, merchant: 'eu-import', observedAt: '2026-10-10T10:00:00.000Z' });

    // Annotated + quarantined, never observed — sorts FIRST (stalest).
    seedProduct(db, { id: 2, name: 'ÀN 2022' });
    quarantine(db, 2, { annotation: 'saatavuus 1 plo' });

    // A healthy row — never in the quarantine queue.
    seedProduct(db, { id: 3, name: 'Karhu III' });

    const res = await request(app, permissiveEnv(d1), '/ops/console/name-quality/quarantined', {
      headers: OPS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        productId: number;
        name: string;
        nameAnnotation: string | null;
        merchant: string | null;
        observedAt: string | null;
      }[];
      total: number;
    };

    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.productId)).toEqual([2, 1]);

    const [neverObserved, observed] = body.items;
    expect(neverObserved.name).toBe('ÀN 2022');
    expect(neverObserved.nameAnnotation).toBe('saatavuus 1 plo');
    expect(neverObserved.merchant).toBeNull();
    expect(neverObserved.observedAt).toBeNull();

    expect(observed.name).toBe('40 %');
    expect(observed.nameAnnotation).toBeNull();
    expect(observed.merchant).toBe('eu-import');
    expect(observed.observedAt).toBe('2026-10-10T10:00:00.000Z');
  });
});
