/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from '../Card';

function renderCard(ui: React.ReactElement) {
  const { container } = render(ui);
  // Card's default `as` is div; its first child element is the card itself
  // (render wraps the tree in a container div).
  return container.firstElementChild as HTMLElement;
}

describe('Card', () => {
  it('defaults to p-5 padding, shadow-sm, and a white surface', () => {
    const card = renderCard(<Card>C</Card>);

    expect(card.className).toContain('p-5');
    expect(card.className).toContain('shadow-sm');
    expect(card.className).toContain('bg-white');
  });

  it.each([
    ['none', ''],
    ['sm', 'p-4'],
    ['md', 'p-5'],
    ['lg', 'p-6'],
  ] as const)('renders padding=%s as %s', (padding, expected) => {
    const card = renderCard(<Card padding={padding}>C</Card>);

    if (expected === '') {
      for (const p of ['p-3', 'p-4', 'p-5', 'p-6']) {
        expect(card.className).not.toContain(p);
      }
    } else {
      expect(card.className).toContain(expected);
    }
  });

  it.each([
    ['none', ''],
    ['sm', 'shadow-sm'],
    ['md', 'shadow-md'],
  ] as const)('renders shadow=%s as %s', (shadow, expected) => {
    const card = renderCard(<Card shadow={shadow}>C</Card>);

    if (expected === '') {
      expect(card.className).not.toContain('shadow-sm');
      expect(card.className).not.toContain('shadow-md');
    } else {
      expect(card.className).toContain(expected);
    }
  });

  it('renders the muted gray surface only when muted', () => {
    expect(renderCard(<Card muted>C</Card>).className).toContain('bg-gray-50');
    expect(renderCard(<Card>C</Card>).className).toContain('bg-white');
  });

  it.each(['section', 'article', 'aside'] as const)(
    'renders as a %s when requested',
    (as) => {
      const { container } = render(<Card as={as}>C</Card>);

      expect(container.firstElementChild?.tagName.toLowerCase()).toBe(as);
    },
  );

  it('defaults to a div', () => {
    const { container } = render(<Card>C</Card>);

    expect(container.firstElementChild?.tagName.toLowerCase()).toBe('div');
  });

  it('keeps the base surface classes across every element choice', () => {
    const { container } = render(<Card as="section">C</Card>);

    expect(container.querySelector('section')?.className).toContain(
      'rounded-lg border border-gray-200',
    );
  });

  it('forwards the ref to the rendered element', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(<Card ref={ref}>C</Card>);

    expect(ref.current).toBe(container.firstElementChild);
  });
});
