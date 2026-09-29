/**
 * Mobile journey — product page at phone viewports.
 *
 * Runs in the mobile-chrome-375 / mobile-chrome-390 projects (375×667
 * and 390×844 — playwright.workers.config.ts). Reaches the seeded TEST
 * Beer product page the way the funnel does — catalog keyword search
 * over the same seeded query the other journeys use, then the product
 * link (id 9001 in seed-journeys.d1.sql) — and pins the
 * no-horizontal-overflow invariant on the product surface.
 *
 * The product page carries no quantity control (honest absence: the
 * landed-cost path continues in the calculator), so the 44 px
 * touch-target contract for quantity controls is pinned on the shared
 * QuantitySelector in the calculator and basket mobile journeys.
 *
 * @module ProductFlowMobileJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, SEED, acceptAgeGate } from './helpers';
import { expectNoHorizontalOverflow } from './mobile.helpers';

test.describe('product flow — mobile viewports', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('catalog → product page renders without horizontal overflow', async ({
    page,
  }) => {
    // Catalog keyword search — the no-JS GET form's URL state (design
    // D5) — over the seeded query; the TEST products render as links to
    // their product pages.
    await page.goto('/products?q=TEST');

    await expect(
      page.getByRole('heading', { name: COPY.catalogHeading, exact: true }),
    ).toBeVisible();

    await page
      .getByRole('link', { name: SEED.beer.name, exact: false })
      .click();

    // Product surface: the seeded product's identity and its observed
    // offers render. The offers price renders "1.49 €" — cents/100
    // with the currency sign trailing, unlike the calculator's totals.
    await expect(
      page.getByRole('heading', { name: SEED.beer.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: COPY.offersTitle, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('1.49 €').first()).toBeVisible();

    // The product surface must fit the phone viewport — no sideways
    // scroll.
    await expectNoHorizontalOverflow(page);
  });
});
