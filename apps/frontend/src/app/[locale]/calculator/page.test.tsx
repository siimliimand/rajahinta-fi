/**
 * Calculator page tests (OpenSpec: design-system-foundation, task 5.3;
 * price-intelligence-roadmap tasks 2.1).
 *
 * State-wiring tests pin the designed states wired into the real
 * search → calculate flow, rendered through the client view
 * (`calculator-view.tsx`, the D2 server-shell conversion):
 *   1. A settled search with zero results renders the EmptyState (not
 *      the selector's inline note).
 *   2. A failed search keeps the inline error and does NOT render the
 *      no-results EmptyState.
 *   3. A rate-limited calculation (429) renders the ErrorState with the
 *      localized rate-limit copy, surfaces the server's Retry-After
 *      wait in seconds, and wires the retry action to re-trigger the
 *      calculation.
 *   4. An age-gate rejection (403, body code AGE_GATE_REQUIRED) renders
 *      the localized AgeGate recovery copy instead of the raw backend
 *      message, with retry still available (age-gate-recovery 3.4).
 *
 * Server-shell tests (2.1) pin the reference conversion: the page owns
 * unique metadata and server-renders the intro + "how this calculation
 * works" summary (about-contact test precedent).
 *
 * @module CalculatorPageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorPage, { generateMetadata as calculatorMetadata } from './page';
import CalculatorView from './calculator-view';
import {
  ApiFetchError,
  searchProducts,
  calculateLandedCost,
  listScenarios,
} from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';

// The server shell (page.tsx) resolves its copy through next-intl/server;
// resolve straight from the Finnish catalog with {param} interpolation
// (about-contact test precedent). The client view uses next-intl's
// provider instead and is unaffected by this mock.
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
    calculateLandedCost: vi.fn(),
    listScenarios: vi.fn(),
    request: vi.fn(),
  };
});

// The merchant-warning notice (task 2.4) is rendered through the i18n
// navigation Link; the router-aware navigation module does not load
// under this test environment, so stub it with the plain-anchor shape
// every other page test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

const mockedSearchProducts = vi.mocked(searchProducts);
const mockedCalculateLandedCost = vi.mocked(calculateLandedCost);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HIT: ProductSearchItem = {
  id: 42,
  name: 'Renat',
  brand: 'Sprit',
  category: 'Vodka',
  alcoholByVolume: 37.5,
  unitVolume: '0,7 l',
  containerType: 'BOTTLE',
  lowestPriceCents: 999,
  merchantCount: 1,
};

function searchResponse(items: ProductSearchItem[]) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

/** The guard's 429 envelope: body carries the Retry-After seconds. */
function rateLimited(): ApiFetchError {
  return new ApiFetchError(429, {
    statusCode: 429,
    message: 'Rate limit exceeded. Try again in 30s.',
    error: 'TooManyRequests',
    timestamp: '2026-08-28T12:00:00Z',
    path: '/api/v1/calculator',
    retryAfterSeconds: 30,
  });
}

