#!/usr/bin/env node
/**
 * G3 vertical slice spike — smoke test.
 *
 * Self-contained: seeds the local D1, boots `wrangler dev`, runs the
 * golden-dataset cases (tests/golden/golden-dataset.test.ts) as HTTP
 * requests, diffs the itemized results against the golden expectations,
 * then burst-checks the DO rate limiter. Writes results/smoke-results.json.
 *
 * Exit 0 = every golden case correct + rate limiter engages.
 */

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 8790);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'results', 'smoke-results.json');

// ---------------------------------------------------------------------------
// Golden cases — expectations copied from tests/golden/golden-dataset.test.ts
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: 'Case 1 — Beer qty=1 Distance Selling (total 441)',
    body: { productId: 1, quantity: 1, destination: 'FI', transportMethod: 'carrierA' },
    expect: (r) => ({
      totalCents: 441,
      foreignRetailPrice: 200,
      transportCost: 150,
      alcoholExciseEstimate: 91,
      containerDutyEstimate: 0,
      currency: 'EUR',
      'classification.classification': 'DistanceSelling',
      'classification.confidence': 'HIGH',
      confidence: 'MEDIUM',
      'metadata.transportOfferId': 900,
      'metadata.retailOfferIds': [100],
    }),
    extra: (r) => !('otherCharges' in r) && typeof r.disclaimer?.text === 'string' && r.disclaimer.text.length > 0,
  },
  {
    name: 'Case 2 — Wine qty=3 Distance Buying (total 2126, transport unscaled)',
    body: { productId: 2, quantity: 3, destination: 'FI', transportMethod: 'carrierB' },
    expect: (r) => ({
      totalCents: 2126,
      foreignRetailPrice: 900,
      transportCost: 200,
      alcoholExciseEstimate: 1026,
      containerDutyEstimate: 0,
      'classification.classification': 'DistanceBuying',
      confidence: 'MEDIUM',
    }),
  },
  {
    name: 'Case 3 — Spirits qty=1 transport unavailable (total 2034, LOW)',
    body: { productId: 3, quantity: 1, destination: 'FI' },
    expect: (r) => ({
      totalCents: 2034,
      transportCost: 0,
      alcoholExciseEstimate: 1534,
      containerDutyEstimate: 0,
      'metadata.transportOfferId': null,
      'classification.classification': 'DistanceBuying',
      confidence: 'LOW',
    }),
  },
  {
    name: 'Case 4 — Unclassified product → 422 gate rejection',
    body: { productId: 4, quantity: 1, destination: 'FI' },
    status: 422,
    expect: (r) => ({
      error: 'ClassificationGateRejection',
      productId: 4,
    }),
    expectText: (r) => String(r.reason ?? '').includes('classification'),
  },
  {
    name: 'Case 5 — Mixed currency: SEK-converted wins, rogue offer excluded',
    body: { productId: 13, quantity: 1, destination: 'FI', transportMethod: 'carrierSE' },
    expect: (r) => ({
      totalCents: 441,
      foreignRetailPrice: 200,
      currency: 'EUR',
      'metadata.retailOfferIds': [112],
      originalRetailPrice: { priceCents: 2264, currency: 'SEK' },
      'classification.classification': 'DistanceSelling',
      confidence: 'HIGH',
    }),
    extra: (r) =>
      Array.isArray(r.excludedOffers) &&
      r.excludedOffers.length === 1 &&
      r.excludedOffers[0].offerId === 114 &&
      r.excludedOffers[0].reason === 'NO_VALID_EUR_CONVERSION' &&
      r.excludedOffers[0].originalPriceCents === 900 &&
      r.excludedOffers[0].originalCurrency === 'SEK' &&
      Array.isArray(r.metadata?.datasetVersions) &&
      r.metadata.datasetVersions.includes('ecb-2026-08-27.1'),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick(result, pathKey) {
  return pathKey
    .split('.')
    .reduce((acc, k) => (acc === undefined || acc === null ? acc : acc[k]), result);
}

function diffExpected(result, expectFn) {
  const expected = expectFn(result);
  const diffs = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = pick(result, key);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      diffs.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return diffs;
}

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/v1/calculator`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 400) return; // server up, DTO guard answering
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not become ready within ${timeoutMs}ms`);
}

