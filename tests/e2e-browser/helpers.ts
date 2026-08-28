/**
 * Shared journey helpers for the browser E2E suite.
 *
 * The app is fi-default (bare paths, no locale prefix) and every copy
 * assertion uses the exact Finnish strings from the message catalogs, so
 * a copy regression fails the suite instead of silently shipping.
 *
 * Seeded fixtures come from the staging seed
 * (packages/data-platform/src/seed/staging-seed.ts): two obviously-fake
 * products — beer 4.7 % vol / 0.500 l and wine 12 % vol / 0.750 l — with
 * EUR retail offers (beer from €1.49, wine from €5.99) and DE/SE parcel
 * transport to FI. These fixed seed facts are what makes the compare
 * sorting assertions deterministic.
 *
 * @module BrowserE2EHelpers
 */

import { expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Copy (fi message catalogs) — single source for assertions
// ---------------------------------------------------------------------------

export const COPY = {
  ageGateTitle: 'Ikätarkistus',
  ageGateConfirm: 'Olen 18 vuotta täyttänyt',
  ageGateDeny: 'En',
  declinedTitle: 'Pääsy rajattu',
  calculatorTitle: 'Kokonaiskustannuslaskuri',
  searchPlaceholder: 'Hae tuotteita…',
  searchButton: 'Hae',
  calculateButton: 'Laske kokonaiskustannus',
  quantityLabel: 'Määrä',
  costBreakdown: 'Kustannuserittely',
  total: 'Yhteensä',
  foreignRetailPrice: 'Ulkomainen vähittäishinta',
  transportCost: 'Kuljetuskustannus',
  alcoholExcise: 'Arvio alkoholin valmisteverosta',
  compareTitle: 'Tuotevertailu',
  addProductButton: '+ Lisää tuote',
  sortLabel: 'Järjestä:',
  exportButton: 'Vie tietoni',
  downloadStarted: 'Lataus aloitettu — tarkista latauskansiosi.',
  welcomeBack: 'Tervetuloa takaisin',
} as const;

/** Structural disclaimer (packages/core-domain/src/disclaimer.ts, fi). */
export const DISCLAIMER_FRAGMENT =
  'Ei ole lopullinen verovelvollisuuden määrä';

// ---------------------------------------------------------------------------
// Seeded staging products (see module doc)
// ---------------------------------------------------------------------------

export const SEED = {
  beer: {
    name: 'TEST Beer — Lorem Ipsum Dolor',
    /** Alcohol by volume from the seed — drives ALCOHOL_PERCENTAGE sort. */
    abv: 0.047,
  },
  wine: {
    name: 'TEST Wine — Lorem Ipsum',
    abv: 0.12,
  },
  /** Query matching both seeded products. */
  query: 'TEST',
} as const;

// ---------------------------------------------------------------------------
// Journey steps
// ---------------------------------------------------------------------------

/**
 * Accept the soft age gate on a fresh session.
 *
 * Navigates to the front page (any gated route would do), waits for the
 * hydrated gate, confirms, and asserts the gate is gone before returning.
 */
export async function acceptAgeGate(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: COPY.ageGateConfirm, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: COPY.ageGateConfirm, exact: true }),
  ).toBeHidden();
}

/**
 * Type a query into a product search field and submit with Enter (the
 * immediate path — no debounce wait needed), then wait for the product
 * button named `productName` to appear in the results.
 *
 * `scope` narrows the search input when several can be on screen — the
 * compare page renders a second search (basket section) while the
 * BASKET_OPTIMIZATION flag is on.
 */
export async function searchProduct(
  page: Page,
  query: string,
  productName: string,
  scope?: ReturnType<Page['locator']>,
): Promise<void> {
  const input = scope
    ? scope.getByPlaceholder(COPY.searchPlaceholder)
    : page.getByPlaceholder(COPY.searchPlaceholder);
  await input.fill(query);
  await input.press('Enter');
  await expect(
    page.getByRole('button', { name: productName, exact: false }),
  ).toBeVisible();
}

/**
 * Run one landed-cost calculation through the calculator UI and wait for
 * the itemized breakdown to render.
 *
 * Also waits for the fire-and-forget account-history POST so a caller
 * can rely on the calculation being recorded under the session (used by
 * the account-export journey).
 */
export async function runCalculation(
  page: Page,
  productName: string,
  quantity: number,
): Promise<void> {
  await page.goto('/calculator');
  await expect(
    page.getByRole('heading', { name: COPY.calculatorTitle, exact: true }),
  ).toBeVisible();

  await searchProduct(page, SEED.query, productName);
  await page
    .getByRole('button', { name: productName, exact: false })
    .click();

  const quantityInput = page.getByLabel(COPY.quantityLabel, { exact: true });
  await quantityInput.fill(String(quantity));

  // The history write is fire-and-forget with a 401→issue-session→replay
  // shape on first account touch; wait for the successful replay so the
  // session cookie and the history row are both in place afterwards.
  const historyRecorded = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/account/history') &&
      response.request().method() === 'POST' &&
      response.status() >= 200 &&
      response.status() < 300,
  );

  await page
    .getByRole('button', { name: COPY.calculateButton, exact: true })
    .click();

  await expect(
    page.getByRole('heading', { name: COPY.costBreakdown, exact: true }),
  ).toBeVisible();

  // The history write is fire-and-forget; wait for it to land so the
  // account export can assert on the recorded calculation.
  await historyRecorded;
}

/**
 * Add one product to the compare view via the toolbar add button and
 * the search panel, and wait for its column to render.
 */
export async function addCompareProduct(
  page: Page,
  productName: string,
): Promise<void> {
  // The toolbar button ("+ Lisää tuote") is the first exact match; the
  // grid's dashed add-column carries the same accessible name once
  // products exist.
  await page
    .getByRole('button', { name: COPY.addProductButton, exact: true })
    .first()
    .click();

  // Scope the search to the add-product panel (its h2 is "Lisää tuote")
  // so a second search box — the basket section, visible while the
  // BASKET_OPTIMIZATION flag is on — cannot collide with this one.
  const panel = page.locator('section', {
    has: page.getByRole('heading', { name: 'Lisää tuote', exact: true }),
  });
  await searchProduct(page, SEED.query, productName, panel);
  await panel
    .getByRole('button', { name: productName, exact: false })
    .click();

  await expect(
    page.getByRole('heading', { name: productName, exact: true }),
  ).toBeVisible();
}

/**
 * Product column names in display order (the h3 of each comparison
 * column, DOM order = visual order in the grid).
 */
export async function compareColumnNames(page: Page): Promise<string[]> {
  return page
    .locator('main div.grid > div h3')
    .allTextContents();
}
