/**
 * AccountPage tests (task 3.1, change email-password-auth).
 *
 * Verifies the reworked session section:
 *   1. ensureSession 401 → redirect to /login (the anonymous bootstrap is
 *      gone — there is no signed-out render).
 *   2. Signed in → the server-derived email and the verified badge render.
 *   3. Unverified → the unverified badge (status semantics, not a lockout)
 *      and a working resend-verification action.
 *   4. Transport failure → the retry note, no redirect.
 *
 * Onboarding preferences card (add-onboarding-preferences task 3.4):
 *   5. Nudge while `onboardedAt` is null; dismiss PUTs exactly
 *      `{ onboarded: true }` and flips the card in place (D6).
 *   6. Set-state: compact summary (channel / tag count / digest) +
 *      editor link; unanswered values summarize as "not set"/"none".
 *   7. Preferences read 401 → the signed-out redirect wins; non-401 →
 *      quiet degradation, no card, no redirect; failed dismiss → the
 *      nudge stays with an inline error.
 *
 * The card's catalog copy lands with task 5.1, so this block feeds the
 * page the Finnish catalog plus a local fixture for the new `Account`
 * keys through the same provider shape `renderWithIntl` uses (the
 * onboarding-page test precedent); copy assertions pin the fixture.
 *
 * @module AccountPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import {
  ApiFetchError,
  ensureSession,
  getAccountPreferences,
  getCalculationResult,
  putAccountPreferences,
  request,
  requestVerificationEmail,
} from '@/lib/api';
import fiMessages from '@/messages/fi.json';
import type {
  AccountPreferencesView,
  ApiError,
  CalculatorResult,
  SessionStatus,
} from '@/lib/types';

// The router object is built once and hoisted: the session and
// preferences effects depend on the router reference, and the real
// next-intl useRouter is stable across renders — a factory returning a
// fresh object would re-trigger the mount loads on every state update
// (onboarding-page test precedent).
const { replaceMock, stableRouter } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replaceMock: replace, stableRouter: { replace } };
});

vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return {
    Link: TestI18nLink,
    useRouter: () => stableRouter,
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ensureSession: vi.fn(),
    request: vi.fn(),
    getAccountPreferences: vi.fn(),
    getCalculationResult: vi.fn(),
    putAccountPreferences: vi.fn(),
    requestVerificationEmail: vi.fn(),
    // The mounted sub-sections probe these on mount.
    listScenarios: vi.fn().mockResolvedValue([]),
    fetchProductsByIds: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }),
  };
});

const mockedEnsureSession = vi.mocked(ensureSession);
const mockedRequest = vi.mocked(request);
const mockedResend = vi.mocked(requestVerificationEmail);
const mockedGetCalculationResult = vi.mocked(getCalculationResult);
const mockedGetPreferences = vi.mocked(getAccountPreferences);
const mockedPutPreferences = vi.mocked(putAccountPreferences);

function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/me',
  };
}

const SESSION: SessionStatus = {
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'kayttaja@example.fi',
  verified: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequest.mockResolvedValue([]);
  // Tests that don't exercise the preferences card get a non-401
  // rejection: the card degrades away and existing assertions are
  // unaffected (quiet degradation is the designed behavior).
  mockedGetPreferences.mockRejectedValue(
    new Error('preferences read not mocked in this test'),
  );
});

describe('AccountPage', () => {
  it('redirects to /login when ensureSession answers 401', async () => {
    mockedEnsureSession.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'SessionRequired')),
    );

    renderWithIntl(<AccountPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    // No signed-in content and no signed-out panel exist — the redirect
    // is the only way forward (there is no loading/anonymous dead end
    // once the redirect resolves).
    expect(screen.queryByTestId('account-email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-unverified-badge')).not.toBeInTheDocument();
  });

  it('renders the email and the verified badge for a verified account', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });

    renderWithIntl(<AccountPage />);

    expect(await screen.findByTestId('account-email')).toHaveTextContent(
      'kayttaja@example.fi',
    );
    expect(screen.getByTestId('account-verified-badge')).toHaveTextContent(
      'Vahvistettu',
    );
    expect(screen.queryByTestId('account-unverified-badge')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the unverified badge and the resend action (status, not lockout)', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue(SESSION);
    mockedResend.mockResolvedValue({ accepted: true });

    renderWithIntl(<AccountPage />);

    expect(await screen.findByTestId('account-unverified-badge')).toHaveTextContent(
      'Vahvistamatta',
    );
    // The feature sections still render — unverified is not a lockout.
    expect(screen.getByTestId('account-alerts-card')).toBeInTheDocument();

    await user.click(screen.getByTestId('account-resend-verification'));
    await waitFor(() => expect(mockedResend).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('account-resend-sent')).toBeInTheDocument();
  });

  it('surfaces a resend failure without leaving the page', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue(SESSION);
    mockedResend.mockRejectedValue(new Error('network down'));

    renderWithIntl(<AccountPage />);

    await user.click(await screen.findByTestId('account-resend-verification'));
    expect(await screen.findByTestId('account-resend-failed')).toBeInTheDocument();
  });

  it('shows the retry note on a transport failure without redirecting', async () => {
    mockedEnsureSession.mockRejectedValue(new Error('network down'));

    renderWithIntl(<AccountPage />);

    expect(await screen.findByTestId('account-load-failed')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Outcome deep-link (honest-trust-surfaces task 3.3): /account?outcome=
// <recordId> from the result view's nudge preselects that record's report
// form — scrolled into view and marked, never auto-submitted.
// ---------------------------------------------------------------------------

/** Minimal history record — only the fields the page renders. */
function historyResult(recordId: number): CalculatorResult {
  return {
    itemizedCosts: [],
    excludedOffers: [],
    foreignRetailPrice: 2400,
    transportCost: 0,
    alcoholExciseEstimate: 0,
    containerDutyEstimate: 0,
    totalCents: 2400,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: { text: 'Testidisclaimer', language: 'fi', version: 'test' },
    classification: {
      classification: 'NotPersisted',
      confidence: 'LOW',
      evidence: [],
      evidenceSummary: 'Ei tallennettu',
    },
    metadata: {
      input: { productId: 1, quantity: 1, destination: 'FI' },
      calculationTimestamp: new Date().toISOString(),
      productMasterId: 1,
      retailOfferIds: [],
      quantity: 1,
      destination: 'FI',
      productName: 'Historiatuote',
      volumeLitres: 0.33,
      alcoholByVolume: 4.7,
      category: 'beer',
      datasetVersions: [],
      transportOfferId: null,
    },
    calculationRecordId: recordId,
  } as CalculatorResult;
}

