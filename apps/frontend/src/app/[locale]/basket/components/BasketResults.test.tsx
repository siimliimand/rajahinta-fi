/**
 * BasketResults localization tests (task 2.3, change
 * fi-locale-surface-hardening, design D1).
 *
 * Pins the code-based presentation path on the basket result:
 *
 *   1. A known `code` renders the catalog label — Finnish under the
 *      default locale, English under an explicit-en provider — and the
 *      English wire label never surfaces for a coded line.
 *   2. An unknown `code` (forward compatibility) renders the verbatim
 *      API `label`.
 *   3. An absent `code` (legacy persisted record) renders the verbatim
 *      API `label`.
 *   4. Reliability-explanation sentences recompose in the active locale
 *      from the wire's dimension prefix + closed status; an unknown
 *      dimension or a sentence without the prefix renders verbatim.
 *   5. Single disclaimer render per combination with confidence-keyed
 *      intensity, and the de-qualified (no estimate qualifier) plain
 *      line labels (hedge-dedup-confidence-meter 3.2, designs D1/D2).
 *
 * @module BasketResultsLocalizationTest
 */
// @vitest-environment jsdom

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import BasketResults from './BasketResults';
import { renderWithIntl } from '@/lib/testing/test-intl';
import enMessages from '@/messages/en.json';
import type {
  BasketOptimizationResult,
  BasketShipment,
} from '@/lib/basket.types';
import type { ConfidenceDetail, ItemizedCost } from '@/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function costItem(overrides: {
  label: string;
  cents?: number;
  reliability?: ItemizedCost['reliability'];
  code?: string;
}): ItemizedCost {
  const { code, cents = 2450, reliability = 'VERIFIED', ...rest } = overrides;
  return {
    category: 'foreignRetailPrice',
    cents,
    reliability,
    ...rest,
    ...(code === undefined ? {} : { code }),
  } as ItemizedCost;
}

function shipment(items: readonly ItemizedCost[]): BasketShipment {
  return {
    merchant: 'alks',
    country: 'EE',
    items,
    consolidatedTransport: {
      totalCents: 590,
      weightTier: '0–5 kg',
      packageTier: 'parcel',
      reliability: 'EXACT',
    },
    retailSubtotalCents: 2450,
    thresholdCheck: {
      minimumOrderValueCents: null,
      meetsThreshold: true,
      termsReliability: null,
    },
  };
}

function makeResult(
  overrides: Partial<BasketOptimizationResult> = {},
): BasketOptimizationResult {
  return {
    shipments: [
      shipment([
        costItem({ label: 'Retail price', code: 'foreign_retail_price' }),
      ]),
    ],
    totalCents: 5000,
    itemizedTotals: 4000,
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: {
      text: 'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
      language: 'fi',
      version: '1.0',
    },
    alternatives: [],
    metadata: {
      input: { items: [{ productId: 101, quantity: 1 }], destination: 'FI' },
      calculationTimestamp: '2026-10-04T12:00:00.000Z',
      datasetVersions: [],
      calculationRecordId: null,
    },
    ...overrides,
  } as BasketOptimizationResult;
}

