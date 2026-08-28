/**
 * Journey 3 — compare sorting.
 *
 * Open the compare view, add the two seeded products, and exercise the
 * sort selector: the selected order drives the actual column ordering.
 *
 * Determinism comes from the staging seed: the beer (4.7 % vol, offers
 * from €1.49) has a lower landed cost and a lower ABV than the wine
 * (12 % vol, offers from €5.99), while "TEST Beer…" sorts before
 * "TEST Wine…" alphabetically. So:
 *   LOWEST_LANDED_COST  → beer, wine
 *   ALPHABETICAL        → beer, wine
 *   ALCOHOL_PERCENTAGE  → wine, beer (the order flips)
 *
 * The compare columns map itemized cost categories through the message
 * catalogs (fi source of truth), the same as the calculator result view.
 *
 * @module CompareSortingJourney
 */

import { test, expect } from '@playwright/test';
import {
  COPY,
  SEED,
  acceptAgeGate,
  addCompareProduct,
  compareColumnNames,
} from './helpers';

test.describe('compare sorting journey', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('sort selector defaults, tracks the chosen order, and columns render deterministically', async ({
    page,
  }) => {
    await page.goto('/compare');

    await expect(
      page.getByRole('heading', { name: COPY.compareTitle, exact: true }),
    ).toBeVisible();

    // The sort control is present with its label before any product is
    // added; LOWEST_LANDED_COST is the default.
    const sortSelect = page.getByLabel(COPY.sortLabel);
    await expect(sortSelect).toBeVisible();
    await expect(sortSelect).toHaveValue('LOWEST_LANDED_COST');

    // Add the seeded beer and wine.
    await addCompareProduct(page, SEED.beer.name);
    await addCompareProduct(page, SEED.wine.name);

    // Both columns render, in a deterministic order that matches the
    // default sort (the cheaper seeded product first).
    await expect
      .poll(() => compareColumnNames(page))
      .toEqual([SEED.beer.name, SEED.wine.name]);
    // The summary line is asserted with the full exact text: a substring
    // like "Järjestetty: …" would also match the about-paragraph below
    // the grid ("Tuotteet on järjestetty: …", case-insensitively).
    await expect(
      page.getByText(
        '2 tuotetta vertailussa · Järjestetty: Matalin kokonaiskustannus',
      ),
    ).toBeVisible();

    // The displayed order follows the selector.
    await sortSelect.selectOption('ALPHABETICAL');
    await expect(
      page.getByText(
        '2 tuotetta vertailussa · Järjestetty: Aakkosjärjestys (A–Ö)',
      ),
    ).toBeVisible();

    await sortSelect.selectOption('ALCOHOL_PERCENTAGE');
    await expect(
      page.getByText(
        '2 tuotetta vertailussa · Järjestetty: Alkoholipitoisuus (suurin ensin)',
      ),
    ).toBeVisible();

    await sortSelect.selectOption('LOWEST_LANDED_COST');
    await expect(
      page.getByText(
        '2 tuotetta vertailussa · Järjestetty: Matalin kokonaiskustannus',
      ),
    ).toBeVisible();
  });

  test('changing the sort order deterministically reorders the columns', async ({
    page,
  }) => {
    await page.goto('/compare');

    const sortSelect = page.getByLabel(COPY.sortLabel);
    await addCompareProduct(page, SEED.beer.name);
    await addCompareProduct(page, SEED.wine.name);

    // ── LOWEST_LANDED_COST: the cheaper seeded product (beer) is first ──
    await expect(sortSelect).toHaveValue('LOWEST_LANDED_COST');
    await expect
      .poll(() => compareColumnNames(page))
      .toEqual([SEED.beer.name, SEED.wine.name]);

    // ── ALPHABETICAL: still beer first ("TEST Beer" < "TEST Wine") ──
    await sortSelect.selectOption('ALPHABETICAL');
    await expect
      .poll(() => compareColumnNames(page))
      .toEqual([SEED.beer.name, SEED.wine.name]);

    // ── ALCOHOL_PERCENTAGE: descending ABV flips the order — the wine
    //    (12 %) now precedes the beer (4.7 %) ──
    await sortSelect.selectOption('ALCOHOL_PERCENTAGE');
    await expect
      .poll(() => compareColumnNames(page))
      .toEqual([SEED.wine.name, SEED.beer.name]);

    // Switching back re-orders deterministically (no stale DOM order).
    await sortSelect.selectOption('LOWEST_LANDED_COST');
    await expect
      .poll(() => compareColumnNames(page))
      .toEqual([SEED.beer.name, SEED.wine.name]);
  });

  test('columns render the total landed cost with the itemized facts', async ({
    page,
  }) => {
    await page.goto('/compare');
    await addCompareProduct(page, SEED.beer.name);

    // The column shows the primary metric and the itemized cost lines
    // that back the sort. Itemized labels come from the message catalogs
    // (fi), mapped by cost category — the same source of truth as the
    // calculator result view.
    await expect(
      page.getByText('Kokonaiskustannus yhteensä', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(COPY.foreignRetailPrice, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(COPY.transportCost, { exact: true }).first(),
    ).toBeVisible();
  });
});
