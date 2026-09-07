/**
 * Journey 2 — calculator flow.
 *
 * Search a seeded product, set the quantity, run the calculation, and
 * verify the result renders the itemized cost breakdown, the total, the
 * quantity×destination summary (destination is Finland-scoped in the
 * Phase 1 UI), and the structural disclaimer banner. The visitor is
 * anonymous throughout: credentials auth replaced the anonymous session
 * auto-mint (email-password-auth), so the fire-and-forget history write
 * resolves 401 and no session cookie is ever issued.
 *
 * @module CalculatorFlowJourney
 */

import { test, expect } from '@playwright/test';
import {
  COPY,
  DISCLAIMER_FRAGMENT,
  SEED,
  acceptAgeGate,
  runCalculation,
} from './helpers';

test.describe('calculator flow journey', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('search → select → quantity → calculate renders itemized breakdown with disclaimer', async ({
    page,
  }) => {
    await page.goto('/calculator');

    await expect(
      page.getByRole('heading', { name: COPY.calculatorTitle, exact: true }),
    ).toBeVisible();

    // Search a seeded product and select it from the results.
    const search = page.getByPlaceholder(COPY.searchPlaceholder);
    await search.fill(SEED.query);
    await search.press('Enter');

    const beerButton = page.getByRole('button', {
      name: SEED.beer.name,
      exact: false,
    });
    await expect(beerButton).toBeVisible();
    await beerButton.click();

    // Quantity via the labelled control (destination is FI-scoped by the
    // UI default; the result summary asserts it).
    await page.getByLabel(COPY.quantityLabel, { exact: true }).fill('6');

    // The calculate action also fires the (fire-and-forget) account
    // history write — for an anonymous visitor it resolves 401
    // (SessionRequired envelope) and the UI stays silent about it.
    const historyRejected = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/account/history') &&
        response.request().method() === 'POST' &&
        response.status() === 401,
    );

    await page
      .getByRole('button', { name: COPY.calculateButton, exact: true })
      .click();

    // ── Itemized breakdown ──
    await expect(
      page.getByRole('heading', { name: COPY.costBreakdown, exact: true }),
    ).toBeVisible();

    // Every externally sourced cost fact is itemized with a label. The
    // same category labels reappear in the data-freshness section, so
    // assert on the first match (the breakdown renders above it).
    for (const line of [
      COPY.foreignRetailPrice,
      COPY.transportCost,
      COPY.alcoholExcise,
    ]) {
      await expect(page.getByText(line, { exact: true }).first()).toBeVisible();
    }

    // ── Total ──
    await expect(
      page.getByText(COPY.total, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/€\d+[.,]\d{2}/).first()).toBeVisible();

    // ── Quantity × destination summary (6 units, Finland) ──
    await expect(page.getByText('6 kpl × FI', { exact: true })).toBeVisible();

    // ── Structural disclaimer — first-class UI, Finnish copy. The version
    // marker is the API's version string (e.g. "v1.0 · suomi"). ──
    await expect(page.getByText(DISCLAIMER_FRAGMENT)).toBeVisible();
    await expect(page.getByText(/^v[\d.]+ · suomi$/)).toBeVisible();

    // The history write was rejected while the result rendered — and no
    // anonymous session was minted to replay it.
    expect((await historyRejected).status()).toBe(401);
    const cookies = await page.context().cookies();
    expect(
      cookies.find((c) => c.name === 'rajahinta_session'),
    ).toBeUndefined();
  });

  test('anonymous account touch stays signed out — no session, no account data', async ({
    page,
  }) => {
    // The calculator works fully signed out; nothing issues a session.
    // The /account gate itself (401 → /login redirect, design D8) is
    // pinned by the frontend page tests with a mocked API — the harness
    // stack deliberately carries no credential flow, so the browser
    // journey pins the stack-independent half: no cookie is ever minted
    // and no signed-in account data renders for an anonymous visitor.
    await runCalculation(page, SEED.beer.name, 1);

    const cookies = await page.context().cookies();
    expect(
      cookies.find((c) => c.name === 'rajahinta_session'),
    ).toBeUndefined();

    await page.goto('/account');
    await expect(
      page.getByRole('heading', { name: 'Tervetuloa takaisin', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Istuntotunnus:/)).toHaveCount(0);
  });
});
