/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('is an assertive live region (role="alert")', () => {
    render(<ErrorState title="Calculation failed" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('carries severity only through the error token group', () => {
    render(
      <ErrorState
        title="Calculation failed"
        description="The estimate could not be computed."
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('bg-error-bg');
    expect(alert.className).toContain('border-error-border');

    // Title in the error foreground color; the description stays neutral.
    expect(screen.getByText('Calculation failed').className).toContain(
      'text-error-fg',
    );
    expect(screen.getByText('The estimate could not be computed.').className).not.toContain(
      'text-error-fg',
    );
  });

  it('renders the exclamation icon aria-hidden (grayscale-safe shape)', () => {
    const { container } = render(<ErrorState title="Failed" />);

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a secondary retry button that calls onRetry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorState title="Failed" onRetry={onRetry} retryLabel="Try again" />,
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('data-variant', 'secondary');

    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders no retry button when onRetry is not given', () => {
    render(<ErrorState title="Failed" description="Permanent" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('requires retryLabel whenever onRetry is given (compile-time union)', () => {
    // The props union makes `onRetry` without `retryLabel` a compile error;
    // the @ts-expect-error below fails typecheck if the union is weakened.
    // @ts-expect-error — onRetry requires retryLabel
    const element = <ErrorState title="T" onRetry={() => undefined} />;

    // The union is the guard under test; rendering must not throw.
    render(element);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the children slot in the same row as the retry button', () => {
    render(
      <ErrorState
        title="Too many requests"
        onRetry={() => undefined}
        retryLabel="Try again"
      >
        <span>Retry allowed in 60 s</span>
      </ErrorState>,
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    const extra = screen.getByText('Retry allowed in 60 s');
    expect(retry.parentElement).toBe(extra.parentElement);
  });

  it('renders the children slot even without a retry button', () => {
    render(
      <ErrorState title="Failed">
        <a href="/methodology">Why did this happen?</a>
      </ErrorState>,
    );

    expect(
      screen.getByRole('link', { name: 'Why did this happen?' }),
    ).toBeInTheDocument();
  });
});
