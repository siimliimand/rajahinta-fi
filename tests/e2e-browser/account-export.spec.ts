/**
 * Journey 4 — account stays gated for anonymous visitors.
 *
 * Credentials auth replaced the anonymous session auto-mint
 * (email-password-auth): nothing issues a `rajahinta_session`
 * client-side any more, and account data never renders for a signed-out
 * visitor.
 *
 * The 401 → /login redirect itself (design D8) is pinned by the frontend
 * account-page tests with a mocked API. The harness stack deliberately
 * carries no credential flow (accounts-module divergence docblock), so
 * the browser journey pins the stack-independent half: no session cookie
 * is ever minted and no signed-in account surface renders.
 *
 * @module AccountExportJourney
 */

import { test, expect } from '@playwright/test';
import { acceptAgeGate } from './helpers';

test.describe('account export journey', () => {
  test('anonymous visitor: no session minted, no account data rendered', async ({
    page,
  }) => {
    await acceptAgeGate(page);

    await page.goto('/account');

    // Signed-in account DATA never renders for an anonymous visitor: the
    // server-derived identity (welcome + session id) stays hidden. The
    // page's static feature chrome (export button, retention policy) is
    // not data and renders regardless. On this stack the account load
    // fails closed with a retry affordance (the harness has no /me —
    // credentials live in the API Worker); in production the same 401
    // surface redirects to /login.
    await expect(
      page.getByRole('heading', { name: 'Tervetuloa takaisin', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Istuntotunnus:/)).toHaveCount(0);
    await expect(
      page.getByText('Tilin tietojen lataaminen epäonnistui.'),
    ).toBeVisible();

    // The identity is server-held only: no anonymous session cookie was
    // issued on the way here (the auto-mint path is deleted).
    const cookies = await page.context().cookies();
    expect(
      cookies.find((c) => c.name === 'rajahinta_session'),
    ).toBeUndefined();
  });
});
