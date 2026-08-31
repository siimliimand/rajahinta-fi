/**
 * D1TransportOfferRepository — real-SQLite tests (task 2.5): carrier
 * reads, the 7-day freshness fallback, weight-bracket matching with
 * open ends, and the pg-shape contract (decimal-text weights, Date
 * instants, boolean involvement).
 *
 * @module D1TransportOfferRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1TransportOfferRepository } from '../transport-offer.repository';

const { d1 } = openMigratedD1();
const repo = new D1TransportOfferRepository(d1);

let offerIdSeq = 1000;
function seedOffer(overrides: {
  carrier?: string;
  originCountry?: string;
  destinationCountry?: string;
  weightMinKg?: number | null;
  weightMaxKg?: number | null;
  packageTier?: string;
  priceCents?: number;
  observedAt?: string;
  refreshedAt?: string;
}): number {
  const id = ++offerIdSeq;
  d1.prepare(
    `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
       weight_min_kg, weight_max_kg, package_tier, price_cents,
       seller_involvement_indicator, observed_at, refreshed_at, reliability_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED')`,
  ).bind(
    id,
    overrides.carrier ?? 'posti',
    overrides.originCountry ?? 'EE',
    overrides.destinationCountry ?? 'FI',
    overrides.weightMinKg ?? null,
    overrides.weightMaxKg ?? null,
    overrides.packageTier ?? 'parcel',
    overrides.priceCents ?? 690,
    0,
    overrides.observedAt ?? new Date().toISOString(),
    overrides.refreshedAt ?? new Date().toISOString(),
  ).run();
  return id;
}

describe('D1TransportOfferRepository', () => {
  it('lists a carrier offers with the pg contract shape', async () => {
    const id = seedOffer({ carrier: 'matkahuolto', weightMinKg: 0.5, weightMaxKg: 20 });
    seedOffer({ carrier: 'posti' });

    const rows = await repo.findByCarrier('matkahuolto');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(id);
    // pg numeric(10,4) decimal text at the repository boundary.
    expect(row.weightMinKg).toBe('0.5000');
    expect(row.weightMaxKg).toBe('20.0000');
    expect(row.observedAt).toBeInstanceOf(Date);
    expect(row.refreshedAt).toBeInstanceOf(Date);
    expect(row.sellerInvolvementIndicator).toBe(false);
  });

  it('returns only fresh offers when any are within seven days', async () => {
    const freshId = seedOffer({ carrier: 'freshco', observedAt: new Date(Date.now() - 86_400_000).toISOString() });
    seedOffer({ carrier: 'freshco', observedAt: '2026-01-01T00:00:00.000Z' });

    const active = await repo.findActive();
    const freshcoRows = active.filter((r) => r.carrier === 'freshco');
    expect(freshcoRows.map((r) => r.id)).toEqual([freshId]);
  });

  it('falls back to the whole table when nothing is fresh', async () => {
    // Isolated DB: no fresh rows anywhere, so the 7-day read comes back
    // empty and the fallback must return the whole table.
    const isolated = openMigratedD1();
    const isolatedRepo = new D1TransportOfferRepository(isolated.d1);
    isolated.d1
      .prepare(
        `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
           weight_min_kg, weight_max_kg, package_tier, price_cents,
           seller_involvement_indicator, observed_at, refreshed_at, reliability_status)
         VALUES (9501, 'oldco', 'EE', 'FI', NULL, NULL, 'parcel', 690, 0,
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'STALE')`,
      )
      .run();

    const active = await isolatedRepo.findActive();
    expect(active.map((r) => r.id)).toContain(9501);
  });

  it('matches the weight bracket numerically with open ends', async () => {
    // pg predicate: weightMinKg <= weightKg < weightMaxKg (null = open end).
    const lowerClosed = seedOffer({ carrier: 'brackets', weightMinKg: 10, weightMaxKg: 30 }); // min closed: 10 <= 10 ✓
    const openEnded = seedOffer({ carrier: 'brackets', weightMinKg: null, weightMaxKg: null }); // always matches
    seedOffer({ carrier: 'brackets', weightMinKg: 2, weightMaxKg: 10 }); // max open: 10 < 10 ✗
    seedOffer({ carrier: 'brackets', weightMinKg: 0.1, weightMaxKg: 2 }); // max open: 2 > 10 ✗

    const rows = await repo.findApplicable('brackets', 'EE', 'FI', 10, 'parcel');
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([lowerClosed, openEnded].sort((a, b) => a - b));
  });

  it('filters by route and package tier', async () => {
    seedOffer({ carrier: 'routing', originCountry: 'EE', destinationCountry: 'FI', packageTier: 'parcel' });
    seedOffer({ carrier: 'routing', originCountry: 'EE', destinationCountry: 'FI', packageTier: 'pallet' });
    seedOffer({ carrier: 'routing', originCountry: 'SE', destinationCountry: 'FI', packageTier: 'parcel' });

    const rows = await repo.findApplicable('routing', 'EE', 'FI', 5, 'parcel');
    expect(rows).toHaveLength(1);
  });
});
