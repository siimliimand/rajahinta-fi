/**
 * Calculator quick/advanced progressive disclosure — view-level tests
 * (price-intelligence-roadmap task 4.2).
 *
 * Pins the task's contract:
 *   1. Default state is quick only: the advanced options render behind an
 *      explicit control and stay collapsed (absent) until it is used.
 *   2. Parity: identical input values produce identical calculation
 *      requests and identical rendered results whether entered with the
 *      advanced section collapsed (quick path) or expanded (full path).
 *      The disclosure changes visibility only — one input state, one
 *      calculation pipeline.
 *
 * @module CalculatorViewProgressiveDisclosureTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorView from './calculator-view';
import { ApiFetchError, searchProducts, calculateLandedCost, listScenarios } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type {
  CalculatorResult as CalculatorResultType,
  ProductSearchItem,
} from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
    calculateLandedCost: vi.fn(),
    listScenarios: vi.fn(),
    request: vi.fn(),
    // The result view's outcome nudge (task 3.3) probes the session on
    // mount; failing closed here keeps the render offline and the nudge
    // out of these view tests' scope.
    ensureSession: vi.fn(() => Promise.reject(new Error('offline'))),
  };
});

// The merchant-warning notice renders through the i18n navigation Link;
// stub it with the plain-anchor shape every other page test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

const mockedSearchProducts = vi.mocked(searchProducts);
const mockedCalculateLandedCost = vi.mocked(calculateLandedCost);
const mockedListScenarios = vi.mocked(listScenarios);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HIT: ProductSearchItem = {
  id: 42,
  name: 'Renat',
  brand: 'Sprit',
  category: 'Vodka',
  // Fraction and canonical litre text, as the API ships (task 1.3).
  alcoholByVolume: 0.375,
  unitVolume: '0.7',
  containerType: 'BOTTLE',
  lowestPriceCents: 999,
  merchantCount: 1,
};

/** Genuinely offer-less product — null price, zero merchants. */
const NO_OFFER_HIT: ProductSearchItem = {
  id: 7,
  name: 'Tarjouskotilo',
  brand: 'Hiljainen',
  category: 'Vodka',
  alcoholByVolume: 0.375,
  unitVolume: '0.5',
  containerType: 'BOTTLE',
  lowestPriceCents: null,
  merchantCount: 0,
};

/** Minimal valid result — enough for the rendered answer-first figure. */
function baseResult(): CalculatorResultType {
  return {
    itemizedCosts: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 4000,
        reliability: 'VERIFIED',
      },
    ],
    excludedOffers: [],
    foreignRetailPrice: 4000,
    transportCost: 500,
    alcoholExciseEstimate: 650,
    containerDutyEstimate: 0,
    totalCents: 5150,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: {
      text: 'Testirakennevastuuvapautus',
      language: 'fi',
      version: 'test',
    },
    classification: {
      classification: 'NotPersisted',
      confidence: 'LOW',
      evidence: [],
      evidenceSummary: 'Ei tallennettu',
    },
    metadata: {
      input: { productId: 42, quantity: 2, destination: 'FI' },
      calculationTimestamp: '2026-08-31T12:00:00.000Z',
      productMasterId: 42,
      retailOfferIds: [10],
      quantity: 2,
      destination: 'FI',
      productName: 'Renat',
      volumeLitres: 0.7,
      alcoholByVolume: 0.375,
      category: 'Vodka',
      datasetVersions: [],
      transportOfferId: null,
    },
    calculationRecordId: 42,
  };
}

function searchResponse(items: ProductSearchItem[]) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

/**
 * Enter the identical quick-path input set: search, select the hit,
 * destination Finland (default), quantity 2. When `expandAdvanced` is
 * set, the advanced section is disclosed after the product selection —
 * the inputs stay the same, only its visibility changes. Returns the
 * calculated request payload for parity comparison.
 */
