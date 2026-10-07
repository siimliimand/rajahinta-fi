/**
 * ComparisonView attribute-row tests (change
 * fi-locale-surface-hardening, task 2.6).
 *
 * Pins the shared `formatAttributeRow` join on the compare grid: a
 * product whose feed name yields no brand renders the category alone
 * ("Vodka · 50 cl"), never the dangling "· Vodka · …" the per-part
 * ``brand + ` · ${part}` `` interpolation produced when brand was
 * empty. The all-parts-present output is pinned identical to the
 * pre-helper rendering so the migration changes nothing else.
 *
 * @module ComparisonViewAttributeRowTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ComparisonView from './ComparisonView';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ComparisonProduct } from '@/lib/types';

// Offline: the row under test renders synchronously, so every api read
// gets a never-settling promise — the history panel keeps its loading
// state and no failure path (or act() noise) can fire before unmount.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    logClick: vi.fn(),
    getMerchantReliability: vi.fn(() => new Promise(() => {})),
    getProductDetail: vi.fn(() => new Promise(() => {})),
    getPriceHistory: vi.fn(() => new Promise(() => {})),
  };
});

// The i18n navigation Link (pulled in via MerchantWarningNotice) does
// not resolve under vitest's ESM transform — stub the plain-anchor
// shape every other component test uses (calculator-view.test.tsx
// precedent).
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

function makeProduct(
  overrides: Partial<ComparisonProduct> & { example?: boolean },
): ComparisonProduct {
  return {
    id: 1,
    name: 'Nimetön kotilo',
    brand: '',
    category: 'Vodka',
    unitVolume: '0.5',
    alcoholByVolume: null,
    totalCents: 5150,
    itemizedCosts: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 4000,
        reliability: 'VERIFIED',
      },
    ],
    confidence: 'MEDIUM',
    reliability: 'VERIFIED',
    ...overrides,
  };
}

function renderView(products: readonly ComparisonProduct[]) {
  return renderWithIntl(
    <ComparisonView
      products={products}
      sortBy="LOWEST_LANDED_COST"
      loading={false}
      onAddProduct={vi.fn()}
    />,
  );
}

describe('ComparisonView attribute row (fi-locale-surface-hardening 2.6)', () => {
  it('renders the category alone with no leading separator when the brand is empty', () => {
    renderView([makeProduct({})]);

    expect(screen.getByText('Vodka · 50 cl')).toBeInTheDocument();
  });

  it('renders the identical join when every part is present', () => {
    renderView([makeProduct({ brand: 'Sprit', name: 'Sprit kotilo' })]);

    expect(screen.getByText('Sprit · Vodka · 50 cl')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Prefilled example columns (task 3.2, change
// savings-first-catalog-and-prefill): prefilled columns render the
// example label and the one-note /savings link; visitor-added columns
// never do; the add tile stays in the wrapping grid.
// ---------------------------------------------------------------------------

describe('ComparisonView example columns (task 3.2, savings-first-catalog-and-prefill)', () => {
  it('labels every prefilled column with the example badge and links the note to /savings', () => {
    renderView([
      makeProduct({ id: 1, example: true }),
      makeProduct({ id: 2, example: true, name: 'Toinen tuote' }),
    ]);

    expect(screen.getAllByTestId('example-column-badge')).toHaveLength(2);
    expect(screen.getAllByText('Esimerkki')).toHaveLength(2);

    const note = screen.getByTestId('comparison-examples-note');
    expect(note.textContent).toContain('tilannekuvasta');
    const link = within(note).getByRole('link');
    expect(link).toHaveAttribute('href', '/savings');
  });

  it('renders no example label on a visitor-added column and no note without examples', () => {
    renderView([makeProduct({})]);

    expect(screen.queryByTestId('example-column-badge')).toBeNull();
    expect(screen.queryByTestId('comparison-examples-note')).toBeNull();
    // The add-product affordance still stands in the grid.
    expect(
      screen.getByRole('button', { name: /Lisää tuote/ }),
    ).toBeInTheDocument();
  });

  it('keeps the add tile in the same wrapping grid as the prefilled columns', () => {
    renderView([
      makeProduct({ id: 1, example: true }),
      makeProduct({ id: 2, example: true, name: 'Toinen tuote' }),
      makeProduct({ id: 3, example: true, name: 'Kolmas tuote' }),
    ]);

    const addTile = screen.getByRole('button', { name: /Lisää tuote/ });
    const grid = addTile.parentElement as HTMLElement;
    // One responsive grid wraps the three example columns plus the add
    // tile — the wrap classes carry the small-viewport reflow.
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-3');
    expect(grid.children).toHaveLength(4);
  });
});
