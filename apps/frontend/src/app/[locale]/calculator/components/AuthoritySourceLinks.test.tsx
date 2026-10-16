/**
 * AuthoritySourceLinks tests (audit-copy-batch 3.1; completed by
 * calculator-authority-links-completion).
 *
 * The calculator result's curated authority links: the declaration panel's
 * two vero.fi guidance pages first, then the verified traveller links the
 * audit named (vero.fi Alkoholiverolaskuri, Tulli traveller guidance).
 * The pins:
 *   1. The heading labels the set, and all four links render in the set's
 *      order with their catalog labels.
 *   2. Every anchor opens in a new tab without granting the opened page
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
  it('renders the heading and all four authority links in the curated order', () => {
    renderWithIntl(<AuthoritySourceLinks />);

    expect(
      screen.getByTestId('authority-source-links'),
    ).toHaveTextContent('Viranomaislähteet');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    // Declaration panel's vero.fi guidance set first, then the audit's
    // traveller links (verified live 2026-10-16).
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
    expect(links[2]).toHaveAttribute(
      'href',
      'https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/alkoholiverolaskuri',
    );
    expect(links[2]).toHaveTextContent('Alkoholiverolaskuri (vero.fi)');
    expect(links[3]).toHaveAttribute(
      'href',
      'https://tulli.fi/rajoitukset/alkoholi/tuonti-matkalta',
    );
    expect(links[3]).toHaveTextContent('Alkoholin tuonti matkalta (Tulli)');
  });

  it('opens the authorities in a new tab without granting them access', () => {
    renderWithIntl(<AuthoritySourceLinks />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
