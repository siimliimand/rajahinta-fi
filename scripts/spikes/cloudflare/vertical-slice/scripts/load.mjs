#!/usr/bin/env node
/**
 * G3 vertical slice spike — load test.
 *
 * Boots `wrangler dev` with the rate limiter ceiling raised, hammers
 * POST /api/v1/calculator with a concurrent fetch loop (~30 s), reports
 * p50/p95/p99 + error rate, and correctness-diffs EVERY 200 response
 * against the closed-form golden total for its (product, quantity):
 *
 *   product 1: 200·q + 150 + 91·q          (beer, carrierA transport)
 *   product 2: 300·q + 200 + 342·q         (wine, carrierB transport)
 *   product 3: 500·q + 1534·q              (spirits, no transport)
 *
 * Writes results/load-results.json.
 *
 * Env: DURATION_S (30), CONCURRENCY (12), PORT (8791).
 */

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const DURATION_S = Number(process.env.DURATION_S ?? 30);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 12);
const OUT = path.join(ROOT, 'results', 'load-results.json');

// Closed-form golden totals per (productId, quantity) — see header.
function expectedTotalCents(productId, quantity) {
  switch (productId) {
    case 1: return 291 * quantity + 150;
    case 2: return 642 * quantity + 200;
    case 3: return 2034 * quantity;
    default: throw new Error(`no formula for product ${productId}`);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function startWrangler() {
  // detached:true puts wrangler + its workerd child in their own process
  // group so stopWrangler can kill the whole tree — orphaned workerd
  // processes otherwise survive, hold the output pipe, and skew later runs.
  const child = spawn(
    'npx',
    [
      'wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1',
      '--var', 'RATE_LIMIT_MAX:100000000',
    ],
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

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/v1/calculator`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 400) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not become ready');
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
let summary;

try {
  console.log('[load] seeding local D1…');
  execSync('npx wrangler d1 execute spike-db --local --file seed.sql', {
    cwd: ROOT,
    stdio: process.env.SPIKE_VERBOSE ? 'inherit' : 'pipe',
  });

  console.log(`[load] starting wrangler dev on :${PORT} (rate limit raised)…`);
  wrangler = startWrangler();
  await waitForServer();
  console.log('[load] ready — warming up…');

  // Warmup: first requests pay esbuild-bundle + DO spin-up cost.
  for (let i = 0; i < 30; i++) {
    await fetch(`${BASE}/api/v1/calculator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: 1, quantity: 1, destination: 'FI', transportMethod: 'carrierA' }),
    });
  }

  console.log(`[load] measuring: ${CONCURRENCY} concurrent workers × ${DURATION_S}s…`);
  const durations = [];
  const statusCounts = {};
  let correctnessMismatches = 0;
  let mismatchSample = null;
  const deadline = Date.now() + DURATION_S * 1000;
  let calls = 0;

  async function worker(workerId) {
    let i = 0;
    while (Date.now() < deadline) {
      const productId = ((workerId + i) % 3) + 1;
      const quantity = (i % 5) + 1;
      const body = {
        productId,
        quantity,
        destination: 'FI',
        ...(productId === 1 ? { transportMethod: 'carrierA' } : {}),
        ...(productId === 2 ? { transportMethod: 'carrierB' } : {}),
      };
      const t0 = performance.now();
      let status = 0;
      try {
        const res = await fetch(`${BASE}/api/v1/calculator`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        status = res.status;
        const json = await res.json();
        const elapsed = performance.now() - t0;
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        if (status === 200) {
          durations.push(elapsed);
          const want = expectedTotalCents(productId, quantity);
          if (json.totalCents !== want) {
            correctnessMismatches++;
            if (!mismatchSample) {
              mismatchSample = { productId, quantity, got: json.totalCents, want };
            }
          }
        }
      } catch {
        statusCounts['network_error'] = (statusCounts['network_error'] ?? 0) + 1;
      }
      calls++;
      i++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));

  const sorted = [...durations].sort((a, b) => a - b);
  const total = Object.values(statusCounts).reduce((s, n) => s + n, 0);
  const errors = total - durations.length;
  const errorRate = total > 0 ? errors / total : 0;
  summary = {
    generatedAt: new Date().toISOString(),
    durationS: DURATION_S,
    concurrency: CONCURRENCY,
    totalCalls: total,
    successfulCalls: durations.length,
    errorRate,
    statusCounts,
    correctnessMismatches,
    mismatchSample,
    p50Ms: +percentile(sorted, 50).toFixed(1),
    p95Ms: +percentile(sorted, 95).toFixed(1),
    p99Ms: +percentile(sorted, 99).toFixed(1),
    minMs: +(sorted[0] ?? 0).toFixed(1),
    maxMs: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
    meanMs: +(sorted.reduce((s, d) => s + d, 0) / (sorted.length || 1)).toFixed(1),
    throughputRps: +(durations.length / DURATION_S).toFixed(1),
    host: 'local wrangler dev (workerd) on this machine — not a K8s replica',
  };

  console.log(`
  ┌─ G3 vertical-slice load results ──────────────────────────
  │  calls:        ${summary.totalCalls} (${summary.successfulCalls} ok, ${errors} errors)
  │  error rate:   ${(errorRate * 100).toFixed(2)} %
  │  correctness:  ${correctnessMismatches} total-cents mismatches
  │  p50 / p95 / p99: ${summary.p50Ms} / ${summary.p95Ms} / ${summary.p99Ms} ms
  │  min / mean / max: ${summary.minMs} / ${summary.meanMs} / ${summary.maxMs} ms
  │  throughput:   ${summary.throughputRps} req/s
  └───────────────────────────────────────────────────────────`);
} catch (err) {
  console.error(`[load] harness error: ${err.message}`);
  summary = { generatedAt: new Date().toISOString(), harnessError: err.message };
  process.exitCode = 1;
} finally {
  await stopWrangler(wrangler);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(`\n[load] results written to results/load-results.json`);

const pass =
  summary.harnessError === undefined &&
  summary.errorRate < 0.01 &&
  summary.correctnessMismatches === 0;
if (!pass) process.exitCode = 1;
