/**
 * Group order integration suite (task 9.5, change
 * product-roadmap-phases-1-4) — the spec: group-order-ledger checklist
 * against the real stack: the FULL createApp() composition (index.ts
 * already wires registerGroupOrderRoutes AND the guard prefix, so
 * createApp() IS the production composition — no extra registration)
 * over a real migrated D1 and in-memory DO namespaces.
 *
 * Audit (task 9.5 text → existing coverage → what this file adds):
 *
 * - "unit: allocation math and minimal transfers" — ALREADY COVERED by
 *   the task-9.2 module tests (27 tests: remainder distribution by
 *   largest fractional remainder, single participant, tie-breaks and
 *   determinism/minimality of settleBalances, result states,
 *   reproducibility, input validation,
 *   packages/core-domain/src/grouporder/__tests__/grouporder.test.ts);
 *   NOT re-tested here.
 * - 9.3 route tests (group-order.routes.test.ts) cover the route
 *   contract over the composed app: guard order, seeded-session expiry
 *   (404/410 incl. the seeded exclusive edge), single-offender payment
 *   rejections, the ledger flows and value states, and the rate-limit
 *   profile split.
 *
 * Integration deltas ADDED here (tests/integration/**, composed-app
 * level over production `createApp()`):
 * - payment-field payload rejected WITH THE FIELD NAMED: a
 *   MULTI-offender, deep-nested payload (payment keys inside array
 *   elements and a nested object) names every offending path — and the
 *   IDENTICAL payload without the payment keys is accepted, so the
 *   rejection is provably caused by the payment fields alone.
 * - expired token rejected (410) against the TTL the API ITSELF set:
 *   a session created through the HTTP API is admitted 1 ms before its
 *   own expiresAt edge, is dead on every token route at exactly the
 *   edge (exclusive), and stays dead after — the edge-time attempts
 *   persist nothing.
 * - flag-off 403 with data present: flag ON creates a session and adds
 *   an item, flag OFF 403s BOTH the authed create and the token route
 *   on the SAME composition and data — the flag is the only variable
 *   (plus the fully locked env).
 * - SOURCE-LEVEL assertion: no payment-processing import exists in the
 *   group-order module (spec "Accounting-only boundary" +
 *   design R12). Scope: packages/core-domain/src/grouporder/** and the
 *   api-worker group-order routes/DTO files. The scan targets IMPORT
 *   POSITIONS (static/side-effect/dynamic/require statements), which
 *   is the precise line of the distinction the test encodes:
 *
 *     PROHIBITED — payment PROCESSING capability: an import position
 *     naming a gateway/SDK/processing module ('stripe', 'paypal',
 *     './payment-processor', …). An import is how processing
 *     capability enters a module; none is allowed.
 *     ALLOWED — payment vocabulary as DATA: the DTO's rejection-list
 *     key names (PAYMENT_SUBSTRING_TERMS / PAYMENT_EXACT_TERMS exist
 *     to reject payment fields), the disclaimer's boundary statement,
 *     and docblock discussion. These are statements and constants, not
 *     import positions, and the scan deliberately never looks at them
 *     — a whole-file scan would false-positive on exactly this
 *     sanctioned vocabulary.
 *
 *   Compliance-grade rigor per the trip-affiliate / producer-dupes
 *   precedent: a non-vacuous matcher proof (the matcher fires on
 *   payment-processing import samples, stays silent on the module's
 *   real imports), import-statement extraction (not whole-file scans),
 *   located-symbol pinning (a renamed/moved code unit cannot silently
 *   escape the scan set), and a pinned positive control proving the
 *   sanctioned key names live exactly in the DTO rejection lists.
 *
 * @module GroupOrderD1IntegrationTest
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  createApp,
  expectEnvelope,
  issueSessionToken,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedProduct,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import type { Env } from '../../../apps/api-worker/src/env';
import type { DatabaseSync } from 'node:sqlite';
import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures and composition — full production stack
// ---------------------------------------------------------------------------

const cookieOf = (token: string): string => `rajahinta_session=${token}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * index.ts registers the group order handlers (create behind the
 * sessionAuth + flag guards, token routes with the flag gate first) on
 * the one app — the composition under test is exactly what production
 * serves.
 */
function fullApp(): ReturnType<typeof createApp> {
  return createApp();
}

