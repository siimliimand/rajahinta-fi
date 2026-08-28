/**
 * Golden Posti price-list payload (task 7.4).
 *
 * Pins the parser's behaviour against a realistic rate table: three
 * lanes (domestic FI, cross-border SE and DE), weight brackets, package
 * tiers, VAT-inclusive prices in EUR, and two deliberately malformed
 * rows whose per-row rejection is part of the contract. When Posti's
 * real payload drifts, this fixture plus the parser test makes the
 * breakage explicit instead of a silent data outage.
 *
 * Prices are illustrative — the parser is under test, not the tariffs.
 *
 * @module PostiRatesFixture
 */

export const POSTI_GOLDEN_PAYLOAD = {
  source: 'posti',
  currency: 'EUR',
  publishedAt: '2026-08-26T06:00:00Z',
  priceListVersion: '2026-08-01',
  products: [
    {
      productCode: 'POSTIPAKETTI-S',
      originCountry: 'FI',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 0, maxKg: 2 },
      priceIncludingVat: 6.9,
      sellerTransportPaid: false,
    },
    {
      productCode: 'POSTIPAKETTI-M',
      originCountry: 'FI',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 2, maxKg: 10 },
      priceIncludingVat: 12.4,
      sellerTransportPaid: false,
    },
    {
      productCode: 'KIRJEPAKETTI-BOX',
      originCountry: 'FI',
      destinationCountry: 'FI',
      packageTier: 'box',
      weightBracket: { minKg: 0, maxKg: 5 },
      priceIncludingVat: 9.2,
      sellerTransportPaid: false,
    },
    {
      productCode: 'PALLET-FI',
      originCountry: 'FI',
      destinationCountry: 'FI',
      packageTier: 'pallet',
      weightBracket: { minKg: 20, maxKg: null },
      priceIncludingVat: 49.0,
      sellerTransportPaid: false,
    },
    {
      productCode: 'INTERNATIONAL-LIGHT-SE',
      originCountry: 'SE',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 0, maxKg: 10 },
      priceIncludingVat: 24.9,
      sellerTransportPaid: true,
    },
    {
      productCode: 'INTERNATIONAL-PARCEL-DE',
      originCountry: 'DE',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 5, maxKg: 20 },
      priceIncludingVat: 32.5,
      sellerTransportPaid: true,
    },
    // Malformed rows — per-row rejection is pinned by the parser test.
    {
      productCode: 'BAD-LANE',
      originCountry: 'SWE', // not ISO alpha-2
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 0, maxKg: 1 },
      priceIncludingVat: 5,
    },
    {
      productCode: 'BAD-PRICE',
      originCountry: 'FI',
      destinationCountry: 'FI',
      packageTier: 'parcel',
      weightBracket: { minKg: 0, maxKg: 1 },
      priceIncludingVat: 'free',
    },
  ],
} as const;

/** The exact rates the golden payload must parse into. */
export const POSTI_GOLDEN_EXPECTED_RATES = [
  {
    carrier: 'posti',
    originCountry: 'FI',
    destinationCountry: 'FI',
    weightMinKg: 0,
    weightMaxKg: 2,
    packageTier: 'parcel',
    priceCents: 690,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: new Date('2026-08-26T06:00:00Z'),
  },
  {
    carrier: 'posti',
    originCountry: 'FI',
    destinationCountry: 'FI',
    weightMinKg: 2,
    weightMaxKg: 10,
    packageTier: 'parcel',
    priceCents: 1240,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: new Date('2026-08-26T06:00:00Z'),
  },
  {
    carrier: 'posti',
    originCountry: 'FI',
    destinationCountry: 'FI',
    weightMinKg: 0,
    weightMaxKg: 5,
    packageTier: 'box',
    priceCents: 920,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: new Date('2026-08-26T06:00:00Z'),
  },
  {
    carrier: 'posti',
    originCountry: 'FI',
    destinationCountry: 'FI',
    weightMinKg: 20,
    weightMaxKg: null,
    packageTier: 'pallet',
    priceCents: 4900,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: new Date('2026-08-26T06:00:00Z'),
  },
  {
    carrier: 'posti',
    originCountry: 'SE',
    destinationCountry: 'FI',
    weightMinKg: 0,
    weightMaxKg: 10,
    packageTier: 'parcel',
    priceCents: 2490,
    currency: 'EUR',
    sellerInvolvementIndicator: true,
    observedAt: new Date('2026-08-26T06:00:00Z'),
  },
  {
    carrier: 'posti',
    originCountry: 'DE',
    destinationCountry: 'FI',
    weightMinKg: 5,
    weightMaxKg: 20,
    packageTier: 'parcel',
    priceCents: 3250,
    currency: 'EUR',
    sellerInvolvementIndicator: true,
    observedAt: new Date('2026-08-26T06:00:00Z'),
  },
] as const;
