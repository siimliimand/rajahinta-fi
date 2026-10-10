/**
 * OnboardingPage tests (task 3.2, change add-onboarding-preferences).
 *
 * Verifies the interstitial/editor wiring:
 *   1. Fresh (unanswered) state: nothing preselected, digest unticked
 *      per design D3, save + always-visible skip.
 *   2. Returning-account load hydrates the controls from the stored view
 *      (the page doubles as the editor).
 *   3. Account-scoped 401 → redirect to /login; non-401 load failure →
 *      retry instead of a redirect.
 *   4. Save → PUT with the chosen values + `onboarded: true`, empty
 *      categoryTags included (zero-selected is valid); failure renders
 *      the inline generic error without routing.
 *   5. Skip → PUT payload is exactly `{ onboarded: true }`, whatever the
 *      controls hold.
 *
 * The `Onboarding` catalog namespace lands with the copy task (5.1), so
 * these tests feed the page a Finnish fixture namespace through the same
 * provider shape `renderWithIntl` uses; copy assertions pin the fixture
 * keys, not the eventual catalog wording.
 *
 * @module OnboardingPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from './page';
import { ApiFetchError, getAccountPreferences, putAccountPreferences } from '@/lib/api';
import type { AccountPreferencesView, ApiError } from '@/lib/types';

// The router object is built once and hoisted: the page's load effect
// depends on the router reference (account-page precedent), and the real
// next-intl useRouter is stable across renders — a factory returning a
// fresh object would re-trigger the mount load on every state update.
const { replaceMock, stableRouter } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replaceMock: replace, stableRouter: { replace } };
});

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
  useRouter: () => stableRouter,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getAccountPreferences: vi.fn(),
    putAccountPreferences: vi.fn(),
  };
});

const mockedGet = vi.mocked(getAccountPreferences);
const mockedPut = vi.mocked(putAccountPreferences);

/** Finnish fixture copy for the `Onboarding` namespace (real catalogs
 *  arrive with 5.1; keys are the contract reported to that task). */
const ONBOARDING_MESSAGES = {
  Onboarding: {
    title: 'Asetuksesi',
    subtitle: 'Vastaukset vaikuttavat vain viikkoyhteenvetoon.',
    loading: 'Ladataan…',
    loadFailed: 'Asetusten lataaminen epäonnistui.',
    retry: 'Yritä uudelleen',
    channelLegend: 'Ostatko juomat matkalla vai kotiintoimituksena?',
    channelTravel: 'Matkalla (esim. Tallinna)',
    channelDelivery: 'Toimitus kotiin',
    channelBoth: 'Molemmat',
    categoryLegend: 'Seurattavat tuoteryhmät',
    categoryHelp: 'Voit jättää kaikki ryhmät valitsematta.',
    digestLabel: 'Viikkoyhteenveto sähköpostiin',
    digestCaption:
      'Kertoo kerran viikossa seurattujen ryhmien alhaisimmat hinnat. Voit lopettaa sen milloin tahansa.',
    save: 'Tallenna',
    saving: 'Tallennetaan…',
    skip: 'Ohita',
    skipping: 'Ohitetaan…',
    genericError: 'Tallennus epäonnistui. Yritä uudelleen.',
  },
};

