/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, ConfidenceBadge, ReliabilityBadge } from '../Badge';
import type { BadgeTone } from '../Badge';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import type { ConfidenceLevel, ReliabilityStatus } from '@/lib/types';

const RELIABILITY_STATUSES: readonly ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];

describe('Badge', () => {
  it('defaults to the neutral tone and md size', () => {
    render(<Badge>Plain</Badge>);

    const badge = screen.getByText('Plain');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
    expect(badge.className).toContain('text-xs');
  });

  it.each([
    'verified',
    'estimated',
    'stale',
    'unavailable',
    'error',
    'neutral',
  ] as const)('renders the %s tone via data-tone', (tone: BadgeTone) => {
    render(<Badge tone={tone}>{tone}</Badge>);

    expect(screen.getByText(tone)).toHaveAttribute('data-tone', tone);
  });

  it('renders the sm size with the smaller type scale', () => {
    render(<Badge size="sm">Small</Badge>);

    expect(screen.getByText('Small').className).toContain('text-[11px]');
  });
});

describe('ReliabilityBadge', () => {
  it.each(RELIABILITY_STATUSES)(
    'renders %s with the canonical ladder tone',
    (status) => {
      render(<ReliabilityBadge status={status} />);

      // The badge and the canonical status module must never diverge.
      expect(screen.getByText(status)).toHaveAttribute(
        'data-tone',
        RELIABILITY_STATUS_META[status].tone,
      );
    },
  );

  it.each(RELIABILITY_STATUSES)(
    'carries a grayscale-safe, aria-hidden icon shape for %s',
    (status) => {
      const { container } = render(<ReliabilityBadge status={status} />);

      const icon = container.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
    },
  );

  it('renders icon shapes that differ across statuses (color is never the sole carrier)', () => {
    const shapes = RELIABILITY_STATUSES.map((status) => {
      const { container } = render(<ReliabilityBadge status={status} />);
      // The first path/circle children define the shape; compare full inner SVG.
      return container.querySelector('svg')?.innerHTML ?? '';
    });

    expect(new Set(shapes).size).toBe(RELIABILITY_STATUSES.length);
  });

  it('falls back to the raw status string so it is never unlabeled', () => {
    render(<ReliabilityBadge status="UNAVAILABLE" />);

    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
  });

  it('renders the localized label when children are provided', () => {
    render(<ReliabilityBadge status="VERIFIED">Vahvistettu</ReliabilityBadge>);

    expect(screen.getByText('Vahvistettu')).toBeInTheDocument();
    expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument();
  });

  it('defaults to the sm size', () => {
    render(<ReliabilityBadge status="STALE" />);

    expect(screen.getByText('STALE').className).toContain('text-[11px]');
  });
});

describe('ConfidenceBadge', () => {
  it.each(CONFIDENCE_LEVELS)('renders %s with data-level', (level) => {
    render(<ConfidenceBadge level={level} />);

    expect(screen.getByText(level)).toHaveAttribute('data-level', level);
  });

  it.each(CONFIDENCE_LEVELS)(
    'tones %s from the canonical status module',
    (level) => {
      render(<ConfidenceBadge level={level} />);

      const meta = CONFIDENCE_LEVEL_META[level];
      expect(screen.getByText(level).className).toContain(meta.badge.bg);
    },
  );

  it('LOW confidence uses the error (red) token group', () => {
    render(<ConfidenceBadge level="LOW" />);

    expect(screen.getByText('LOW').className).toContain('bg-error-bg');
  });

  it('renders an aria-hidden bar meter whose filled count tracks the level', () => {
    const filled: Record<ConfidenceLevel, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    for (const level of CONFIDENCE_LEVELS) {
      const { container } = render(<ConfidenceBadge level={level} />);

      const meter = container.querySelector('span[aria-hidden="true"]');
      expect(meter).not.toBeNull();

      const bars = meter!.querySelectorAll('span');
      expect(bars).toHaveLength(3);

      const dimmed = [...bars].filter((bar) =>
        bar.className.includes('opacity-40'),
      );
      expect(dimmed).toHaveLength(3 - filled[level]);
    }
  });

  it('falls back to the raw level string so it is never unlabeled', () => {
    render(<ConfidenceBadge level="MEDIUM" />);

    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
  });

  it('renders the localized label when children are provided', () => {
    render(<ConfidenceBadge level="HIGH">Korkea luotettavuus</ConfidenceBadge>);

    expect(screen.getByText('Korkea luotettavuus')).toBeInTheDocument();
    expect(screen.queryByText('HIGH')).not.toBeInTheDocument();
  });

  it('defaults to the md size', () => {
    render(<ConfidenceBadge level="LOW" />);

    expect(screen.getByText('LOW').className).toContain('text-xs');
  });
});
