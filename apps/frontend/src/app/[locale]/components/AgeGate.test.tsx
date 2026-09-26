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
// pathname is steerable so the declined-path exclusion is reachable.
const { replaceMock, pathnameState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pathnameState: { value: '/' },
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathnameState.value,
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

function seedConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=true; path=/`;
}

/** Render the gate around a marked restricted child, app conventions. */
function renderGate(initialVerified: boolean | null = false): void {
  renderWithIntl(
    <AgeGate initialVerified={initialVerified}>
      <div>content</div>
    </AgeGate>,
  );
}

/** Render to an HTML string the way the server would. */
function renderToHtml(
  initialVerified: boolean,
  children: React.ReactNode,
): string {
  return renderToString(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      <AgeGate initialVerified={initialVerified}>{children}</AgeGate>
    </NextIntlClientProvider>,
  );
}

function queryOverlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-age-gate-overlay]');
}

/** Dispatch a Tab keydown from the current activeElement (jsdom has no
    default tab navigation, so the trap's wrap is what moves focus). */
function pressTab(shift = false): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('AgeGate', () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear any cookie set by previous tests (seeded with path=/).
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
    replaceMock.mockClear();
    pathnameState.value = '/';
  });

  it('renders children behind the overlay prompt when unconfirmed', () => {
    renderGate(false);

    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByText(DENY_TEXT)).toBeTruthy();
    // Overlay, not replacement: restricted content stays in the DOM
    // behind the fixed overlay (crawlability without cloaking).
    expect(screen.getByText('content')).toBeTruthy();
    const overlay = queryOverlay();
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain('fixed');
  });

  it('confirm sets the age_confirmed cookie, closes the overlay, keeps the content', async () => {
    const user = userEvent.setup();
    renderGate(false);

    await user.click(screen.getByText(CONFIRM_TEXT));

    expect(document.cookie).toContain(`${COOKIE_NAME}=true`);
    expect(queryOverlay()).toBeNull();
    expect(screen.getByText('content')).toBeTruthy();

    // jsdom cannot read max-age back from document.cookie, so the 90-day
    // TTL is pinned through the exported constant instead.
    expect(AGE_CONFIRMATION_TTL_DAYS).toBe(90);
  });

  it('deny clears the cookie and redirects to the declined path', async () => {
    // No cookie (expired/absent) → the modal is what offers deny.
    const user = userEvent.setup();
    renderGate(false);
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();

    await user.click(screen.getByText(DENY_TEXT));

    expect(document.cookie).not.toContain(`${COOKIE_NAME}=`);
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith(DECLINED_PATH);
  });

  it('ignores and removes the stale legacy localStorage key when there is no cookie', () => {
    localStorage.setItem(COOKIE_NAME, 'true');
    renderGate(false);

    // localStorage is no longer a gate input: without a cookie the modal
    // still overlays the content, and the stale key is cleaned up on mount.
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
    expect(queryOverlay()).not.toBeNull();
    expect(localStorage.getItem(COOKIE_NAME)).toBeNull();
  });

  it('unconfirmed SSR carries the restricted content AND the overlay dialog', () => {
    const html = renderToHtml(
      false,
      <div data-testid="restricted">RESTRICTED-CONTENT-MARKER</div>,
    );

    expect(html).toContain('RESTRICTED-CONTENT-MARKER');
    expect(html).toContain('data-age-gate-overlay');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="age-gate-title"');
    // The inert placeholder branch is gone.
    expect(html).not.toContain('data-age-gate-placeholder');
  });

  it('confirmed SSR carries the content and ships no overlay', () => {
    const html = renderToHtml(
      true,
      <div data-testid="restricted">RESTRICTED-CONTENT-MARKER</div>,
    );

    expect(html).toContain('RESTRICTED-CONTENT-MARKER');
    expect(html).not.toContain('data-age-gate-overlay');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('Ikätarkistus');
  });

  it('hydrates the unconfirmed server HTML with no hydration mismatch', async () => {
    const serverHtml = renderToHtml(false, <div>content</div>);
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    const hydrationErrors: unknown[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      hydrationErrors.push(args);
    });

    const { hydrateRoot } = await import('react-dom/client');
    act(() => {
      hydrateRoot(
        container,
        <NextIntlClientProvider locale="fi" messages={fiMessages}>
          <AgeGate initialVerified={false}>
            <div>content</div>
          </AgeGate>
        </NextIntlClientProvider>,
      );
    });

    errorSpy.mockRestore();
    const flat = JSON.stringify(hydrationErrors);
    expect(flat).not.toMatch(/hydrat|mismatch/i);

    // The decision the server made still holds after hydration.
    expect(queryOverlay()).not.toBeNull();
    expect(screen.getByText('content')).toBeTruthy();
    container.remove();
  });

  it('re-opens the overlay when the api client dispatches age-gate:required', () => {
    seedConfirmedCookie();
    renderGate(true);
    expect(queryOverlay()).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(AGE_GATE_REQUIRED_EVENT));
    });

    expect(queryOverlay()).not.toBeNull();
    // Overlay, not replacement — the content is still in the DOM.
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('confirming from the recovery modal closes it and sets the cookie', async () => {
    seedConfirmedCookie();
    const user = userEvent.setup();
    renderGate(true);

    act(() => {
      window.dispatchEvent(new CustomEvent(AGE_GATE_REQUIRED_EVENT));
    });
    await user.click(screen.getByText(CONFIRM_TEXT));

    expect(queryOverlay()).toBeNull();
    expect(document.cookie).toContain(`${COOKIE_NAME}=true`);
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('the declined path renders children with no overlay (exclusion unchanged)', () => {
    pathnameState.value = DECLINED_PATH;
    renderGate(false);

    expect(queryOverlay()).toBeNull();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('moves focus into the dialog when the overlay opens', () => {
    renderGate(false);

    expect(document.activeElement).toBe(screen.getByText(CONFIRM_TEXT));
  });

  it('traps Tab focus inside the dialog while the overlay is open', () => {
    renderGate(false);
    const confirm = screen.getByText(CONFIRM_TEXT);
    const deny = screen.getByText(DENY_TEXT);
    expect(document.activeElement).toBe(confirm);

    // Tab on the last control wraps to the first.
    deny.focus();
    pressTab();
    expect(document.activeElement).toBe(confirm);

    // Shift+Tab on the first control wraps to the last.
    pressTab(true);
    expect(document.activeElement).toBe(deny);
  });

  it('returns focus to the triggering element after confirming the recovery modal', async () => {
    seedConfirmedCookie();
    const user = userEvent.setup();
    renderWithIntl(
      <AgeGate initialVerified={true}>
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent(AGE_GATE_REQUIRED_EVENT))
          }
        >
          open-gate
        </button>
        <div>content</div>
      </AgeGate>,
    );
    const trigger = screen.getByText('open-gate');

    await user.click(trigger);
    // The recovery-opened dialog owns focus.
    expect(document.activeElement).toBe(screen.getByText(CONFIRM_TEXT));

    await user.click(screen.getByText(CONFIRM_TEXT));

    // Focus handed back to the flow that opened the gate.
    expect(queryOverlay()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByText('content')).toBeTruthy();
  });
});
