import { describe, it, expect } from 'vitest';
import type { ITransportOfferQuery } from '../transport-offer-query.interface';
import type { TransportOffer } from '../transport-offer.type';
import { BasketShippingCalculator } from '../basket-shipping-calculator.service';
import type {
  BasketItem,
  BasketShippingThresholdCheck,
} from '../basket-shipping.types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2026-08-16T12:00:00Z');

function makeOffer(
  overrides: Partial<TransportOffer> & {
    carrier: string;
    destinationCountry: string;
  },
): TransportOffer {
  return {
    id: overrides.id ?? 1,
    carrier: overrides.carrier,
    originCountry: overrides.originCountry ?? 'DE',
    destinationCountry: overrides.destinationCountry,
    weightBracket: overrides.weightBracket ?? { minKg: null, maxKg: null },
    packageTier: overrides.packageTier ?? 'parcel',
    priceCents: overrides.priceCents ?? 5000,
    currency: overrides.currency ?? 'EUR',
    sellerInvolvementIndicator: overrides.sellerInvolvementIndicator ?? false,
    observedAt: overrides.observedAt ?? BASE_DATE,
    refreshedAt: overrides.refreshedAt ?? BASE_DATE,
    reliabilityStatus: overrides.reliabilityStatus ?? 'EXACT',
  };
}

/** In-memory query stub that returns configured data. */
class StubQuery implements ITransportOfferQuery {
  constructor(private readonly offers: TransportOffer[]) {}

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return this.offers.filter((o) => o.carrier === carrierId);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BasketShippingCalculator', () => {
  // -----------------------------------------------------------------------
  // calculateBasket()
  // -----------------------------------------------------------------------

  describe('calculateBasket', () => {
    it('returns EXACT with correct total when basket fits a weight bracket', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 2000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 10, maxKg: 30 },
          priceCents: 3500,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      const items: BasketItem[] = [
        { weightKg: 2, packageType: 'parcel' },
        { weightKg: 3, packageType: 'parcel' },
      ];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      expect(result.totalWeight).toBe(5);
      expect(result.totalCents).toBe(2000);
      expect(result.reliability).toBe('EXACT');
      expect(result.packageTier).toBe('parcel');
    });

