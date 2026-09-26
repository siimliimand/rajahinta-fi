/**
 * Journey 1 — age gate.
 *
 * First visit shows the gate over restricted content; accepting unlocks
 * the calculator (and persists across reloads); declining lands on the
 * neutral in-house page. Also proves the SSR overlay contract: the
 * restricted content stays in the server-rendered HTML (crawlable) and
 * the gate overlays it in the same document.
 *
 * @module AgeGateJourney
 */

import { test, expect } from '@playwright/test';
import { COPY } from './helpers';

test.describe('age gate journey', () => {
  test('first visit gates the calculator; accepting unlocks it and persists', async ({
    page,
  }) => {
    const response = await page.goto('/calculator');

    // The server-rendered document serves the restricted content with
    // the gate as an overlay on top — not a placeholder replacement
    // (task landing d1479e8, roadmap 1.1/1.3): content stays crawlable,
    // the overlay ships in the same SSR payload, and gated data remains
    // server-enforced via the APIs' 403s. The assertion targets rendered
    // markup, not the raw payload (the fi message catalog is inlined in
    // the RSC payload, so a raw substring check would always match).
    const html = await response!.text();
    expect(html).toContain('data-age-gate-overlay');
    expect(html).toMatch(
      new RegExp(`<h1[^>]*>\\s*${COPY.calculatorTitle}\\s*</h1>`),
    );

    // The gate renders over restricted content after hydration.
    const gateTitle = page.getByRole('heading', {
      name: COPY.ageGateTitle,
      exact: true,
    });
    await expect(gateTitle).toBeVisible();

    await page
      .getByRole('button', { name: COPY.ageGateConfirm, exact: true })
      .click();

    await expect(
      page.getByRole('heading', {
        name: COPY.calculatorTitle,
        exact: true,
      }),
    ).toBeVisible();
    await expect(gateTitle).toBeHidden();

    // The confirmation is mirrored to the age_confirmed cookie the API
    // client attaches as x-age-confirmed on catalog requests.
    const cookies = await page.context().cookies();
    const ageCookie = cookies.find((c) => c.name === 'age_confirmed');
    expect(ageCookie?.value).toBe('true');

    // The stored decision survives a reload — no re-gating.
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: COPY.calculatorTitle,
        exact: true,
      }),
    ).toBeVisible();
    await expect(gateTitle).toBeHidden();
  });

  test('declining clears the answer and lands on the neutral in-house page', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: COPY.ageGateTitle, exact: true }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: COPY.ageGateDeny, exact: true })
      .click();

    await expect(page).toHaveURL(/\/age-gate\/declined$/);
    await expect(
      page.getByRole('heading', { name: COPY.declinedTitle, exact: true }),
    ).toBeVisible();

    // The declined page is neutral and never re-gates: no alcohol-
    // related gate content, no confirm/deny buttons replay.
    await expect(
      page.getByRole('button', { name: COPY.ageGateDeny, exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole('button', { name: COPY.ageGateConfirm, exact: true }),
    ).toBeHidden();

    // Declining cleared the stored answer — the confirmation cookie is
    // gone, not left half-set.
    const cookies = await page.context().cookies();
    expect(
      cookies.find((c) => c.name === 'age_confirmed' && c.value !== ''),
    ).toBeUndefined();
  });
});
