/**
 * FerryPricesBlock observed-price pins (change ferry-onboard-prices,
 * task 4.1).
 *
 * The observed onboard prices are FACTS, not offers: each row carries
 * the full provenance (operator, route, label, price, observation date)
 * plus its verbatim source citation behind the collapsed evidence
 * disclosure — the allowances page's house pattern. The one-line
 * disclaimer states the facts framing, and the block renders no buy CTA
 * anywhere (the only links are evidence citations).
 *
 * The honest empty state pins the spec: an empty array renders no block
 * at all, and an ABSENT key (older cached responses omit `ferryPrices`)
 * is treated exactly as empty — render nothing, no crash. The native
 * `<details>` toggle has no motion, so reduced-motion preferences need
 * no extra handling; the aria surface mirrors the sibling partner block
 * (a labeled `<aside>`).
 *
 * @module FerryPricesBlockTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FerryPricesBlock from './FerryPricesBlock';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { TripFerryPriceRow } from '../trip.types';

// ---------------------------------------------------------------------------
// Fixtures — one citation with a stored URL, one without
// ---------------------------------------------------------------------------

const ROWS: TripFerryPriceRow[] = [
  {
    operator: 'Eckerö Line',
    route: 'Helsinki–Maarianhamina',
    label: 'Olut 0,5 l purkki',
    priceCents: 350,
    observedAt: '2026-10-01',
    citation:
      'Laivan myymälähinnasto 1.10.2026 (https://example.com/pricelist)',
  },
  {
    operator: 'Viking Line',
    route: 'Helsinki–Tukholma',
    label: 'Kuohuviini 0,75 l pullo',
    priceCents: 1250,
    observedAt: '2026-10-02',
    citation: 'Terminaalin hyllyhinta, kirjattu havainto ilman linkkiä',
  },
];

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('FerryPricesBlock observed facts (ferry-onboard-prices 4.1)', () => {
  it('renders every row with its provenance inside the collapsed disclosure', () => {
    renderWithIntl(<FerryPricesBlock rows={ROWS} />);

    const block = screen.getByTestId('trip-ferry-prices');
    // The labeled-aside aria surface of the sibling partner block.
    expect(block.getAttribute('aria-label')).toBe('Laivaston havaitut hinnat');

    // Collapsed by default — the evidence opens on demand.
    const disclosure = screen.getByTestId('trip-ferry-prices-disclosure');
    expect(disclosure.hasAttribute('open')).toBe(false);

    const rows = screen.getAllByTestId('trip-ferry-price-row');
    expect(rows).toHaveLength(2);

    // Row provenance: operator · route, label, price (fi money form),
    // and the observation date as a calendar date, never raw ISO.
    expect(rows[0].textContent).toContain('Eckerö Line · Helsinki–Maarianhamina');
    expect(rows[0].textContent).toContain('Olut 0,5 l purkki');
    expect(rows[0].textContent).toContain('3,50\u00a0€');
    expect(rows[0].textContent).toContain('Havaintopäivä: 1.10.2026');
    expect(rows[1].textContent).toContain('Viking Line · Helsinki–Tukholma');
    expect(rows[1].textContent).toContain('Kuohuviini 0,75 l pullo');
    expect(rows[1].textContent).toContain('12,50\u00a0€');
    expect(rows[1].textContent).toContain('Havaintopäivä: 2.10.2026');
  });

  it('renders citations verbatim — evidence-linked when a URL is stored, plain text otherwise', () => {
    renderWithIntl(<FerryPricesBlock rows={ROWS} />);

    const rows = screen.getAllByTestId('trip-ferry-price-row');

    // The stored citation is the visible text, byte-level, with the
    // extracted URL only as the href.
    const link = within(rows[0]).getByRole('link');
    expect(link.textContent).toBe(
      'Laivan myymälähinnasto 1.10.2026 (https://example.com/pricelist)',
    );
    expect(link.getAttribute('href')).toBe('https://example.com/pricelist');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    // A citation without a URL stays verbatim plain text.
    expect(within(rows[1]).queryByRole('link')).toBeNull();
    expect(rows[1].textContent).toContain(
      'Terminaalin hyllyhinta, kirjattu havainto ilman linkkiä',
    );
  });

  it('carries the observed-facts disclaimer and no buy CTA', () => {
    renderWithIntl(<FerryPricesBlock rows={ROWS} />);

    const block = screen.getByTestId('trip-ferry-prices');
    expect(block.textContent).toContain('eivät ostotarjouksia');
    expect(block.textContent).toContain('eivätkä ne vaikuta laskelmiin');

    // The only links are evidence citations — never a purchase path,
    // and no button/submit anywhere in the block.
    expect(within(block).getAllByRole('link')).toHaveLength(1);
    expect(within(block).queryByRole('button')).toBeNull();
  });

  it('renders nothing when the rows array is empty', () => {
    renderWithIntl(<FerryPricesBlock rows={[]} />);
    expect(screen.queryByTestId('trip-ferry-prices')).toBeNull();
    expect(screen.queryByTestId('trip-ferry-prices-disclosure')).toBeNull();
  });

  it('renders nothing when the key is absent (older cached responses)', () => {
    renderWithIntl(<FerryPricesBlock />);
    expect(screen.queryByTestId('trip-ferry-prices')).toBeNull();
  });
});
