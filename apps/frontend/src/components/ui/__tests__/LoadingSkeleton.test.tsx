/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingSkeleton } from '../LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('hides itself from assistive technology (aria-hidden)', () => {
    const { container } = render(<LoadingSkeleton />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('defaults to the text variant, exposed via data-variant', () => {
    const { container } = render(<LoadingSkeleton />);

    expect(container.firstElementChild).toHaveAttribute('data-variant', 'text');
  });

  it.each(['text', 'box', 'card'] as const)('renders the %s variant', (variant) => {
    const { container } = render(<LoadingSkeleton variant={variant} />);

    expect(container.firstElementChild).toHaveAttribute('data-variant', variant);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders one block per count in the text variant', () => {
    const { container } = render(<LoadingSkeleton variant="text" count={3} />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('shortens the last text line only when there is more than one', () => {
    const single = render(<LoadingSkeleton variant="text" count={1} />);
    const singleLines = single.container.querySelectorAll('.animate-pulse');
    expect(singleLines).toHaveLength(1);
    expect(singleLines[0].className).not.toContain('w-5/6');

    const multi = render(<LoadingSkeleton variant="text" count={3} />);
    const lines = multi.container.querySelectorAll('.animate-pulse');
    expect(lines[0].className).toContain('w-full');
    expect(lines[0].className).not.toContain('w-5/6');
    expect(lines[2].className).toContain('w-5/6');
  });

  it('renders count boxes in the box variant', () => {
    const { container } = render(<LoadingSkeleton variant="box" count={2} />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
  });

  it('renders composed card blocks (four pulse elements each) in the card variant', () => {
    const { container } = render(<LoadingSkeleton variant="card" count={2} />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(8);
    expect(container.querySelectorAll('.rounded-lg.border')).toHaveLength(2);
  });

  it('clamps count below one to a single block', () => {
    for (const count of [0, -3]) {
      const { container } = render(<LoadingSkeleton count={count} />);

      expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
    }
  });
});
