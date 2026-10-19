/**
 * Scan entry button tests (task 3.3, change label-scan-product-lookup).
 *
 * Renders the REAL component directly (the labels resolve in the page —
 * the server owns the vocabulary, so this test pins the presentation
 * contract over literal props):
 *
 *   1. Exactly ONE link, carrying the given accessible name and hover
 *      title — an icon button's accessible name never comes from a
 *      hardcoded string (design D: labels are catalog keys, resolved
 *      server-side from Scan.entry*).
 *   2. The href resolves through the REAL routing vocabulary (the shared
 *      TestI18nLink double) — `{ pathname: '/scan' }` renders the
 *      localized segment, never a raw href.
 *   3. The icon is decorative inline SVG (aria-hidden) — the accessible
 *      name comes from the label alone.
 *   4. The ≥44 px touch-target floor is on the link (DESIGN.md mobile
 *      pattern — the scanner is a phone feature).
 *
 * @module ScanEntryButtonTest
 */
// @vitest-environment jsdom

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScanEntryButton from './ScanEntryButton';

// The i18n Link renders as a plain anchor carrying the href next-intl
// would produce, resolved against the REAL routing.pathnames vocabulary —
// the mock cannot drift from the config.
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

describe('ScanEntryButton', () => {
  it('renders one catalog-keyed icon link resolving /scan through the routing vocabulary', () => {
    render(
      <ScanEntryButton
        label="Tunnista etiketti kuvalla"
        ariaLabel="Avaa etiketin tunnistus"
      />,
    );

    const link = screen.getByRole('link', {
      name: 'Avaa etiketin tunnistus',
    });
    // The typed href object resolves to the localized FI segment; the EN
    // rendering is next-intl's localization layer (routing.ts), pinned by
    // the page test's EN catalog resolution and the messages parity pin.
    expect(link).toHaveAttribute('href', '/skannaus');
    expect(link).toHaveAttribute('title', 'Tunnista etiketti kuvalla');
    expect(link).toHaveClass('touch-target');
    // One link, one decorative icon — the button is icon-only.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const icon = link.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