/** Group order flag ON (permissive base) — the serving path. */
function groupOrderEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_GROUP_ORDER_LEDGER: 'true' });
}

interface SessionJson {
  id: number;
  shareToken: string;
  createdAt: string;
  expiresAt: string;
}

function tokenPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createSession(
  app: ReturnType<typeof createApp>,
  env: Env,
  token: string,
  body: unknown = {},
): Promise<Response> {
  return request(app, env, '/api/v1/group-orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieOf(token) },
    body: JSON.stringify(body),
  });
}

const TOKEN_PATHS = (t: string): readonly string[] => [
  `/api/v1/group-orders/${t}/join`,
  `/api/v1/group-orders/${t}/items`,
  `/api/v1/group-orders/${t}/ledger`,
];

interface Setup {
  db: DatabaseSync;
  d1: D1DatabaseLike;
  app: ReturnType<typeof createApp>;
  env: Env;
  token: string;
  shareToken: string;
  /** The expiry the API itself set on the created session (exclusive edge). */
  expiresAt: string;
}

/** Account 7 creates a session THROUGH the API (flag on) — no direct seeding. */
async function setupWithSession(): Promise<Setup> {
  const { db, d1 } = openMigratedD1();
  seedAccount(db, { id: 7, userId: 'user-7', email: 'user-7@example.invalid', tier: 'FREE' });
  const app = fullApp();
  const env = groupOrderEnv(d1);
  const token = await issueSessionToken(d1, 7);
  const created = await createSession(app, env, token);
  expect(created.status).toBe(201);
  const body = (await created.json()) as SessionJson;
  return { db, d1, app, env, token, shareToken: body.shareToken, expiresAt: body.expiresAt };
}

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// 1. Payment-field payload rejected WITH THE FIELD NAMED — composed app,
//    deep-nested multi-offender; the identical clean payload is accepted
//    (spec "Payment payload rejected": the validation error names the
//    disallowed field; design R12 API layer of the three-layer boundary)
// ===========================================================================

describe('payment-field payloads rejected with the field named (task 9.5)', () => {
  let s: Setup;

  beforeEach(async () => {
    s = await setupWithSession();
    seedProduct(s.db, { id: 1 });
    // Participant 'A' exists (an added item), so the clean shared-cost
    // baseline below is a legal ledger request.
    const item = await request(s.app, s.env, `/api/v1/group-orders/${s.shareToken}/items`, tokenPost({ nickname: 'A', productId: 1, quantity: 2 }));
    expect(item.status).toBe(201);
  });

  it('names every offender of a deep-nested payload — and accepts the identical payload without them', async () => {
    const ledgerPath = `/api/v1/group-orders/${s.shareToken}/ledger`;

    // Non-vacuity: the exact same shape WITHOUT payment keys computes —
    // the rejection below is caused by the payment fields alone.
    const clean = {
      sharedCosts: [
        { label: 'Ferry shipping', cents: 500, frontedByParticipantId: 'A' },
        { label: 'Packaging duty', cents: 300, frontedByParticipantId: 'A' },
      ],
    };
    const ok = await request(s.app, s.env, ledgerPath, tokenPost(clean));
    expect(ok.status).toBe(200);

    // The offender: payment keys at three depths — array element [0],
    // array element [1], and a nested object inside [1]. The gate walks
    // depth-first in insertion order and names EVERY offending path.
    const offender = {
      sharedCosts: [
        { label: 'Ferry shipping', cents: 500, frontedByParticipantId: 'A', paymentReference: 'sepa-123' },
        {
          label: 'Packaging duty',
          cents: 300,
          frontedByParticipantId: 'A',
          iban: 'FI2112345600000785',
          settlement: { cardNumber: '4111111111111111' },
        },
      ],
    };
    const body = await expectEnvelope(
      await request(s.app, s.env, ledgerPath, tokenPost(offender)),
      400,
      { error: 'ValidationError' },
    );
    for (const path of [
      'sharedCosts[0].paymentReference',
      'sharedCosts[1].iban',
      'sharedCosts[1].settlement.cardNumber',
    ]) {
      expect(body.message).toContain(`field '${path}' is not accepted`);
    }
    // The gate's named-field rejection fired BEFORE the strict schema:
    // the message is the named-field form, not a generic unknown-key error.
    expect(body.message).toContain('is not accepted');
  });

  it('rejects the same deep-nested payload on the authenticated create route, naming the field', async () => {
    const body = await expectEnvelope(
      await createSession(s.app, s.env, s.token, {
        checkout: { paymentIntent: 'pi_123' },
      }),
      400,
      { error: 'ValidationError' },
    );
    expect(body.message).toContain("field 'checkout.paymentIntent' is not accepted");
  });
});

