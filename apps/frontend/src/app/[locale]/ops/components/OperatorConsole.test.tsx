/**
 * OperatorConsole governance action gating — the Grant/Revoke buttons
 * share section-level fields (source URL, note) and stay disabled until
 * they are filled. The console must say so: a visible hint while a
 * requirement is unmet and a title on each disabled button, not a silent
 * faded dead click (2026-10-20 operator session found the old behavior
 * indistinguishable from a broken button).
 *
 * @module OperatorConsole.test
 */
// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '@/lib/testing/test-intl';
import OperatorConsole from './OperatorConsole';
import { grantGovernance } from '../api';

vi.mock('../api', () => ({
  OpsApiError: class OpsApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  listGovernance: vi.fn(async () => ({
    items: [
      {
        merchantId: 'lazyshop',
        name: 'Lazyshop',
        country: 'FI',
        feedUrl: '',
        permissionStatus: 'PENDING',
        sourceCount: 1,
        hasWarnings: false,
      },
    ],
    total: 1,
  })),
  listConfirmations: vi.fn(async () => ({ taxReviews: [] })),
  listCorrections: vi.fn(async () => ({ items: [], total: 0 })),
  listAuditTrail: vi.fn(async () => ({ items: [], total: 0 })),
  grantGovernance: vi.fn(async () => ({
    merchantId: 'lazyshop',
    permissionStatus: 'GRANTED',
    updatedSources: 1,
    changed: true,
  })),
  revokeGovernance: vi.fn(async () => ({
    merchantId: 'lazyshop',
    permissionStatus: 'REVOKED',
    updatedSources: 1,
    changed: true,
  })),
  resolveTaxReview: vi.fn(),
  resolveCorrection: vi.fn(),
}));

const GRANT_HINT = 'Myöntäminen vaatii lähteen osoitteen.';
const REVOKE_HINT = 'Peruuttaminen vaatii kirjauksen tai syyn.';

/** Log in and load the console with the mocked governance fixture. */
async function renderLoadedConsole() {
  renderWithIntl(<OperatorConsole />);
  fireEvent.change(screen.getByLabelText('Operaattorin tunnus'), {
    target: { value: 'siim (owner)' },
  });
  fireEvent.change(screen.getByLabelText('Pääsytoken'), {
    target: { value: 'token' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lataa konsoli' }));
  await screen.findByText('Lazyshop');
}

function grantButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Myönnä' }) as HTMLButtonElement;
}

function revokeButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Peruuta' }) as HTMLButtonElement;
}

describe('OperatorConsole governance gating', () => {
  it('empty fields: both actions disabled, each stating its missing requirement', async () => {
    await renderLoadedConsole();

    expect(grantButton().disabled).toBe(true);
    expect(grantButton()).toHaveAttribute('title', GRANT_HINT);
    expect(revokeButton().disabled).toBe(true);
    expect(revokeButton()).toHaveAttribute('title', REVOKE_HINT);
    expect(screen.getByText(GRANT_HINT)).toBeInTheDocument();
    expect(screen.getByText(REVOKE_HINT)).toBeInTheDocument();
  });

  it('filled source URL: Grant enables and its hint clears, Revoke still gated', async () => {
    await renderLoadedConsole();

    fireEvent.change(screen.getByLabelText('Lähteen osoite'), {
      target: { value: 'https://lazyshop.fi/' },
    });

    expect(grantButton().disabled).toBe(false);
    expect(grantButton().getAttribute('title')).toBeNull();
    expect(screen.queryByText(GRANT_HINT)).toBeNull();
    expect(revokeButton().disabled).toBe(true);
    expect(screen.getByText(REVOKE_HINT)).toBeInTheDocument();
  });

  it('filled note: Revoke enables; the grant hint remains while the URL is still empty', async () => {
    await renderLoadedConsole();

    fireEvent.change(
      screen.getByLabelText('Kirjaus tai syy (pakollinen peruutukselle)'),
      { target: { value: 'owner unpark directive' } },
    );

    expect(revokeButton().disabled).toBe(false);
    expect(revokeButton().getAttribute('title')).toBeNull();
    expect(screen.queryByText(REVOKE_HINT)).toBeNull();
    expect(screen.getByText(GRANT_HINT)).toBeInTheDocument();
  });

  it('enabled Grant click submits the audited grant and flashes the recorded action', async () => {
    await renderLoadedConsole();

    fireEvent.change(screen.getByLabelText('Lähteen osoite'), {
      target: { value: 'https://lazyshop.fi/' },
    });
    fireEvent.click(grantButton());

    await screen.findByText(/Oikeus myönnetty: Lazyshop/);
    expect(grantGovernance).toHaveBeenCalledTimes(1);
    const call = vi.mocked(grantGovernance).mock.calls[0];
    expect(call?.[0]).toBe('token');
    expect(call?.[1]).toBe('lazyshop');
    expect(call?.[2]).toEqual({
      operator: 'siim (owner)',
      acquisitionMethod: 'PERMITTED_FEED',
      sourceUrl: 'https://lazyshop.fi/',
      note: undefined,
    });
  });
});
