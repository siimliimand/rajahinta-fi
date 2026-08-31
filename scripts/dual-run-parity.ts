#!/usr/bin/env node
/**
 * Dual-run parity harness (task 6.6, change migrate-to-cloudflare;
 * design D10).
 *
 * During the dual-run window both stacks serve live traffic: the Nest
 * baseline (K8s) and the Cloudflare Worker. This harness sends the same
 * calculator inputs to both and diffs the full result payloads —
 * the output-level safety net over the identical core-domain engines.
 *
 * ## Sample
 *
 *   - The golden 5 cases (tests/golden — beer/wine/spirits totals, the
 *     classification-gate rejection, and the mixed-currency offer set)
 *     ALWAYS run: they are the regression core of every dual-run pass.
 *   - Plus a sample of real calculation inputs, either from
 *     `--sample-file <path>` (JSON array of
 *     {productId, quantity, destination, transportMethod?,
 *     transportArrangement?}) or generated from the seeded product list
 *     of the baseline (`GET /api/v1/products?limit=N` → one qty-1 FI
 *     input per product).
 *
 * ## Comparison rules (normalized)
 *
 *   1. Same HTTP status on both sides (200 pairs with 200, 422 with 422 —
 *      the golden gate-rejection case must fail identically).
 *   2. Same field set everywhere (deep key-set equality; a missing or
 *      extra field is a mismatch even when the values would compare equal).
 *   3. Cent equality: every numeric value is compared strictly — the
 *      payloads are integer cents end to end.
 *   4. Enum validity + equality: `confidence` ∈ HIGH/MEDIUM/LOW,
 *      `reliability`/`status` ∈ VERIFIED/ESTIMATED/STALE/UNAVAILABLE on
 *      BOTH sides (a bogus-but-equal enum value is still a failure).
 *   5. Volatile fields are stripped before diffing: the wall-clock
 *      `metadata.calculationTimestamp` and the stack-local
 *      `calculationRecordId` (pg and D1 sequences diverge by design).
 *
 * Exit codes: 0 = all cases parity, 1 = any mismatch/violation,
 * 2 = usage/transport error.
 *
 * ## Rate-limit coexistence
 *
 * The CALCULATOR profile admits 10 requests/min per client identity on
 * BOTH stacks (guard parity). A sampled pass exceeds that budget within
 * seconds, and the two stacks admit independently — so the SAME case can
 * come back 429/200, a harness artifact rather than a parity signal
 * (observed live in same-origin smoke at exactly the golden-5 boundary).
 * The harness therefore paces its calculator POSTs per origin — default
 * 8/min, `--pace-ms` — and absorbs one 429 with Retry-After backoff
 * before reporting; a persistent rejection still surfaces as a
 * status-parity failure.
 *
 * ## Usage
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx \
 *     ../../scripts/dual-run-parity.ts \
 *     --baseline-url https://api.k8s.example \
 *     --worker-url   https://rajahinta-api.example.workers.dev \
 *     --sample-file samples.json --report-json report.json
 *
 * The same-origin smoke mode (`--allow-same-url`) is for harness
 * verification against a single live endpoint (e.g. local
 * `wrangler dev`); a real parity pass always uses two different URLs.
 *
 * @module DualRunParity
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Value sets (mirror packages/core-domain reliability/confidence types)
// ---------------------------------------------------------------------------

export const CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const RELIABILITY_VALUES = ['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'] as const;

// ---------------------------------------------------------------------------
// Golden 5 — the always-run core sample (tests/golden/golden-dataset.test.ts)
// ---------------------------------------------------------------------------

export interface CalculationInput {
  readonly productId: number;
  readonly quantity: number;
  readonly destination: string;
  readonly transportMethod?: string;
  readonly transportArrangement?: string;
}

export interface ParityCase {
  readonly name: string;
  readonly input: CalculationInput;
}

/**
 * One input per golden case. Product ids follow tests/golden/data/products.ts:
 * 1 beer, 2 wine, 3 spirits (no transport), 4 unclassified (422), 13
 * mixed-currency SEK/EUR. Requires the golden products to exist on BOTH
 * stacks (the ETL/seed guarantees this during the dual-run window).
 */