function startWrangler(extraArgs = []) {
  // detached:true puts wrangler + its workerd child in their own process
  // group so stopWrangler can kill the whole tree — orphaned workerd
  // processes otherwise survive, hold the output pipe, and wedge callers.
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', ...extraArgs],
    {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  child.stdout.on('data', (d) => {
    if (process.env.SPIKE_VERBOSE) process.stdout.write(`[wrangler] ${d}`);
  });
  child.stderr.on('data', (d) => {
    if (process.env.SPIKE_VERBOSE) process.stderr.write(`[wrangler!] ${d}`);
  });
  return child;
}

async function stopWrangler(child) {
  if (!child || child.exitCode !== null) return;
  // Negative PID = the whole detached process group (wrangler + workerd).
  const pgid = child.pid;
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5000);
    child.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let wrangler;
const results = [];
let failed = 0;

try {
  console.log('[smoke] seeding local D1…');
  execSync('npx wrangler d1 execute spike-db --local --file seed.sql', {
    cwd: ROOT,
    stdio: process.env.SPIKE_VERBOSE ? 'inherit' : 'pipe',
  });

  console.log(`[smoke] starting wrangler dev on :${PORT}…`);
  wrangler = startWrangler();
  await waitForServer();
  console.log('[smoke] server ready — running golden cases\n');

  for (const c of CASES) {
    const entry = { name: c.name, pass: false, diffs: [] };
    try {
      const res = await fetch(`${BASE}/api/v1/calculator`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(c.body),
      });
      const json = await res.json();
      entry.httpStatus = res.status;

      if (c.status !== undefined) {
        entry.pass =
          res.status === c.status &&
          diffExpected(json, c.expect).length === 0 &&
          (c.expectText ? c.expectText(json) : true);
        entry.diffs = [
          ...diffExpected(json, c.expect),
          ...(c.expectText && !c.expectText(json)
            ? [`reason text mismatch: ${JSON.stringify(json.reason)}`]
            : []),
        ];
      } else {
        entry.diffs = diffExpected(json, c.expect);
        if (c.extra && !c.extra(json)) entry.diffs.push('extra assertions failed');
        entry.pass = res.status === 200 && entry.diffs.length === 0;
      }
    } catch (err) {
      entry.diffs.push(`request failed: ${err.message}`);
    }
    if (!entry.pass) failed++;
    results.push(entry);
    console.log(`  ${entry.pass ? 'PASS' : 'FAIL'} — ${c.name}`);
    if (!entry.pass) entry.diffs.forEach((d) => console.log(`      · ${d}`));
  }

  // ---- Rate limiter burst (last — exhausts the window) ----
  console.log('\n[smoke] burst-checking DO rate limiter (default 60/min)…');
  const burst = await Promise.all(
    Array.from({ length: 70 }, () =>
      fetch(`${BASE}/api/v1/calculator`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 1, quantity: 1, destination: 'FI', transportMethod: 'carrierA' }),
      }).then((r) => r.status),
    ),
  );
  const tooMany = burst.filter((s) => s === 429).length;
  const okCount = burst.filter((s) => s === 200).length;
  const rlPass = tooMany > 0 && okCount >= 40; // window already partly consumed
  results.push({ name: 'Rate limiter engages under burst', pass: rlPass, httpStatus: `200×${okCount} 429×${tooMany}` });
  if (!rlPass) failed++;
  console.log(`  ${rlPass ? 'PASS' : 'FAIL'} — 200×${okCount}, 429×${tooMany} (window shared with golden cases)`);
} catch (err) {
  failed++;
  results.push({ name: 'harness', pass: false, diffs: [err.message] });
  console.error(`[smoke] harness error: ${err.message}`);
} finally {
  await stopWrangler(wrangler);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), pass: failed === 0, results }, null, 2) + '\n');

console.log(`\n[smoke] ${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — results written to results/smoke-results.json`);
process.exit(failed === 0 ? 0 : 1);
