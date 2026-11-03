/**
 * OpsConsoleNav tests (2026-10-26 ops-surface audit) — the discoverability
 * guard for the standalone console routes:
 *   1. All seven consoles render with their Finnish labels (the source of
 *      truth) as links.
 *   2. Every link carries the locale-prefixed /ops/<slug> href — the
 *      calendar-candidates link is pinned explicitly: it is the console
 *      whose invisibility read as "API-only" and prompted this nav.
 *   3. The intro copy renders so an operator can tell the inline sections
 *      from the standalone routes.
 *
 * @module OpsConsoleNavTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OpsConsoleNav from './OpsConsoleNav';
import { renderWithIntl } from '@/lib/testing/test-intl';

const EXPECTED_SLUGS = [
  'calendar-candidates',
  'calendar-events',
  'reports',
  'appeals',
  'newsletter',
  'guides',
  'name-quality',
] as const;

describe('OpsConsoleNav', () => {
  it('renders one locale-prefixed link per standalone console', () => {
    renderWithIntl(<OpsConsoleNav locale="fi" />);
    const list = screen.getByRole('list');
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(EXPECTED_SLUGS.length);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      EXPECTED_SLUGS.map((slug) => `/fi/ops/${slug}`),
    );
  });

  it('links the calendar-candidates review queue with its Finnish label', () => {
    renderWithIntl(<OpsConsoleNav locale="fi" />);
    const candidates = screen.getByRole('link', { name: 'Kalenteriehdokkaat' });
    expect(candidates.getAttribute('href')).toBe('/fi/ops/calendar-candidates');
  });

  it('renders the index heading and intro copy', () => {
    renderWithIntl(<OpsConsoleNav locale="fi" />);
    expect(screen.getByText('Muut konsolit')).toBeTruthy();
    expect(
      screen.getByText(
        'Kaikki operaattorityökalut eivät mahdu tälle sivulle — nämä konsolit ovat omilla sivuillaan.',
      ),
    ).toBeTruthy();
  });
});
