/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../Input';

describe('Input', () => {
  it('associates the label with the control via htmlFor/id', () => {
    render(<Input id="brand" label="Brand" />);

    const input = screen.getByLabelText('Brand');
    expect(input).toHaveAttribute('id', 'brand');
    expect(screen.getByText('Brand')).toHaveAttribute('for', 'brand');
  });

  it('renders hint text wired through aria-describedby', () => {
    render(<Input id="qty" label="Quantity" hint="Units per purchase" />);

    const input = screen.getByLabelText('Quantity');
    expect(input).toHaveAttribute('aria-describedby', 'qty-hint');
    expect(screen.getByText('Units per purchase')).toHaveAttribute(
      'id',
      'qty-hint',
    );
  });

  it('switches to the error state and wires the message into aria-describedby', () => {
    render(<Input id="vol" label="Volume" error="Volume is required" />);

    const input = screen.getByLabelText('Volume');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'vol-error');
    expect(input.className).toContain('border-error');

    const message = screen.getByText('Volume is required');
    expect(message).toHaveAttribute('id', 'vol-error');
    expect(message.className).toContain('text-error');
  });

  it('lists hint and error together in aria-describedby when both are given', () => {
    render(
      <Input id="price" label="Price" hint="Euros" error="Price is required" />,
    );

    expect(screen.getByLabelText('Price')).toHaveAttribute(
      'aria-describedby',
      'price-hint price-error',
    );
  });

  it('stays in the normal state without aria-invalid when there is no error', () => {
    render(<Input id="ok" label="Fine" />);

    const input = screen.getByLabelText('Fine');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input.className).toContain('border-gray-300');
  });

  it('omits hint/error ids when no id is given (nothing to wire to)', () => {
    render(<Input hint="Floating hint" />);

    const input = screen.getByDisplayValue('');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.getByText('Floating hint')).not.toHaveAttribute('id');
  });

  it('requires id when a label is given (compile-time union)', () => {
    // The props union makes `<Input label="…" />` without an id a compile
    // error; the @ts-expect-error below fails typecheck if the union is
    // ever weakened. At runtime the label still renders — but with no id
    // there is no `for` to associate.
    // @ts-expect-error — label requires id
    render(<Input label="Unguarded" />);

    expect(screen.getByText('Unguarded')).not.toHaveAttribute('for');
  });

  it('forwards the ref to the underlying input element', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input id="refd" ref={ref} />);

    expect(ref.current).toBe(screen.getByRole('textbox'));
  });
});
