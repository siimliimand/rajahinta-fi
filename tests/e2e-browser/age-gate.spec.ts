/**
 * Journey 1 — age gate.
 *
 * First visit shows the gate over restricted content; accepting unlocks
 * the calculator (and persists across reloads); declining lands on the
 * neutral in-house page. Also proves the SSR placeholder contract:
 * restricted content is absent from the server-rendered HTML.
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

    // Restricted content is absent from the server-rendered document —
    // the SSR placeholder contract (task landing 608564a). The assertion
    // targets rendered markup: the fi message catalog (which contains
    // every copy string) is legitimately inlined in the RSC payload, so
    // a raw substring check would always match.
    const html = await response!.text();
    expect(html).toContain('data-age-gate-placeholder');
    expect(html).not.toMatch(
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
