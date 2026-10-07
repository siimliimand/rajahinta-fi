/**
 * ConfidenceMeter component tests (hedge-dedup-confidence-meter 4.1,
 * design D3/D4).
 *
 * Pins the display contract the confidence-framework spec delta names:
 *   - an absent margin renders nothing (render-nothing convention);
 *   - the ± € figure is computed from the persisted quantile × the total
 *     it qualifies, rounded to whole cents;
 *   - the basis is always adjacent: relative percent, sample count, and
 *     as-of date render beside the figure, never dropped;
 *   - the methodology explanation is one click away (the same /ranking
 *     destination the SiteFooter "Menetelmä" link uses);
 *   - a non-finite quantile renders nothing — a figure is never
 *     fabricated.
 *
 * @module ConfidenceMeterTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfidenceMeter from './ConfidenceMeter';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { EmpiricalMargin } from '@/lib/types';

// The methodology link renders through the i18n navigation Link; stub it
// with the plain-anchor shape the other view tests use.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// ---------------------------------------------------------------------------
// Fixtures — the wire shape (EmpiricalMarginView, empirical-margin.ts)
// ---------------------------------------------------------------------------

const MARGIN: EmpiricalMargin = {
  quantile: 0.05,
  sampleCount: 16,
  cell: { dimension: 'global', key: 'global' },
  asOf: '2026-09-28T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('ConfidenceMeter (hedge-dedup 4.1)', () => {
  it('renders nothing when the margin is absent', () => {
    const { container } = renderWithIntl(
      <ConfidenceMeter margin={undefined} totalCents={6480} />,
    );
    expect(screen.queryByTestId('confidence-meter')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders the ± euro figure computed from quantile × total', () => {
    renderWithIntl(<ConfidenceMeter margin={MARGIN} totalCents={6480} />);
    // 0.05 × 6480 ¢ = 324 ¢ → fi money form with the ± prefix.
    expect(screen.getByTestId('confidence-meter').textContent).toContain(
      '±3,24\u00a0€',
    );
  });

  it('rounds the ± figure to whole cents', () => {
    renderWithIntl(<ConfidenceMeter margin={MARGIN} totalCents={4650} />);
    // 0.05 × 4650 ¢ = 232.5 ¢ → 233 ¢.
    expect(screen.getByTestId('confidence-meter').textContent).toContain(
      '±2,33\u00a0€',
    );
  });

  it('renders the relative percent beside the figure', () => {
    renderWithIntl(<ConfidenceMeter margin={MARGIN} totalCents={6480} />);
    expect(screen.getByTestId('confidence-meter').textContent).toContain(
      '±5,0 %',
    );
  });

  it('renders the sample count adjacent', () => {
    renderWithIntl(<ConfidenceMeter margin={MARGIN} totalCents={6480} />);
    expect(screen.getByTestId('confidence-meter').textContent).toContain(
      'n=16',
    );
  });

  it('renders the as-of date adjacent, localized like AccuracyStat', () => {
    renderWithIntl(<ConfidenceMeter margin={MARGIN} totalCents={6480} />);
    expect(screen.getByTestId('confidence-meter').textContent).toContain(
      `laskettu ${new Date('2026-09-28T12:00:00.000Z').toLocaleDateString('fi-FI', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      })}`,
    );
  });

  it('links to the methodology explanation', () => {
    renderWithIntl(<ConfidenceMeter margin={MARGIN} totalCents={6480} />);
    const link = within_meter().querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/ranking');
  });

  it('renders nothing on a non-finite quantile — a figure is never fabricated', () => {
    const { container } = renderWithIntl(
      <ConfidenceMeter
        margin={{ ...MARGIN, quantile: Number.NaN }}
        totalCents={6480}
      />,
    );
    expect(screen.queryByTestId('confidence-meter')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

/** The meter under the default fi provider (helper keeps tests terse). */
function within_meter(): HTMLElement {
  return screen.getByTestId('confidence-meter');
}
