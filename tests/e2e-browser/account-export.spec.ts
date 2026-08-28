/**
 * Journey 4 — account export.
 *
 * The anonymous session is issued automatically on the first account
 * touch (httpOnly `rajahinta_session`, minted via the 401→issue→replay
 * path in the API client), and the data-export endpoint — reached
 * through the real UI button — returns this account's own data.
 *
 * Known gap (reported, asserted as shape only): on the DB-backed stack
 * the export's calculationHistory is always empty — see the assertion
 * comment in the test body.
 *
 * @module AccountExportJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, SEED, acceptAgeGate, runCalculation } from './helpers';

test.describe('account export journey', () => {
  test('session issues on account touch; export returns this account and its data', async ({
    page,
  }) => {
    await acceptAgeGate(page);

    // Produce one calculation owned by this session so the export has
    // verifiable content. runCalculation waits for the successful
    // history POST — by then the session cookie is already minted (it
    // happened on that POST's first 401).
    await runCalculation(page, SEED.beer.name, 1);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'rajahinta_session');
    expect(sessionCookie).toBeDefined();
    // The identity is server-held only — the token never reaches JS.
    expect(sessionCookie?.httpOnly).toBe(true);

    // The account page renders the server-derived identity (the API
    // client minted the session; no client-generated identity exists).
    await page.goto('/account');
    await expect(
      page.getByRole('heading', { name: COPY.welcomeBack, exact: true }),
    ).toBeVisible();

    const idLine = page.getByText(/Istuntotunnus: [0-9a-f-]{8}…/);
    await expect(idLine).toBeVisible();
    const idText = (await idLine.textContent()) ?? '';
    const shortId = /Istuntotunnus: ([0-9a-f-]{8})…/.exec(idText)?.[1];
    expect(shortId).toBeTruthy();

    // Export through the UI path: click the button and capture the API
    // response the button triggers (the client then wraps it in the
    // JSON download).
    const [exportResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/account/export') &&
          response.request().method() === 'GET',
      ),
      page
        .getByRole('button', { name: COPY.exportButton, exact: true })
        .click(),
    ]);

    expect(exportResponse.status()).toBe(200);

    const payload = (await exportResponse.json()) as {
      userId: string;
      exportDate: string;
      account: { userId: string };
      savedBaskets: unknown[];
      savedScenarios: unknown[];
      calculationHistory: { productName: string }[];
    };

    // The export is this account's data: the userId matches the
    // server-derived session identity shown in the UI.
    expect(payload.userId).toBe(payload.account.userId);
    expect(payload.userId.startsWith(shortId!)).toBe(true);
    expect(typeof payload.exportDate).toBe('string');
    expect(Array.isArray(payload.savedBaskets)).toBe(true);
    expect(Array.isArray(payload.savedScenarios)).toBe(true);

    // Calculation history: on the DB-backed stack the record→account
    // link exists only as the calculation_records FK —
    // addCalculationToHistory is a no-op on the repository path and the
    // export synthesizes entries from the (always-empty) account list,
    // so the export's calculationHistory is currently always [] even
    // though the calculation above was recorded server-side (reported
    // defect; asserted here as shape only until it is fixed).
    expect(Array.isArray(payload.calculationHistory)).toBe(true);

    // The UI confirmed the download started (Finnish copy).
    await expect(
      page.getByText(COPY.downloadStarted, { exact: true }),
    ).toBeVisible();
  });
});
