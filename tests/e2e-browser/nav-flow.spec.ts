/**
 * Journey 6 — header navigation through the task groups
 * (three-task-navigation 3.3).
 *
 * The header is three disclosure groups, not a row of flat links: a
 * visitor reaches a tool by opening its group
 * (`nav-group-<name>-trigger`) and following the panel's real link.
 * The journey walks two groups — shopping → "Laskuri" → /laskuri,
 * then trip → "Ostoskori" → /ostoskori from the page the first hop
 * landed
 * on — so the trigger-opens-panel / panel-link-navigates contract is
 * exercised on real routes, including the second group's panel after a
 * client-side navigation (a route change must have closed the first
 * disclosure, not jammed the header).
 *
 * It also pins the demotion contract at the browser level: the scenario
 * calculator and the ranking methodology have no header anchors (they
 * live in the footer), and the removed Planning dropdown leaves no
 * testids behind.
 *
 * @module NavFlowJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, acceptAgeGate } from './helpers';

test.describe('header navigation through the task groups', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('opening a group and following its panel link reaches the tool', async ({
    page,
  }) => {
    await page.goto('/');

    // Shopping group → Laskuri: the trigger opens its panel and the
    // panel's tool link navigates.
    const shoppingTrigger = page.getByTestId('nav-group-shopping-trigger');
    await expect(shoppingTrigger).toBeVisible();
    await shoppingTrigger.click();

    const shoppingMenu = page.getByTestId('nav-group-shopping-menu');
    await expect(shoppingMenu).toBeVisible();
    await shoppingMenu
      .getByRole('link', { name: COPY.navCalculator, exact: true })
      .click();

    await expect(page).toHaveURL(/\/laskuri$/);
    await expect(
      page.getByRole('heading', { name: COPY.calculatorTitle, exact: true }),
    ).toBeVisible();

    // Trip group → Ostoskori, reached from the page the first hop
    // landed on — the previous disclosure must be closed (the header
    // navigable again), and this group's own panel work end to end.
    const tripTrigger = page.getByTestId('nav-group-trip-trigger');
    await expect(tripTrigger).toBeVisible();
    await tripTrigger.click();

    const tripMenu = page.getByTestId('nav-group-trip-menu');
    await expect(tripMenu).toBeVisible();
    await tripMenu
      .getByRole('link', { name: COPY.navBasket, exact: true })
      .click();

    await expect(page).toHaveURL(/\/ostoskori$/);
    await expect(
      page.getByRole('heading', { name: COPY.basketTitle, exact: true }),
    ).toBeVisible();
  });

  test('demoted tools and the removed Planning dropdown are absent from the header', async ({
    page,
  }) => {
    await page.goto('/');

    const header = page.locator('header');

    // Scenario calculator and ranking methodology live in the footer's
    // About column — no header anchor may point there (hrefs in the fi
    // canonical vocabulary — i18n/routing.ts); the Planning dropdown is
    // gone entirely (its testids included).
    await expect(header.locator('a[href="/skenaario"]')).toHaveCount(0);
    await expect(header.locator('a[href="/jarjestys"]')).toHaveCount(0);
    await expect(header.getByTestId('planning-dropdown-trigger')).toHaveCount(
      0,
    );
    await expect(header.getByTestId('planning-dropdown-menu')).toHaveCount(0);

    // The header's navigation IS the three task groups, plus the
    // account chrome outside them.
    for (const key of ['shopping', 'trip', 'event'] as const) {
      await expect(
        header.getByTestId(`nav-group-${key}-trigger`),
      ).toBeVisible();
    }
    await expect(header.getByTestId('header-account')).toBeVisible();
  });
});
