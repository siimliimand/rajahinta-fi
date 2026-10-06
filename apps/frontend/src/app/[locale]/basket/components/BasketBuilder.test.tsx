/**
 * BasketBuilder progress-indicator tests (change
 * client-experience-improvement, task 2.4).
 *
 * Pins the basket-optimization spec scenario "Progress indicator shows
 * the cap": a basket holding 12 items against the 30-item cap displays
 * the literal "12/30" next to the item list, so the limit is visible
 * before it is hit. The digits render as plain text (no message-catalog
 * key); the localized heading carries the same counts for assistive
 * tech, so the duplicate counter is hidden from it.
 *
 * @module BasketBuilderProgressTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BasketBuilder from './BasketBuilder';
import type { BasketItem } from './BasketBuilder';
import { searchProducts, getSavingsBestPerMerchant } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';
import type { SavingsBestPerMerchantRow } from '@/lib/api';

// The progress-indicator tests below never fire a search or an example
// read; the attribute-row and example-list tests override these defaults
// with their own fixtures.
vi.mock('@/lib/api', () => ({
  searchProducts: vi.fn().mockResolvedValue({ items: [] }),
  getSavingsBestPerMerchant: vi.fn().mockResolvedValue({
    asOf: null,
    merchants: [],
  }),
}));

// The example block renders through the i18n navigation Link; stub it
// with the plain-anchor shape every other component test uses
// (calculator-view.test.tsx precedent).
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// Clear call history between tests (implementations persist, so the
// factory defaults above keep applying unless a test overrides them).
beforeEach(() => {
  vi.clearAllMocks();
});

const ITEMS: BasketItem[] = Array.from({ length: 12 }, (_, i) => ({
  productId: i + 1,
  productName: `Product ${i + 1}`,
  quantity: 1,
}));

function renderBuilder(
  items: readonly BasketItem[],
  maxItems: number,
  onAddItem = vi.fn(),
) {
  return {
    onAddItem,
    ...renderWithIntl(
      <BasketBuilder
        items={items}
        maxItems={maxItems}
        minQueryLength={2}
        destination="FI"
        transportArrangement="SELLER_ARRANGED"
        onAddItem={onAddItem}
        onUpdateQuantity={vi.fn()}
        onRemoveItem={vi.fn()}
        onDestinationChange={vi.fn()}
        onTransportArrangementChange={vi.fn()}
      />,
    ),
  };
}

describe('BasketBuilder — item-cap progress indicator (task 2.4)', () => {
  it('shows the literal 12/30 counter next to the item list', () => {
    renderBuilder(ITEMS, 30);

    const progress = screen.getByTestId('basket-item-progress');
    expect(progress).toHaveTextContent('12/30');
    // The digits are a plain text node, not an interpolated catalog key.
    expect(progress).toHaveTextContent(/^12\/30$/);
  });

  it('shows the localized basket title with the same counts', () => {
    renderBuilder(ITEMS, 30);

    expect(screen.getByText('Ostoskori (12/30)')).toBeInTheDocument();
  });

  it('shows 0/30 before any item is added', () => {
    renderBuilder([], 30);

    expect(screen.getByTestId('basket-item-progress')).toHaveTextContent(
      /^0\/30$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Attribute row (fi-locale-surface-hardening, task 2.6)
// ---------------------------------------------------------------------------

/** Feed rows can carry an empty brand when the name yields no token. */
const BRANDLESS_HIT: ProductSearchItem = {
  id: 5,
  name: 'Nimetön kotilo',
  brand: '',
  category: 'Vodka',
  alcoholByVolume: null,
  unitVolume: '0.5',
  containerType: 'BOTTLE',
  lowestPriceCents: null,
  merchantCount: 0,
};

