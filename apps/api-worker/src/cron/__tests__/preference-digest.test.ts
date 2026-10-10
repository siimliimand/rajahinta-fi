/**
 * Preference-digest cron handler tests (task 4.2, change
 * add-onboarding-preferences) — the binding semantics of the weekly
 * sweep:
 *
 * - the `PREFERENCE_DIGEST_ENABLED` kill switch is strict ('true' only):
 *   unset/false/any-other-value exits with NOTHING read or written
 *   (spec: disabled environment writes nothing), and an unconfigured
 *   email transport past the gate likewise never reads eligibility;
 * - the eligibility filter gates each account on the handler-side
 *   conditions (verified address, ≥ 1 tag, onboarded) — the consent
 *   condition itself is the enumeration query's SQL filter and is
 *   covered by the repository tests
 *   (packages/data-platform src/__tests__/account-preference.repository.test.ts);
 * - week idempotency: an account already holding a delivered OR pending
 *   intent row for the ISO week is suppressed — the pending case is the
 *   crash-reentry path (crash after intent, before mark), and it never
 *   double-sends nor writes a second intent;
 * - the UNIQUE (account, week) race on createIntent counts as skip,
 *   never as failure;
 * - an empty digest (no fresh buckets in any followed category) skips
 *   with NO intent row and NO email;
 * - the delivery pipeline: intent row written BEFORE dispatch, outcome
 *   marked AFTER (pending-only one-shot), dispatch failure marks failed,
 *   a failed marking is swallowed (the pending row suppresses the rest
 *   of the week), and a null markDelivered (concurrent marker) still
 *   counts notified;
 * - the dispatch payload is the structured digest contract
 *   (`{ to, digest: { week, facts } }` — the email Worker renders);
 * - per-account error isolation; the ISO week key's known-date answers;
 *   router wiring on the weekly Monday-morning UTC pattern.
 *
 * @module PreferenceDigestTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DIGEST_FRESHNESS_WINDOW_DAYS,
  PREFERENCE_DIGEST_CRON,
  handlePreferenceDigest,
  isDigestEligible,
  isoWeekKey,
  type DigestEmailPayload,
  type PreferenceDigestResult,
} from '../preference-digest';
import { handlersForCron } from '../router';
import { createLogger } from '../../logger';
import type { Env } from '../../env';
import { DuplicateDigestIntentError } from '../../../../../packages/data-platform/src/repositories/d1/digest-notification.repository';
import type { DigestNotificationRecord, DigestNotificationRepository } from '../../../../../packages/data-platform/src/repositories/d1/digest-notification.repository';
import type { DigestConsentRow } from '../../../../../packages/data-platform/src/repositories/d1/account-preference.repository';
import type { DigestSummaryRow } from '../../../../../packages/core-domain/src/digest/digest.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed "now" — a Saturday; the sweep week is 2026-W41. */
const NOW = new Date('2026-10-10T06:00:00.000Z');
const WEEK = '2026-W41';

const LOG = createLogger('error');

/** A fully eligible consent row — tests strip one condition at a time. */
function consent(overrides: Partial<DigestConsentRow> = {}): DigestConsentRow {
  return {
    accountId: 7,
    email: 'user@example.com',
    emailVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),
    categoryTags: ['beer'],
    onboardedAt: new Date('2026-09-02T00:00:00.000Z'),
    ...overrides,
  };
}

/** Two fresh product-wide beer buckets — a category minimum AND a new low. */
function beerRows(): DigestSummaryRow[] {
  return [
    {
      category: 'beer',
      productId: 123,
      merchant: null,
      periodStart: '2026-10-08',
      priceCloseCents: 1599,
    },
    {
      category: 'beer',
      productId: 123,
      merchant: null,
      periodStart: '2026-10-09',
      priceCloseCents: 1499,
    },
  ];
}

function intentRow(
  accountId: number,
  status: DigestNotificationRecord['deliveryStatus'],
): DigestNotificationRecord {
  return {
    id: 900,
    accountId,
    digestWeek: WEEK,
    channel: 'email',
    deliveryStatus: status,
    createdAt: NOW,
    markedAt: status === 'pending' ? null : NOW,
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PREFERENCE_DIGEST_ENABLED: 'true',
    EMAIL_WORKER_URL: 'https://rajahinta-email-worker.example.workers.dev',
    EMAIL_SEND_SECRET: 'test-shared-secret',
    LOG_LEVEL: 'error',
    ...overrides,
  } as unknown as Env;
}

// ---------------------------------------------------------------------------
// Dependency stubs (the handler's seams; the price-alert-evaluation test
// precedent — plain vi.fn worlds cast to the repository contracts)
// ---------------------------------------------------------------------------

