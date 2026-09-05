/**
 * D1CarrierBoxTypesRepository — real-SQLite tests (task 3.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers carrier scoping, the
 * smallest-internal-volume-first ordering the packing engine iterates in
 * (design R4: smallest sufficient box), cross-carrier listing, and the
 * positive-dimension schema guards. Each test gets a fresh migrated
 * database — rows assert on the (carrier, name) unique key, which a
 * shared fixture set would collide on.
 *
 * @module D1CarrierBoxTypesRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1CarrierBoxTypesRepository, type CarrierBoxTypeRecord } from '../carrier-box-types.repository';
import type { DatabaseSync } from 'node:sqlite';

const OBSERVED_AT = '2026-09-01T00:00:00.000Z';
const SOURCE = 'https://carrier.example/packaging';

/** Fresh migrated DB + repository per test — no (carrier, name) collisions across cases. */
function makeFixture(): { db: DatabaseSync; repo: D1CarrierBoxTypesRepository } {
  const { db, d1 } = openMigratedD1();
  return { db, repo: new D1CarrierBoxTypesRepository(d1) };
}

/** Insert one box directly — repository tests are independent of the seed module. */
function insertBox(
  db: DatabaseSync,
  carrier: string,
  name: string,
  heightMm: number,
  widthMm: number,
  depthMm: number,
  maxWeightG: number,
): void {
  db.prepare(
    `INSERT INTO carrier_box_types (carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm, max_weight_g, source, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carrier, name, heightMm, widthMm, depthMm, maxWeightG, SOURCE, OBSERVED_AT);
}

/** Internal volume in mm³ — the ordering key under test. */
function volume(box: CarrierBoxTypeRecord): number {
  return box.internalHeightMm * box.internalWidthMm * box.internalDepthMm;
}

describe('D1CarrierBoxTypesRepository', () => {
  it('lists one carrier’s boxes smallest internal volume first', async () => {
    const { db, repo } = makeFixture();
    insertBox(db, 'postnord', 'PostNord Box L', 340, 250, 160, 10000);
    insertBox(db, 'postnord', 'PostNord Box S', 180, 130, 60, 2000);
    insertBox(db, 'postnord', 'PostNord Box M', 240, 190, 100, 5000);

    const boxes = await repo.listByCarrier('postnord');
    expect(boxes.map((b) => b.name)).toEqual(['PostNord Box S', 'PostNord Box M', 'PostNord Box L']);
    const volumes = boxes.map(volume);
    expect([...volumes].sort((a, b) => a - b)).toEqual(volumes);
  });

  it('scopes listings to the carrier — other carriers’ boxes never leak in', async () => {
    const { db, repo } = makeFixture();
    insertBox(db, 'postnord', 'PostNord Box M', 240, 190, 100, 5000);
    insertBox(db, 'dhl', 'DHL Paket S', 250, 175, 100, 5000);

    const postnord = await repo.listByCarrier('postnord');
    expect(postnord.length).toBe(1);
    expect(postnord.every((b) => b.carrier === 'postnord')).toBe(true);

    // Unknown carrier — an empty catalogue, not an error.
    await expect(repo.listByCarrier('matkahuolto')).resolves.toEqual([]);
  });

  it('listAll walks every carrier smallest-first with a deterministic carrier tiebreak', async () => {
    const { db, repo } = makeFixture();
    insertBox(db, 'postnord', 'PostNord Box M', 240, 190, 100, 5000); // 4,560,000
    insertBox(db, 'dhl', 'DHL Paket S', 250, 175, 100, 5000); // 4,375,000
    insertBox(db, 'dhl', 'DHL Paket M', 350, 250, 150, 10000); // 13,125,000
    insertBox(db, 'postnord', 'PostNord Box L', 340, 250, 160, 10000); // 13,600,000

    const boxes = await repo.listAll();
    expect(boxes.map((b) => `${b.carrier}/${b.name}`)).toEqual([
      'dhl/DHL Paket S',
      'postnord/PostNord Box M',
      'dhl/DHL Paket M',
      'postnord/PostNord Box L',
    ]);
  });

  it('round-trips every column including provenance', async () => {
    const { db, repo } = makeFixture();
    insertBox(db, 'dhl', 'DHL Paket L', 450, 300, 200, 20000);

    const [box] = await repo.listByCarrier('dhl');
    expect(box).toMatchObject({
      carrier: 'dhl',
      name: 'DHL Paket L',
      internalHeightMm: 450,
      internalWidthMm: 300,
      internalDepthMm: 200,
      maxWeightG: 20000,
      source: SOURCE,
    });
    expect(box!.observedAt).toEqual(new Date(OBSERVED_AT));
  });

  it('rejects non-positive dimensions and weight at the schema level', () => {
    const { db } = makeFixture();
    const guarded = `INSERT INTO carrier_box_types (carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm, max_weight_g, source, observed_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const row of [
      ['c', 'b1', 0, 100, 100, 1000],
      ['c', 'b2', 100, 0, 100, 1000],
      ['c', 'b3', 100, 100, 0, 1000],
      ['c', 'b4', 100, 100, 100, 0],
    ]) {
      expect(() =>
        db.prepare(guarded).run(row[0], row[1], row[2], row[3], row[4], row[5], SOURCE, OBSERVED_AT),
      ).toThrow();
    }
  });
});
