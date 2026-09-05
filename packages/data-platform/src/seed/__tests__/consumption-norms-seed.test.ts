/**
 * Consumption-norms seed tests (task 4.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the governance contract the
 * spec pins: every row carries a verifiable source citation (a
 * citation-less norms row is unrepresentable), every row lands
 * PENDING_CONFIRMATION (publication is the operator's manual step,
 * never the seed's), the curated matrix is complete and idempotent,
 * and the upsert can never rewrite a PUBLISHED row (append-only).
 *
 * @module ConsumptionNormsSeedTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from '../../repositories/d1/__tests__/d1-test-harness';
import { D1ConsumptionNormsRepository } from '../../repositories/d1/consumption-norms.repository';
import {
  CONSUMPTION_NORM_DRINK_TYPES,
  CONSUMPTION_NORM_EVENT_PROFILES,
} from '../../repositories/d1/consumption-norms.repository';
import {
  CONSUMPTION_NORMS_SEED,
  CONSUMPTION_NORMS_SEED_VERSION,
  CONSUMPTION_NORMS_CITATION_URL,
  seedConsumptionNorms,
} from '../consumption-norms.seed';

const { db, d1 } = openMigratedD1();
const repo = new D1ConsumptionNormsRepository(d1);

function rowCount(): number {
  return (db.prepare('SELECT count(*) AS n FROM consumption_norms').get() as { n: number }).n;
}

describe('consumption norms seed — curated content', () => {
  it('covers the full drink type × event profile matrix, each key exactly once', () => {
    expect(CONSUMPTION_NORMS_SEED).toHaveLength(
      CONSUMPTION_NORM_DRINK_TYPES.length * CONSUMPTION_NORM_EVENT_PROFILES.length,
    );

    const keys = CONSUMPTION_NORMS_SEED.map((r) => `${r.drinkType}|${r.eventProfile}`);
    expect(new Set(keys).size).toBe(keys.length);

    for (const drinkType of CONSUMPTION_NORM_DRINK_TYPES) {
      for (const eventProfile of CONSUMPTION_NORM_EVENT_PROFILES) {
        expect(keys).toContain(`${drinkType}|${eventProfile}`);
      }
    }
  });

  it('carries a verifiable source citation on every row — a citation-less norm is unrepresentable', () => {
    for (const row of CONSUMPTION_NORMS_SEED) {
      expect(row.sourceCitation.trim().length).toBeGreaterThan(0);
      // The verifiable reference an operator can actually open.
      expect(row.sourceCitation).toContain(CONSUMPTION_NORMS_CITATION_URL);
      expect(row.sourceCitation).toContain('https://');
      // The audited derivation (drinks/hour × 15.2 ml ÷ ABV), not a bare link.
      expect(row.sourceCitation).toContain('derivation:');
      expect(row.sourceCitation).toContain('Finnish standard drink');
    }
  });

  it('stays inside the schema vocabularies and positive-value rules (mirrors the CHECKs before they run)', () => {
    for (const row of CONSUMPTION_NORMS_SEED) {
      expect(CONSUMPTION_NORM_DRINK_TYPES).toContain(row.drinkType);
      expect(CONSUMPTION_NORM_EVENT_PROFILES).toContain(row.eventProfile);
      expect(row.normValuePerGuestPerHour).toBeGreaterThan(0);
      expect(Number.isFinite(row.normValuePerGuestPerHour)).toBe(true);
    }
  });

  it('is one version, dated 2026-01-01, open-ended — deterministic, never wall-clock', () => {
    for (const row of CONSUMPTION_NORMS_SEED) {
      expect(row.versionLabel).toBe(CONSUMPTION_NORMS_SEED_VERSION);
      expect(row.effectiveFrom).toBe('2026-01-01');
      expect(row.effectiveTo).toBeNull();
    }
  });
});

describe('consumption norms seed — apply', () => {
  it('lands the whole version in one batch, every row PENDING_CONFIRMATION', async () => {
    await seedConsumptionNorms(d1);
    expect(rowCount()).toBe(CONSUMPTION_NORMS_SEED.length);

    const statuses = db
      .prepare('SELECT DISTINCT status FROM consumption_norms')
      .all() as Array<{ status: string }>;
    expect(statuses).toEqual([{ status: 'PENDING_CONFIRMATION' }]);

    const stored = db
      .prepare(
        `SELECT norm_value_per_guest_per_hour, source_citation
         FROM consumption_norms WHERE drink_type = 'beer' AND event_profile = 'casual_gathering'`,
      )
      .get() as { norm_value_per_guest_per_hour: number; source_citation: string };
    const curated = CONSUMPTION_NORMS_SEED.find(
      (r) => r.drinkType === 'beer' && r.eventProfile === 'casual_gathering',
    )!;
    expect(stored.norm_value_per_guest_per_hour).toBe(curated.normValuePerGuestPerHour);
    expect(stored.source_citation).toBe(curated.sourceCitation);
  });

  it('is idempotent: a re-run refreshes pending rows in place, never duplicates', async () => {
    await seedConsumptionNorms(d1);
    await seedConsumptionNorms(d1);
    expect(rowCount()).toBe(CONSUMPTION_NORMS_SEED.length);

    // Stored values match the curated constant exactly (replace, not drift).
    const rows = db
      .prepare('SELECT norm_value_per_guest_per_hour, source_citation FROM consumption_norms')
      .all() as Array<{ norm_value_per_guest_per_hour: number; source_citation: string }>;
    for (const row of rows) {
      expect(
        CONSUMPTION_NORMS_SEED.some(
          (curated) =>
            curated.normValuePerGuestPerHour === row.norm_value_per_guest_per_hour &&
            curated.sourceCitation === row.source_citation,
        ),
      ).toBe(true);
    }
  });

  it('can never rewrite a PUBLISHED row — the append-only guard skips terminal rows on re-run', async () => {
    await seedConsumptionNorms(d1);

    // The operator confirms publication through the manual path.
    const before = await repo.findPublishedEffectiveNorm('beer', 'casual_gathering', '2026-06-01');
    expect(before).toBeNull(); // nothing published yet
    const [pendingRow] = await repo.findByVersionLabel(CONSUMPTION_NORMS_SEED_VERSION);
    const published = await repo.publish(pendingRow.id, 'ops@example.invalid');
    expect(published!.status).toBe('PUBLISHED');

    // Simulate post-publication drift on the published row: the seed's
    // re-run must NOT reconcile it (corrections append a new version).
    db.exec('UPDATE consumption_norms SET norm_value_per_guest_per_hour = 9.99 WHERE id = ' + pendingRow.id);
    await seedConsumptionNorms(d1);

    const after = await repo.findById(pendingRow.id);
    expect(after!.normValuePerGuestPerHour).toBe(9.99); // untouched — still terminal
    expect(after!.status).toBe('PUBLISHED');

    // Pending rows were still refreshed by the same re-run (upsert ran).
    const untouchedCount = (
      db
        .prepare(
          `SELECT count(*) AS n FROM consumption_norms
           WHERE status = 'PENDING_CONFIRMATION' AND norm_value_per_guest_per_hour != 9.99`,
        )
        .get() as { n: number }
    ).n;
    expect(untouchedCount).toBe(CONSUMPTION_NORMS_SEED.length - 1);
  });
});