function renderOnboarding(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fi" messages={ONBOARDING_MESSAGES}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Stored-view fixture: unanswered/unticked by default (the fresh state). */
function preferencesView(
  overrides: Partial<AccountPreferencesView> = {},
): AccountPreferencesView {
  return {
    channel: null,
    categoryTags: [],
    digestEnabled: false,
    onboardedAt: null,
    ...overrides,
  };
}

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-10-10T10:00:00.000Z',
    path: '/api/v1/account/preferences',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OnboardingPage', () => {
  it('renders the fresh quiz: nothing preselected, digest unticked (D3), skip visible', async () => {
    mockedGet.mockResolvedValue(preferencesView());

    renderOnboarding(<OnboardingPage />);
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());

    // Q1 unanswered state renders with no radio checked — no client-side
    // default substitutes for the stored null (D8).
    for (const option of ['TRAVEL', 'DELIVERY', 'BOTH']) {
      expect(screen.getByTestId(`onboarding-channel-${option}`)).not.toBeChecked();
    }
    // Q2 all chips off; zero selected stays a valid answer.
    expect(screen.getByTestId('onboarding-category-beer')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('onboarding-category-spirits')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Q3 digest consent is opt-in: unticked by default.
    expect(screen.getByTestId('onboarding-digest')).not.toBeChecked();
    // Skip renders enabled beside save.
    expect(screen.getByTestId('onboarding-skip')).toBeEnabled();
    expect(screen.getByTestId('onboarding-save')).toBeEnabled();
  });

  it('hydrates the controls from the stored view (returning-account editor)', async () => {
    mockedGet.mockResolvedValue(
      preferencesView({
        channel: 'DELIVERY',
        categoryTags: ['beer', 'spirits'],
        digestEnabled: true,
        onboardedAt: '2026-10-01T10:00:00.000Z',
      }),
    );

    renderOnboarding(<OnboardingPage />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-channel-DELIVERY')).toBeChecked(),
    );
    expect(screen.getByTestId('onboarding-channel-TRAVEL')).not.toBeChecked();
    expect(screen.getByTestId('onboarding-category-beer')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('onboarding-category-spirits')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('onboarding-category-wine_still')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('onboarding-digest')).toBeChecked();
  });

  it('redirects a signed-out visitor to /login on 401 and writes nothing', async () => {
    mockedGet.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'no session')),
    );

    renderOnboarding(<OnboardingPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('offers a retry on a non-401 load failure instead of a redirect', async () => {
    mockedGet.mockRejectedValue(
      new ApiFetchError(500, apiError(500, 'backend unreachable')),
    );

    renderOnboarding(<OnboardingPage />);

    expect(await screen.findByTestId('onboarding-load-failed')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('onboarding-retry')).toBeEnabled();
  });

  it('saves the chosen values with onboarded: true and routes to /account', async () => {
    mockedGet.mockResolvedValue(preferencesView());
    mockedPut.mockResolvedValue(
      preferencesView({ onboardedAt: '2026-10-10T10:00:00.000Z' }),
    );

    renderOnboarding(<OnboardingPage />);
    await screen.findByTestId('onboarding-save');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('onboarding-channel-TRAVEL'));
    await user.click(screen.getByTestId('onboarding-category-beer'));
    await user.click(screen.getByTestId('onboarding-digest'));
    await user.click(screen.getByTestId('onboarding-save'));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith({
        channel: 'TRAVEL',
        categoryTags: ['beer'],
        digestEnabled: true,
        onboarded: true,
      }),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/account'));
  });

  it('saves with empty categoryTags (zero-selected is a valid answer)', async () => {
    mockedGet.mockResolvedValue(preferencesView());
    mockedPut.mockResolvedValue(
      preferencesView({ onboardedAt: '2026-10-10T10:00:00.000Z' }),
    );

    renderOnboarding(<OnboardingPage />);
    await screen.findByTestId('onboarding-save');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('onboarding-channel-BOTH'));
    await user.click(screen.getByTestId('onboarding-save'));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith({
        channel: 'BOTH',
        categoryTags: [],
        digestEnabled: false,
        onboarded: true,
      }),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/account'));
  });

  it('renders the inline generic error when the save fails and does not route', async () => {
    mockedGet.mockResolvedValue(preferencesView());
    mockedPut.mockRejectedValue(
      new ApiFetchError(500, apiError(500, 'save failed')),
    );

    renderOnboarding(<OnboardingPage />);
    await screen.findByTestId('onboarding-save');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('onboarding-save'));

    expect(await screen.findByTestId('onboarding-failure')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('skip PUTs exactly { onboarded: true } regardless of the controls and routes to /account', async () => {
    mockedGet.mockResolvedValue(preferencesView());
    mockedPut.mockResolvedValue(
      preferencesView({ onboardedAt: '2026-10-10T10:00:00.000Z' }),
    );

    renderOnboarding(<OnboardingPage />);
    await screen.findByTestId('onboarding-save');

    // Tick everything first: skip must answer nothing and change nothing.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('onboarding-channel-TRAVEL'));
    await user.click(screen.getByTestId('onboarding-category-beer'));
    await user.click(screen.getByTestId('onboarding-digest'));
    await user.click(screen.getByTestId('onboarding-skip'));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    // Deep per-call match: any extra key would fail this assertion.
    expect(mockedPut).toHaveBeenCalledWith({ onboarded: true });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/account'));
  });
});