function searchResponse(items: readonly ProductSearchItem[]) {
  return {
    items: [...items],
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

describe('BasketBuilder attribute row (fi-locale-surface-hardening 2.6)', () => {
  it('renders the result row without a leading separator when the brand is empty', async () => {
    vi.mocked(searchProducts).mockResolvedValue(
      searchResponse([BRANDLESS_HIT]),
    );
    const user = userEvent.setup();
    renderBuilder([], 30);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    // The empty brand contributes neither text nor the dangling ' · '.
    expect(await screen.findByText('Vodka · 0.5')).toBeInTheDocument();
  });

  it('renders the identical join when the brand is present', async () => {
    vi.mocked(searchProducts).mockResolvedValue(
      searchResponse([{ ...BRANDLESS_HIT, brand: 'Sprit' }]),
    );
    const user = userEvent.setup();
    renderBuilder([], 30);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    expect(
      await screen.findByText('Sprit · Vodka · 0.5'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Example deals in the empty state (task 3.3, change
// savings-first-catalog-and-prefill): the empty basket lists the
// per-merchant snapshot deals with per-item add buttons and a one-click
// example-basket fill. The basket starts EMPTY — nothing auto-adds, and
// an empty or failed listing renders nothing new.
// ---------------------------------------------------------------------------

const ROW: SavingsBestPerMerchantRow = {
  productId: 42,
  productName: 'Renat',
  category: 'Vodka',
  merchant: 'systembolaget',
  merchantCountry: 'SE',
  priceCents: 3099,
  observedAt: '2026-10-05T10:00:00.000Z',
  landedTotalCents: 3890,
  alkoReferenceCents: 4499,
  alkoObservedAt: '2026-10-05T10:00:00.000Z',
  gapCents: -609,
  gapBasisPoints: -1354,
  reliability: 'VERIFIED',
  confidence: 'HIGH',
  taxDatasetVersion: 'test',
};

const ROW_SECOND: SavingsBestPerMerchantRow = {
  ...ROW,
  productId: 77,
  productName: 'Toinen esimerkki',
  merchant: 'vinmonopolet',
  merchantCountry: 'NO',
};

describe('BasketBuilder example deals (task 3.3, savings-first-catalog-and-prefill)', () => {
  it('lists the per-merchant deals example-labeled with the /savings link — and never auto-adds', async () => {
    vi.mocked(getSavingsBestPerMerchant).mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW, ROW_SECOND],
    });
    const { onAddItem } = renderBuilder([], 30);

    const block = await screen.findByTestId('basket-examples');
    expect(within(block).getAllByTestId('basket-example-row')).toHaveLength(2);

    // Example labeling and the full-listing link.
    expect(within(block).getByTestId('basket-example-badge')).toHaveTextContent(
      'Esimerkki',
    );
    expect(
      within(block).getByRole('link', { name: 'Katso koko luettelo' }),
    ).toHaveAttribute('href', '/savings');

    // Snapshot figures per row: merchant, country, landed total.
    const firstRow = within(block).getAllByTestId('basket-example-row')[0] as HTMLElement;
    expect(within(firstRow).getByText('Renat')).toBeInTheDocument();
    expect(within(firstRow).getByText('systembolaget · SE')).toBeInTheDocument();
    expect(
      within(firstRow).getByText('Arvioitu kokonaishinta: 38,90 €'),
    ).toBeInTheDocument();

    // The basket starts EMPTY — rendering the list adds nothing.
    expect(onAddItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('basket-item-progress')).toHaveTextContent(
      '0/30',
    );
  });

  it('adds a single example through the regular add path when its button is clicked', async () => {
    vi.mocked(getSavingsBestPerMerchant).mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW, ROW_SECOND],
    });
    const user = userEvent.setup();
    const { onAddItem } = renderBuilder([], 30);

    const addButtons = await screen.findAllByTestId('basket-example-add');
    await user.click(addButtons[1] as HTMLElement);

    expect(onAddItem).toHaveBeenCalledTimes(1);
    expect(onAddItem).toHaveBeenCalledWith(
      ROW_SECOND.productId,
      ROW_SECOND.productName,
    );
  });

  it('fills the example basket in one click — one add per row', async () => {
    vi.mocked(getSavingsBestPerMerchant).mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW, ROW_SECOND],
    });
    const user = userEvent.setup();
    const { onAddItem } = renderBuilder([], 30);

    await screen.findByTestId('basket-examples');
    await user.click(screen.getByTestId('fill-example-basket'));

    expect(onAddItem).toHaveBeenCalledTimes(2);
    expect(onAddItem).toHaveBeenNthCalledWith(
      1,
      ROW.productId,
      ROW.productName,
    );
    expect(onAddItem).toHaveBeenNthCalledWith(
      2,
      ROW_SECOND.productId,
      ROW_SECOND.productName,
    );
  });

  it('renders nothing new on an empty listing — the plain empty state stands', async () => {
    // Explicit empty listing — mock implementations persist across
    // tests (only call history is cleared).
    vi.mocked(getSavingsBestPerMerchant).mockResolvedValue({
      asOf: null,
      merchants: [],
    });
    renderBuilder([], 30);

    await waitFor(() =>
      expect(getSavingsBestPerMerchant).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId('basket-examples')).toBeNull();
    expect(
      screen.getByText(
        'Tuotteita ei ole vielä lisätty. Käytä yllä olevaa hakua tuotteiden lisäämiseen.',
      ),
    ).toBeInTheDocument();
  });

  it('renders nothing new when the listing read fails', async () => {
    vi.mocked(getSavingsBestPerMerchant).mockRejectedValue(
      new Error('backend unreachable'),
    );
    renderBuilder([], 30);

    await waitFor(() =>
      expect(getSavingsBestPerMerchant).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId('basket-examples')).toBeNull();
  });

  it('hides the example list once the basket holds items', async () => {
    vi.mocked(getSavingsBestPerMerchant).mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW],
    });
    renderBuilder([{ productId: 42, productName: 'Renat', quantity: 1 }], 30);

    // The list is the EMPTY state's content; a held item suppresses it.
    await waitFor(() =>
      expect(getSavingsBestPerMerchant).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId('basket-examples')).toBeNull();
  });
});
