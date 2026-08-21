import { describe, it, expect } from 'vitest';
import type { ITransportOfferQuery } from '../transport-offer-query.interface';
import type { TransportOffer } from '../transport-offer.type';
import {
  TransportEstimationService,
  NotFoundError,
} from '../transport-estimation.service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2026-08-16T12:00:00Z');

function makeOffer(
  overrides: Partial<TransportOffer> & {
    carrier: string;
    originCountry: string;
    destinationCountry: string;
  },
): TransportOffer {
  return {
    id: overrides.id ?? 1,
    carrier: overrides.carrier,
    originCountry: overrides.originCountry,
    destinationCountry: overrides.destinationCountry,
    weightBracket: overrides.weightBracket ?? { minKg: null, maxKg: null },
    packageTier: overrides.packageTier ?? 'pallet',
    priceCents: overrides.priceCents ?? 5000,
    currency: overrides.currency ?? 'EUR',
    sellerInvolvementIndicator: overrides.sellerInvolvementIndicator ?? false,
    observedAt: overrides.observedAt ?? BASE_DATE,
    refreshedAt: overrides.refreshedAt ?? BASE_DATE,
    reliabilityStatus: overrides.reliabilityStatus ?? 'VERIFIED',
  };
}

/** In-memory query stub — returns the offers passed to the constructor. */
class StubQuery implements ITransportOfferQuery {
  constructor(private readonly offers: TransportOffer[]) {}

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(_carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === _carrierId);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransportEstimationService', () => {
  // -----------------------------------------------------------------------
  // estimate()
  // -----------------------------------------------------------------------

  describe('estimate', () => {
    it('returns VERIFIED when weight fits an existing bracket', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 2000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 10, maxKg: 30 },
          priceCents: 3500,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.estimate('posti', 'DE', 'FI', 5, 'parcel');

      expect(result.reliabilityStatus).toBe('VERIFIED');
      expect(result.offer.priceCents).toBe(2000);
      expect(result.offer.weightBracket).toEqual({ minKg: 0, maxKg: 10 });
      expect(result.matchedWeightBracket).toEqual({ minKg: 0, maxKg: 10 });
    });

    it('returns ESTIMATED + closest bracket when no exact weight match', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 2000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 20, maxKg: 30 },
          priceCents: 4000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      // 15kg is between the two brackets — closest is 0-10 (midpoint 5 vs 25)
      const result = await service.estimate('posti', 'DE', 'FI', 15, 'parcel');

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.offer.priceCents).toBe(2000);
    });

    it('throws NotFoundError when no offers exist for the route', async () => {
      const service = new TransportEstimationService(new StubQuery([]));

      await expect(
        service.estimate('dhl', 'DE', 'FI', 5, 'parcel'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when carrier has offers but none match route', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'SE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      await expect(
        service.estimate('posti', 'DE', 'FI', 5, 'parcel'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when carrier has offers but wrong package tier', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'pallet',
          weightBracket: { minKg: 0, maxKg: 100 },
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      await expect(
        service.estimate('posti', 'DE', 'FI', 10, 'parcel'),
      ).rejects.toThrow(NotFoundError);
    });

    it('matches open-ended upward bracket (min only)', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 50, maxKg: null },
          priceCents: 8000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.estimate('posti', 'DE', 'FI', 100, 'parcel');

      expect(result.reliabilityStatus).toBe('VERIFIED');
      expect(result.offer.priceCents).toBe(8000);
    });

    it('matches open-ended downward bracket (max only)', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: null, maxKg: 5 },
          priceCents: 1000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.estimate('posti', 'DE', 'FI', 2, 'parcel');

      expect(result.reliabilityStatus).toBe('VERIFIED');
      expect(result.offer.priceCents).toBe(1000);
    });

    it('matches completely open bracket (null/null)', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: null, maxKg: null },
          priceCents: 3000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.estimate('posti', 'DE', 'FI', 42, 'parcel');

      expect(result.reliabilityStatus).toBe('VERIFIED');
      expect(result.offer.priceCents).toBe(3000);
    });

    it('ESTIMATED picks the closest midpoint for open-ended brackets', async () => {
      const offers = [
        // two open-ended brackets: [null, 10] (midpoint proxy 10) and [50, null] (midpoint proxy 50)
        makeOffer({
          id: 1,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: null, maxKg: 10 },
          priceCents: 1000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 50, maxKg: null },
          priceCents: 7000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      // 30 is closer to 10 (distance 20) than to 50 (distance 20) — tie goes to first
      // Actually both distances are 20. Our implementation picks first found on tie.
      // Let's use 22: distance to [null,10] = 12, distance to [50,null] = 28
      const result = await service.estimate('posti', 'DE', 'FI', 22, 'parcel');

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.offer.priceCents).toBe(1000);
    });
  });

  // -----------------------------------------------------------------------
  // findOffers()
  // -----------------------------------------------------------------------

  describe('findOffers', () => {
    it('returns all offers for the carrier + route', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'pallet',
        }),
        makeOffer({
          id: 3,
          carrier: 'dhl',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.findOffers('posti', 'DE', 'FI');

      expect(result).toHaveLength(2);
      expect(result.map((o) => o.id)).toEqual([1, 2]);
    });

    it('returns empty array when no offers match', async () => {
      const service = new TransportEstimationService(new StubQuery([]));

      const result = await service.findOffers('posti', 'DE', 'FI');

      expect(result).toEqual([]);
    });

    it('filters by origin and destination', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'SE',
          destinationCountry: 'FI',
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.findOffers('posti', 'DE', 'FI');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // NotFoundError
  // -----------------------------------------------------------------------

  describe('NotFoundError', () => {
    it('carries the original query parameters', () => {
      const err = new NotFoundError('posti', 'DE', 'FI', 'parcel');

      expect(err.carrier).toBe('posti');
      expect(err.origin).toBe('DE');
      expect(err.destination).toBe('FI');
      expect(err.packageType).toBe('parcel');
      expect(err.message).toContain('posti');
      expect(err.message).toContain('DE');
      expect(err.message).toContain('FI');
    });
  });
});