async function runFlow(
  user: ReturnType<typeof userEvent.setup>,
  expandAdvanced = false,
): Promise<Record<string, unknown>> {
  await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
  await user.click(screen.getByRole('button', { name: 'Hae' }));
  const hit = await screen.findByText('Renat');
  await user.click(hit.closest('button') as HTMLButtonElement);

  if (expandAdvanced) {
    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('calculator-advanced')).toBeInTheDocument();
  }

  // Quick-path quantity — same control serves both paths. The selector
  // ignores empty input while typing, so step it with its own control.
  await user.click(
    screen.getByRole('button', { name: 'Lisää määrää' }),
  );

  await user.click(
    screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
  );
  await screen.findByTestId('result-card');

  return JSON.parse(
    JSON.stringify(mockedCalculateLandedCost.mock.calls[0]![0]),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListScenarios.mockResolvedValue([]);
  mockedSearchProducts.mockResolvedValue(searchResponse([HIT]));
  mockedCalculateLandedCost.mockResolvedValue(baseResult());
});

// ---------------------------------------------------------------------------
// 1. Default state — quick only
// ---------------------------------------------------------------------------

describe('CalculatorView quick/advanced default state (task 4.2)', () => {
  it('shows the quick path by default and keeps the advanced options collapsed', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Select a product so the quick-path configuration card is on screen.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // Quick-path inputs are visible by default…
    expect(screen.getByTestId('calc-destination')).toBeInTheDocument();
    expect(screen.getByLabelText('Määrä')).toBeInTheDocument();
    expect(screen.getByTestId('observed-price')).toHaveTextContent('€9.99');

    // …while the advanced options exist behind an explicit control that
    // reports collapsed and keeps the section unrendered (quick only).
    const toggle = screen.getByTestId('advanced-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Lisäasetukset');
    expect(screen.queryByTestId('calculator-advanced')).toBeNull();
  });

  it('discloses the advanced options only through the explicit control', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Reach the quick-path configuration card.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('calculator-advanced')).toBeInTheDocument();

    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('calculator-advanced')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Parity — quick path ≡ full path for identical inputs
// ---------------------------------------------------------------------------

describe('CalculatorView quick/full-path parity (task 4.2)', () => {
  it('produces identical requests and identical results on both paths', async () => {
    const user = userEvent.setup();

    // ── Quick path: advanced stays collapsed ──
    const quick = renderWithIntl(<CalculatorView />);
    const quickPayload = await runFlow(user);
    const quickTotal = within(quick.container).getByTestId(
      'landed-cost-total',
    ).textContent;
    quick.unmount();

    // ── Full path: same inputs, advanced expanded ──
    const full = renderWithIntl(<CalculatorView />);
    const fullPayload = await runFlow(user, true);
    const fullTotal = within(full.container).getByTestId(
      'landed-cost-total',
    ).textContent;

    // Identical input values → identical request payload…
    expect(fullPayload).toEqual(quickPayload);
    expect(quickPayload).toEqual({
      productId: HIT.id,
      quantity: 2,
      destination: 'FI',
    });
    // …and identical rendered results (one pipeline, one result object).
    // fi money form via the shared formatter (fi-locale-surface-
    // hardening 2.4) — the exact string including the non-breaking
    // space Intl puts before the symbol.
    expect(fullTotal).toBe(quickTotal);
    expect(quickTotal).toBe('51,50\u00a0€');
  });

  it('the advanced carrier override is the only payload difference, and only when set', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Reach the quick-path configuration card, expand advanced but leave
    // it untouched — the payload must stay identical to the quick path's.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    await user.click(screen.getByTestId('advanced-toggle'));
    await user.click(screen.getByRole('button', { name: 'Lisää määrää' }));
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
    expect(mockedCalculateLandedCost.mock.calls[0]![0]).toEqual({
      productId: HIT.id,
      quantity: 2,
      destination: 'FI',
    });

    // Setting the carrier adds exactly that field.
    await user.type(screen.getByTestId('calc-transport-method'), 'Viking Line');
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await waitFor(() =>
      expect(mockedCalculateLandedCost).toHaveBeenCalledTimes(2),
    );
    expect(mockedCalculateLandedCost.mock.calls[1]![0]).toEqual({
      productId: HIT.id,
      quantity: 2,
      destination: 'FI',
      transportMethod: 'Viking Line',
    });
  });
});

// ---------------------------------------------------------------------------
// Price before calculation (task 3.2, unit-integrity-and-result-trust):
// rows carry the lowest observed price; the Configure step shows the
// selected product's lowest observed price before the first calculation.
// ---------------------------------------------------------------------------