export const GOLDEN_CASES: readonly ParityCase[] = [
  { name: 'golden-1-beer-distance-selling', input: { productId: 1, quantity: 1, destination: 'FI', transportMethod: 'carrierA' } },
  { name: 'golden-2-wine-distance-buying', input: { productId: 2, quantity: 3, destination: 'FI', transportMethod: 'carrierB' } },
  { name: 'golden-3-spirits-transport-unavailable', input: { productId: 3, quantity: 1, destination: 'FI' } },
  { name: 'golden-4-unclassified-gate-rejection', input: { productId: 4, quantity: 1, destination: 'FI' } },
  { name: 'golden-5-mixed-currency', input: { productId: 13, quantity: 1, destination: 'FI', transportMethod: 'carrierSE' } },
];

// ---------------------------------------------------------------------------
// Transport — injectable for tests / stubs
// ---------------------------------------------------------------------------

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type Transport = (url: string, init: RequestInit) => Promise<HttpResponse>;

/** Default transport over global fetch with a per-request timeout. */
export function makeFetchTransport(timeoutMs: number): Transport {
  return async (url, init) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
}

export const CALCULATOR_PATH = '/api/v1/calculator';

/**
 * The harness replays confirmed-client traffic: Phase 1 age confirmation is
 * a header-or-cookie check (age-gate.ts), and the header is the mechanism
 * a non-browser client uses. Without it every request 403s at the gate
 * before reaching the calculator, on both stacks.
 */
const CONFIRMED_CLIENT_HEADERS: Readonly<Record<string, string>> = {
  'x-age-confirmed': '1',
};

async function postCalculation(
  transport: Transport,
  baseUrl: string,
  input: CalculationInput,
  hooks?: ParityRunHooks,
): Promise<HttpResponse> {
  const url = `${baseUrl.replace(/\/+$/, '')}${CALCULATOR_PATH}`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...CONFIRMED_CLIENT_HEADERS },
    body: JSON.stringify(input),
  };
  if (hooks?.pacer) await hooks.pacer.acquire(new URL(url).origin);
  let response = await transport(url, init);
  if (response.status === 429) {
    // A 429 is the harness's own traffic (or shared-IP pressure) tripping
    // the CALCULATOR profile — not a calculator-output signal. Back off
    // once per the stack's Retry-After and re-ask; a persistent rejection
    // still surfaces as a status-parity failure.
    const sleep = hooks?.sleep ?? sleepMs;
    await sleep(Math.min(retryAfterMsOf(response.body), MAX_429_BACKOFF_MS));
    if (hooks?.pacer) await hooks.pacer.acquire(new URL(url).origin);
    response = await transport(url, init);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Rate-limit coexistence — per-origin pacing + one 429 retry
// ---------------------------------------------------------------------------

/** Default spacing between calculator POSTs to one origin: 8/min — under
 * the CALCULATOR profile (10/min) with headroom for shared-IP traffic. */
export const DEFAULT_PACE_MS = 7_500;
/** Fallback backoff when a 429 body carries no usable retryAfterSeconds. */
const DEFAULT_429_BACKOFF_MS = 5_000;
/** Hard cap on the single 429 backoff (a parity pass must stay bounded). */
const MAX_429_BACKOFF_MS = 20_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Extract the retry delay (ms) from a stack's 429 body, with a fallback. */
function retryAfterMsOf(body: unknown): number {
  const seconds = (body as { retryAfterSeconds?: unknown } | null)?.['retryAfterSeconds'];
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_429_BACKOFF_MS;
}

/**
 * Per-origin request pacer. `acquire` returns when the caller may send to
 * that origin and reserves the next slot synchronously — safe under the
 * runner's concurrency pool (single event loop: no two callers can claim
 * the same slot).
 */
export class OriginPacer {
  private readonly nextSlotAt = new Map<string, number>();

  constructor(readonly minIntervalMs: number) {}

  async acquire(origin: string): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt.get(origin) ?? 0);
    this.nextSlotAt.set(origin, slot + this.minIntervalMs);
    if (slot > now) await sleepMs(slot - now);
  }
}

