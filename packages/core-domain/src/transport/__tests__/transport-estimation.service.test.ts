import { describe, it, expect } from 'vitest';
import type { ITransportOfferQuery } from '../transport-offer-query.interface';
import type { TransportOffer } from '../transport-offer.type';
import {
  TransportEstimationService,
  NotFoundError,
} from '../transport-estimation.service';
import {
  deriveShipmentTier,
  isPackageTier,
} from '../shipment-tier';
import { selectBestBracketOffer, inBracket } from '../bracket-selection';

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
  /** Carrier IDs the service actually looked up (normalization assertions). */
  readonly carrierLookups: string[] = [];

  constructor(private readonly offers: TransportOffer[]) {}

  async findAllActive(): Promise<TransportOffer[]> {
    return this.offers;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    this.carrierLookups.push(carrierId);
    return this.offers.filter((o) => o.carrier === carrierId);
  }
}

/**
 * Fransberg-shaped dataset (design D3): per-parcel-count parcel brackets
 * capped at 31.5 kg each, pallet freight above the parcel range.
 */
function makeFransbergOffers(): TransportOffer[] {
  return [
    makeOffer({
      id: 1,
      carrier: 'fransberg',
      originCountry: 'DE',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 0, maxKg: 31.5 },
      priceCents: 1490,
    }),
    makeOffer({
      id: 2,
      carrier: 'fransberg',
      originCountry: 'DE',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 31.5, maxKg: 63 },
      priceCents: 2490,
    }),
    makeOffer({
      id: 3,
      carrier: 'fransberg',
      originCountry: 'DE',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 63, maxKg: 94.5 },
      priceCents: 3490,
    }),
    makeOffer({
      id: 4,
      carrier: 'fransberg',
      originCountry: 'DE',
      destinationCountry: 'FI',
      packageTier: 'pallet',
      weightBracket: { minKg: 300, maxKg: 720 },
      priceCents: 19900,
    }),
  ];
}

