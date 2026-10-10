/**
 * Preference-digest weekly cron handler (task 4.2, change
 * add-onboarding-preferences; design D3/D4/D5) — the opt-in weekly
 * digest sweep.
 *
 * ## Cadence — own weekly tick, kill-switched
 *
 * Registered on its own Monday-morning UTC pattern ({@link
 * PREFERENCE_DIGEST_CRON}, in wrangler triggers.crons for every
 * environment). The pattern exists everywhere so enabling the digest is
 * a one-flip operation; execution is gated by the
 * `PREFERENCE_DIGEST_ENABLED` var (strict `'true'` — anything else,
 * including unset, is the disabled state). The gate runs BEFORE any
 * read: a disabled environment writes nothing and does not even
 * enumerate eligibility (spec: "the handler exits without reading
 * eligibility and without writing any row"), which is what makes the
 * var a real kill switch and not merely a send suppressor.
 *
 * ## Week key — ISO calendar week, computed at sweep start
 *
 * The idempotency key is the ISO-8601 week string (e.g. `2026-W41`),
 * computed ONCE per sweep from the run instant in UTC ({@link
 * isoWeekKey}): Monday-based weeks, week 1 is the week containing the
 * year's first Thursday. The computation anchors the date at UTC
 * midnight, walks to the week's Thursday (the week's year-owner per
 * ISO 8601), and derives the week index from the distance to that
 * year's first Thursday — `YYYY` in the key is the week's year, which
 * differs from the calendar year on the New-Year boundary weeks.
 *
 * ## Data source — materialized summaries only (design D4)
 *
 * Facts come from the pure core-domain computation (task 4.1) over the
 * product-wide daily summary buckets (merchant-null rows, the same
 * source CATEGORY alert evaluation reads) inside the closed 7-day
 * freshness window — never the raw R2 observation log. The fetch rides
 * the {@link DigestSummaryQueryPort} adapter
 * (d1-digest-summary-query-port.ts); the module itself stays pure. A
 * followed category with no fresh bucket is omitted by the computation;
 * an account whose whole digest comes out empty is SKIPPED — no intent
 * row, no email (spec: "Nothing to report means no email").
 *
 * ## Eligibility (spec: consent-gated eligibility)
 *
 * The sweep enumerates digest-consented accounts
 * (`AccountPreferencesRepository.listDigestConsents` — the consent flag
 * in SQL) and gates each row on the remaining conditions here, in one
 * exported predicate ({@link isDigestEligible}): a non-null
 * `emailVerifiedAt`, at least one category tag, and `onboardedAt` set.
 * An account failing any condition is never read again — no summary
 * fetch, no intent, no email.
 *
 * ## Delivery pipeline (crash-safe, design D5)
 *
 * Re-entry read → facts → empty-skip → intent row (PENDING, UNIQUE
 * account+week) → email dispatch → pending-only outcome mark. The
 * `findByAccountAndWeek` read is the idempotency anchor: a row already
 * PENDING or DELIVERED for this week suppresses the account, so a
 * crashed sweep (intent written, dispatch or mark never ran) can never
 * double-send on re-run — the same bounded window as the alert
 * pipeline: a crash AFTER the send but BEFORE markDelivered stays
 * pending and the row suppresses every later run of the same week (the
 * digest is not re-attempted within the week; the next week is a new
 * key). The UNIQUE index is the second guard: a concurrent sweep
 * winning the insert surfaces as {@link DuplicateDigestIntentError},
 * which counts as skip — never as failure. Marking is pending-only
 * one-shot (task 1.3's anchor), so an outcome is recorded exactly once.
 *
 * ## Dispatch contract
 *
 * The email Worker owns rendering. This handler POSTs the structured
 * digest payload `{ to, locale?, digest: { week, facts } }` to the
 * email Worker's internal send path behind the shared-secret header
 * (binding-first, the EMAIL_WORKER_URL fallback like every sibling);
 * the digest email builder in apps/email-worker recognizes the payload
 * by its `digest` field and renders subject and body. `locale` is
 * declared but not sent in v1 — accounts carry no locale column and one
 * is deliberately not added (minimization; design open question).
 *
 * Per-account error isolation: one failing account counts failed and
 * the sweep continues. Counters surface in the returned result and the
 * structured log; no Analytics Engine point-set is recorded — none was
 * specified for this job (the alert sweeps' kind-stamped AE contract is
 * alert-specific).
 *
 * @module PreferenceDigestCron
 */