/** Optional runtime seams for the case runner (pacing, test-clock). */
export interface ParityRunHooks {
  /** Per-origin pacer; omit (or null) for unpaced requests. */
  readonly pacer?: OriginPacer | null;
  /** Backoff clock — injectable so 429 tests don't actually wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Normalization — strip volatile fields, keep everything else exact
// ---------------------------------------------------------------------------

/**
 * Volatile field names stripped wherever they appear. Result payloads:
 * the wall-clock `calculationTimestamp` (under `metadata`) and the
 * stack-local `calculationRecordId` (pg and D1 sequences diverge by
 * design). Error envelopes: both stacks' exception filters (Nest
 * api-error.filter and the Worker error boundary) stamp `timestamp` and
 * `path` per request — always different, never meaningful for parity.
 */
const VOLATILE_KEYS: readonly string[] = [
  'calculationRecordId',
  'calculationTimestamp',
  'timestamp',
  'path',
];

function stripVolatile(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) stripVolatile(child);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const key of Object.keys(node)) {
    if (VOLATILE_KEYS.includes(key)) {
      delete (node as Record<string, unknown>)[key];
    } else {
      stripVolatile((node as Record<string, unknown>)[key]);
    }
  }
}

/**
 * Strip volatile fields from a payload (mutates the clone). Applied to
 * 200 result payloads AND non-2xx error envelopes — the timestamp/path
 * stamping exists on both sides and is never parity-relevant.
 */
export function normalizePayload(payload: unknown): unknown {
  const clone = deepClone(payload);
  stripVolatile(clone);
  return clone;
}

/** Deep-clone via JSON round-trip (payloads are JSON-native). */
function deepClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Enum validation — key-driven walk
// ---------------------------------------------------------------------------

export interface EnumViolation {
  readonly path: string;
  readonly value: string;
  readonly allowed: readonly string[];
}

function formatPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((acc, segment) =>
    typeof segment === 'number' ? `${acc}[${segment}]` : (acc === '' ? String(segment) : `${acc}.${segment}`), '');
}

/**
 * Validate enum-carrying fields by key: `confidence` → ConfidenceLevel,
 * `reliability` / `status` → ReliabilityStatus. The calculator result
 * payload carries no other string-typed fields under these keys, so the
 * walk is exact, not heuristic.
 */
export function validateEnums(payload: unknown): EnumViolation[] {
  const violations: EnumViolation[] = [];
  const walk = (node: unknown, path: readonly (string | number)[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...path, i]));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      const childPath = [...path, key] as const;
      if (typeof value === 'string') {
        if (key === 'confidence' && !(CONFIDENCE_VALUES as readonly string[]).includes(value)) {
          violations.push({ path: formatPath(childPath), value, allowed: CONFIDENCE_VALUES });
        }
        if ((key === 'reliability' || key === 'status') && !(RELIABILITY_VALUES as readonly string[]).includes(value)) {
          violations.push({ path: formatPath(childPath), value, allowed: RELIABILITY_VALUES });
        }
      } else {
        walk(value, childPath);
      }
    }
  };
  walk(payload, []);
  return violations;
}

// ---------------------------------------------------------------------------
// Deep diff — field-set equality + value equality with paths
// ---------------------------------------------------------------------------

export type DiffKind =
  | 'missing-in-worker'
  | 'missing-in-baseline'
  | 'type-mismatch'
  | 'value-mismatch';