// ===========================================================================
// 2. Expired token rejected — 410 at the EXCLUSIVE edge of the TTL the API
//    itself set (spec "Expired token rejected": the session SHALL NOT be
//    accessible through a link past its expiry)
// ===========================================================================

describe('share-link expiry end-to-end — the API-created TTL edge (task 9.5)', () => {
  it('admits the token 1 ms before its own edge, kills it on every route at exactly the edge, and persists nothing', async () => {
    const s = await setupWithSession();

    // The API set a fixed 7-day TTL (sanity — the edge under test is the
    // production lifetime, not a seeded arbitrary one).
    const edge = new Date(s.expiresAt).getTime();
    expect(edge - Date.now()).toBeGreaterThan(6 * DAY_MS);
    seedProduct(s.db, { id: 1 });

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // One millisecond BEFORE the edge the link still works.
      vi.setSystemTime(edge - 1);
      const admitted = await request(
        s.app,
        s.env,
        `/api/v1/group-orders/${s.shareToken}/join`,
        tokenPost({ nickname: 'A' }),
      );
      expect(admitted.status).toBe(200);

      // AT the edge (exclusive — expiresAt <= now is already expired):
      // every token route refuses with 410 Gone.
      vi.setSystemTime(edge);
      for (const path of TOKEN_PATHS(s.shareToken)) {
        await expectEnvelope(await request(s.app, s.env, path, tokenPost({})), 410, {
          error: 'SessionExpired',
        });
      }

      // And the refusal is permanent, not a boundary rounding accident.
      vi.setSystemTime(edge + 3_600_000);
      await expectEnvelope(
        await request(s.app, s.env, `/api/v1/group-orders/${s.shareToken}/join`, tokenPost({ nickname: 'A' })),
        410,
        { error: 'SessionExpired' },
      );
    } finally {
      vi.useRealTimers();
    }

    // The edge-time attempts wrote nothing — an expired link cannot
    // mutate the session it used to open.
    const rows = s.db.prepare('SELECT COUNT(*) AS n FROM group_order_items').get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });
});

// ===========================================================================
// 3. Flag-off 403 — both the authed create and the token routes, with data
//    present so the flag is provably the only variable (spec "Feature
//    gating": session creation AND share-link access return the
//    feature-disabled error)
// ===========================================================================

