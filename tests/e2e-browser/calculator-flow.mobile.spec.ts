/**
 * Mobile journey — calculator at phone viewports.
 *
 * Runs in the mobile-chrome-375 / mobile-chrome-390 projects (375×667
 * and 390×844 — playwright.workers.config.ts), walking the same
 * search → select → quantity → calculate path as the desktop
 * calculator-flow journey. The phone-view invariants it pins on the
 * surfaces it reaches:
 *
 *  - the shared QuantitySelector steppers keep their 44 px minimum
 *    touch-target size (task 5.4's h-11/w-11 boxes, measured, not
 *    assumed);
 *  - the rendered result never scrolls sideways at phone width.
 *
 * @module CalculatorFlowMobileJourney
 */

import { test, expect } from '@playwright/test';
import {
  COPY,
  SEED,
  acceptAgeGate,
  searchProduct,
} from './helpers';
import {
  expectNoHorizontalOverflow,
  expectTouchTargetAtLeast44px,
} from './mobile.helpers';

test.describe('calculator flow — mobile viewports', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('quantity steppers stay ≥44 px touch targets and the result renders without horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/calculator');

    await expect(
      page.getByRole('heading', { name: COPY.calculatorTitle, exact: true }),
    ).toBeVisible();

    // Search a seeded product and select it — selecting renders the
    // configure panel with the shared QuantitySelector.
    await searchProduct(page, SEED.query, SEED.beer.name);
    await page
      .getByRole('button', { name: SEED.beer.name, exact: false })
      .click();

    // The ± steppers are the quantity touch targets on small viewports:
    // both edges of both buttons measure at least 44 CSS px.
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

    // Run the calculation with the stepped quantity and reach the
    // result surface.
    await page
      .getByRole('button', { name: COPY.calculateButton, exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: COPY.costBreakdown, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(COPY.total, { exact: true }).first(),
    ).toBeVisible();

    // The itemized result must fit the phone viewport — no sideways
    // scroll to read the breakdown.
    await expectNoHorizontalOverflow(page);
  });
});