export interface PayloadDiff {
  readonly path: string;
  readonly kind: DiffKind;
  readonly baseline: string;
  readonly worker: string;
}

function render(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/**
 * Diff two JSON values deeply. Objects must carry the SAME key set (in
 * either order); arrays must have the same length and element-wise equal
 * members; numbers compare strictly (integer cents). Returns every
 * difference with its JSON path, capped to keep reports readable.
 */
export function diffNormalized(
  baseline: unknown,
  worker: unknown,
  maxDiffs = 25,
): PayloadDiff[] {
  const diffs: PayloadDiff[] = [];
  const walk = (a: unknown, b: unknown, path: readonly (string | number)[]): void => {
    if (diffs.length >= maxDiffs) return;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) {
        diffs.push({ path: formatPath(path), kind: 'type-mismatch', baseline: render(a), worker: render(b) });
        return;
      }
      if (a.length !== b.length) {
        diffs.push({
          path: `${formatPath(path)}.length`,
          kind: 'value-mismatch',
          baseline: String(a.length),
          worker: String(b.length),
        });
        return;
      }
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], [...path, i]);
      return;
    }
    const aIsObject = typeof a === 'object' && a !== null;
    const bIsObject = typeof b === 'object' && b !== null;
    if (aIsObject !== bIsObject) {
      diffs.push({ path: formatPath(path), kind: 'type-mismatch', baseline: render(a), worker: render(b) });
      return;
    }
    if (aIsObject && bIsObject) {
      const aKeys = new Set(Object.keys(a as Record<string, unknown>));
      const bKeys = new Set(Object.keys(b as Record<string, unknown>));
      for (const key of aKeys) {
        if (diffs.length >= maxDiffs) return;
        if (!bKeys.has(key)) {
          diffs.push({ path: formatPath([...path, key]), kind: 'missing-in-worker', baseline: render((a as Record<string, unknown>)[key]), worker: '∅' });
        }
      }
      for (const key of bKeys) {
        if (diffs.length >= maxDiffs) return;
        if (!aKeys.has(key)) {
          diffs.push({ path: formatPath([...path, key]), kind: 'missing-in-baseline', baseline: '∅', worker: render((b as Record<string, unknown>)[key]) });
        }
      }
      for (const key of aKeys) {
        if (diffs.length >= maxDiffs) return;
        if (bKeys.has(key)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], [...path, key]);
      }
      return;
    }
    if (typeof a !== typeof b || !Object.is(a, b)) {
      diffs.push({ path: formatPath(path), kind: 'value-mismatch', baseline: render(a), worker: render(b) });
    }
  };
  walk(baseline, worker, []);
  return diffs;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface CaseResult {
  readonly name: string;
  readonly input: CalculationInput;
  readonly ok: boolean;
  readonly baselineStatus: number;
  readonly workerStatus: number;
  /** Payload diffs (empty when the case passed). */
  readonly diffs: readonly PayloadDiff[];
  /** Enum violations per side (a bogus-but-equal enum still fails). */
  readonly enumViolations: { side: 'baseline' | 'worker'; violations: readonly EnumViolation[] }[];
  readonly error?: string;
}

export interface ParityReport {
  readonly baselineUrl: string;
  readonly workerUrl: string;
  readonly totalCases: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly CaseResult[];
}

