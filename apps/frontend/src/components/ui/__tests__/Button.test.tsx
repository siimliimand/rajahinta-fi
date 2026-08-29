/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';

describe('Button', () => {
  it('defaults to type="button" so a Button inside a form never submits implicitly', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('passes an explicit type through', () => {
    render(<Button type="submit">Go</Button>);

    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)(
    'renders the %s variant via data-variant',
    (variant) => {
      render(<Button variant={variant}>V</Button>);

      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renders the %s size via data-size', (size) => {
    render(<Button size={size}>S</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('data-size', size);
  });

  it('defaults to the primary variant and md size', () => {
    render(<Button>D</Button>);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'md');
  });

  it('exposes disabled natively and does not fire onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'No' });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('passes onClick through on interaction', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click</Button>);

    await user.click(screen.getByRole('button', { name: 'Click' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards the ref to the underlying button element', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>R</Button>);

    expect(ref.current).toBe(screen.getByRole('button'));
  });
});
