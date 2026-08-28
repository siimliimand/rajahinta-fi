/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { AgeGate } from './AgeGate';
import { renderWithIntl } from '@/lib/testing/test-intl';
import fiMessages from '@/messages/fi.json';

const STORAGE_KEY = 'age_confirmed';

// The gate navigates and reads the pathname through next-intl navigation,
// which needs a Next.js router context that unit tests do not have.
const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/',
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

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
    // Clear any cookies set by previous tests
    document.cookie = `${STORAGE_KEY}=; max-age=0`;
    replaceMock.mockClear();
  });

  it('sets localStorage key "age_confirmed" to "true" on confirm', async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('Olen 18 vuotta täyttänyt'));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('sets cookie "age_confirmed" on confirm', async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('Olen 18 vuotta täyttänyt'));

    expect(document.cookie).toContain(`${STORAGE_KEY}=true`);
  });

  it('uses the same key "age_confirmed" for both localStorage and cookie', async () => {
    // This validates the design invariant from DESIGN.md:
    // "One canonical storage key so the UI gate and the API token cannot diverge."
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('Olen 18 vuotta täyttänyt'));

    // Both storage mechanisms must use the identical key
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(document.cookie).toContain(`${STORAGE_KEY}=true`);
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

  it('decline navigates to the in-house page, not an external origin', async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('En'));

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/age-gate/declined');
  });

  it('decline clears the stored confirmation from localStorage and cookie', async () => {
    localStorage.setItem(STORAGE_KEY, 'false');
    document.cookie = `${STORAGE_KEY}=true; path=/; max-age=86400`;
    const user = userEvent.setup();
    renderWithIntl(<AgeGate><div>content</div></AgeGate>);

    await user.click(screen.getByText('En'));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(`${STORAGE_KEY}=true`);
  });
});
