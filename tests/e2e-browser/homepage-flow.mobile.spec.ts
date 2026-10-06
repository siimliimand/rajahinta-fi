/**
 * Mobile journey — homepage live gap hero at phone viewports
 * (homepage-live-gap-hero task 4.3).
 *
 * Runs in the mobile-chrome-375 / mobile-chrome-390 projects (375×667
 * and 390×844 — playwright.workers.config.ts). Pins the phone-view
 * invariants of the live observed-difference section's populated state
 * (Workers harness: boot-workers-stack.sh applies
 * seed-savings-snapshot.d1.sql):
 *
 *  - every hero row keeps the 44 px minimum touch-target size on BOTH
 *    edges — measured on the rendered row box, which IS the link's hit
 *    area: the product anchor stretches over the row via its ::after
 *    overlay against the row's containing block, so the rendered row is
 *    what a thumb actually hits (the same measured-not-assumed method
 *    the calculator/basket journeys use for the quantity steppers);
 *  - tapping a row — not the link text — navigates to the product page:
 *    the whole row is ONE link;
 *  - the page never scrolls sideways at phone width (the hero table's
 *    own overflow wrapper scrolls internally; the document must not).
 *
 * On a harness whose homepage renders a degraded state (no snapshot day
 * — E2E_SAVINGS_SNAPSHOT=0 — or the legacy harness's unavailable read)
 * there are no rows to measure; the journey then pins the degraded
 * contract instead: the state renders and no figure does.
 *
 * @module HomepageFlowMobileJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, SEED, acceptAgeGate } from './helpers';
import {
  expectNoHorizontalOverflow,
  expectTouchTargetAtLeast44px,
} from './mobile.helpers';

test.describe('homepage live gap hero — mobile viewports', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('hero rows are ≥44 px full-row links; degraded states render without figures', async ({
    page,
  }) => {
    await page.goto('/');

    const hero = page.getByTestId('home-gap-hero');
    await expect(hero).toBeVisible();
    await expect(
      hero.getByRole('heading', { name: COPY.liveGapHeading, exact: true }),
    ).toBeVisible();

    const rows = hero.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      // Degraded (pending / unavailable): the state renders, figures do
      // not — there is nothing to measure. Exactly one of the two state
      // bodies exists in the server-rendered HTML.
      const degraded = page
        .getByTestId('home-gap-hero-pending')
        .or(page.getByTestId('home-gap-hero-unavailable'));
      await expect(degraded).toBeVisible();
      await expect(hero.getByText('€')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      return;
    }

    // ── Populated: measure the rows, then tap one ──────────────────────
    await expect(rows).toHaveCount(2);

    for (const [index, name] of [
      [0, SEED.wine.name],
      [1, SEED.beer.name],
    ] as const) {
      const row = rows.nth(index);
      await expect(row).toContainText(name);
      // The row is the link's hit area (::after overlay) — both of its
      // rendered edges must clear the 44 px minimum.
      await expectTouchTargetAtLeast44px(row);
    }

    // Tapping the first row — wherever Playwright lands inside it after
    // scrolling, not on the link text — follows the whole-row link into
    // the product page (the fixture's most import-favourable row first).
    await rows.nth(0).click();
    await expect(page).toHaveURL(
      new RegExp(`/products/${SEED.savings.wineId}$`),
    );

    // The hero table may scroll inside its own wrapper; the page itself
    // must not scroll sideways.
    await expectNoHorizontalOverflow(page);
  });
});