function renderWithEn(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Line labels — known codes localize, unknown/absent codes fall back
// ---------------------------------------------------------------------------

describe('BasketResults line labels (code-keyed, D1)', () => {
  it('renders Finnish catalog labels for every known code and never the wire label', () => {
    renderWithIntl(
      <BasketResults
        result={makeResult({
          shipments: [
            shipment([
              costItem({
                label: 'Retail price',
                code: 'foreign_retail_price',
              }),
              costItem({
                label: 'Unit price (x2)',
                code: 'foreign_unit_price',
              }),
              costItem({
                label: 'Transport',
                cents: 590,
                reliability: 'ESTIMATED',
                code: 'transport',
              }),
              costItem({
                label: 'Alcohol excise',
                reliability: 'ESTIMATED',
                code: 'alcohol_excise',
              }),
              costItem({
                label: 'Container duty',
                code: 'container_duty',
              }),
              costItem({
                label: 'Alcohol excise (within traveller allowance)',
                code: 'alcohol_excise_within_allowance',
              }),
              costItem({
                label: 'Container duty (within traveller allowance)',
                code: 'container_duty_within_allowance',
              }),
              costItem({
                label: 'Alcohol excise (over-allowance surplus)',
                code: 'alcohol_excise_over_allowance',
              }),
              costItem({
                label: 'Container duty (over-allowance surplus)',
                code: 'container_duty_over_allowance',
              }),
              costItem({
                label: 'Import VAT (estimated)',
                cents: 720,
                reliability: 'ESTIMATED',
                code: 'import_vat',
              }),
              costItem({
                label: 'Import VAT (within traveller allowance)',
                code: 'import_vat_within_allowance',
              }),
              costItem({
                label: 'Import VAT (over-allowance surplus, estimated)',
                code: 'import_vat_over_allowance',
              }),
            ]),
          ],
        })}
      />,
    );

    expect(screen.getByText('Vähittäishinta')).toBeInTheDocument();
    expect(screen.getByText('Yksikköhinta')).toBeInTheDocument();
    // The transport LINE label collides textually with the shipment
    // card's transport-section header ("Kuljetus"), so assert on both
    // rendering: the fallback copy must be absent either way.
    expect(screen.getAllByText('Kuljetus').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Transport')).not.toBeInTheDocument();
    expect(screen.getByText('Alkoholivalmistevero')).toBeInTheDocument();
    expect(screen.getByText('Pakkausvero')).toBeInTheDocument();
    expect(
      screen.getByText('Alkoholivalmistevero (sallitun määrän sisällä, veroton)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Pakkausvero (sallitun määrän sisällä, veroton)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Alkoholivalmistevero (sallitun määrän ylittävä osa)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Pakkausvero (sallitun määrän ylittävä osa)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tuonnin arvonlisävero'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tuonnin arvonlisävero (sallitun määrän sisällä, veroton)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tuonnin arvonlisävero (sallitun määrän ylittävä osa)',
      ),
    ).toBeInTheDocument();
    // A coded line never surfaces the English wire copy.
    expect(screen.queryByText('Retail price')).not.toBeInTheDocument();
    expect(screen.queryByText('Import VAT (estimated)')).not.toBeInTheDocument();
  });

  it('renders the verbatim API label for an unknown code', () => {
    renderWithIntl(
      <BasketResults
        result={makeResult({
          shipments: [
            shipment([
              costItem({ label: 'Surplus fee', code: 'surplus_fee' }),
            ]),
          ],
        })}
      />,
    );

    // Unknown code → the wire label, never blank and never a key path.
    expect(screen.getByText('Surplus fee')).toBeInTheDocument();
  });

  it('renders the verbatim API label when the code is absent (legacy record)', () => {
    renderWithIntl(
      <BasketResults
        result={makeResult({
          shipments: [shipment([costItem({ label: 'Excise duty' })])],
        })}
      />,
    );

    expect(screen.getByText('Excise duty')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Reliability-explanation sentences — dimension + status → locale copy
// ---------------------------------------------------------------------------

describe('BasketResults reliability explanations (code-keyed, D1)', () => {
  function breakdownResult(
    breakdown: readonly ConfidenceDetail[],
  ): BasketOptimizationResult {
    return makeResult({ confidenceBreakdown: breakdown });
  }

  it('composes the Finnish sentence from the dimension and the status', () => {
    renderWithIntl(
      <BasketResults
        result={breakdownResult([
          {
            status: 'VERIFIED',
            detail:
              '[Transport] Data point is verified against an authoritative source.',
          },
          {
            status: 'ESTIMATED',
            detail:
              '[Excise] Data point is estimated from incomplete or indirect data.',
          },
          {
            status: 'STALE',
            detail:
              '[Threshold terms (alks)] Data point has exceeded its freshness threshold.',
          },
        ])}
      />,
    );

    expect(
      screen.getByText(
        '[Kuljetus] Tieto on vahvistettu luotettavasta lähteestä.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '[Valmistevero] Tieto on arvioitu puutteellisen tai epäsuoran aineiston perusteella.',
      ),
    ).toBeInTheDocument();
    // The merchant id rides as-is inside the localized dimension.
    expect(
      screen.getByText(
        '[Vähimmäistilausehdot (alks)] Tieto on ylittänyt tuoreusrajan.',
      ),
    ).toBeInTheDocument();
    // No English wire sentence survives.
    expect(
      screen.queryByText(
        '[Transport] Data point is verified against an authoritative source.',
      ),
    ).not.toBeInTheDocument();
  });

  it('renders the verbatim sentence for an unknown dimension or missing prefix', () => {
    renderWithIntl(
      <BasketResults
        result={breakdownResult([
          {
            status: 'VERIFIED',
            detail:
              '[Mystery input] Data point is verified against an authoritative source.',
          },
          {
            status: 'UNAVAILABLE',
            detail: 'No bracket prefix at all.',
          },
        ])}
      />,
    );

    expect(
      screen.getByText(
        '[Mystery input] Data point is verified against an authoritative source.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No bracket prefix at all.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Single disclaimer render with confidence-keyed intensity, and the plain
// (de-qualified) line labels (hedge-dedup-confidence-meter 3.2, D1/D2):
// each combination renders its own API disclaimer exactly once — amber
// `status-stale-*` at LOW, quiet neutral gray one-liner otherwise, the
// payload text byte-identical in both intensities. The import-VAT line
// label reads without the estimate qualifier; estimate-ness stays on the
// per-value reliability badges.
// ---------------------------------------------------------------------------

describe('BasketResults disclaimer dedup + intensity (hedge-dedup 3.2)', () => {
  it('renders the combination disclaimer exactly once per view', () => {
    const { container } = renderWithIntl(
      <BasketResults result={makeResult()} />,
    );

    // Byte-level single occurrence in the whole rendered output — no heap.
    expect(
      container.textContent.split(
        'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
      ).length - 1,
    ).toBe(1);
    expect(screen.getAllByTestId('disclaimer-banner')).toHaveLength(1);
  });

  it('renders one disclaimer per combination, each sourced from its own payload', () => {
    const { container } = renderWithIntl(
      <BasketResults
        result={makeResult({
          alternatives: [
            {
              shipments: [
                shipment([
                  costItem({ label: 'Retail price', code: 'foreign_retail_price' }),
                ]),
              ],
              totalCents: 5100,
              itemizedTotals: 4100,
              confidence: 'LOW',
              confidenceBreakdown: [],
              disclaimer: {
                text: 'Vaihtoehdon oma vastuuvapauslause.',
                language: 'fi',
                version: '1.0',
              },
              metadata: {
                input: { items: [{ productId: 101, quantity: 1 }], destination: 'FI' },
                calculationTimestamp: '2026-10-04T12:00:00.000Z',
                datasetVersions: [],
                calculationRecordId: null,
              },
            },
          ],
        })}
      />,
    );

    // Each combination carries its own disclaimer from the API — one
    // render each, never a duplicated heap inside a combination.
    expect(screen.getAllByTestId('disclaimer-banner')).toHaveLength(2);
    expect(container.textContent.split(
      'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
    ).length - 1).toBe(1);
    expect(container.textContent.split(
      'Vaihtoehdon oma vastuuvapauslause.',
    ).length - 1).toBe(1);
  });

  it('renders the amber status-stale banner at LOW confidence', () => {
    renderWithIntl(<BasketResults result={makeResult({ confidence: 'LOW' })} />);

    const banner = screen.getByTestId('disclaimer-banner');
    expect(banner.getAttribute('data-confidence')).toBe('LOW');
    expect(banner.className).toContain('status-stale');
    expect(
      within(banner).getByText(
        'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the quiet neutral one-liner at MEDIUM confidence with the same text', () => {
    renderWithIntl(<BasketResults result={makeResult()} />);

    const banner = screen.getByTestId('disclaimer-banner');
    expect(banner.getAttribute('data-confidence')).toBe('MEDIUM');
    expect(banner.className).toContain('border-gray-200');
    expect(banner.className).toContain('bg-gray-50');
    expect(banner.className).not.toContain('status-stale');
    // Same payload text and version/language line — only the
    // presentation differs, never a word of the disclaimer.
    expect(
      within(banner).getByText(
        'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
      ),
    ).toBeInTheDocument();
    expect(banner.textContent).toContain('v1.0 · suomi');
  });

  it('labels the import-VAT line without the estimate qualifier', () => {
    renderWithIntl(
      <BasketResults
        result={makeResult({
          shipments: [
            shipment([
              costItem({
                label: 'Import VAT (estimated)',
                reliability: 'ESTIMATED',
                code: 'import_vat',
              }),
            ]),
          ],
        })}
      />,
    );

    // The catalog label carries no estimate qualifier — estimate-ness
    // stays on the per-value badge, never the name.
    expect(screen.getByText('Tuonnin arvonlisävero')).toBeInTheDocument();
    expect(
      screen.queryByText('Tuonnin arvonlisävero (arvio)'),
    ).toBeNull();
    expect(screen.getAllByText('Arvioitu').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Explicit-en rendering — the same code path under the English catalog
// ---------------------------------------------------------------------------

describe('BasketResults under the en locale', () => {
  it('renders English labels and sentences for known codes', () => {
    renderWithEn(
      <BasketResults
        result={makeResult({
          shipments: [
            shipment([
              costItem({
                label: 'Vähittäishinta',
                code: 'foreign_retail_price',
              }),
            ]),
          ],
          confidenceBreakdown: [
            {
              status: 'VERIFIED',
              detail:
                '[Transport] Data point is verified against an authoritative source.',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Retail price')).toBeInTheDocument();
    expect(screen.queryByText('Vähittäishinta')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '[Transport] Data point is verified against an authoritative source.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the verbatim API label for an unknown code in en too', () => {
    renderWithEn(
      <BasketResults
        result={makeResult({
          shipments: [
            shipment([
              costItem({ label: 'Surplus fee', code: 'surplus_fee' }),
            ]),
          ],
        })}
      />,
    );

    expect(screen.getByText('Surplus fee')).toBeInTheDocument();
  });
});
