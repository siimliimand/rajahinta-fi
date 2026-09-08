/**
 * MerchantWarningNotice tests (trust-and-reach-roadmap task 2.4).
 *
 * Pins the display-only warning contract on the rendering side:
 *   1. Empty list renders NOTHING — absence is the quiet case (the
 *      fail-open join omits the block; an empty array is "no warnings").
 *   2. A warning renders the merchant name, the published-standard
 *      basis label, and a link to the warning's methodology URL.
 *   3. An unknown stored standardMet degrades to the generic basis —
 *      a schema extension must never crash a product page.
 *   4. Multiple warnings render one notice with one row each.
 *
 * Assertions run on the serialized HTML because each notice row mixes
 * the merchant name, basis, and rich link inside one paragraph.
 *
 * @module MerchantWarningNoticeTest
 */
// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import MerchantWarningNotice from './MerchantWarningNotice';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { MerchantWarning } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>) => {
    const { href, children, ...rest } = props;
    return React.createElement('a', { ...rest, href: String(href ?? '') }, children);
  },
}));

const WARNING: MerchantWarning = {
  merchantDomain: 'example.com',
  merchantName: 'example oy',
  standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
  publishedAt: '2026-09-01T00:00:00.000Z',
  methodologyUrl: '/ranking',
};

function renderToHtml(warnings: readonly MerchantWarning[]): string {
  const { container } = renderWithIntl(
    <MerchantWarningNotice warnings={warnings} />,
  );
  return container.innerHTML;
}

describe('MerchantWarningNotice', () => {
  it('renders nothing for an empty list', () => {
    const { container } = renderWithIntl(
      <MerchantWarningNotice warnings={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the merchant name, the basis label, and the methodology link', () => {
    const html = renderToHtml([WARNING]);

    expect(html).toContain('Julkaistu kauppiashuomautus');
    expect(html).toContain('Kauppias example oy:');
    // Finnish catalog basis label for the non-delivery standard.
    expect(html).toContain('useita itsenäisiä, vahvistettuja toimitushäiriöraportteja');
    // Links the warning's methodology destination.
    expect(html).toContain('href="/ranking"');
    expect(html).toContain('menetelmäsivulla');
  });

  it('falls back to the generic basis for an unknown standardMet', () => {
    const html = renderToHtml([{ ...WARNING, standardMet: 'SOMETHING_NEW' }]);
    expect(html).toContain('julkaistu näyttövaatimus');
    // And it does NOT render either specific basis.
    expect(html).not.toContain('toimitushäiriöraportteja');
    expect(html).not.toContain('yritysrekisteritieto');
  });

  it('renders one row per warning', () => {
    const html = renderToHtml([
      WARNING,
      { ...WARNING, merchantDomain: 'other.example', merchantName: 'other oy' },
    ]);
    expect(html).toContain('Kauppias example oy:');
    expect(html).toContain('Kauppias other oy:');
  });
});