import {
  computePreferenceDigest,
} from '../../../../packages/core-domain/src/digest/compute';
import type {
  DigestFact,
  DigestSummaryQueryPort,
} from '../../../../packages/core-domain/src/digest/digest.types';
import {
  D1DigestNotificationRepository,
  DuplicateDigestIntentError,
  type DigestNotificationRecord,
  type DigestNotificationRepository,
} from '../../../../packages/data-platform/src/repositories/d1/digest-notification.repository';
import {
  type DigestConsentRow,
  D1AccountPreferencesRepository,
} from '../../../../packages/data-platform/src/repositories/d1/account-preference.repository';
import { createD1DigestSummaryQueryPort } from '../adapters/d1-digest-summary-query-port';
import {
  EMAIL_SEND_PATH,
  EMAIL_SEND_SECRET_HEADER,
  type EmailDispatchTarget,
} from '../services/email-send';
import type { Env } from '../env';
import type { Logger } from '../logger';

/**
 * The digest's own cron pattern — Monday 06:00 UTC ("Monday morning
 * UTC"; 08/09 Helsinki wall clock depending on DST, immaterial for a
 * weekly sweep — the same UTC-only note as the daily crons in
 * wrangler.jsonc). Present in every environment's triggers so enabling
 * is a one-flip operation; the var gates execution.
 */
export const PREFERENCE_DIGEST_CRON = '0 6 * * 1';

/**
 * How far back the freshness window reaches (days) — the SAME horizon
 * the CATEGORY alert evaluation reads (design D4: one definition of
 * current), applied as a closed [fromDay, toDay] daily range.
 */
export const DIGEST_FRESHNESS_WINDOW_DAYS = 7;

/** The intent-log channel — email only (the schema CHECK admits it). */
const DIGEST_CHANNEL = 'email' as const;

// ---------------------------------------------------------------------------
// Week key + eligibility
// ---------------------------------------------------------------------------

/**
 * The ISO-8601 week key (`YYYY-Www`) of `now` in UTC — the digest
 * idempotency key, computed at sweep start. See the module doc's week
 * section for the algorithm and the year-owner rule.
 */
