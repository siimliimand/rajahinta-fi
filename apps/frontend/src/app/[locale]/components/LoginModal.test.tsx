/**
 * LoginModal tests (task 3.3, change add-product-favorites).
 *
 * Verifies the composition — Dialog + LoginForm — not what the parts
 * already cover in their own suites:
 *   1. Closed renders nothing; open renders the dialog with the form.
 *   2. Open moves focus into the dialog; close returns it to the trigger.
 *   3. Escape and a backdrop click dismiss via onClose.
 *   4. Register and forgot-password links carry the page's hrefs.
 *   5. Login success fires onSuccess; a 401 failure stays in the dialog.
 *
 * @module LoginModalTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginModal from './LoginModal';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, loginAccount } from '@/lib/api';
import type { ApiError } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    loginAccount: vi.fn(),
  };
});

const mockedLogin = vi.mocked(loginAccount);

function queryOverlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-dialog-overlay]');
}

function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/login',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithIntl(
      <LoginModal open={false} onClose={() => {}} onSuccess={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(queryOverlay()).toBeNull();
    expect(screen.queryByTestId('login-submit')).toBeNull();
  });

  it('renders the form and both links inside the dialog when open', () => {
    renderWithIntl(<LoginModal open onClose={() => {}} onSuccess={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: 'Kirjaudu sisään' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(screen.getByLabelText('Sähköpostiosoite'));
    expect(screen.getByLabelText('Salasana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unohditko salasanan?' })).toHaveAttribute(
      'href',
      '/account/forgot',
    );
    expect(screen.getByRole('link', { name: 'Luo tili' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('moves focus into the dialog on open and back to the trigger on close', async () => {
    const user = userEvent.setup();
    // Stateful host: open via the trigger, dismiss via Escape, which is
    // the real flow (a bare rerender would swap out the intl provider).
    function Host() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>trigger</button>
          <LoginModal open={open} onClose={() => setOpen(false)} onSuccess={() => {}} />
        </>
      );
    }
    renderWithIntl(<Host />);

    await user.click(screen.getByText('trigger'));
    expect(document.activeElement).toBe(screen.getByLabelText('Sähköpostiosoite'));

    await user.keyboard('{Escape}');
    expect(queryOverlay()).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('trigger'));
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithIntl(<LoginModal open onClose={onClose} onSuccess={() => {}} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on a backdrop click but not on clicks inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithIntl(<LoginModal open onClose={onClose} onSuccess={() => {}} />);

    await user.click(screen.getByLabelText('Sähköpostiosoite'));
    expect(onClose).not.toHaveBeenCalled();

    queryOverlay()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onSuccess when the login succeeds', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockedLogin.mockResolvedValue({
      userId: '11111111-2222-4333-8444-555555555555',
      expiresAt: '2026-09-27T00:00:00.000Z',
      verified: false,
    });
    renderWithIntl(<LoginModal open onClose={() => {}} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledWith(
      'kayttaja@example.fi',
      'salasana-12-merkKIna',
    ));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('renders the credentials failure inside the dialog and keeps onSuccess silent', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockedLogin.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'InvalidCredentials')),
    );
    renderWithIntl(<LoginModal open onClose={() => {}} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'vasara');
    await user.click(screen.getByTestId('login-submit'));

    const failure = await screen.findByTestId('login-failure');
    expect(screen.getByRole('dialog')).toContainElement(failure);
    expect(failure).toHaveTextContent('Virheellinen sähköposti tai salasana.');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
