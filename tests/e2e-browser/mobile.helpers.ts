/**
 * Mobile-viewport invariant helpers for the browser E2E suite.
 *
 * The mobile projects (mobile-chrome-375 / mobile-chrome-390 in
 * playwright.workers.config.ts — 375×667 and 390×844) run the
 * calculator, basket, and product journeys at phone viewports and pin
 * two viewport invariants on every surface they reach:
 *
 *  1. No horizontal overflow — a phone must never scroll sideways to
 *     read a result. Measured on the document's scrolling element
 *     (body equivalent included via the fallback), the same signal a
 *     real visitor experiences as sideways panning.
 *  2. The 44 px minimum touch-target size on quantity controls —
 *     the shared QuantitySelector steppers, measured on the rendered
 *     bounding box (width AND height), not the style declaration.
 *
 * `expect.poll` inside the overflow helper waits for hydration and
 * late layout to settle — it is a wait, not a retry: the suite's
 * `retries: 0` philosophy is untouched.
 *
 * @module MobileE2EHelpers
 */

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Minimum touch-target edge, in CSS pixels (WCAG 2.5.8 target size
 * minimum / the iOS HIG 44 pt guideline the steppers implement).
 */
export const MIN_TOUCH_TARGET_PX = 44;

/**
 * Assert the current page never scrolls horizontally: the scrolling
 * element's content width stays within the viewport width. Polled so a
 * just-hydrated layout has room to settle before the verdict.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.scrollingElement ?? document.body).scrollWidth -
          window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

/**
 * Assert a control's rendered box meets the 44 px touch-target minimum
 * on BOTH edges — width and height. Measured on the element itself; a
 * visually smaller hit area cannot hide behind a padded parent.
 */
export async function expectTouchTargetAtLeast44px(
  control: Locator,
): Promise<void> {
  const box = await control.boundingBox();
  if (box === null) {
    throw new Error(
      'touch target has no bounding box — the control is not rendered',
    );
  }
  expect(box.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
}
