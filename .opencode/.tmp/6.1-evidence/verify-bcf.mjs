/**
 * Task 6.1 verification evidence — scenarios b (age-gate decline recovery),
 * c (anonymous trip fill), f (429 friendly message).
 *
 * Drives the real composed Workers stack (frontend :8787, API :8788) with
 * FRESH browser contexts (no cookies) so each scenario starts ungated and
 * anonymous. Network requests/responses are captured as evidence.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'http://localhost:8787';
const API = 'http://localhost:8788';
const OUT = '/home/sim/www/rajahinta-fi/.opencode/.tmp/6.1-evidence';
const results = [];

function record(scenario, ok, evidence) {
  results.push({ scenario, ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${scenario}: ${evidence}`);
}

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// Scenario b — age-gate decline recovery (fresh context = no age cookie)
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ locale: 'fi-FI' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/04b-gate-presented.png` });

  // Decline ("En").
  await dialog.getByRole('button', { name: 'En', exact: true }).click();
  await page.waitForURL('**/age-gate/declined', { timeout: 30_000 });
  const recovery = page.locator('[data-testid="age-gate-recovery"]');
  await recovery.waitFor({ state: 'visible', timeout: 30_000 });
  const recoveryText = (await recovery.textContent())?.trim();
  await page.screenshot({ path: `${OUT}/05b-declined-with-recovery.png` });

  // Recovery action re-presents the confirmation.
  await recovery.click();
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  const confirmVisible = await dialog
    .getByRole('button', { name: 'Olen 18 vuotta täyttänyt' })
    .isVisible();
  await page.screenshot({ path: `${OUT}/06b-gate-represented.png` });

  record(
    'b: age-gate decline recovery',
    page.url().includes('/') && confirmVisible && recoveryText === 'Painoin vahingossa — yritä uudelleen',
    `decline → ${page.url()} … recovery link "${recoveryText}" … dialog re-presented with confirm button visible=${confirmVisible}`,
  );
  await ctx.close();
}

// ---------------------------------------------------------------------------
// Scenario c — anonymous trip fill (fresh context, zero cookies)
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ locale: 'fi-FI' });
  const page = await ctx.newPage();
  const fills = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/trip/fill')) {
      fills.push({ url: r.url(), headers: r.headers() });
    }
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/trip/fill')) {
      fills[fills.length - 1].status = r.status();
    }
  });

  // Raw anonymity proof first: POST with a context that has NO cookies at
  // all (never confirmed the gate, never logged in).
  const raw = await ctx.request.post(`${API}/api/v1/trip/fill`, {
    data: { travelDate: '2026-09-27', items: [{ productId: 9001, maxQuantity: 24 }] },
  });
  const rawOk = raw.status() === 200;
  const rawBody = await raw.json().catch(() => ({}));
  const cookieHeader = (await ctx.cookies()).map((c) => c.name);

  // UI path: confirm the (non-identity) age gate, then fill via the form.
  await page.goto(BASE + '/trip');
  const dialog = page.locator('[role="dialog"]');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: 'Olen 18 vuotta täyttänyt' }).click();
  }
  await page.getByTestId('trip-mode-fill').click();
  await page.fill('#trip-fill-search', 'TEST');
  await page.getByRole('button', { name: /Hae|Etsi/ }).first().click();
  await page.getByTestId('trip-fill-candidate-9001').click();
  await page.fill('#trip-fill-qty-9001', '24');
  const [fillResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/trip/fill'), { timeout: 30_000 }),
    page.getByRole('button', { name: 'Laske täyttö' }).click(),
  ]);
  const uiStatus = fillResponse.status();
  await page.screenshot({ path: `${OUT}/07c-trip-fill-result.png`, fullPage: true });
  const sessionCookies = (await ctx.cookies()).map((c) => c.name).filter((n) => n !== 'age_confirmed');

  record(
    'c: anonymous trip fill',
    rawOk && uiStatus === 200 && sessionCookies.length === 0 && rawBody?.lines?.length >= 0,
    `cookie-less POST ${API}/api/v1/trip/fill → ${raw.status()}; UI submit → ${uiStatus}; cookies present: ${JSON.stringify((await ctx.cookies()).map((c) => c.name))} (only age_confirmed, no session); captured ${fills.length} fill request(s)`,
  );
  await ctx.close();
}

// ---------------------------------------------------------------------------
// Scenario f — 429 renders the friendly message
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ locale: 'fi-FI' });
  const page = await ctx.newPage();
  const calcResponses = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/calculator')) {
      calcResponses.push({ url: r.url(), status: r.status() });
    }
  });

  await page.goto(BASE + '/calculator?q=TEST');
  const dialog = page.locator('[role="dialog"]');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: 'Olen 18 vuotta täyttänyt' }).click();
  }
  // Fresh context: the mount-time prefill search 403s (no age cookie yet);
  // confirming the gate leaves the inline error — re-run the search.
  await page.getByRole('button', { name: 'Hae', exact: true }).click();
  await page.getByRole('button', { name: /TEST Beer/ }).first().click();

  // Exhaust the shared CALCULATOR bucket (60/min) with requests that still
  // consume a slot (the limiter admits BEFORE the handler's 400).
  let exhausted = 0;
  for (let i = 0; i < 60; i++) {
    const res = await ctx.request.post(`${API}/api/v1/calculator`, {
      data: {},
    });
    exhausted = i + 1;
    if (res.status() === 429) break; // bucket full — done early
  }

  // The UI submission must now receive 429 and render the friendly copy.
  const [calcResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/calculator'), { timeout: 30_000 }),
    page.getByRole('button', { name: 'Laske kokonaiskustannus' }).click(),
  ]);
  const friendly = page.getByText('Hetkinen — lasketaan vielä edellistä');
  await friendly.waitFor({ state: 'visible', timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/08f-429-friendly.png`, fullPage: true });

  record(
    'f: 429 friendly message',
    calcResponse.status() === 429 && await friendly.isVisible(),
    `exhausted ${exhausted} slots of CALCULATOR (60/min); UI POST → HTTP ${calcResponse.status()}; friendly text "Hetkinen — lasketaan vielä edellistä" visible`,
  );
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/playwright-scenarios-result.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL SCENARIOS PASS' : `${failed.length} SCENARIO(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
