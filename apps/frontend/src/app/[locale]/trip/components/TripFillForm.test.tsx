/**
 * TripFillForm attribute-row tests (change
 * fi-locale-surface-hardening, task 2.6).
 *
 * Pins the shared `formatAttributeRow` join on the fill-mode candidate
 * list: a product whose feed name yields no brand renders the volume
 * alone ("0.5"), never the dangling "· 0.5" the per-part
 * ``brand + ` · ${part}` `` interpolation produced when brand was
 * empty.
 *
 * @module TripFillFormAttributeRowTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TripFillForm from './TripFillForm';
import { searchProducts } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    // Only the ?product= handshake reads the detail; no prefill is
    // mounted here, and a never-settling stub keeps that path offline.
    getProductDetail: vi.fn(() => new Promise(() => {})),
    searchProducts: vi.fn(),
  };
});

const mockedSearchProducts = vi.mocked(searchProducts);

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

describe('TripFillForm attribute row (fi-locale-surface-hardening 2.6)', () => {
  it('renders the volume alone with no leading separator when the brand is empty', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([BRANDLESS_HIT]));
    const user = userEvent.setup();
    renderWithIntl(<TripFillForm onSubmit={vi.fn()} submitting={false} />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    // The fill row's only other part is the raw stored volume — with the
    // brand absent, nothing precedes it (this surface shows no category).
    const row = await screen.findByTestId('trip-fill-candidate-5');
    expect(within(row).getByText('0.5')).toBeInTheDocument();
  });

  it('renders the identical join when the brand is present', async () => {
    mockedSearchProducts.mockResolvedValue(
      searchResponse([{ ...BRANDLESS_HIT, brand: 'Sprit' }]),
    );
    const user = userEvent.setup();
    renderWithIntl(<TripFillForm onSubmit={vi.fn()} submitting={false} />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'kotilo');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    const row = await screen.findByTestId('trip-fill-candidate-5');
    expect(within(row).getByText('Sprit · 0.5')).toBeInTheDocument();
  });
});
