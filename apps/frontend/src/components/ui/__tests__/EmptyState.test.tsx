/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '../EmptyState';
import { Button } from '../Button';

describe('EmptyState', () => {
  it('is a polite live region (role="status")', () => {
    render(<EmptyState title="No results" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders title and description as the announced content', () => {
    render(
      <EmptyState title="No results" description="Try a different search term" />,
    );

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('No results');
    expect(region).toHaveTextContent('Try a different search term');
  });

  it('renders the icon slot wrapped in an aria-hidden container', () => {
    const { container } = render(
      <EmptyState
        title="Empty"
        icon={<svg data-testid="decorative-icon" viewBox="0 0 10 10" />}
      />,
    );

    const wrapper = container.querySelector('span[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).toContainElement(screen.getByTestId('decorative-icon'));
  });

  it('renders action and children together in one action row', () => {
    render(
      <EmptyState
        title="Nothing here"
        action={<Button>Clear filters</Button>}
      >
        <a href="/ranking">How ranking works</a>
      </EmptyState>,
    );

    const action = screen.getByRole('button', { name: 'Clear filters' });
    const link = screen.getByRole('link', { name: 'How ranking works' });

    // Both land in the same row div.
    expect(action.parentElement).toBe(link.parentElement);
  });

  it('renders no action row when neither action nor children are given', () => {
    const { container } = render(<EmptyState title="Bare" />);

    const region = screen.getByRole('status');
    expect(region.querySelector('.mt-2')).toBeNull();
    expect(container.querySelectorAll('div')).toHaveLength(2); // root + text block
  });
});