/** Validate a case input shape (fails the run loudly, not silently). */
export function assertValidInput(input: unknown, label: string): CalculationInput {
  const value = input as Record<string, unknown>;
  const problems: string[] = [];
  if (!Number.isInteger(value?.['productId']) || (value?.['productId'] as number) <= 0) {
    problems.push('productId must be a positive integer');
  }
  if (!Number.isInteger(value?.['quantity']) || (value?.['quantity'] as number) < 1) {
    problems.push('quantity must be a positive integer');
  }
  if (typeof value?.['destination'] !== 'string' || (value['destination'] as string).length !== 2) {
    problems.push('destination must be a 2-letter country code');
  }
  if (value?.['transportMethod'] !== undefined && typeof value['transportMethod'] !== 'string') {
    problems.push('transportMethod must be a string when provided');
  }
  if (
    value?.['transportArrangement'] !== undefined &&
    !['SELLER_ARRANGED', 'INDEPENDENT_CARRIER', 'PERSONAL'].includes(value['transportArrangement'] as string)
  ) {
    problems.push('transportArrangement must be one of SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL');
  }
  if (problems.length > 0) {
    throw new Error(`invalid sample input "${label}": ${problems.join('; ')}`);
  }
  return input as CalculationInput;
}

/** Run one parity case against both stacks and compare. */
export async function runParityCase(
  transport: Transport,
  endpoints: { baselineUrl: string; workerUrl: string },
  parityCase: ParityCase,
  hooks?: ParityRunHooks,
): Promise<CaseResult> {
  let baseline: HttpResponse;
  let worker: HttpResponse;
  try {
    [baseline, worker] = await Promise.all([
      postCalculation(transport, endpoints.baselineUrl, parityCase.input, hooks),
      postCalculation(transport, endpoints.workerUrl, parityCase.input, hooks),
    ]);
  } catch (error) {
    return {
      name: parityCase.name,
      input: parityCase.input,
      ok: false,
      baselineStatus: 0,
      workerStatus: 0,
      diffs: [],
      enumViolations: [],
      error: `transport failure: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (baseline.status !== worker.status) {
    return {
      name: parityCase.name,
      input: parityCase.input,
      ok: false,
      baselineStatus: baseline.status,
      workerStatus: worker.status,
      diffs: [
        {
          path: 'HTTP status',
          kind: 'value-mismatch',
          baseline: String(baseline.status),
          worker: String(worker.status),
        },
      ],
      enumViolations: [],
    };
  }

  const normalizedBaseline = normalizePayload(baseline.body);
  const normalizedWorker = normalizePayload(worker.body);

  const diffs = diffNormalized(normalizedBaseline, normalizedWorker);

  const enumViolations: CaseResult['enumViolations'] = [];
  const baselineViolations = validateEnums(normalizedBaseline);
  const workerViolations = validateEnums(normalizedWorker);
  if (baselineViolations.length > 0) enumViolations.push({ side: 'baseline', violations: baselineViolations });
  if (workerViolations.length > 0) enumViolations.push({ side: 'worker', violations: workerViolations });

  return {
    name: parityCase.name,
    input: parityCase.input,
    ok: diffs.length === 0 && enumViolations.length === 0,
    baselineStatus: baseline.status,
    workerStatus: worker.status,
    diffs,
    enumViolations,
  };
}

/** Run all cases with a small concurrency pool (golden first, then samples). */
export async function runParity(
  transport: Transport,
  endpoints: { baselineUrl: string; workerUrl: string },
  cases: readonly ParityCase[],
  options: { timeoutMs: number; concurrency: number; hooks?: ParityRunHooks },
): Promise<ParityReport> {
  const results: CaseResult[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(options.concurrency, cases.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < cases.length) {
      const index = cursor++;
      results.push(await runParityCase(transport, endpoints, cases[index], options.hooks));
    }
  });
  await Promise.all(workers);

  // Deterministic report order: golden order first (as given), then samples.
  const order = new Map(cases.map((c, i) => [c.name, i]));
  results.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));

  const failed = results.filter((r) => !r.ok).length;
  return {
    baselineUrl: endpoints.baselineUrl,
    workerUrl: endpoints.workerUrl,
    totalCases: results.length,
    passed: results.length - failed,
    failed,
    cases: results,
  };
}

// ---------------------------------------------------------------------------
// Sample generation
// ---------------------------------------------------------------------------

/**
 * Generate sample inputs from the baseline's seeded product list
 * (GET /api/v1/products?limit=N → one qty-1 FI input per product id).
 */
export async function generateSampleFromBaseline(
  transport: Transport,
  baselineUrl: string,
  sampleSize: number,
): Promise<ParityCase[]> {
  const url = `${baselineUrl.replace(/\/+$/, '')}/api/v1/products?limit=${sampleSize}`;
  const response = await transport(url, { method: 'GET' });
  if (response.status !== 200) {
    throw new Error(
      `product sampling failed: GET ${url} → HTTP ${response.status} — pass --sample-file instead`,
    );
  }
  const body = response.body as { items?: Array<{ id?: unknown }>; results?: Array<{ id?: unknown }> };
  const items = Array.isArray(response.body)
    ? (response.body as Array<{ id?: unknown }>)
    : (body.items ?? body.results ?? []);
  const ids = items
    .map((item) => item?.['id'])
    .filter((id): id is number => Number.isInteger(id) && (id as number) > 0);
  if (ids.length === 0) {
    throw new Error(`product sampling returned no product ids from ${url} — pass --sample-file instead`);
  }
  return ids.map((id) => ({
    name: `sample-product-${id}`,
    input: { productId: id, quantity: 1, destination: 'FI' },
  }));
}

/** Parse --sample-file: a JSON array of calculation inputs. */
export function parseSampleFile(path: string): ParityCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`cannot read sample file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`sample file ${path} must contain a JSON array of calculation inputs`);
  }
  return parsed.map((input, i) => ({
    name: `sample-file-${i}`,
    input: assertValidInput(input, `#${i}`),
  }));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function renderReport(report: ParityReport): string {
  const lines: string[] = [
    `dual-run parity: ${report.passed}/${report.totalCases} cases in parity ` +
      `(baseline ${report.baselineUrl} · worker ${report.workerUrl})`,
  ];
  for (const result of report.cases) {
    const status = result.ok ? 'PASS' : 'FAIL';
    lines.push(`  ${status}  ${result.name} (${result.baselineStatus}/${result.workerStatus})`);
    for (const diff of result.diffs) {
      lines.push(`         ${diff.path}: baseline=${diff.baseline} worker=${diff.worker} (${diff.kind})`);
    }
    for (const { side, violations } of result.enumViolations) {
      for (const violation of violations) {
        lines.push(
          `         ${side} enum violation at ${violation.path}: ${JSON.stringify(violation.value)} ` +
            `(allowed: ${violation.allowed.join(', ')})`,
        );
      }
    }
    if (result.error) lines.push(`         ${result.error}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  baselineUrl?: string;
  workerUrl?: string;
  sampleFile?: string;
  sampleSize: number;
  timeoutMs: number;
  concurrency: number;
  reportJson?: string;
  allowSameUrl: boolean;
  paceMs: number;
}

function usage(): string {
  return [
    'Usage: pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/dual-run-parity.ts --baseline-url <url> --worker-url <url> [options]',
    '',
    'Required:',
    '  --baseline-url <url>   Nest baseline base URL (K8s, dual-run)',
    '  --worker-url <url>     Cloudflare Worker base URL (api-worker)',
    '',
    'Options:',
    '  --sample-file <path>   JSON array of {productId, quantity, destination, …} inputs',
    `  --sample-size <n>      products sampled from the baseline when no file is given (default 20; 0 = golden only)`,
    '  --golden-only          run the golden 5 cases only (implies --sample-size 0)',
    '  --timeout-ms <n>       per-request timeout (default 15000)',
    '  --concurrency <n>      parallel cases (default 4)',
    `  --pace-ms <n>          min spacing between POSTs to one origin — the CALCULATOR`,
    `                         profile admits 10/min, so the default is ${DEFAULT_PACE_MS} (8/min); 0 disables`,
    '  --report-json <path>   also write the machine-readable report here',
    '  --allow-same-url       permit baseline == worker (harness smoke only — NOT a real parity pass)',
    '  -h, --help             this help',
    '',
    'Exit codes: 0 parity · 1 any mismatch · 2 usage/transport error.',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { sampleSize: 20, timeoutMs: 15000, concurrency: 4, allowSameUrl: false, paceMs: DEFAULT_PACE_MS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--baseline-url':
        options.baselineUrl = argv[++i];
        break;
      case '--worker-url':
        options.workerUrl = argv[++i];
        break;
      case '--sample-file':
        options.sampleFile = argv[++i];
        break;
      case '--sample-size':
        options.sampleSize = Number(argv[++i]);
        if (!Number.isInteger(options.sampleSize) || options.sampleSize < 0) {
          console.error(`--sample-size must be a non-negative integer\n\n${usage()}`);
          process.exit(2);
        }
        break;
      case '--golden-only':
        options.sampleSize = 0;
        break;
      case '--timeout-ms': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n <= 0) {
          console.error(`--timeout-ms must be a positive integer\n\n${usage()}`);
          process.exit(2);
        }
        options.timeoutMs = n;
        break;
      }
      case '--concurrency': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n < 1 || n > 32) {
          console.error(`--concurrency must be an integer in [1, 32]\n\n${usage()}`);
          process.exit(2);
        }
        options.concurrency = n;
        break;
      }
      case '--pace-ms': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n < 0) {
          console.error(`--pace-ms must be a non-negative integer\n\n${usage()}`);
          process.exit(2);
        }
        options.paceMs = n;
        break;
      }
      case '--report-json':
        options.reportJson = argv[++i];
        break;
      case '--allow-same-url':
        options.allowSameUrl = true;
        break;
      case '-h':
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}\n\n${usage()}`);
        process.exit(2);
    }
  }
  if (!options.baselineUrl || !options.workerUrl) {
    console.error(`--baseline-url and --worker-url are both required\n\n${usage()}`);
    process.exit(2);
  }
  if (
    new URL(options.baselineUrl).toString() === new URL(options.workerUrl).toString() &&
    !options.allowSameUrl
  ) {
    console.error(
      'baseline and worker URLs are identical — a parity pass needs two stacks. ' +
        'Use --allow-same-url only for single-endpoint harness smoke runs.\n',
    );
    process.exit(2);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const endpoints = { baselineUrl: options.baselineUrl!, workerUrl: options.workerUrl! };
  const transport = makeFetchTransport(options.timeoutMs);

  // 1. Golden 5 — always.
  const cases: ParityCase[] = [...GOLDEN_CASES];

  // 2. Sample — from file, or generated from the baseline's product list.
  if (options.sampleFile) {
    cases.push(...parseSampleFile(options.sampleFile));
  } else if (options.sampleSize > 0) {
    const sampled = await generateSampleFromBaseline(transport, endpoints.baselineUrl, options.sampleSize);
    cases.push(...sampled);
  }

  console.log(`[parity] ${cases.length} case(s): ${GOLDEN_CASES.length} golden + ${cases.length - GOLDEN_CASES.length} sampled`);
  console.log(`[parity] per-origin pacing: ${options.paceMs > 0 ? `${options.paceMs} ms (CALCULATOR profile is 10/min per client)` : 'disabled'}`);
  const report = await runParity(transport, endpoints, cases, {
    timeoutMs: options.timeoutMs,
    concurrency: options.concurrency,
    hooks: { pacer: options.paceMs > 0 ? new OriginPacer(options.paceMs) : null },
  });

  console.log(renderReport(report));

  if (options.reportJson) {
    const path = resolve(options.reportJson);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[parity] report written to ${path}`);
  }

  if (report.failed > 0) {
    console.error(`[parity] FAILED — ${report.failed} case(s) out of parity; cutover gate is NOT met.`);
    process.exit(1);
  }
  console.log('[parity] PASSED — zero mismatches across the sampled set.');
}

/** Run only when invoked directly (tests import the module for its exports). */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(`[parity] FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