interface World {
  listDigestConsents: ReturnType<typeof vi.fn>;
  findByAccountAndWeek: ReturnType<typeof vi.fn>;
  createIntent: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  digestSummaries: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

interface WorldOptions {
  /** The consent enumeration result (default: one eligible account). */
  consents?: DigestConsentRow[];
  /** Existing intent rows by account id — the re-entry read's answers. */
  existingIntents?: Map<number, DigestNotificationRecord>;
  /** The summary-port result (default: fresh beer rows; [] = empty). */
  summaryRows?: DigestSummaryRow[];
  /** Port behavior override (isolation tests). */
  summariesImpl?: (query: unknown) => Promise<DigestSummaryRow[]>;
  /** The dispatch behavior (default: success). */
  sendImpl?: (payload: DigestEmailPayload) => Promise<void>;
  /** Intent-write behavior override (the UNIQUE race test). */
  createIntentImpl?: () => Promise<DigestNotificationRecord>;
}

function makeWorld(options: WorldOptions = {}): {
  world: World;
  /** Call-order log across seams — the intent-before-dispatch assertion. */
  calls: string[];
  sent: DigestEmailPayload[];
  run: (envOverrides?: Partial<Env>) => Promise<PreferenceDigestResult>;
} {
  const {
    consents = [consent()],
    existingIntents = new Map(),
    summaryRows = beerRows(),
    summariesImpl,
    sendImpl,
    createIntentImpl,
  } = options;

  const calls: string[] = [];
  const sent: DigestEmailPayload[] = [];

  const listDigestConsents = vi.fn(async () => {
    calls.push('listDigestConsents');
    return consents;
  });
  const findByAccountAndWeek = vi.fn(async (accountId: number) => {
    calls.push(`findByAccountAndWeek:${accountId}`);
    return existingIntents.get(accountId) ?? null;
  });
  const createIntent = vi.fn(
    createIntentImpl ??
      (async (input: { accountId: number }) => {
        calls.push(`createIntent:${input.accountId}`);
        return intentRow(input.accountId, 'pending');
      }),
  );
  const markDelivered = vi.fn(async (id: number) => {
    calls.push(`markDelivered:${id}`);
    return intentRow(7, 'delivered');
  });
  const markFailed = vi.fn(async (id: number) => {
    calls.push(`markFailed:${id}`);
    return intentRow(7, 'failed');
  });
  const digestSummaries = vi.fn(
    summariesImpl ??
      (async () => {
        calls.push('digestSummaries');
        return summaryRows;
      }),
  );
  const send = vi.fn(
    sendImpl ??
      (async (payload: DigestEmailPayload) => {
        calls.push('send');
        sent.push(payload);
      }),
  );

  const notifications = {
    findByAccountAndWeek,
    createIntent,
    markDelivered,
    markFailed,
  } as unknown as DigestNotificationRepository;

  const run = (envOverrides: Partial<Env> = {}): Promise<PreferenceDigestResult> =>
    handlePreferenceDigest(makeEnv(envOverrides), LOG, {
      listDigestConsents,
      notifications,
      digestSummaries,
      send,
      now: () => NOW,
    });

  return {
    world: {
      listDigestConsents,
      findByAccountAndWeek,
      createIntent,
      markDelivered,
      markFailed,
      digestSummaries,
      send,
    },
    calls,
    sent,
    run,
  };
}

// ---------------------------------------------------------------------------
// Kill-switch gate (spec: disabled environment writes nothing)
// ---------------------------------------------------------------------------

describe('PREFERENCE_DIGEST_ENABLED gate', () => {
  it.each([
    ['unset (absent var)', undefined],
    ['explicit false', 'false'],
    ['wrong case — fail closed', 'TRUE'],
    ['numeric-ish junk — fail closed', '1'],
  ])('%s → the handler exits without reading eligibility and without writing', async (_name, value) => {
    const { world, run } = makeWorld();

    const result = await run({ PREFERENCE_DIGEST_ENABLED: value as string | undefined });

    expect(result).toEqual({
      enabled: false,
      configured: false,
      eligible: 0,
      notified: 0,
      failed: 0,
      suppressed: 0,
      emptySkipped: 0,
    });
    // Not even the enumeration read ran — the gate precedes every read.
    expect(world.listDigestConsents).not.toHaveBeenCalled();
    expect(world.findByAccountAndWeek).not.toHaveBeenCalled();
    expect(world.digestSummaries).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it("exact 'true' runs the sweep", async () => {
    const { world, run } = makeWorld();

    const result = await run();

    expect(result.enabled).toBe(true);
    expect(result.configured).toBe(true);
    expect(world.listDigestConsents).toHaveBeenCalledTimes(1);
  });

  it('an unconfigured email transport past the gate never reads eligibility', async () => {
    const { world, run } = makeWorld();

    const result = await run({ EMAIL_SEND_SECRET: undefined });

    expect(result.enabled).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.eligible).toBe(0);
    expect(world.listDigestConsents).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Eligibility (the handler-side conditions; consent is SQL-side)
// ---------------------------------------------------------------------------

describe('eligibility filter', () => {
  it.each([
    ['null emailVerifiedAt (unverified address)', { emailVerifiedAt: null }],
    ['empty category tags', { categoryTags: [] }],
    ['null onboardedAt (interstitial pending)', { onboardedAt: null }],
  ])('%s → the account is never processed', async (_name, override) => {
    const { world, run } = makeWorld({ consents: [consent(override)] });

    const result = await run();

    expect(result.eligible).toBe(0);
    expect(world.findByAccountAndWeek).not.toHaveBeenCalled();
    expect(world.digestSummaries).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('the eligibility conjunct passes only a fully-eligible row (unit)', () => {
    expect(isDigestEligible(consent())).toBe(true);
    expect(isDigestEligible(consent({ emailVerifiedAt: null }))).toBe(false);
    expect(isDigestEligible(consent({ categoryTags: [] }))).toBe(false);
    expect(isDigestEligible(consent({ onboardedAt: null }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Week idempotency + crash re-entry (design D5)
// ---------------------------------------------------------------------------

describe('week idempotency and crash re-entry', () => {
  it('a DELIVERED intent row for the week suppresses the account', async () => {
    const { world, run } = makeWorld({
      existingIntents: new Map([[7, intentRow(7, 'delivered')]]),
    });

    const result = await run();

    expect(result.suppressed).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.createIntent).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('a PENDING intent row (crash after intent, before mark) suppresses the account — no double send', async () => {
    const { world, run } = makeWorld({
      existingIntents: new Map([[7, intentRow(7, 'pending')]]),
    });

    const result = await run();

    expect(result.suppressed).toBe(1);
    expect(result.notified).toBe(0);
    // The re-entry read happens BEFORE the summary fetch — a suppressed
    // account costs one indexed read.
    expect(world.digestSummaries).not.toHaveBeenCalled();
    expect(world.createIntent).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
    expect(world.markFailed).not.toHaveBeenCalled();
  });

  it('a DuplicateDigestIntentError from createIntent counts as skip, not failure', async () => {
    const { world, run } = makeWorld({
      createIntentImpl: async () => {
        throw new DuplicateDigestIntentError(7, WEEK);
      },
    });

    const result = await run();

    expect(result.suppressed).toBe(1);
    expect(result.failed).toBe(0);
    expect(world.send).not.toHaveBeenCalled();
    expect(world.markFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Empty digest (spec: nothing to report means no email AND no intent row)
// ---------------------------------------------------------------------------

describe('empty-digest skip', () => {
  it('zero facts skip the account with no intent row and no dispatch', async () => {
    const { world, run } = makeWorld({ summaryRows: [] });

    const result = await run();

    expect(result.emptySkipped).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.createIntent).not.toHaveBeenCalled();
    expect(world.send).not.toHaveBeenCalled();
  });

  it('a category with no fresh bucket is omitted while a fresh one still reports', async () => {
    // beer has buckets, wine_still (also followed) has none — the digest
    // carries only beer facts and is not empty, so it sends.
    const { sent, run } = makeWorld({
      consents: [consent({ categoryTags: ['beer', 'wine_still'] })],
    });

    const result = await run();

    expect(result.emptySkipped).toBe(0);
    expect(result.notified).toBe(1);
    // Only beer facts — the unfresh wine_still tag is omitted, never
    // reported as zero or stale.
    const categories = sent[0]!.digest.facts.map((fact) => fact.category);
    expect(categories).toContain('beer');
    expect(categories).not.toContain('wine_still');
  });
});

// ---------------------------------------------------------------------------
// Delivery pipeline (intent → dispatch → pending-only outcome mark)
// ---------------------------------------------------------------------------

describe('delivery pipeline', () => {
  it('writes the intent BEFORE dispatch and marks delivered AFTER; the payload cites the week and facts', async () => {
    const { calls, sent, run } = makeWorld();

    const result = await run();

    expect(result.notified).toBe(1);
    expect(result.failed).toBe(0);
    const intentAt = calls.indexOf('createIntent:7');
    const sendAt = calls.indexOf('send');
    const markAt = calls.indexOf('markDelivered:900');
    expect(intentAt).toBeGreaterThanOrEqual(0);
    expect(sendAt).toBeGreaterThan(intentAt);
    expect(markAt).toBeGreaterThan(sendAt);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('user@example.com');
    expect(sent[0]!.digest.week).toBe(WEEK);
    // The pure computation's output, passed through verbatim: category
    // minimum first (category asc, price asc), then the new low.
    expect(sent[0]!.digest.facts).toEqual([
      {
        category: 'beer',
        kind: 'CATEGORY_MINIMUM',
        priceCloseCents: 1499,
        productId: 123,
        merchant: null,
        periodStart: '2026-10-09',
      },
      {
        category: 'beer',
        kind: 'NOTABLE_NEW_LOW',
        priceCloseCents: 1499,
        productId: 123,
        merchant: null,
        periodStart: '2026-10-09',
      },
    ]);
  });

  it('scopes the summary read to the account tags and the 7-day closed window', async () => {
    const { world, run } = makeWorld({
      consents: [consent({ categoryTags: ['wine_still', 'beer'] })],
    });

    await run();

    expect(world.digestSummaries).toHaveBeenCalledWith({
      categories: ['wine_still', 'beer'],
      fromDay: '2026-10-03',
      toDay: '2026-10-10',
    });
    expect(DIGEST_FRESHNESS_WINDOW_DAYS).toBe(7);
  });

  it('a failed dispatch marks the row failed and counts it — no delivered mark', async () => {
    const { world, calls, run } = makeWorld({
      sendImpl: async () => {
        throw new Error('email worker rejected the send: HTTP 500');
      },
    });

    const result = await run();

    expect(result.failed).toBe(1);
    expect(result.notified).toBe(0);
    expect(world.markFailed).toHaveBeenCalledWith(900);
    expect(calls.some((call) => call.startsWith('markDelivered'))).toBe(false);
  });

  it('a failing mark-failed is swallowed — the sweep neither throws nor double-counts', async () => {
    const { world, run } = makeWorld({
      sendImpl: async () => {
        throw new Error('transport down');
      },
    });
    world.markFailed.mockRejectedValueOnce(new Error('d1 write failed'));

    const result = await run();

    expect(result.failed).toBe(1);
    expect(result.notified).toBe(0);
  });

  it('a null markDelivered (concurrent marker) still counts notified — the send succeeded', async () => {
    const { world, run } = makeWorld();
    world.markDelivered.mockResolvedValueOnce(null);

    const result = await run();

    expect(result.notified).toBe(1);
    expect(result.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('per-account error isolation', () => {
  it('a failing account counts failed and the sweep continues with the next', async () => {
    const other = consent({
      accountId: 8,
      email: 'other@example.com',
      categoryTags: ['spirits'],
    });
    const { world, calls, run } = makeWorld({
      consents: [consent(), other],
      summariesImpl: async (query) => {
        const categories = (query as { categories: readonly string[] }).categories;
        if (categories.includes('beer')) {
          throw new Error('summary read exploded');
        }
        return [
          {
            category: 'spirits',
            productId: 200,
            merchant: null,
            periodStart: '2026-10-09',
            priceCloseCents: 2900,
          },
        ];
      },
    });

    const result = await run();

    expect(result.eligible).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.notified).toBe(1);
    expect(calls.some((call) => call === 'createIntent:8')).toBe(true);
    expect(world.markDelivered).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Week key + wiring
// ---------------------------------------------------------------------------

describe('isoWeekKey', () => {
  it('names the ISO week of known dates (UTC)', () => {
    expect(isoWeekKey(new Date('2026-10-10T06:00:00.000Z'))).toBe('2026-W41');
    // Jan 1 2026 is a Thursday — week 1 owns it.
    expect(isoWeekKey(new Date('2026-01-01T12:00:00.000Z'))).toBe('2026-W01');
    // Jan 1 2023 is a Sunday — it belongs to the PREVIOUS year's W52,
    // and the key's year is the week's year-owner.
    expect(isoWeekKey(new Date('2023-01-01T12:00:00.000Z'))).toBe('2022-W52');
    // Monday of the following week rolls the key.
    expect(isoWeekKey(new Date('2026-10-12T00:00:00.000Z'))).toBe('2026-W42');
    // Hour-of-day cannot leak into the key (the UTC-midnight anchor).
    expect(isoWeekKey(new Date('2026-10-10T23:59:59.999Z'))).toBe('2026-W41');
  });
});

describe('cron registration', () => {
  it('routes the preference digest on the weekly Monday-morning UTC pattern', () => {
    expect(PREFERENCE_DIGEST_CRON).toBe('0 6 * * 1');
    expect(handlersForCron(PREFERENCE_DIGEST_CRON).map((h) => h.name)).toContain(
      'preference-digest',
    );
  });
});
