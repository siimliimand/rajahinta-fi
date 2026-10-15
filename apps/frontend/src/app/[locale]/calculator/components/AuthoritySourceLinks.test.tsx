/**
 * AuthoritySourceLinks tests (audit-copy-batch task 3.1).
 *
 * The calculator result's permanent official-source link set mirrors the
 * API's OFFICIAL_SOURCES (packages/core-domain
 * src/declaration/excise-declaration.service.ts) verbatim — no URL is
 * invented in the client. The pins:
 *   1. The heading labels the set, and both vero.fi links render in the
 *      API's order with their catalog labels.
 *   2. Both anchors open in a new tab without granting the opened page
 *      access (noopener) — the guidance panel's anchor conventions.
 *
 * @module AuthoritySourceLinksTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthoritySourceLinks from './AuthoritySourceLinks';
import { renderWithIntl } from '@/lib/testing/test-intl';

describe('AuthoritySourceLinks (audit-copy-batch 3.1)', () => {
  it('renders the heading and both vero.fi links in the official-source order', () => {
    renderWithIntl(<AuthoritySourceLinks />);

    expect(
      screen.getByTestId('authority-source-links'),
    ).toHaveTextContent('Viranomaislähteet');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    // Same set and order as the API's OFFICIAL_SOURCES — alcohol excise
    // duty first, then the excise-duties overview.
    expect(links[0]).toHaveAttribute(
      'href',
      'https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/alkoholi/',
    );
    expect(links[0]).toHaveTextContent('Alkoholivalmistevero (vero.fi)');
    expect(links[1]).toHaveAttribute(
      'href',
      'https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/',
    );
    expect(links[1]).toHaveTextContent('Valmisteverot (vero.fi)');
  });

  it('opens the authorities in a new tab without granting them access', () => {
    renderWithIntl(<AuthoritySourceLinks />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
