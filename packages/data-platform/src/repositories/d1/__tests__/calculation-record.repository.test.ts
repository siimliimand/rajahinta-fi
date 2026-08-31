/**
 * D1CalculationRecordRepository — real-SQLite tests (task 2.5) on the
 * node:sqlite harness with the committed migrations applied. Ports the
 * pg repository behaviors: composite-PK id assignment, session ordering,
 * atomic first-claim-wins linkSession, the GDPR-export projection, and
 * the entity-reference lookups (jsonb containment translated to
 * json_each).
 *
 * @module D1CalculationRecordRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1CalculationRecordRepository } from '../calculation-record.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1CalculationRecordRepository(d1);

let productIdSeq = 500;
async function seedProduct(): Promise<number> {
  const id = ++productIdSeq;
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'm', 'b', 'beer', 0.5, 'can', 'beer')`,
  ).run(id, `product-${id}`);
  return id;
}

let recordSeq = 0;
function recordInput(overrides: {
  productMasterId: number;
  sessionId?: string | null;
  retailOfferIds?: number[] | null;
  transportOfferId?: number | null;
  exciseRuleVersionId?: number | null;
  containerDutyRuleVersionId?: number | null;
  calculatedAt?: Date;
}) {
  recordSeq += 1;
  return {
    productMasterId: overrides.productMasterId,
    retailOfferIds: overrides.retailOfferIds ?? null,
    transportOfferId: overrides.transportOfferId ?? null,
    exciseRuleVersionId: overrides.exciseRuleVersionId ?? null,
    containerDutyRuleVersionId: overrides.containerDutyRuleVersionId ?? null,
    totalCents: 1000 + recordSeq,
    breakdown: { excise: 500, container: 100 },
    confidence: 'HIGH',
    quantity: 1,
    destination: 'FI',
    disclaimer: 'Estimate — not tax advice.',
    sessionId: overrides.sessionId ?? null,
    calculatedAt: overrides.calculatedAt,
  };
}

describe('D1CalculationRecordRepository', () => {
  it('creates and reads back a record with the pg contract shape', async () => {
    const productId = await seedProduct();
    const created = await repo.create(recordInput({ productMasterId: productId, retailOfferIds: [3, 7] }));

    // Application-side id assignment on the composite-PK table.
    expect(created.id).toBeGreaterThan(0);
    expect(created.retailOfferIds).toEqual([3, 7]);
    expect(created.breakdown).toEqual({ excise: 500, container: 100 });
    expect(created.calculatedAt).toBeInstanceOf(Date);
    expect(created.sessionId).toBeNull();

    const loaded = await repo.findById(created.id);
    expect(loaded).toEqual(created);
  });

  it('returns null for an unknown id', async () => {
    await expect(repo.findById(999_999_999)).resolves.toBeNull();
  });

  it('lists a session records chronologically', async () => {
    const productId = await seedProduct();
    const sessionId = 'sess-order-1';
    await repo.create(recordInput({ productMasterId: productId, sessionId, calculatedAt: new Date('2026-08-28T10:00:00.000Z') }));
    await repo.create(recordInput({ productMasterId: productId, sessionId, calculatedAt: new Date('2026-08-28T09:00:00.000Z') }));
    await repo.create(recordInput({ productMasterId: productId, sessionId: 'other-session', calculatedAt: new Date('2026-08-28T08:00:00.000Z') }));

    const rows = await repo.findBySession(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.calculatedAt.toISOString())).toEqual([
      '2026-08-28T09:00:00.000Z',
      '2026-08-28T10:00:00.000Z',
    ]);
  });

  describe('linkSession', () => {
    it('claims an anonymous record; first claim wins, never re-assigned', async () => {
      const productId = await seedProduct();
      const record = await repo.create(recordInput({ productMasterId: productId }));

      await expect(repo.linkSession(record.id, 'session-a')).resolves.toBe(true);
      await expect(repo.linkSession(record.id, 'session-b')).resolves.toBe(false);

      const after = await repo.findById(record.id);
      expect(after?.sessionId).toBe('session-a');
    });

    it('reports false for an unknown record', async () => {
      await expect(repo.linkSession(987_654_321, 'session-x')).resolves.toBe(false);
    });
  });

  it('returns the minimal GDPR-export projection with the product name joined', async () => {
    const productId = await seedProduct();
    const sessionId = 'sess-gdpr';
    await repo.create({ ...recordInput({ productMasterId: productId, sessionId, calculatedAt: new Date('2026-08-28T09:00:00.000Z') }), totalCents: 291, quantity: 6 });

    const entries = await repo.findHistoryEntriesBySession(sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      totalCents: 291,
      quantity: 6,
      productName: `product-${productId}`,
    });
    expect(entries[0]!.calculatedAt).toEqual(new Date('2026-08-28T09:00:00.000Z'));
    // The export carries only what its consumers render — no breakdown.
    expect(Object.keys(entries[0]!).sort()).toEqual(
      ['calculationId', 'calculatedAt', 'productName', 'quantity', 'totalCents'].sort(),
    );
  });

  describe('findCalculationRecordIdsByEntity', () => {
    let productId: number;
    let offerRecordId: number;
    let transportRecordId: number;
    let taxRuleRecordId: number;

    it('resolves every entity type including the json_each containment translation', async () => {
      productId = await seedProduct();

      db.prepare(
        `INSERT INTO transport_offers (id, carrier, origin_country, package_tier, price_cents)
         VALUES (6001, 'posti', 'EE', 'parcel', 690)`,
      ).run();
      db.prepare(
        `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from, calculation_formula_reference, official_source, version_label)
         VALUES (6002, 'excise', 'beer', 28.35, '2026-01-01T00:00:00.000Z', 'FLAT_PER_LITRE', 'https://vero.fi', 'v-test-beer')`,
      ).run();

      offerRecordId = (
        await repo.create(recordInput({ productMasterId: productId, retailOfferIds: [42, 43] }))
      ).id;
      transportRecordId = (
        await repo.create(recordInput({ productMasterId: productId, transportOfferId: 6001 }))
      ).id;
      taxRuleRecordId = (
        await repo.create(
          recordInput({
            productMasterId: productId,
            exciseRuleVersionId: 6002,
            containerDutyRuleVersionId: 6002,
          }),
        )
      ).id;

      await expect(repo.findCalculationRecordIdsByEntity('product', productId)).resolves.toContain(offerRecordId);

      // pg jsonb @> containment → json_each EXISTS.
      await expect(
        repo.findCalculationRecordIdsByEntity('retailOffer', 42),
      ).resolves.toEqual([offerRecordId]);
      await expect(
        repo.findCalculationRecordIdsByEntity('retailOffer', 43),
      ).resolves.toEqual([offerRecordId]);
      await expect(
        repo.findCalculationRecordIdsByEntity('retailOffer', 44),
      ).resolves.toEqual([]);

      await expect(
        repo.findCalculationRecordIdsByEntity('transportOffer', 6001),
      ).resolves.toEqual([transportRecordId]);

      // taxRule matches either FK column.
      await expect(
        repo.findCalculationRecordIdsByEntity('taxRule', 6002),
      ).resolves.toEqual([taxRuleRecordId]);
    });

    it('unknown entity types return no ids', async () => {
      await expect(
        repo.findCalculationRecordIdsByEntity('merchant', 1),
      ).resolves.toEqual([]);
    });
  });
});