describe('CalculatorView price-before-calculation (task 3.2)', () => {
  it('renders the lowest observed price on rows with offers and nothing on offer-less rows', async () => {
    mockedSearchProducts.mockResolvedValue(
      searchResponse([HIT, NO_OFFER_HIT]),
    );
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    // Priced row: the lowest observed price renders in euros — fi money
    // form via the shared formatter (fi-locale-surface-hardening 2.4).
    const pricedRow = (
      await screen.findByText('Renat')
    ).closest('li') as HTMLElement;
    expect(
      within(pricedRow).getByTestId('row-lowest-price'),
    ).toHaveTextContent('Halvin havaittu hinta: 9,99 €');

    // Offer-less row: honestly empty — no price element, never €0.00.
    const emptyRow = screen
      .getByText('Tarjouskotilo')
      .closest('li') as HTMLElement;
    expect(within(emptyRow).queryByTestId('row-lowest-price')).toBeNull();
    expect(emptyRow.textContent).not.toContain('€');
  });

  it('shows the selected product lowest observed price on the Configure step before any calculation', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // The price comes from the selected search item's aggregates — shown
    // before any calculation runs, and never from a result object.
    // Terminology unified on "Halvin havaittu hinta"
    // (catalog-first-run-polish 4.4).
    expect(screen.getByTestId('observed-price')).toHaveTextContent(
      'Halvin havaittu hinta: €9.99',
    );
    expect(mockedCalculateLandedCost).not.toHaveBeenCalled();
    expect(screen.queryByTestId('result-card')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Form pass (task 4.7): units, numeric keyboards, specific validation,
// reset affordance — at the view level
// ---------------------------------------------------------------------------

describe('CalculatorView form pass (task 4.7)', () => {
  it('renders the unit beside the quantity field and inputMode on it', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // Unit as plain text beside the numeric field…
    expect(screen.getByTestId('quantity-unit')).toHaveTextContent('kpl');
    // …and a numeric keyboard intent on the input itself.
    const quantity = screen.getByLabelText('Määrä') as HTMLInputElement;
    expect(quantity.inputMode).toBe('numeric');
    expect(quantity.type).toBe('number');
  });

  it('shows a specific inline message when the search term is too short', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // One character is below the search's minimum — the message must
    // name the minimum, not just say "invalid". No request fires.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'r');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    expect(screen.getByTestId('calc-query-error')).toHaveTextContent(
      'Hakusanan on oltava vähintään 2 merkkiä pitkä.',
    );
    expect(mockedSearchProducts).not.toHaveBeenCalled();

    // Further typing supersedes the notice.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'e');
    expect(screen.queryByTestId('calc-query-error')).toBeNull();
  });

  it('the reset affordance restores every input to its default', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Drive every input away from its default.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);
    await user.click(screen.getByRole('button', { name: 'Lisää määrää' }));
    await user.click(screen.getByTestId('advanced-toggle'));
    await user.type(screen.getByTestId('calc-transport-method'), 'Viking Line');
    expect(screen.getByTestId('calc-destination')).toHaveValue('FI');

    await user.click(screen.getByTestId('calculator-reset'));

    // Defaults: the search term is cleared and the configuration card
    // (product, quantity, destination, carrier, advanced) is gone.
    const search = screen.getByPlaceholderText(
      'Hae tuotteita…',
    ) as HTMLInputElement;
    expect(search.value).toBe('');
    expect(screen.queryByTestId('calc-destination')).toBeNull();
    expect(screen.queryByTestId('calc-transport-method')).toBeNull();
    expect(screen.queryByTestId('advanced-toggle')).toBeNull();
    expect(mockedCalculateLandedCost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Buying-mode toggle (task 2.1, change finnish-first-client-experience):
// Toimitus is the default and reproduces today's request exactly; Otan
// itse mukaan adds transportArrangement: 'PERSONAL'; the 409
// NoPublishedAllowances rejection renders the honest unavailable state
// with the form kept usable.
// ---------------------------------------------------------------------------

describe('CalculatorView buying-mode toggle (task 2.1)', () => {
  it('defaults to Toimitus and keeps the request payload free of transportArrangement', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    expect(
      screen.getByRole('radio', { name: /Toimitus/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Otan itse mukaan/ }),
    ).not.toBeChecked();

    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
    expect(mockedCalculateLandedCost.mock.calls[0]![0]).toEqual({
      productId: HIT.id,
      quantity: 1,
      destination: 'FI',
    });
  });

  it('sends transportArrangement PERSONAL when Otan itse mukaan is selected', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    await user.click(screen.getByRole('radio', { name: /Otan itse mukaan/ }));
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
    expect(mockedCalculateLandedCost.mock.calls[0]![0]).toEqual({
      productId: HIT.id,
      quantity: 1,
      destination: 'FI',
      transportArrangement: 'PERSONAL',
    });
  });

  it('renders the honest traveller-unavailable state on 409 NoPublishedAllowances and keeps the form usable', async () => {
    mockedCalculateLandedCost.mockRejectedValueOnce(
      new ApiFetchError(409, {
        statusCode: 409,
        message:
          'No published traveller allowance dataset is effective on 2026-10-01 — a traveller-mode calculation cannot run without a bound',
        error: 'NoPublishedAllowances',
        timestamp: '2026-10-01T12:00:00.000Z',
        path: '/api/v1/calculator',
      }),
    );
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);
    await user.click(screen.getByRole('radio', { name: /Otan itse mukaan/ }));
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );

    // The honest state: the missing dataset is the reason, retry-later
    // copy, and never the raw backend message.
    const state = await screen.findByTestId('traveller-unavailable');
    expect(state.textContent).toContain('tietoaineistoa');
    expect(state.textContent).not.toContain('No published traveller');

    // The form stays usable: the toggle is intact, delivery remains
    // selectable, and switching back succeeds.
    const seller = screen.getByRole('radio', { name: /Toimitus/ });
    expect(seller).toBeEnabled();
    await user.click(seller);
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
    expect(mockedCalculateLandedCost.mock.calls[1]![0]).toEqual({
      productId: HIT.id,
      quantity: 1,
      destination: 'FI',
    });
  });
});

