/**
 * Journey 4 — account stays gated for anonymous visitors.
 *
 * Credentials auth replaced the anonymous session auto-mint
 * (email-password-auth): nothing issues a `rajahinta_session`
 * client-side any more, and account data never renders for a signed-out
 * visitor.
 *
 * The 401 → /login redirect (design D8) and the legacy harness's
 * fail-closed retry affordance are both real: the Workers stack serves
 * /me from the API Worker (a 401 replaces the route with /login), while
 * the legacy compose harness has no /me and the load fails closed with
 * the retry affordance. The CI suite runs BOTH harnesses, so the
 * journey waits for either outcome and pins the invariants that hold on
 * both: no session cookie is ever minted and no signed-in account
 * surface renders.
 *
 * @module AccountExportJourney
 */

import { test, expect } from '@playwright/test';
import { acceptAgeGate } from './helpers';

test.describe('account export journey', () => {
  test('anonymous visitor: no session minted, no account data rendered', async ({
    page,
  }) => {
    // Cold CI stacks compile/serve the first /account load slowly (the
    // retry affordance appeared seconds after a naive 15 s window on the
    // 2026-10-01 run) — the journey needs more than the default budget.
    test.setTimeout(90_000);
    await acceptAgeGate(page);

    await page.goto('/account');

    // Signed-in account DATA never renders for an anonymous visitor: the
    // server-derived identity (welcome + session id) stays hidden. The
    // account-scoped 401 either replaces the route with /login (Workers
    // stack) or fails closed with the retry affordance (legacy stack).
    await expect
      .poll(
        () =>
          /\/login$/.test(page.url())
            ? 'redirect'
            : page.getByText('Tilin tietojen lataaminen epäonnistui.').count() >
                0
              ? 'retry-affordance'
              : page.getByRole('button', { name: 'Yritä uudelleen' }).count() >
                  0
                ? 'retry-affordance'
                : 'pending',
        { timeout: 25_000, intervals: [500, 1_000, 2_500, 5_000] },
      )
      .not.toBe('pending');
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