/** The parcel-only prefix of the Fransberg shape (no pallet rows at all). */
function makeParcelOnlyOffers(): TransportOffer[] {
  return makeFransbergOffers().filter((o) => o.packageTier === 'parcel');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransportEstimationService', () => {
  // -----------------------------------------------------------------------
  // estimate()
  // -----------------------------------------------------------------------

  describe('estimate', () => {
    it('returns VERIFIED when weight fits an existing bracket on a stored weight', async () => {
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

      // 5 kg total, stored weight → exact bracket + stored basis (D6)
      const result = await service.estimate('posti', 'DE', 'FI', 5, 5000);

      expect(result.reliabilityStatus).toBe('VERIFIED');
      expect(result.offer.priceCents).toBe(2000);
      expect(result.offer.weightBracket).toEqual({ minKg: 0, maxKg: 10 });
      expect(result.matchedWeightBracket).toEqual({ minKg: 0, maxKg: 10 });
    });

    it('caps an exact bracket at ESTIMATED when the basis is a volume estimate (D6)', async () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 2000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      // Same exact bracket, but no stored weight → the pre-D6 rule said
      // VERIFIED here; the honest rule downgrades the status and moves no
      // monetary figure.
      const result = await service.estimate('posti', 'DE', 'FI', 5);

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.weightBasis).toBe('VOLUME_ESTIMATE');
      expect(result.offer.priceCents).toBe(2000);
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
      const result = await service.estimate('posti', 'DE', 'FI', 15);

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.offer.priceCents).toBe(2000);
    });

    it('throws NotFoundError when no offers exist for the route', async () => {
      const service = new TransportEstimationService(new StubQuery([]));

      await expect(
        service.estimate('dhl', 'DE', 'FI', 5),
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
        service.estimate('posti', 'DE', 'FI', 5),
      ).rejects.toThrow(NotFoundError);
    });

    it('matches by weight-derived tier even when the legacy packageType argument disagrees (D3)', async () => {
      // Only pallet rows exist. Pre-D3 this request (packageType 'parcel')
      // found nothing; the weight-derived tier prices it anyway — container
      // material no longer gates the transport join.
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'pallet',
          weightBracket: { minKg: 0, maxKg: 100 },
          priceCents: 7500,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.estimate('posti', 'DE', 'FI', 10, 'parcel');

      expect(result.offer.priceCents).toBe(7500);
      expect(result.matchedWeightBracket).toEqual({ minKg: 0, maxKg: 100 });
      expect(result.reliabilityStatus).toBe('ESTIMATED');
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

      // Open-ended parcel row → the carrier prices parcels at any weight
      // (D3); stored grams keep the exact match VERIFIED (D6).
      const result = await service.estimate('posti', 'DE', 'FI', 100, 100000);

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

      const result = await service.estimate('posti', 'DE', 'FI', 2, 2000);

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

      const result = await service.estimate('posti', 'DE', 'FI', 42, 42000);

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

      // 22: distance to [null,10] = 12, distance to [50,null] = 28
      const result = await service.estimate('posti', 'DE', 'FI', 22);

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.offer.priceCents).toBe(1000);
    });
  });

  // -----------------------------------------------------------------------
  // estimate() — carrier normalization (design D2)
  // -----------------------------------------------------------------------

  describe('estimate — carrier normalization', () => {
    const offers = makeFransbergOffers();

    it('trims and lowercases the carrier before querying', async () => {
      const query = new StubQuery(offers);
      const service = new TransportEstimationService(query);

      const result = await service.estimate('  Fransberg  ', 'DE', 'FI', 40);

      expect(query.carrierLookups).toEqual(['fransberg']);
      expect(result.offer.priceCents).toBe(2490);
    });

    it('matches case-insensitively against stored lowercase IDs', async () => {
      const query = new StubQuery([
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
          priceCents: 2000,
        }),
      ]);
      const service = new TransportEstimationService(query);

      const result = await service.estimate('POSTI', 'DE', 'FI', 5);

      expect(query.carrierLookups).toEqual(['posti']);
      expect(result.offer.priceCents).toBe(2000);
    });

    it('still degrades to NotFoundError for a genuinely unknown carrier', async () => {
      const service = new TransportEstimationService(new StubQuery(offers));

      await expect(
        service.estimate('  DHL Express  ', 'DE', 'FI', 5),
      ).rejects.toThrow(NotFoundError);
    });

    it('normalizes the carrier in findOffers too', async () => {
      const query = new StubQuery(makeFransbergOffers());
      const service = new TransportEstimationService(query);

      const result = await service.findOffers('Fransberg', 'DE', 'FI');

      expect(query.carrierLookups).toEqual(['fransberg']);
      expect(result).toHaveLength(4);
    });
  });

  // -----------------------------------------------------------------------
  // estimate() — tier derivation from weight (design D3)
  // -----------------------------------------------------------------------

  describe('estimate — weight-derived tier', () => {
    it('uses parcel rows while the weight fits the carrier’s largest parcel ceiling', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeFransbergOffers()),
      );

      // 40 kg is above the first bracket but within the largest parcel
      // ceiling (94.5 kg) → parcel tier, bracket 31.5–63.
      const result = await service.estimate('fransberg', 'DE', 'FI', 40);

      expect(result.offer.id).toBe(2);
      expect(result.offer.priceCents).toBe(2490);
      // Exact bracket on a volume estimate → ESTIMATED (D6)
      expect(result.reliabilityStatus).toBe('ESTIMATED');
    });

    it('switches to pallet rows above the largest parcel ceiling', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeFransbergOffers()),
      );

      const result = await service.estimate('fransberg', 'DE', 'FI', 400);

      expect(result.offer.packageTier).toBe('pallet');
      expect(result.offer.priceCents).toBe(19900);
    });

    it('keeps a weight exactly at the dataset ceiling in the parcel tier', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeFransbergOffers()),
      );

      // 31.5 kg is the first bracket's ceiling — inside it (inBracket is
      // ceiling-inclusive), so the parcel tier must still be derived.
      const result = await service.estimate('fransberg', 'DE', 'FI', 31.5);

      expect(result.offer.id).toBe(1);
      expect(result.offer.priceCents).toBe(1490);
    });

    it('throws NotFoundError when the derived tier has no rows (never fabricates across tiers)', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeParcelOnlyOffers()),
      );

      // 500 kg is pallet freight, but the carrier has no pallet rows —
      // the honest degradation is UNAVAILABLE upstream, not a parcel price.
      const error = await service
        .estimate('fransberg', 'DE', 'FI', 500)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).packageType).toBe('pallet');
      expect((error as NotFoundError).carrier).toBe('fransberg');
    });

    it('ignores the legacy containerType argument entirely', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeFransbergOffers()),
      );

      const withoutLegacy = await service.estimate('fransberg', 'DE', 'FI', 40);
      const withLegacy = await service.estimate(
        'fransberg',
        'DE',
        'FI',
        40,
        'bottle',
      );

      expect(withLegacy.offer.id).toBe(withoutLegacy.offer.id);
      expect(withLegacy.offer.priceCents).toBe(withoutLegacy.offer.priceCents);
    });
  });

  // -----------------------------------------------------------------------
  // estimate() — total shipment weight (design D4)
  // -----------------------------------------------------------------------

  describe('estimate — shipment weight', () => {
    function makeCountBracketOffers(): TransportOffer[] {
      return [
        makeOffer({
          id: 1,
          carrier: 'fransberg',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 1 },
          priceCents: 490,
        }),
        makeOffer({
          id: 2,
          carrier: 'fransberg',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 1, maxKg: 16 },
          priceCents: 1490,
        }),
      ];
    }

    it('bracket-matches the total shipment weight, not a per-unit weight', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeCountBracketOffers()),
      );

      // 12 × 1 kg bottles → the caller passes 12 (task 3.3 owns the
      // multiplication). The service must price the 12 kg shipment, not
      // re-derive a per-unit weight.
      const result = await service.estimate('fransberg', 'DE', 'FI', 12);

      expect(result.offer.priceCents).toBe(1490);
      expect(result.lookupWeightKg).toBe(12);
    });

    it('stored grams never override the caller’s total', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeCountBracketOffers()),
      );

      // Per-unit grams (1000 g) are metadata for the weight basis; the
      // lookup weight stays the 12 kg total the caller computed.
      const result = await service.estimate('fransberg', 'DE', 'FI', 12, 1000);

      expect(result.lookupWeightKg).toBe(12);
      expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
      expect(result.storedWeightGrams).toBe(1000);
      expect(result.offer.priceCents).toBe(1490);
      expect(result.reliabilityStatus).toBe('VERIFIED');
    });
  });

  // -----------------------------------------------------------------------
  // estimate() — VERIFIED gating (design D6)
  // -----------------------------------------------------------------------

  describe('estimate — VERIFIED gating', () => {
    function makeGatingOffers(): TransportOffer[] {
      return [
        makeOffer({
          id: 1,
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
    }

    it('VERIFIED requires an exact bracket AND a stored weight', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeGatingOffers()),
      );

      const result = await service.estimate('posti', 'DE', 'FI', 5, 5000);

      expect(result.reliabilityStatus).toBe('VERIFIED');
      expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
    });

    it('caps an exact bracket on a volume estimate at ESTIMATED', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeGatingOffers()),
      );

      const result = await service.estimate('posti', 'DE', 'FI', 5);

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.weightBasis).toBe('VOLUME_ESTIMATE');
      expect(result.storedWeightGrams).toBeNull();
    });

    it('caps the closest-bracket fallback at ESTIMATED even on a stored weight', async () => {
      // Gap between the brackets: [0,10] and [20,30]. 15 kg misses both →
      // closest-midpoint fallback; the stored basis cannot promote a
      // fallback to VERIFIED.
      const offers = [
        makeOffer({
          id: 1,
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

      const result = await service.estimate('posti', 'DE', 'FI', 15, 15000);

      expect(result.reliabilityStatus).toBe('ESTIMATED');
      expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
      expect(result.offer.priceCents).toBe(2000);
    });

    it('treats non-positive stored grams as no stored weight', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeGatingOffers()),
      );

      const zeroGrams = await service.estimate('posti', 'DE', 'FI', 5, 0);
      const nullGrams = await service.estimate('posti', 'DE', 'FI', 5, null);

      expect(zeroGrams.weightBasis).toBe('VOLUME_ESTIMATE');
      expect(zeroGrams.reliabilityStatus).toBe('ESTIMATED');
      expect(zeroGrams.storedWeightGrams).toBeNull();
      expect(nullGrams.weightBasis).toBe('VOLUME_ESTIMATE');
      expect(nullGrams.reliabilityStatus).toBe('ESTIMATED');
    });

    it('accepts stored grams in the legacy fifth slot as a number', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeGatingOffers()),
      );

      const result = await service.estimate('posti', 'DE', 'FI', 5, 5000);

      expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
      expect(result.reliabilityStatus).toBe('VERIFIED');
    });
  });

  // -----------------------------------------------------------------------
  // estimate() — downgrade-only property (design D6)
  // -----------------------------------------------------------------------

  describe('estimate — downgrade-only property', () => {
    // The pre-D6 rule: selectBestBracketOffer's reliability alone decided
    // the status (EXACT → VERIFIED). The D6 rule adds the stored-weight
    // condition, so for the same candidate set the status may only move
    // VERIFIED → ESTIMATED, never ESTIMATED → VERIFIED.
    it('no input yields a better status than the pre-D6 rule gave', async () => {
      const offers = makeFransbergOffers();
      const service = new TransportEstimationService(new StubQuery(offers));

      const weights = [0.5, 5, 12, 31.5, 40, 63, 94.5, 400, 720];
      const storedVariants: Array<number | null | undefined> = [
        undefined,
        null,
        500,
        5000,
        500000,
      ];

      for (const weight of weights) {
        // Candidates the tier join selects for this weight (D3). Holding
        // the candidate set fixed is what makes the status comparison a
        // statement about the D6 rule alone: same selection in, so the new
        // status can only equal or downgrade the old one.
        const tier = deriveShipmentTier(offers, weight);
        const candidates = offers.filter(
          (o) =>
            o.originCountry === 'DE' &&
            o.destinationCountry === 'FI' &&
            isPackageTier(o, tier),
        );

        for (const stored of storedVariants) {
          const result = await service.estimate(
            'fransberg',
            'DE',
            'FI',
            weight,
            stored,
          );

          const oldSelection = selectBestBracketOffer(candidates, weight)!;
          const oldStatus =
            oldSelection.reliability === 'EXACT' ? 'VERIFIED' : 'ESTIMATED';

          // D6 gate, stated positively: VERIFIED implies exact bracket AND
          // stored basis.
          if (result.reliabilityStatus === 'VERIFIED') {
            expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
            expect(inBracket(result.offer, weight)).toBe(true);
            expect(oldStatus).toBe('VERIFIED');
          }

          // Downgrade-only: where the old rule said ESTIMATED, the new rule
          // cannot say VERIFIED.
          if (oldStatus === 'ESTIMATED') {
            expect(result.reliabilityStatus).toBe('ESTIMATED');
          }
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // estimate() — weight basis (task 3.2, design D4 + D6 superseding D7 wiring)
  // -----------------------------------------------------------------------

  describe('estimate — weight basis', () => {
    // Bracket A [0, 0.5] kg and bracket B [0.5, 1] kg — a 0.48 kg total
    // selects A, a 0.75 kg total selects B, so the tests prove which weight
    // actually drove the lookup.
    function makeBracketOffers(): TransportOffer[] {
      return [
        makeOffer({
          id: 1,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 0.5 },
          priceCents: 1000,
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0.5, maxKg: 1 },
          priceCents: 2000,
        }),
      ];
    }

    it('the caller’s resolved total drives the lookup and stored grams state the basis', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeBracketOffers()),
      );

      // 480 g total (the caller resolved stored grams → 0.48 kg, design D5)
      const result = await service.estimate('posti', 'DE', 'FI', 0.48, 480);

      expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
      expect(result.lookupWeightKg).toBe(0.48);
      expect(result.storedWeightGrams).toBe(480);
      expect(result.offer.priceCents).toBe(1000);
      expect(result.reliabilityStatus).toBe('VERIFIED');
    });

    it('a volume-estimate total is used as-is and caps the status at ESTIMATED', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeBracketOffers()),
      );

      const result = await service.estimate('posti', 'DE', 'FI', 0.75);

      expect(result.weightBasis).toBe('VOLUME_ESTIMATE');
      expect(result.lookupWeightKg).toBe(0.75);
      expect(result.storedWeightGrams).toBeNull();
      expect(result.offer.priceCents).toBe(2000);
      expect(result.reliabilityStatus).toBe('ESTIMATED');
    });

    it('treats an explicit null stored weight like an omitted one', async () => {
      const service = new TransportEstimationService(
        new StubQuery(makeBracketOffers()),
      );

      const result = await service.estimate('posti', 'DE', 'FI', 0.75, null);

      expect(result.weightBasis).toBe('VOLUME_ESTIMATE');
      expect(result.lookupWeightKg).toBe(0.75);
      expect(result.storedWeightGrams).toBeNull();
      expect(result.offer.priceCents).toBe(2000);
      expect(result.reliabilityStatus).toBe('ESTIMATED');
    });

    it('states the stored-weight basis also on the closest-bracket fallback', async () => {
      const offers = [
        makeOffer({
          id: 1,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 5, maxKg: 10 },
          priceCents: 3000,
        }),
      ];
      const service = new TransportEstimationService(new StubQuery(offers));

      const result = await service.estimate('posti', 'DE', 'FI', 0.75, 480);

      expect(result.weightBasis).toBe('STORED_PRODUCT_WEIGHT');
      expect(result.lookupWeightKg).toBe(0.75);
      expect(result.reliabilityStatus).toBe('ESTIMATED');
    });
  });

  // -----------------------------------------------------------------------
  // deriveShipmentTier (pure helper, reused by basket parity in task 3.4)
  // -----------------------------------------------------------------------

  describe('deriveShipmentTier', () => {
    it('derives parcel while the weight fits the largest parcel ceiling', () => {
      expect(deriveShipmentTier(makeFransbergOffers(), 40)).toBe('parcel');
      expect(deriveShipmentTier(makeFransbergOffers(), 94.5)).toBe('parcel');
    });

    it('derives pallet above the largest parcel ceiling', () => {
      expect(deriveShipmentTier(makeFransbergOffers(), 94.51)).toBe('pallet');
      expect(deriveShipmentTier(makeFransbergOffers(), 400)).toBe('pallet');
    });

    it('uses the carrier’s own largest ceiling, not the first bracket’s', () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 0, maxKg: 10 },
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 10, maxKg: 31.5 },
        }),
      ];

      // 20 kg exceeds the first ceiling but fits the carrier's largest one.
      expect(deriveShipmentTier(offers, 20)).toBe('parcel');
      expect(deriveShipmentTier(offers, 31.5)).toBe('parcel');
      expect(deriveShipmentTier(offers, 31.51)).toBe('pallet');
    });

    it('an open-ended parcel row means parcels at any weight', () => {
      const offers = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'parcel',
          weightBracket: { minKg: 50, maxKg: null },
        }),
      ];

      expect(deriveShipmentTier(offers, 5000)).toBe('parcel');
    });

    it('a carrier with no parcel rows derives pallet for positive weights', () => {
      const palletOnly = [
        makeOffer({
          carrier: 'fransberg',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'pallet',
          weightBracket: { minKg: 300, maxKg: 720 },
        }),
      ];

      expect(deriveShipmentTier(palletOnly, 5)).toBe('pallet');
      expect(deriveShipmentTier(palletOnly, 500)).toBe('pallet');
    });

    it('matches stored tier labels tolerantly (casing, whitespace)', () => {
      const sloppy = [
        makeOffer({
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: ' Parcel ',
          weightBracket: { minKg: 0, maxKg: 31.5 },
        }),
        makeOffer({
          id: 2,
          carrier: 'posti',
          originCountry: 'DE',
          destinationCountry: 'FI',
          packageTier: 'bottle',
          weightBracket: { minKg: 0, maxKg: 5 },
        }),
      ];

      expect(isPackageTier(sloppy[0]!, 'parcel')).toBe(true);
      // Container material is not a shipping tier — never counted.
      expect(isPackageTier(sloppy[1]!, 'parcel')).toBe(false);
      expect(deriveShipmentTier(sloppy, 30)).toBe('parcel');
      expect(deriveShipmentTier(sloppy, 32)).toBe('pallet');
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
      expect(result[0]!.id).toBe(1);
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
