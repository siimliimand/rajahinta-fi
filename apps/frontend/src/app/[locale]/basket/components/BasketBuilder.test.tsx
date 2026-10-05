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
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BasketBuilder from './BasketBuilder';
import type { BasketItem } from './BasketBuilder';
import { searchProducts } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';

// The progress-indicator tests below never fire a search; the
// attribute-row tests override this default with their own fixtures.
vi.mock('@/lib/api', () => ({
  searchProducts: vi.fn().mockResolvedValue({ items: [] }),
}));

const ITEMS: BasketItem[] = Array.from({ length: 12 }, (_, i) => ({
  productId: i + 1,
  productName: `Product ${i + 1}`,
  quantity: 1,
}));

function renderBuilder(items: readonly BasketItem[], maxItems: number) {
  return renderWithIntl(
    <BasketBuilder
      items={items}
      maxItems={maxItems}
      minQueryLength={2}
      destination="FI"
      transportArrangement="SELLER_ARRANGED"
      onAddItem={vi.fn()}
      onUpdateQuantity={vi.fn()}
      onRemoveItem={vi.fn()}
      onDestinationChange={vi.fn()}
      onTransportArrangementChange={vi.fn()}
    />,
  );
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