// ---------------------------------------------------------------------------
// Zero-result did-you-mean chip (task 3.3, change
// finnish-first-client-experience): the response's `suggestion` renders a
// clickable chip that runs the suggested query while the customer's
// original query stays in the input; it never appears when results exist.
// ---------------------------------------------------------------------------

describe('CalculatorView did-you-mean suggestion chip (task 3.3)', () => {
  it('runs the suggested query from the chip and preserves the original query in the input', async () => {
    mockedSearchProducts
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        suggestion: 'Koskenkorva',
      })
      .mockResolvedValueOnce(searchResponse([HIT]));
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'koskenkrova');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    const banner = await screen.findByTestId('search-suggestion');
    expect(banner.textContent).toContain('Tarkoititko:');
    const chip = screen.getByTestId('search-suggestion-chip');
    expect(chip).toHaveTextContent('Koskenkorva');

    // The chip searches — the input is never rewritten.
    const input = screen.getByPlaceholderText(
      'Hae tuotteita…',
    ) as HTMLInputElement;
    expect(input.value).toBe('koskenkrova');
    await user.click(chip);
    await screen.findByText('Renat');

    expect(mockedSearchProducts).toHaveBeenLastCalledWith(
      'Koskenkorva',
      'ALPHABETICAL',
      1,
      20,
      expect.anything(),
    );
    expect(input.value).toBe('koskenkrova');
    // Results exist → the banner is gone.
    expect(screen.queryByTestId('search-suggestion')).toBeNull();
  });

  it('never renders the chip when results exist or the response carries no suggestion', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    await screen.findByText('Renat');
    expect(screen.queryByTestId('search-suggestion')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Brandless attribute row (fi-locale-surface-hardening, task 2.6)
// ---------------------------------------------------------------------------

/** Feed rows can carry an empty brand when the name yields no token. */
const BRANDLESS_HIT: ProductSearchItem = {
  id: 9,
  name: 'Nimetön kotilo',
  brand: '',
  category: 'Vodka',
  alcoholByVolume: 0.375,
  unitVolume: '0.7',
  containerType: 'BOTTLE',
  lowestPriceCents: null,
  merchantCount: 0,
};

describe('CalculatorView brandless attribute row (fi-locale-surface-hardening 2.6)', () => {
  it('renders the search-result row without a leading separator when the brand is empty', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([BRANDLESS_HIT]));
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    // The empty brand contributes neither text nor the dangling ' · '.
    expect(await screen.findByText('Vodka · 70 cl · 37.5 %')).toBeInTheDocument();
  });

  it('renders the configure-step summary as the category alone when the brand is empty', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([BRANDLESS_HIT]));
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Nimetön kotilo');
    await user.click(hit.closest('button') as HTMLButtonElement);

    expect(screen.getByText('Vodka · 70 cl')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Per-unit price context on pack rows (catalog-first-run-polish 4.2):
// dropdown rows surface the read-time €/g embed and an "≈ x,xx €/kpl"
// helper on multi-unit pack rows; single-unit rows stay unchanged.
// Display-only — the derivation reads the row's own embed (design D2:
// no duplicated parser, no new API surface) and never touches a
// calculation input, ranking, or sort order.
// ---------------------------------------------------------------------------

/**
 * A 24-pack row carrying the listing embed the API computes for it: the
 * cheapest current offer priced against the package total volume the
 * read-time pack-units parser produced
 * (`0.33 l × 24 × 0.047 × 789 g/l` grams of ethanol).
 */
const PACK_HIT: ProductSearchItem = {
  id: 77,
  name: 'Karhu Olut 4.7% 24 × 0,33 l tölkki',
  brand: 'Karhu',
  category: 'Beer',
  alcoholByVolume: 0.047,
  unitVolume: '0.33',
  containerType: 'CAN',
  lowestPriceCents: 2999,
  merchantCount: 2,
  eurPerGram: {
    status: 'computed',
    centsPerGram: 2999 / (0.33 * 24 * 0.047 * 789),
    ethanolGrams: 0.33 * 24 * 0.047 * 789,
    priceReliability: 'VERIFIED',
  },
};

/** Single-unit product WITH a computed embed — must stay helper-free. */
const SINGLE_UNIT_WITH_EMBED: ProductSearchItem = {
  ...HIT,
  id: 43,
  eurPerGram: {
    status: 'computed',
    centsPerGram: 999 / (0.7 * 0.375 * 789),
    ethanolGrams: 0.7 * 0.375 * 789,
    priceReliability: 'VERIFIED',
  },
};

describe('CalculatorView per-unit price context on pack rows (catalog-first-run-polish 4.2)', () => {
  it('surfaces the €/g embed and the ≈ €/kpl helper with Finnish decimal comma on a pack row', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([PACK_HIT]));
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'karhu');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    const row = (
      await screen.findByText(PACK_HIT.name)
    ).closest('li') as HTMLElement;
    // The €/g embed renders in the catalog chip's presentation.
    expect(within(row).getByTestId('row-eur-per-gram')).toHaveTextContent(
      '10.21 snt/g',
    );
    // 2999 ¢ ÷ 24 units → "≈ 1,25 €/kpl" — beside the absolute price
    // (fi money form via the shared formatter, decimal comma).
    expect(within(row).getByTestId('row-per-unit-price')).toHaveTextContent(
      '≈ 1,25 €/kpl',
    );
    expect(
      within(row).getByTestId('row-lowest-price'),
    ).toHaveTextContent('Halvin havaittu hinta: 29,99 €');
  });

  it('keeps single-unit rows unchanged: the embed renders but no per-unit helper', async () => {
    mockedSearchProducts.mockResolvedValue(
      searchResponse([SINGLE_UNIT_WITH_EMBED]),
    );
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    const row = (
      await screen.findByText('Renat')
    ).closest('li') as HTMLElement;
    expect(within(row).getByTestId('row-eur-per-gram')).toBeInTheDocument();
    expect(within(row).queryByTestId('row-per-unit-price')).toBeNull();
  });

  it('renders the per-unit helper beside the selected pack absolute price on the Configure step', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([PACK_HIT]));
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'karhu');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText(PACK_HIT.name);
    await user.click(hit.closest('button') as HTMLButtonElement);

    expect(screen.getByTestId('observed-price')).toHaveTextContent(
      'Halvin havaittu hinta: €29.99',
    );
    expect(screen.getByTestId('observed-per-unit-price')).toHaveTextContent(
      '≈ 1,25 €/kpl',
    );
    expect(mockedCalculateLandedCost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Result visibility after calculation (catalog-first-run-polish 4.3,
// design D3): when a calculation lands, the result card scrolls into view
// only when it is not already substantially in the viewport — smoothly by
// default, instantly under prefers-reduced-motion. The desktop sticky
// summary, on screen by construction, never moves.
// ---------------------------------------------------------------------------

/** DOMRect for a card whose viewport geometry the test pins. */
function rectAt(top: number, bottom: number, height: number): DOMRect {
  return {
    top,
    bottom,
    height,
    width: 375,
    left: 0,
    right: 375,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('CalculatorView result visibility after calculation (catalog-first-run-polish 4.3)', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;
  const scrollIntoView = vi.fn();

  /** Pin the summary card's viewport geometry for the current render. */
  const stubSummaryRect = (rect: DOMRect) => {
    vi.spyOn(
      screen.getByTestId('calculator-summary'),
      'getBoundingClientRect',
    ).mockReturnValue(rect);
  };

  /** Replace matchMedia; returns the mock for query assertions. */
  const stubMotionPreference = (reducedMotion: boolean) => {
    const matcher = vi.fn(
      (query: string) =>
        ({
          matches:
            reducedMotion && query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    window.matchMedia = matcher as unknown as typeof window.matchMedia;
    return matcher;
  };

  /** Search → select the hit → calculate, and wait for the result card. */
  const driveToResult = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
  });

  it('scrolls the out-of-view result card into view with smooth behavior', async () => {
    stubMotionPreference(false);
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);
    // Entirely below the 768px jsdom fold.
    stubSummaryRect(rectAt(900, 1400, 500));

    await driveToResult(user);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('scrolls when visibility is marginal (barely peeking above the fold)', async () => {
    stubMotionPreference(false);
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);
    // 68 of 500px inside the 768px viewport — not substantially visible.
    stubSummaryRect(rectAt(700, 1200, 500));

    await driveToResult(user);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('does not scroll when the result card is already substantially in view', async () => {
    stubMotionPreference(false);
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);
    stubSummaryRect(rectAt(100, 500, 400));

    await driveToResult(user);

    expect(screen.getByTestId('result-card')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls instantly when prefers-reduced-motion is set', async () => {
    const matcher = stubMotionPreference(true);
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);
    stubSummaryRect(rectAt(900, 1400, 500));

    await driveToResult(user);

    expect(matcher).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
    });
  });
});

// ---------------------------------------------------------------------------
// Selection collapses the result list (catalog-first-run-polish 4.3): a
// selection replaces the inline result list with the chosen-product state,
// the collapse holds through the calculation, and "Vaihda" restores the
// list for another pick.
// ---------------------------------------------------------------------------

describe('CalculatorView selection collapses the result list (catalog-first-run-polish 4.3)', () => {
  it('replaces the result list with the chosen-product state and restores it on Vaihda', async () => {
    mockedSearchProducts.mockResolvedValue(
      searchResponse([HIT, NO_OFFER_HIT]),
    );
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    expect(await screen.findByText('Renat')).toBeInTheDocument();
    expect(screen.getByText('Tarjouskotilo')).toBeInTheDocument();

    await user.click(
      screen.getByText('Renat').closest('button') as HTMLButtonElement,
    );

    // The chosen-product state renders in the list's place: the selected
    // row's name, with the un-chosen rows gone and the section header
    // naming the selection.
    expect(screen.getByTestId('chosen-product')).toHaveTextContent('Renat');
    expect(screen.queryByText('Tarjouskotilo')).toBeNull();
    expect(screen.getByText('Valittu tuote')).toBeInTheDocument();

    // The collapse holds through the calculation — the list never
    // reappears behind the result.
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
    expect(screen.getByTestId('chosen-product')).toHaveTextContent('Renat');

    // "Vaihda" brings the list back for another pick.
    await user.click(screen.getByRole('button', { name: 'Vaihda' }));
    expect(await screen.findByText('Tarjouskotilo')).toBeInTheDocument();
    expect(screen.queryByTestId('chosen-product')).toBeNull();
  });
});
