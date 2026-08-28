/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MerchantLink } from './MerchantLink';

describe('MerchantLink', () => {
  it('renders an anchor element with the label text', () => {
    render(
      <MerchantLink label="View at Merchant" offerId={42} />,
    );
    const link = screen.getByRole('link', { name: 'View at Merchant' });
    expect(link).toBeInTheDocument();
  });

  it('sets href to the outbound redirect endpoint', () => {
    render(
      <MerchantLink label="View" offerId={99} />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/api/v1/outbound/99'),
    );
  });

  it('opens in a new tab with nofollow noopener', () => {
    render(
      <MerchantLink label="View" offerId={1} />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'nofollow noopener');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MerchantLink
        label="View"
        offerId={1}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole('link'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies custom className', () => {
    render(
      <MerchantLink
        label="View"
        offerId={1}
        className="text-sm text-gray-500"
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveClass('text-sm', 'text-gray-500');
  });

  it('does not include tracking parameters in the URL', () => {
    render(
      <MerchantLink label="View" offerId={1} />,
    );
    const link = screen.getByRole('link');
    const href = link.getAttribute('href')!;
    expect(href).not.toContain('aff=');
    expect(href).not.toContain('ref=');
    expect(href).not.toContain('utm_');
    expect(href).not.toContain('tracking');
  });
});
