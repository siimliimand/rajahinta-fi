/**
 * Mobile journey — header navigation through the task groups at phone
 * viewports (three-task-navigation 3.3).
 *
 * Runs in the mobile-chrome-375 / mobile-chrome-390 projects (375×667
 * and 390×844 — playwright.workers.config.ts). The mobile panel must
 * present the SAME three task groups as the desktop row, so the
 * journey toggles the menu open ("Päävalikko") and asserts ALL THREE
 * group disclosures are present — triggers carrying the task-language
 * labels and their panels, every testid `-mobile` suffixed — plus the
 * account and locale chrome inside the open panel.
 *
 * It then walks one group end to end: open the shopping disclosure,
 * follow "Laskuri" into /laskuri, and land on the same calculator
 * surface the desktop journey drives. While the panel is open the page
 * must not scroll sideways — the open panel is a phone surface like
 * any other (the suite's shared overflow invariant).
 *
 * @module NavFlowMobileJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, acceptAgeGate } from './helpers';
import { expectNoHorizontalOverflow } from './mobile.helpers';

test.describe('header navigation through the task groups — mobile viewports', () => {
  test.beforeEach(async ({ page }) => {
    // The desktop-only CI project (playwright.config.ts) has no phone
    // viewports; this journey verifies MOBILE chrome, so shrink the
    // viewport to a phone width when running wide. The phone-viewport
    // projects (playwright.workers.config.ts) keep their own sizes.
    if ((page.viewportSize()?.width ?? 0) > 640) {
      await page.setViewportSize({ width: 375, height: 667 });
    }
    await acceptAgeGate(page);
  });

  test('the panel presents the three task groups; a disclosure navigates to its tool', async ({
    page,
  }) => {
    await page.goto('/');

    // Toggle the mobile menu open — the only button named after the
    // navigation itself.
    const toggle = page.getByRole('button', {
      name: COPY.navToggle,
      exact: true,
    });
    await expect(toggle).toBeVisible();
    await toggle.click();

    // All three task groups are presented as disclosures: a visible
    // trigger speaking task language (not a tool name) and its panel,
    // both under the -mobile-suffixed testids.
    const groups = [
      ['shopping', COPY.groupShopping],
      ['trip', COPY.groupTrip],
      ['event', COPY.groupEvent],
    ] as const;
    for (const [key, label] of groups) {
      const trigger = page.getByTestId(`nav-group-${key}-trigger-mobile`);
      await expect(trigger).toBeVisible();
      // The trigger speaks task language, not a tool name (the exact
      // label strings are pinned by the SiteHeader unit suite; the
      // journey asserts the vocabulary shows up in the browser).
      await expect(trigger).toContainText(label);
      await expect(
        page.getByTestId(`nav-group-${key}-menu-mobile`),
      ).toBeAttached();
    }

    // The open panel is a phone surface: it must fit the viewport —
    // no sideways scroll while the navigation is expanded.
    await expectNoHorizontalOverflow(page);

    // Account and locale chrome ride in the same panel, -mobile
    // suffixed like the groups.
    await expect(page.getByTestId('header-account-mobile')).toBeVisible();
    await expect(page.getByTestId('locale-switcher-mobile')).toBeVisible();

    // Walk the shopping disclosure end to end: open it, follow the
    // tool link into the calculator.
    const shoppingTrigger = page.getByTestId(
      'nav-group-shopping-trigger-mobile',
    );
    await shoppingTrigger.click();

    const shoppingMenu = page.getByTestId('nav-group-shopping-menu-mobile');
    await expect(shoppingMenu).toBeVisible();
    await shoppingMenu
      .getByRole('link', { name: COPY.navCalculator, exact: true })
      .click();

    // Following the link lands on the calculator surface — and closes
    // the panel behind the navigation.
    await expect(page).toHaveURL(/\/laskuri$/);
    await expect(
      page.getByRole('heading', { name: COPY.calculatorTitle, exact: true }),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expectNoHorizontalOverflow(page);
  });
});