/** The guard's 403 age-gate envelope: body carries the machine code. */
function ageGateRequired(): ApiFetchError {
  return new ApiFetchError(403, {
    statusCode: 403,
    message: 'Age confirmation is required to use the calculator.',
    error: 'AgeGateRequired',
    timestamp: '2026-08-28T12:00:00Z',
    path: '/api/v1/calculator',
    code: 'AGE_GATE_REQUIRED',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listScenarios).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Search no-results → EmptyState
// ---------------------------------------------------------------------------

describe('CalculatorPage search no-results state (task 5.3)', () => {
  it('renders the designed EmptyState when a settled search returns nothing', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([]));
    const user = userEvent.setup();

    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'absintti');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    const title = await screen.findByText('Ei hakutuloksia');
    expect(title.closest('[data-state="empty"]')).not.toBeNull();
    expect(
      screen.getByText(
        /Tuotteita ei löytynyt haulla "absintti"\. Tarkista kirjoitusasu tai kokeile toista tuotenimeä\./,
      ),
    ).toBeInTheDocument();
    // The selector's inline no-results note is replaced, not duplicated.
    expect(
      screen.queryByText(/Kirjoita tuotteen nimi/),
    ).not.toBeInTheDocument();
  });

  it('keeps the inline error (no EmptyState) when the search itself fails', async () => {
    mockedSearchProducts.mockRejectedValue(new Error('search backend down'));
    const user = userEvent.setup();

    renderWithIntl(<CalculatorView />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'olut');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    await screen.findByText('search backend down');
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Calculation 429 → ErrorState with surfaced Retry-After
// ---------------------------------------------------------------------------

describe('CalculatorPage rate-limited calculation state (task 5.3)', () => {
  it('surfaces the 429 Retry-After through the ErrorState and retries', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([HIT]));
    mockedCalculateLandedCost.mockRejectedValue(rateLimited());
    const user = userEvent.setup();

    renderWithIntl(<CalculatorView />);

    // Search → select the hit.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // Calculate → 429.
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );

    // Designed error state: alert role, localized rate-limit copy, and
    // the server's wait in seconds.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('Laskenta epäonnistui')).toBeInTheDocument();
    expect(
      screen.getByText('Laskentojen määrää on rajoitettu väliaikaisesti.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('calc-retry-after')).toHaveTextContent(
      'Odota 30 sekuntia ja yritä sitten uudelleen.',
    );

    // Retry is wired to re-trigger the calculation.
    await user.click(screen.getByRole('button', { name: 'Yritä uudelleen' }));
    await waitFor(() =>
      expect(mockedCalculateLandedCost).toHaveBeenCalledTimes(2),
    );
  });
});

// ---------------------------------------------------------------------------
// Calculation age-gate 403 → ErrorState with localized recovery copy
// ---------------------------------------------------------------------------

describe('CalculatorPage age-gate recovery state (age-gate-recovery 3.4)', () => {
  it('maps the age-gate 403 to the localized recovery copy and hides the raw message', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([HIT]));
    mockedCalculateLandedCost.mockRejectedValue(ageGateRequired());
    const user = userEvent.setup();

    renderWithIntl(<CalculatorView />);

    // Search → select the hit.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // Calculate → 403 AGE_GATE_REQUIRED.
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );

    // Designed error state carries the localized AgeGate recovery copy
    // (fi.json catalog) — never the raw backend message.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('Ikävahvistus tarvitaan')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ikävahvistuksesi on vanhentunut. Vahvista ikäsi jatkaaksesi.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Age confirmation is required to use the calculator.'),
    ).toBeNull();
    // The generic failure copy is replaced too, not stacked.
    expect(screen.queryByText('Laskenta epäonnistui')).toBeNull();

    // Retry stays available so the user can re-run after confirming.
    expect(
      screen.getByRole('button', { name: 'Yritä uudelleen' }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Server shell (task 2.1, D2): unique metadata + SSR intro / method summary
// ---------------------------------------------------------------------------

describe('CalculatorPage server shell (task 2.1)', () => {
  it('emits unique metadata with the cross-border calculator framing', async () => {
    const meta = await calculatorMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Rajat ylittävä kustannuslaskuri');
    expect(meta.description).toContain('kokonaiskustannuksesta Suomeen');
    // Unique against the site-default metadata title, not a restatement.
    const root = (await import('@/messages/fi.json')).default as {
      Metadata: { title: string };
    };
    expect(meta.title).not.toBe(root.Metadata.title);
  });

  it('server-renders the intro and the how-this-calculation-works summary', async () => {
    const messages = (await import('@/messages/fi.json')).default;
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={messages}>
        {await CalculatorPage({ params: Promise.resolve({ locale: 'fi' }) })}
      </NextIntlClientProvider>,
    );

    expect(html).toContain('Kokonaiskustannuslaskuri');
    expect(html).toContain('Miten laskenta toimii');
    // The summary is content, not advice — the estimates stance holds.
    expect(html).toContain('ei vero- tai tullineuvontaa');
  });
});