export function isoWeekKey(now: Date): string {
  // Anchor at UTC midnight of the calendar day so hour-of-day can never
  // leak into the week arithmetic.
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Monday = 0 .. Sunday = 6 (getUTCDay is Sunday = 0).
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  // Walk to this week's Thursday — the week's year-owner per ISO 8601.
  day.setUTCDate(day.getUTCDate() - daysSinceMonday + 3);
  const thursday = day;
  // The year's first Thursday: Jan 4 walked back to its week's Thursday.
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  const week =
    1 +
    Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The handler-side eligibility gate (spec: consent-gated eligibility) —
 * the conditions the enumeration query does not carry: a verified
 * address, at least one followed tag, completed (or skipped) onboarding.
 * The consent condition is the enumeration itself (SQL
 * `digest_enabled = 1`), so a true here plus a consented row is the full
 * conjunct. Pure — unit-tested for each condition.
 */
export function isDigestEligible(row: DigestConsentRow): boolean {
  return (
    row.emailVerifiedAt !== null &&
    row.categoryTags.length >= 1 &&
    row.onboardedAt !== null
  );
}

/**
 * The kill-switch read (spec: erasure and kill switch): enabled iff the
 * var is EXACTLY `'true'` — unset, `'false'`, or any other value is the
 * disabled state (fail closed; a typo'd value must not silently enable
 * personalized alcohol email).
 */
export function isPreferenceDigestEnabled(env: Env): boolean {
  return env.PREFERENCE_DIGEST_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// Dispatch — the digest payload through the email Worker
// ---------------------------------------------------------------------------

/**
 * The structured digest payload the email Worker renders. The `digest`
 * field is what distinguishes it on the shared send path; facts are the
 * pure computation's output, rendered verbatim by the email worker
 * (apps/email-worker owns subject + body). `locale` is reserved for the
 * per-account-locale future (v1 never sends it).
 */
export interface DigestEmailPayload {
  readonly to: string;
  readonly locale?: string;
  readonly digest: {
    /** The ISO week key the digest covers — the intent row's key. */
    readonly week: string;
    /** The cited facts, category-asc then price-asc (task 4.1 ordering). */
    readonly facts: readonly DigestFact[];
  };
}

/**
 * POST one digest payload through the email Worker's internal send
 * contract — the same transport shape as `dispatchEmailToWorker`
 * (binding-first, secret header, throw on rejection) but with the
 * digest body: the email worker renders, this module only cites facts.
 * Throws on transport or rejection — the CALLER owns outcome marking.
 */
export async function sendDigestEmail(
  target: EmailDispatchTarget,
  payload: DigestEmailPayload,
): Promise<void> {
  if (!target.sendSecret || (!target.binding && !target.baseUrl)) {
    throw new Error(
      'email worker is not configured (EMAIL_WORKER binding / EMAIL_WORKER_URL + EMAIL_SEND_SECRET)',
    );
  }
  const url = `${(target.baseUrl ?? 'https://rajahinta-email.internal').replace(/\/+$/, '')}${EMAIL_SEND_PATH}`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [EMAIL_SEND_SECRET_HEADER]: target.sendSecret,
    },
    body: JSON.stringify(payload),
  };
  const response = target.binding
    ? await target.binding.fetch(new Request(url, init))
    : await fetch(url, init);
  if (!response.ok) {
    throw new Error(`email worker rejected the send: HTTP ${response.status}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** One run's outcome — logged by the cron dispatch, asserted by tests. */
export interface PreferenceDigestResult {
  /** False when the var gate is off — nothing was read or written. */
  readonly enabled: boolean;
  /**
   * The email-transport check, evaluated only past the gate (false when
   * the gate is off or the transport is unconfigured — in both cases
   * eligibility is never read: a run that cannot dispatch must not
   * strand pending intent rows).
   */
  readonly configured: boolean;
  /** Accounts passing the full eligibility conjunct. */
  readonly eligible: number;
  /** Digests dispatched and marked delivered. */
  readonly notified: number;
  /** Dispatch or evaluation failures (the account, not the sweep). */
  readonly failed: number;
  /** Skips from an existing intent row — delivered, pending, or a lost
   * createIntent race (the UNIQUE guard). The idempotency counter. */
  readonly suppressed: number;
  /** Computed digests with zero facts — skipped with no intent row. */
  readonly emptySkipped: number;
}

/** Seam overrides (test doubles; defaults are the real D1/fetch paths). */
export interface PreferenceDigestDeps {
  /** Consent enumeration — defaults to the account-preference repository. */
  listDigestConsents?: () => Promise<readonly DigestConsentRow[]>;
  notifications?: DigestNotificationRepository;
  /** Summary fetch port — defaults to the D1 adapter. */
  digestSummaries?: DigestSummaryQueryPort;
  send?: (payload: DigestEmailPayload) => Promise<void>;
  now?: () => Date;
}

/** The run-local, mutable twin of the counted result fields. */
interface MutableDigestCounters {
  notified: number;
  failed: number;
  suppressed: number;
  emptySkipped: number;
}

/**
 * One weekly digest tick: gate, enumerate consented accounts, gate each
 * on the remaining eligibility conditions, compute facts from
 * materialized summaries, and dispatch through the intent-log pipeline.
 * Never throws on per-account failure (isolation) — the router's
 * handler boundary only sees failures of the enumeration itself.
 */
export async function handlePreferenceDigest(
  env: Env,
  log: Logger,
  deps: PreferenceDigestDeps = {},
): Promise<PreferenceDigestResult> {
  const zeros = {
    eligible: 0,
    notified: 0,
    failed: 0,
    suppressed: 0,
    emptySkipped: 0,
  } as const;

  // -- Kill-switch gate (spec: disabled environment writes nothing) ------
  // FIRST, before any read: not even eligibility is enumerated.
  if (!isPreferenceDigestEnabled(env)) {
    log.info({
      message:
        'Preference digest is disabled (PREFERENCE_DIGEST_ENABLED unset/false) — nothing read, nothing written',
    });
    return { enabled: false, configured: false, ...zeros };
  }

  // -- Email configuration gate -------------------------------------------
  // Without the send path no intent could ever complete; evaluating
  // would only strand pending rows. Same posture as the alert sweeps.
  if (
    !env.EMAIL_SEND_SECRET ||
    (!env.EMAIL_WORKER && !env.EMAIL_WORKER_URL)
  ) {
    log.warn({
      message:
        'Preference digest email delivery is not configured (EMAIL_WORKER ' +
        'binding or EMAIL_WORKER_URL, EMAIL_SEND_SECRET) — digest not ' +
        'evaluated this tick',
    });
    return { enabled: true, configured: false, ...zeros };
  }

  const now = deps.now ?? (() => new Date());
  // Captured post-gate: closures (the default sender below) see plain
  // values instead of re-reading optional properties.
  const sendTarget: EmailDispatchTarget = {
    binding: env.EMAIL_WORKER,
    baseUrl: env.EMAIL_WORKER_URL,
    sendSecret: env.EMAIL_SEND_SECRET,
  };

  const listDigestConsents =
    deps.listDigestConsents ??
    (() => new D1AccountPreferencesRepository(env.DB).listDigestConsents());
  const notifications =
    deps.notifications ?? new D1DigestNotificationRepository(env.DB);
  const digestSummaries =
    deps.digestSummaries ?? createD1DigestSummaryQueryPort(env.DB);
  const send =
    deps.send ?? ((payload: DigestEmailPayload) => sendDigestEmail(sendTarget, payload));

  // The week key is the sweep's identity — computed once at start, so a
  // sweep straddling midnight Sunday→Monday still writes one key.
  const digestWeek = isoWeekKey(now());
  // The closed [fromDay, toDay] daily window — whole-day anchors, the
  // run day inclusive (the CATEGORY sweep's window semantics).
  const runInstant = now();
  const toDay = runInstant.toISOString().slice(0, 10);
  const fromDay = new Date(
    runInstant.getTime() - DIGEST_FRESHNESS_WINDOW_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  const consented = await listDigestConsents();
  const eligible = consented.filter(isDigestEligible);
  const counters: MutableDigestCounters = {
    notified: 0,
    failed: 0,
    suppressed: 0,
    emptySkipped: 0,
  };

  for (const account of eligible) {
    // Per-account isolation: a failing account counts failed, never
    // aborts the sweep.
    try {
      // -- Re-entry / idempotency read (design D5) ------------------------
      // A row already PENDING (a previous run crashed between intent and
      // mark) or DELIVERED (already sent this week) suppresses the
      // account — a re-run can never double-send. Checked BEFORE the
      // summary fetch: a suppressed account costs one indexed read.
      const existing = await notifications.findByAccountAndWeek(
        account.accountId,
        digestWeek,
      );
      if (existing !== null) {
        counters.suppressed++;
        log.info({
          message: `Digest ${digestWeek}: account ${account.accountId} already holds a ${existing.deliveryStatus} intent row — skipped`,
        });
        continue;
      }

      // -- Facts from materialized summaries (design D4) -------------------
      const summaryRows = await digestSummaries({
        categories: account.categoryTags,
        fromDay,
        toDay,
      });
      const facts = computePreferenceDigest({
        categoryTags: account.categoryTags,
        summaryRows,
      });
      if (facts.length === 0) {
        // Nothing to report means no email AND no intent row (spec) —
        // an empty digest must not consume the account's week.
        counters.emptySkipped++;
        log.info({
          message: `Digest ${digestWeek}: account ${account.accountId} has no reportable facts in the ${DIGEST_FRESHNESS_WINDOW_DAYS}d window — no intent row written`,
        });
        continue;
      }

      // -- Intent row MUST exist before any dispatch attempt (design D5) --
      let intent: DigestNotificationRecord;
      try {
        intent = await notifications.createIntent({
          accountId: account.accountId,
          digestWeek,
          channel: DIGEST_CHANNEL,
        });
      } catch (err) {
        if (err instanceof DuplicateDigestIntentError) {
          // A concurrent sweep won the (account, week) insert — the
          // UNIQUE guard doing its job. Skip, never fail.
          counters.suppressed++;
          log.info({
            message: `Digest ${digestWeek}: account ${account.accountId} lost the intent race — skipped`,
          });
          continue;
        }
        throw err;
      }

      // -- Dispatch → pending-only outcome mark ---------------------------
      try {
        await send({
          to: account.email,
          digest: { week: digestWeek, facts: [...facts] },
        });
      } catch (err) {
        log.error({
          message: `Digest ${digestWeek}: account ${account.accountId} email dispatch failed: ${
            err instanceof Error ? err.message : 'unknown error'
          } — the pending intent is marked failed`,
        });
        // Best-effort marking; a marking failure leaves the row pending,
        // which suppresses the rest of this week's re-runs (the weekly
        // key bounds the window the alert pipeline retries inside).
        await notifications
          .markFailed(intent.id)
          .catch((markErr: unknown) => {
            log.error({
              message: `Digest ${digestWeek}: account ${account.accountId} mark-failed failed: ${
                markErr instanceof Error ? markErr.message : 'unknown error'
              }`,
            });
          });
        counters.failed++;
        continue;
      }

      // null would mean the row already left pending (a concurrent
      // marker) — the send itself still succeeded, so it counts notified.
      const marked = await notifications.markDelivered(intent.id);
      if (marked === null) {
        log.warn({
          message: `Digest ${digestWeek}: intent ${intent.id} was already marked by another writer`,
        });
      }
      counters.notified++;
    } catch (err) {
      counters.failed++;
      log.error({
        message: `Digest ${digestWeek}: account ${account.accountId} evaluation failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      });
    }
  }

  log.info({
    message: `Preference digest ${digestWeek}: ${eligible.length} eligible, ${counters.notified} notified, ${counters.emptySkipped} empty-skipped, ${counters.suppressed} intent-suppressed, ${counters.failed} failed`,
    digestWeek,
    ...counters,
  });

  return {
    enabled: true,
    configured: true,
    eligible: eligible.length,
    ...counters,
  };
}
