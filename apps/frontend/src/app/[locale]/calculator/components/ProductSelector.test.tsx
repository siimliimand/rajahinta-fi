/**
 * ProductSelector attribute-row tests (change
 * fi-locale-surface-hardening, task 2.6).
 *
 * Pins the shared `formatAttributeRow` join on the search-result list:
 * a product whose feed name yields no brand renders the category alone
 * ("Vodka · 50 cl · 37.5 %"), never the dangling "· Vodka · …" the
 * per-part ``brand + ` · ${part}` `` interpolation produced when brand
 * was empty. The all-parts-present output is pinned identical to the
 * pre-helper rendering so the migration changes nothing else.
 *
 * @module ProductSelectorAttributeRowTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProductSelector from './ProductSelector';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';

function makeItem(overrides: Partial<ProductSearchItem>): ProductSearchItem {
  return {
    id: 1,
    name: 'Nimetön kotilo',
    brand: '',
    category: 'Vodka',
    alcoholByVolume: 0.375,
    unitVolume: '0.5',
    containerType: 'BOTTLE',
    lowestPriceCents: null,
    merchantCount: 0,
    ...overrides,
  };
}

function renderSelector(items: ProductSearchItem[]) {
  return renderWithIntl(
    <ProductSelector
      items={items}
      selectedId={null}
      onSelect={vi.fn()}
      loading={false}
      query="kotilo"
    />,
  );
}

describe('ProductSelector attribute row (fi-locale-surface-hardening 2.6)', () => {
  it('renders the category alone with no leading separator when the brand is empty', () => {
    renderSelector([makeItem({})]);

    expect(screen.getByText('Vodka · 50 cl · 37.5 %')).toBeInTheDocument();
  });

  it('renders the identical join when every part is present', () => {
    renderSelector([makeItem({ brand: 'Sprit' })]);

    expect(
      screen.getByText('Sprit · Vodka · 50 cl · 37.5 %'),
    ).toBeInTheDocument();
  });

  it('treats a whitespace-only brand as absent', () => {
    renderSelector([makeItem({ brand: '   ' })]);

    expect(screen.getByText('Vodka · 50 cl · 37.5 %')).toBeInTheDocument();
  });
});
