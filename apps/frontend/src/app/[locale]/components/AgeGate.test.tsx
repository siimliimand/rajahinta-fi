/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { AgeGate, AGE_CONFIRMATION_TTL_DAYS } from './AgeGate';
import { renderWithIntl } from '@/lib/testing/test-intl';
import fiMessages from '@/messages/fi.json';

const COOKIE_NAME = 'age_confirmed';
// Module-local in lib/api.ts (not exported), so tests dispatch the literal.
const AGE_GATE_REQUIRED_EVENT = 'age-gate:required';
const DECLINED_PATH = '/age-gate/declined';
const CONFIRM_TEXT = 'Olen 18 vuotta täyttänyt';
const DENY_TEXT = 'En';

// The gate navigates and reads the pathname through next-intl navigation,
// which needs a Next.js router context that unit tests do not have.
const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/',
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

function seedConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=true; path=/`;
}

/** Render the gate around a marked restricted child, app conventions. */
function renderGate(): void {
  renderWithIntl(<AgeGate><div>content</div></AgeGate>);
}

/** Render to an HTML string the way the server would. */
function renderToHtml(ui: React.ReactElement): string {
  return renderToString(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('AgeGate', () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear any cookie set by previous tests (seeded with path=/).
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
    replaceMock.mockClear();
  });

  it('renders the prompt with confirm/deny when the cookie is missing or expired', () => {
    renderGate();

    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByText(DENY_TEXT)).toBeTruthy();
    // Unconfirmed: restricted content stays behind the modal.
    expect(screen.queryByText('content')).toBeNull();
  });

  it('confirm sets the age_confirmed cookie and shows the content', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(screen.getByText(CONFIRM_TEXT));

    expect(document.cookie).toContain(`${COOKIE_NAME}=true`);
    expect(screen.getByText('content')).toBeTruthy();

    // jsdom cannot read max-age back from document.cookie, so the 90-day
    // TTL is pinned through the exported constant instead.
    expect(AGE_CONFIRMATION_TTL_DAYS).toBe(90);
  });

  it('deny clears the cookie and redirects to the declined path', async () => {
    // No cookie (expired/absent) → the modal is what offers deny.
    const user = userEvent.setup();
    renderGate();
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();

    await user.click(screen.getByText(DENY_TEXT));

    expect(document.cookie).not.toContain(`${COOKIE_NAME}=`);
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith(DECLINED_PATH);
  });

  it('ignores and removes the stale legacy localStorage key when there is no cookie', () => {
    localStorage.setItem(COOKIE_NAME, 'true');
    renderGate();

    // localStorage is no longer a gate input: without a cookie the modal
    // still renders, and the stale key is cleaned up on mount.
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
    expect(localStorage.getItem(COOKIE_NAME)).toBeNull();
  });

  it('renders the placeholder and no restricted content in SSR output', () => {
    const html = renderToHtml(
      <AgeGate>
        <div data-testid="restricted">RESTRICTED-CONTENT-MARKER</div>
      </AgeGate>,
    );

    expect(html).toContain('data-age-gate-placeholder');
    expect(html).not.toContain('RESTRICTED-CONTENT-MARKER');
  });

  it('re-opens the prompt when the api client dispatches age-gate:required', () => {
    seedConfirmedCookie();
    renderGate();
    expect(screen.getByText('content')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new CustomEvent(AGE_GATE_REQUIRED_EVENT));
    });

    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('confirming from the recovery modal closes it and sets the cookie', async () => {
    seedConfirmedCookie();
    const user = userEvent.setup();
    renderGate();

    act(() => {
      window.dispatchEvent(new CustomEvent(AGE_GATE_REQUIRED_EVENT));
    });
    await user.click(screen.getByText(CONFIRM_TEXT));

    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(document.cookie).toContain(`${COOKIE_NAME}=true`);
    expect(screen.getByText('content')).toBeTruthy();
  });
});
