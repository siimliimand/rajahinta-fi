import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'fi-FI' });
const page = await ctx.newPage();
const msgs = [];
page.on('console', (m) => msgs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on('requestfailed', (r) => msgs.push(`REQFAILED: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.url().includes('/api/')) msgs.push(`API: ${r.status()} ${r.url()}`);
});
await page.goto('http://localhost:8787/calculator?q=TEST');
const dialog = page.locator('[role="dialog"]');
const dialogVisible = await dialog.isVisible().catch(() => false);
console.log('dialog visible:', dialogVisible);
if (dialogVisible) {
  await dialog.getByRole('button', { name: 'Olen 18 vuotta täyttänyt' }).click();
  console.log('confirmed gate');
}
await page.waitForTimeout(8000);
console.log('cookies:', (await ctx.cookies()).map((c) => c.name).join(','));
console.log('TEST Beer buttons:', await page.getByRole('button', { name: /TEST Beer/ }).count());
console.log('---- messages ----');
for (const m of msgs.slice(-25)) console.log(m);
await page.screenshot({ path: '/home/sim/www/rajahinta-fi/.opencode/.tmp/6.1-evidence/probe-f.png', fullPage: true });
await browser.close();
