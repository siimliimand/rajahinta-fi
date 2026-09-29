/**
 * Mobile journey — basket optimizer at phone viewports.
 *
 * Runs in the mobile-chrome-375 / mobile-chrome-390 projects (375×667
 * and 390×844 — playwright.workers.config.ts). Opens the basket
 * optimizer, adds a seeded product through the builder search (the same
 * placeholder and result-button convention as the calculator's
 * search), and exercises the basket line's quantity stepper — the same
 * shared QuantitySelector the calculator renders. The phone-view
 * invariants it pins:
 *
 *  - the basket line's steppers keep their 44 px minimum touch-target
 *    size, both edges, measured on the rendered boxes;
 *  - the builder surface never scrolls sideways at phone width.
 *
 * The optimization submit itself is out of scope here — the desktop
 * surfaces own the result-content assertions; this journey owns the
 * viewport invariants on the builder the task names.
 *
 * @module BasketFlowMobileJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, SEED, acceptAgeGate, searchProduct } from './helpers';
import {
  expectNoHorizontalOverflow,
  expectTouchTargetAtLeast44px,
} from './mobile.helpers';

test.describe('basket flow — mobile viewports', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('basket line quantity steppers stay ≥44 px and the builder surface renders without horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/basket');

    await expect(
      page.getByRole('heading', { name: COPY.basketTitle, exact: true }),
    ).toBeVisible();

    // Add a seeded product through the builder search; adding clears
    // the search panel and renders the basket line with its
    // QuantitySelector.
    await searchProduct(page, SEED.query, SEED.beer.name);
    await page
      .getByRole('button', { name: SEED.beer.name, exact: false })
      .click();

    const increase = page.getByRole('button', {
      name: COPY.quantityIncrease,
      exact: true,
    });
    const decrease = page.getByRole('button', {
      name: COPY.quantityDecrease,
      exact: true,
    });
    await expect(increase).toBeVisible();
    await expectTouchTargetAtLeast44px(increase);
    await expectTouchTargetAtLeast44px(decrease);

    // Exercise the control: 1 → 2 through the + stepper.
    await increase.click();
    await expect(
      page.getByLabel(COPY.quantityLabel, { exact: true }),
    ).toHaveValue('2');

    // The builder surface must fit the phone viewport — no sideways
    // scroll.
    await expectNoHorizontalOverflow(page);
  });
});
