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
import { describe, expect, it, vi } from 'vitest';
import BasketBuilder from './BasketBuilder';
import type { BasketItem } from './BasketBuilder';
import { renderWithIntl } from '@/lib/testing/test-intl';

// No search fires in these tests — the API client mock only guards the
// module import.
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