    it('benefits from higher weight tier with better rate', async () => {
      // Basket of 15kg total — should land in the 10-30 bracket (3500¢)
      // instead of the 0-10 bracket (2000¢ * 2 if summed individually)
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 2000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 10, maxKg: 30 },
          priceCents: 3500,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      // Two 7.5kg items = 15kg total → higher tier at 3500¢ instead of 4000¢
      const items: BasketItem[] = [
        { weightKg: 7.5, packageType: 'parcel' },
        { weightKg: 7.5, packageType: 'parcel' },
      ];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      expect(result.totalWeight).toBe(15);
      expect(result.totalCents).toBe(3500);
      expect(result.reliability).toBe('EXACT');
    });

    it('fallbacks to cheapest bracket with ESTIMATED when no exact weight match', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 5 },
          priceCents: 1000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 20, maxKg: 50 },
          priceCents: 6000,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      // 12kg fits neither bracket → cheapest (1000¢) → ESTIMATED
      const items: BasketItem[] = [{ weightKg: 12, packageType: 'parcel' }];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      expect(result.totalCents).toBe(1000);
      expect(result.reliability).toBe('ESTIMATED');
    });

    it('returns PARTIAL when no offers exist for destination/package', async () => {
      const calc = new BasketShippingCalculator(new StubQuery([]));

      const items: BasketItem[] = [
        { weightKg: 5, packageType: 'parcel' },
      ];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      expect(result.totalCents).toBe(0);
      expect(result.reliability).toBe('PARTIAL');
      expect(result.breakdown).toHaveLength(1);
      expect(result.breakdown[0].allocatedCents).toBe(0);
    });

    it('queries all active offers when transportMethod is omitted', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 20 },
          priceCents: 2500,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      const items: BasketItem[] = [{ weightKg: 10, packageType: 'parcel' }];
      const result = await calc.calculateBasket(items, 'FI');

      expect(result.totalCents).toBe(2500);
      expect(result.reliability).toBe('EXACT');
    });

    it('picks dominant package type across mixed items', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'box',
          weightBracket: { minKg: 0, maxKg: 50 },
          priceCents: 3000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 1500,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      // 2 boxes + 1 parcel → dominant is 'box'
      const items: BasketItem[] = [
        { weightKg: 5, packageType: 'box' },
        { weightKg: 8, packageType: 'box' },
        { weightKg: 2, packageType: 'parcel' },
      ];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      expect(result.packageTier).toBe('box');
      expect(result.totalCents).toBe(3000);
    });

    it('allocates cost proportionally by weight', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 20 },
          priceCents: 1000,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      const items: BasketItem[] = [
        { weightKg: 1, packageType: 'parcel' },
        { weightKg: 3, packageType: 'parcel' },
      ];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      // 4kg total, 1kg gets 250¢, 3kg gets 750¢
      expect(result.breakdown[0].allocatedCents).toBe(250);
      expect(result.breakdown[1].allocatedCents).toBe(750);
      expect(
        result.breakdown.reduce((s, b) => s + b.allocatedCents, 0),
      ).toBe(result.totalCents);
    });

    it('handles rounding of proportional allocation correctly', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 20 },
          priceCents: 100, // 100¢ for 3kg = 33.33¢ each
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      const items: BasketItem[] = [
        { weightKg: 1, packageType: 'parcel' },
        { weightKg: 1, packageType: 'parcel' },
        { weightKg: 1, packageType: 'parcel' },
      ];
      const result = await calc.calculateBasket(items, 'FI', 'posti');

      // Each initially gets 33 (Math.round(100/3)), sum = 99, diff = 1 added to largest
      expect(
        result.breakdown.reduce((s, b) => s + b.allocatedCents, 0),
      ).toBe(100);
    });

    it('sets weightTier label from bracket boundaries', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 5, maxKg: 10 },
          priceCents: 2000,
        }),
      ];
      const calc = new BasketShippingCalculator(new StubQuery(offers));

      const result = await calc.calculateBasket(
        [{ weightKg: 7, packageType: 'parcel' }],
        'FI',
        'posti',
      );

      expect(result.weightTier).toBe('5–10 kg');
    });
  });

  // -----------------------------------------------------------------------
  // checkThreshold()
  // -----------------------------------------------------------------------

  describe('checkThreshold', () => {
    const calc = new BasketShippingCalculator(new StubQuery([]));

    it('returns qualifies=true when total meets threshold', () => {
      const result: BasketShippingThresholdCheck = calc.checkThreshold(10000, 10000);
      expect(result.qualifiesForFreeShipping).toBe(true);
      expect(result.remainingToFreeCents).toBeNull();
    });

    it('returns qualifies=true when total exceeds threshold', () => {
      const result: BasketShippingThresholdCheck = calc.checkThreshold(15000, 10000);
      expect(result.qualifiesForFreeShipping).toBe(true);
      expect(result.remainingToFreeCents).toBeNull();
    });

    it('returns qualifies=false with remaining when total below threshold', () => {
      const result: BasketShippingThresholdCheck = calc.checkThreshold(8000, 10000);
      expect(result.qualifiesForFreeShipping).toBe(false);
      expect(result.remainingToFreeCents).toBe(2000);
    });

    it('returns no-threshold info when threshold is null', () => {
      const result: BasketShippingThresholdCheck = calc.checkThreshold(5000, null);
      expect(result.freeShippingThresholdCents).toBeNull();
      expect(result.qualifiesForFreeShipping).toBe(false);
      expect(result.remainingToFreeCents).toBeNull();
    });

    it('returns no-threshold info when threshold is zero', () => {
      const result: BasketShippingThresholdCheck = calc.checkThreshold(5000, 0);
      expect(result.freeShippingThresholdCents).toBeNull();
      expect(result.qualifiesForFreeShipping).toBe(false);
      expect(result.remainingToFreeCents).toBeNull();
    });
  });
});