describe('GROUP_ORDER_LEDGER flag gate end-to-end with data present (task 9.5)', () => {
  it('serves create + share-link with the flag ON, then 403s both with the flag OFF', async () => {
    // Flag ON: a real session with a real item exists.
    const s = await setupWithSession();
    seedProduct(s.db, { id: 1 });
    const item = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/items`,
      tokenPost({ nickname: 'A', productId: 1, quantity: 1 }),
    );
    expect(item.status).toBe(201);

    // Flag OFF (permissive base — the flag key absent, everything else
    // open): the SAME authed create and the SAME share link get the
    // feature-disabled envelope.
    const off = permissiveEnv(s.d1);
    await expectEnvelope(await createSession(s.app, off, s.token), 403, {
      message: 'Feature "GROUP_ORDER_LEDGER" is not enabled',
      error: 'Forbidden',
    });
    await expectEnvelope(
      await request(s.app, off, `/api/v1/group-orders/${s.shareToken}/join`, tokenPost({ nickname: 'A' })),
      403,
      { message: 'Feature "GROUP_ORDER_LEDGER" is not enabled', error: 'Forbidden' },
    );

    // Fully locked env — same verdicts composed.
    const locked = lockedEnv(s.d1);
    await expectEnvelope(await createSession(s.app, locked, s.token), 403, {
      error: 'Forbidden',
    });
    await expectEnvelope(
      await request(s.app, locked, `/api/v1/group-orders/${s.shareToken}/join`, tokenPost({})),
      403,
      { error: 'Forbidden' },
    );
  });
});

// ===========================================================================
// 4. Source level — no payment-processing import exists in the group-order
//    module (spec "Accounting-only boundary"; design R12). See the module
//    docblock for the PROHIBITED (capability, import positions) vs ALLOWED
//    (vocabulary as data: DTO rejection lists, disclaimer text) distinction.
// ===========================================================================

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** The group-order module: the core-domain allocation unit and its API surface. */
const GROUP_ORDER_FILES = {
  module: path.join(REPO_ROOT, 'packages/core-domain/src/grouporder/grouporder.ts'),
  types: path.join(REPO_ROOT, 'packages/core-domain/src/grouporder/grouporder.types.ts'),
  disclaimer: path.join(REPO_ROOT, 'packages/core-domain/src/grouporder/grouporder.disclaimer.ts'),
  routes: path.join(REPO_ROOT, 'apps/api-worker/src/routes/group-order.routes.ts'),
  dto: path.join(REPO_ROOT, 'apps/api-worker/src/routes/group-order-dto.ts'),
} as const;

/**
 * Payment-PROCESSING vocabulary — gateway/SDK/processing-module names.
 * The non-vacuity test proves the matcher fires on processing imports;
 * the scans prove no import position in the module ever does.
 */
const PAYMENT_PROCESSING_VOCABULARY =
  /payment|checkout|stripe|paypal|venmo|mobilepay|klarna|braintree|adyen|sumup|billing|\bcharge/i;

interface ImportStatement {
  readonly statement: string;
  readonly specifier: string;
}

/**
 * Extract IMPORT statements only — static (incl. `import type` and
 * multi-line named braces), side-effect, dynamic `import('…')`, and
 * `require('…')`. Docblocks, strings, and constants are never matched:
 * that is the mechanism that keeps the ALLOWED vocabulary (DTO
 * rejection lists, disclaimer text) out of the scan.
 */
function extractImportStatements(source: string): ImportStatement[] {
  const statements: ImportStatement[] = [];
  for (const m of source.matchAll(/\bimport\b[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    statements.push({ statement: m[0], specifier: m[1] ?? '' });
  }
  for (const m of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    statements.push({ statement: m[0], specifier: m[1] ?? '' });
  }
  for (const m of source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    statements.push({ statement: m[0], specifier: m[1] ?? '' });
  }
  return statements;
}

/** Extract a full declaration block by brace matching (trip-affiliate precedent). */
function extractBraceBlock(source: string, declaration: RegExp): string | null {
  const match = declaration.exec(source);
  if (match === null) return null;
  const open = source.indexOf('{', match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

/** Extract a `const NAME = [...]` literal by bracket matching (past any type annotation). */
function extractBracketArray(source: string, constantName: string): string | null {
  const match = new RegExp(`\\bconst ${constantName}\\b`).exec(source);
  if (match === null) return null;
  // The initializer's '[' — not the '[' of a `readonly string[]` annotation.
  const assign = source.indexOf('=', match.index);
  if (assign === -1) return null;
  const open = source.indexOf('[', assign);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/** The code units that ARE the group-order module — a rename must fail loudly here. */
const GROUP_ORDER_CODE_UNITS: Readonly<
  Record<keyof typeof GROUP_ORDER_FILES, readonly { label: string; pattern: RegExp }[]>
> = {
  module: [
    { label: 'export function calculateGroupOrderLedger', pattern: /\bexport function calculateGroupOrderLedger\b/ },
    { label: 'export function settleBalances', pattern: /\bexport function settleBalances\b/ },
  ],
  types: [
    { label: 'export class InvalidGroupOrderInputError', pattern: /\bexport class InvalidGroupOrderInputError\b/ },
  ],
  disclaimer: [
    { label: 'export const GROUP_ORDER_DISCLAIMER_FI', pattern: /\bexport const GROUP_ORDER_DISCLAIMER_FI\b/ },
    { label: 'export const GROUP_ORDER_DISCLAIMER_EN', pattern: /\bexport const GROUP_ORDER_DISCLAIMER_EN\b/ },
  ],
  routes: [
    { label: 'async function resolveTokenScope', pattern: /\basync function resolveTokenScope\b/ },
    { label: 'function registerGroupOrderRoutes', pattern: /\bfunction registerGroupOrderRoutes\b/ },
  ],
  dto: [
    { label: 'export function rejectPaymentInstrumentFields', pattern: /\bexport function rejectPaymentInstrumentFields\b/ },
    { label: 'export async function parseGroupOrderDto', pattern: /\bexport async function parseGroupOrderDto\b/ },
  ],
};

describe('group-order module is payment-processing-free at source level (task 9.5)', () => {
  it('the vocabulary matcher fires on payment-processing imports and stays silent on the module\u2019s real ones — no vacuous pass', () => {
    const mustFire = [
      "import { PaymentIntent } from 'stripe'",
      "import Stripe from 'stripe'",
      "import { createPaymentLink } from '../payments/client'",
      "import { CheckoutApi } from './checkout-sdk'",
      "import 'stripe'",
      "const stripe = require('stripe')",
      "await import('./payment-processor')",
    ];
    for (const sample of mustFire) {
      expect(extractImportStatements(sample).length, JSON.stringify(sample)).toBeGreaterThan(0);
      expect(
        PAYMENT_PROCESSING_VOCABULARY.test(sample),
        JSON.stringify(sample),
      ).toBe(true);
    }
    // And it must NOT fire on the module's actual innocent imports.
    for (const sample of [
      "import { z } from 'zod'",
      "import { Hono } from 'hono'",
      "import type { Disclaimer } from '../calculator/calculator.types'",
      "import { calculateGroupOrderLedger } from '../../../../packages/core-domain/src/grouporder/grouporder'",
    ]) {
      expect(PAYMENT_PROCESSING_VOCABULARY.test(sample), JSON.stringify(sample)).toBe(false);
    }
  });

  it('every import statement in the group-order module is free of payment-processing vocabulary', () => {
    let total = 0;
    for (const [fileKey, file] of Object.entries(GROUP_ORDER_FILES)) {
      const source = readFileSync(file, 'utf8');
      expect(source.length).toBeGreaterThan(0);
      const imports = extractImportStatements(source);
      // Extraction non-vacuity: every module file really has imports.
      expect(imports.length, `${fileKey} must yield import statements`).toBeGreaterThan(0);
      for (const found of imports) {
        expect(
          found.statement,
          `${fileKey} import of "${found.specifier}" must not carry payment-processing vocabulary ` +
            '(spec: accounting-only boundary — imports are how processing capability enters)',
        ).not.toMatch(PAYMENT_PROCESSING_VOCABULARY);
        expect(found.specifier).not.toMatch(PAYMENT_PROCESSING_VOCABULARY);
      }
      total += imports.length;
    }
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it('the scan pins the located code units of the module — a rename cannot silently escape', () => {
    const located: string[] = [];
    for (const [fileKey, file] of Object.entries(GROUP_ORDER_FILES)) {
      const source = readFileSync(file, 'utf8');
      for (const unit of GROUP_ORDER_CODE_UNITS[fileKey as keyof typeof GROUP_ORDER_FILES]) {
        const block = extractBraceBlock(source, unit.pattern);
        // Located-symbol proof: the unit must still exist for the scan
        // to count as covering the module.
        expect(block, `${fileKey}::${unit.label} must still exist`).not.toBeNull();
        located.push(`${fileKey}::${unit.label}`);
      }
    }
    expect(located).toHaveLength(9);
  });

  it('payment key NAMES live exactly in the DTO rejection lists — the sanctioned data-level home', () => {
    const source = readFileSync(GROUP_ORDER_FILES.dto, 'utf8');
    // Positive control: the rejection constants DO carry the vocabulary —
    // proving the distinction the scan encodes. The key names are DATA
    // (they exist to REJECT payment fields); the prohibition is payment
    // PROCESSING capability, which can only enter through an import.
    const substringTerms = extractBracketArray(source, 'PAYMENT_SUBSTRING_TERMS');
    const exactTerms = extractBracketArray(source, 'PAYMENT_EXACT_TERMS');
    expect(substringTerms).not.toBeNull();
    expect(exactTerms).not.toBeNull();
    expect(substringTerms).toMatch(PAYMENT_PROCESSING_VOCABULARY);
    expect(exactTerms).toMatch(PAYMENT_PROCESSING_VOCABULARY);
    expect(substringTerms).toContain("'payment'");
    expect(exactTerms).toContain("'stripe'");
    expect(exactTerms).toContain("'paypal'");
    // …while the import positions of the very same file stay clean.
    for (const found of extractImportStatements(source)) {
      expect(found.statement).not.toMatch(PAYMENT_PROCESSING_VOCABULARY);
    }
  });
});
