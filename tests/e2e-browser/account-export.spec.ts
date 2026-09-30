/**
 * Journey 4 — account stays gated for anonymous visitors.
 *
 * Credentials auth replaced the anonymous session auto-mint
 * (email-password-auth): nothing issues a `rajahinta_session`
 * client-side any more, and account data never renders for a signed-out
 * visitor.
 *
 * The 401 → /login redirect itself (design D8) is unconditional in the
 * account page's client (an account-scoped 401 replaces the route with
 * /login on every stack — the harness divergence this journey once
 * pinned is gone), so the journey pins the redirect outcome directly:
 * no session cookie is ever minted, no signed-in account surface
 * renders, and the anonymous /account visit lands on /login.
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
    // account-scoped 401 redirects to /login (design D8) on every stack.
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Tervetuloa takaisin', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Istuntotunnus:/)).toHaveCount(0);

    // The identity is server-held only: no anonymous session cookie was
    // issued on the way here (the auto-mint path is deleted).
    const cookies = await page.context().cookies();
    expect(
      cookies.find((c) => c.name === 'rajahinta_session'),
    ).toBeUndefined();
  });
});
