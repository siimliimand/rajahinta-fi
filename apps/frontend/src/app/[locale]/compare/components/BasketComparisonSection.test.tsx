/**
 * BasketComparisonSection cap disclosures (audit-copy-batch task 2.2,
 * spec web-application "Tool-limit disclosure").
 *
 * The comparison runs the same optimization as the basket behind a
 * smaller 10-item cap, so the same disclosure contract applies:
 *   - from 8 of 10 items the remaining capacity is named before the
 *     next add silently does nothing (the 30-item basket's five-slot
 *     window would be half of this cap);
 *   - below the window nothing warns;
 *   - at the cap the search form yields to the at-limit message that
 *     states the reason (the combination space) and offers the group
 *     order as the alternative for larger joint orders.
 *
 * @module BasketComparisonSectionCapTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BasketComparisonSection from './BasketComparisonSection';
import { searchProducts } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
  };
});

// The group-order link renders through the i18n navigation Link; stub it
// with the plain-anchor shape every other component test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Ten distinct rows — exactly the cap, so every add is a new item. */
const CATALOG: ProductSearchItem[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  name: `Tuote ${i + 1}`,
  brand: '',
  category: 'Olut',
  alcoholByVolume: 4.7,
  unitVolume: '0.33',
  containerType: 'BOTTLE',
  lowestPriceCents: 199,
  merchantCount: 2,
}));

function searchResponse(items: readonly ProductSearchItem[]) {
  return {
    items: [...items],
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

beforeEach(() => {
  vi.mocked(searchProducts).mockReset();
});

/**
 * Add the nth catalog row through the real UI path: search, then click
 * the single returned row. One row per search keeps the result-button
 * lookup unambiguous while the basket grows toward the cap.
 */
async function addProduct(
  user: ReturnType<typeof userEvent.setup>,
  nth: number,
): Promise<void> {
  vi.mocked(searchProducts).mockResolvedValue(
    searchResponse([CATALOG[nth - 1]!]),
  );
  await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'olut');
  await user.click(screen.getByRole('button', { name: 'Hae' }));
  await user.click(
    await screen.findByRole('button', {
      name: (name) => name.includes(`Tuote ${nth}`),
    }),
  );
}

describe('BasketComparisonSection cap disclosures (audit-copy-batch 2.2)', () => {
  it('names the remaining capacity from 8 of 10 items and stays quiet below', async () => {
    const user = userEvent.setup();
    renderWithIntl(<BasketComparisonSection />);

    for (let n = 1; n <= 7; n += 1) {
      await addProduct(user, n);
    }
    await waitFor(() =>
      expect(screen.getByText('Ostoskori (7/10)')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('compare-cap-proximity')).toBeNull();

    await addProduct(user, 8);
    expect(screen.getByTestId('compare-cap-proximity')).toHaveTextContent(
      'Kori 8/10 — vielä 2 paikkaa.',
    );

    await addProduct(user, 9);
    expect(screen.getByTestId('compare-cap-proximity')).toHaveTextContent(
      'Kori 9/10 — vielä 1 paikka.',
    );
  });

  it('at the cap replaces the search with the cap reason and the group-order alternative', async () => {
    const user = userEvent.setup();
    renderWithIntl(<BasketComparisonSection />);

    for (let n = 1; n <= 10; n += 1) {
      await addProduct(user, n);
    }

    // The at-limit state takes over the search card entirely.
    expect(screen.queryByPlaceholderText('Hae tuotteita…')).toBeNull();
    expect(
      screen.getByText(
        'Ostoskori on täynnä (enintään 10 tuotetta). Poista tuote lisätäksesi toisen.',
      ),
    ).toBeInTheDocument();
    // The reason the cap exists — the same optimization runs behind it.
    expect(
      screen.getByText(
        /korin koko on rajattu 10 tuotteeseen/,
      ),
    ).toBeInTheDocument();
    // The named alternative affordance links into the group order.
    const link = screen.getByRole('link', { name: 'ryhmätilaus' });
    expect(link).toHaveAttribute('href', '/group-order');
    // The proximity hint yields to the at-limit message.
    expect(screen.queryByTestId('compare-cap-proximity')).toBeNull();
  });
});