describe('AccountPage outcome deep-link (?outcome=, task 3.3)', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.history.pushState({}, '', '/account');
  });

  it('marks the requested record and scrolls its report form into view', async () => {
    window.history.pushState({}, '', '/account?outcome=42');
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedRequest.mockResolvedValue([{ recordId: 42, outcomeReported: false }]);
    mockedGetCalculationResult.mockResolvedValue(historyResult(42));

    renderWithIntl(<AccountPage />);

    const form = await screen.findByTestId('outcome-report-form-42');
    const entry = form.closest('li');
    expect(entry?.hasAttribute('data-outcome-preselected')).toBe(true);
    // The scroll runs in an effect after the history resolves — the spy
    // can lag the form's first paint, so await it instead of racing it.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it('leaves no highlight when the requested record is not in the history', async () => {
    window.history.pushState({}, '', '/account?outcome=99');
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedRequest.mockResolvedValue([{ recordId: 42, outcomeReported: false }]);
    mockedGetCalculationResult.mockResolvedValue(historyResult(42));

    renderWithIntl(<AccountPage />);

    // The history still renders (record 42's form), but nothing is
    // marked — the deep link never fabricates a prompt.
    await screen.findByTestId('outcome-report-form-42');
    expect(document.querySelector('[data-outcome-preselected]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Onboarding preferences card (D6, add-onboarding-preferences task 3.4):
// one nudge while `onboardedAt` is null — dismiss writes exactly
// `{ onboarded: true }` and flips the card in place; the set-state is a
// compact summary + editor link; a non-401 read failure renders no card.
// ---------------------------------------------------------------------------

/** Stored-view fixture (unanswered/unticked by default — the fresh state). */
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

/** Finnish catalog + the preferences-card keys as a local fixture — the
 *  catalog copy arrives with 5.1 (onboarding-page test precedent). */
const ACCOUNT_MESSAGES = {
  ...fiMessages,
  Account: {
    ...fiMessages.Account,
    onboardingTitle: 'Mieltymykset',
    onboardingNudgeBody:
      'Vastaa pariin kysymykseen, niin palvelu painottaa sinua koskevia hintoja.',
    onboardingCta: 'Vastaa kysymyksiin',
    onboardingDismiss: 'Ohita tämä',
    onboardingDismissFailed: 'Ohittaminen epäonnistui. Yritä uudelleen.',
    onboardingEdit: 'Muokkaa vastauksia',
    onboardingChannelLabel: 'Ostokanava',
    onboardingChannelNotSet: 'Ei valittu',
    onboardingChannelTravel: 'Matkalla',
    onboardingChannelDelivery: 'Kotiintoimitus',
    onboardingChannelBoth: 'Molemmat',
    onboardingTagsLabel: 'Seuratut tuoteryhmät',
    onboardingTagsNone: 'Ei valittu',
    onboardingTagsCount:
      '{count, plural, one {# tuoteryhmä} other {# tuoteryhmää}}',
    onboardingDigestLabel: 'Viikkoyhteenveto',
    onboardingDigestOn: 'Käytössä',
    onboardingDigestOff: 'Pois',
  },
};

/** renderWithIntl + the fixture keys for the card (see header note). */
function renderAccount(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fi" messages={ACCOUNT_MESSAGES}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('AccountPage onboarding preferences card (task 3.4)', () => {
  it('shows the nudge card linking to /onboarding while onboardedAt is null', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockResolvedValue(preferencesView());

    renderAccount(<AccountPage />);

    expect(
      await screen.findByTestId('account-onboarding-nudge'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('account-onboarding-summary'),
    ).not.toBeInTheDocument();
    // /onboarding stays reachable from the hub (D6).
    expect(
      screen.getByTestId('account-onboarding-cta').getAttribute('href'),
    ).toBe('/onboarding');
    expect(screen.getByTestId('account-onboarding-dismiss')).toBeInTheDocument();
  });

  it('dismiss PUTs exactly { onboarded: true } and flips to the set-state without reload', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockResolvedValue(preferencesView());
    mockedPutPreferences.mockResolvedValue(
      preferencesView({ onboardedAt: '2026-10-10T10:00:00.000Z' }),
    );

    renderAccount(<AccountPage />);

    await user.click(await screen.findByTestId('account-onboarding-dismiss'));
    await waitFor(() =>
      expect(mockedPutPreferences).toHaveBeenCalledTimes(1),
    );
    expect(mockedPutPreferences).toHaveBeenCalledWith({ onboarded: true });
    expect(
      await screen.findByTestId('account-onboarding-summary'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('account-onboarding-nudge'),
    ).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the set-state summary (channel, tag count, digest) with the editor link', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockResolvedValue(
      preferencesView({
        onboardedAt: '2026-10-10T10:00:00.000Z',
        channel: 'TRAVEL',
        categoryTags: ['beer', 'wine'],
        digestEnabled: true,
      }),
    );

    renderAccount(<AccountPage />);

    expect(
      await screen.findByTestId('account-onboarding-summary'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('account-onboarding-channel'),
    ).toHaveTextContent('Matkalla');
    expect(screen.getByTestId('account-onboarding-tags')).toHaveTextContent(
      '2',
    );
    expect(screen.getByTestId('account-onboarding-digest')).toHaveTextContent(
      'Käytössä',
    );
    expect(
      screen.queryByTestId('account-onboarding-nudge'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('account-onboarding-edit').getAttribute('href'),
    ).toBe('/onboarding');
  });

  it('summarizes unanswered values as "not set"/"none" (null channel, zero tags, digest off)', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockResolvedValue(
      preferencesView({ onboardedAt: '2026-10-10T10:00:00.000Z' }),
    );

    renderAccount(<AccountPage />);

    expect(
      await screen.findByTestId('account-onboarding-channel'),
    ).toHaveTextContent('Ei valittu');
    expect(screen.getByTestId('account-onboarding-tags')).toHaveTextContent(
      'Ei valittu',
    );
    expect(screen.getByTestId('account-onboarding-digest')).toHaveTextContent(
      'Pois',
    );
  });

  it('renders no card and no redirect when the preferences read fails non-401', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockRejectedValue(new Error('network down'));

    renderAccount(<AccountPage />);

    // The rest of the hub renders; the preferences surface degrades away.
    expect(await screen.findByTestId('account-email')).toBeInTheDocument();
    expect(
      screen.queryByTestId('account-onboarding-card'),
    ).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to /login when the preferences read answers 401 (signed-out handling wins)', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'SessionRequired')),
    );

    renderAccount(<AccountPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('keeps the nudge and shows the inline error when the dismiss PUT fails', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });
    mockedGetPreferences.mockResolvedValue(preferencesView());
    mockedPutPreferences.mockRejectedValue(new Error('network down'));

    renderAccount(<AccountPage />);

    await user.click(await screen.findByTestId('account-onboarding-dismiss'));
    expect(
      await screen.findByTestId('account-onboarding-dismiss-failed'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('account-onboarding-nudge'),
    ).toBeInTheDocument();
    expect(mockedPutPreferences).toHaveBeenCalledWith({ onboarded: true });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
