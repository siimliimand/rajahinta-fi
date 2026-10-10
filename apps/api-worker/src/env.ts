/**
 * Worker bindings (wrangler.jsonc) and the Hono environment type.
 *
 * D1/DO bindings are live as of tasks 2.4 and 3.3–3.4 (v1/v2 DO
 * migrations); the Queue + R2 bindings arrive with task 4.1 (design D6,
 * D4-amended); route ports start at task 3.5.
 */

import type { IngestionMessageBody } from './queues/ingestion-message';
import type { AuthenticatedAccount } from './auth/authenticated-account';

export interface Env {
  /** D1 database. Binding present; real schemas/providers arrive in task 2.4. */
  readonly DB: D1Database;
  /** RateLimiterDO — task 3.3. */
  readonly RATE_LIMITER?: DurableObjectNamespace;
  /** IdempotencyDO — task 3.3 (also carries the job-claim namespace, task 4.1). */
  readonly IDEMPOTENCY?: DurableObjectNamespace;
  /** ClickCounterDO — task 3.4 (migration tag v2; alarm-driven flush). */
  readonly CLICK_COUNTER?: DurableObjectNamespace;
  /**
   * Price-ingestion Queue — task 4.1 (design D6). Producer: the hourly
   * cron handler sends one message per permitted merchant. The consumer
   * side is this worker's `queue()` handler (wrangler queues.consumers).
   */
  readonly INGESTION_QUEUE?: Queue<IngestionMessageBody>;
  /**
   * Price-ingestion Workflow — task 4.2 (design D6). The Queue consumer
   * creates one instance per message; the instance id IS the message's
   * dedupe key, making the handoff idempotent under at-least-once
   * delivery. Class exported from src/workflows/ (the lead re-exports
   * it from src/index.ts — see src/workflows/index.ts).
   */
  readonly INGESTION_WORKFLOW?: Workflow;
  /**
   * R2 observation log — task 4.1/4.3 (design D4 as amended by G1).
   * Append-only JSONL objects (`observations/YYYY-MM-DD.jsonl`); written
   * by the ingestion pipeline's offer-change hook, batch-read by the
   * time-series aggregation cron handler.
   */
  readonly OBSERVATION_LOG?: R2Bucket;
  /**
   * R2 rate-snapshot bucket — task 4.4 (design D6/D9). Holds the
   * official rate-snapshot object the tax-dataset review hashes
   * (SHA-256 against the last-reviewed entry). Deliberately a separate
   * bucket from OBSERVATION_LOG: an append-only event log and a
   * config snapshot have different write patterns and lifecycles.
   */
  readonly RATE_SNAPSHOTS?: R2Bucket;
  /**
   * Workers Analytics Engine dataset — task 6.1 (design D8). One dataset
   * per environment (wrangler.jsonc `analytics_engine_datasets`); carries
   * the request counters (route pattern + status class) and freshness
   * gauges via `writeDataPoint`. Optional: dev/local runs without the
   * binding use the no-op emitter (src/observability/metrics.ts; data
   * point shapes and Grafana re-point queries in
   * src/observability/METRICS.md).
   */
  readonly METRICS?: AnalyticsEngineDataset;
  /**
   * Object key of the rate snapshot inside RATE_SNAPSHOTS (per-env
   * config, design D9; wrangler vars per environment). Default when
   * unset: config/rate-snapshot.json (the same relative path the
   * file-based source resolved in the backend).
   */
  readonly RATE_SNAPSHOT_OBJECT_KEY?: string;
  /**
   * Retention windows (days) for the calculation-record sweep — passed
   * into the D1 retention service as explicit overrides (the service's
   * own defaults are the 30-day anonymous window / 180-day age cap).
   */
  readonly CALCULATION_RECORD_RETENTION_DAYS?: string;
  readonly CALCULATION_RECORD_AGE_CAP_DAYS?: string;
  /** Minimum structured-log level (default "info"). */
  readonly LOG_LEVEL?: string;

  // -- Freshness alerting (task 6.3, design D7/D8) --------------------------

  /**
   * Email Worker service binding (per-env wrangler.jsonc `services`) —
   * the PREFERRED transport for the internal send contract
   * (`POST /internal/email/send`, apps/email-worker, task 5.3).
   * Cloudflare blocks same-account Worker-to-Worker subrequests over
   * workers.dev hostnames (error 1042), so workers.dev URLs can only
   * ever 404 from this Worker; the binding routes in-account.
   */
  readonly EMAIL_WORKER?: Fetcher;
  /**
   * Email Worker base URL (per-env wrangler var, design D9) — URL
   * fallback for the send contract when the EMAIL_WORKER binding is
   * absent (tests, local). Rejected at the edge with 404/1042 when it
   * points at a workers.dev hostname.
   */
  readonly EMAIL_WORKER_URL?: string;
  /**
   * CORS origin allowlist (task 5.2) — comma-separated exact origins.
   * Parity with main.ts (`CORS_ORIGIN ?? 'http://localhost:3001'`):
   * per-env wrangler var in staging/production, localhost default in dev.
   * Never `*` — the session cookie is httpOnly and only travels on
   * credentialed cross-origin requests.
   */
  readonly CORS_ORIGIN?: string;
  /**
   * Shared secret for the email Worker's send contract (header
   * `X-Email-Send-Secret`). A SECRET, never a wrangler var: set per
   * environment with `wrangler secret put EMAIL_SEND_SECRET`; must match
   * the email Worker's EMAIL_SEND_SECRET.
   */
  readonly EMAIL_SEND_SECRET?: string;
  /** Operator recipient of freshness alert emails. */
  readonly FRESHNESS_ALERT_EMAIL_TO?: string;
  /**
   * Weekly preference-digest kill switch (task 4.2, change
   * add-onboarding-preferences; design D5 / spec "Erasure and kill
   * switch"). Enabled ONLY on the exact string 'true' — unset, 'false',
   * or any other value keeps the sweep off, and the disabled state
   * writes nothing (the handler exits before reading eligibility). A
   * per-env wrangler var, absent by default so every environment starts
   * disabled; the Monday cron pattern exists in all environments so
   * enabling is a one-flip operation.
   */
  readonly PREFERENCE_DIGEST_ENABLED?: string;
  /**
   * Suppression window in seconds — repeats of an already-alerted
   * violation within the window are not re-emailed (IdempotencyDO
   * marker). Default 4 h when unset (Alertmanager repeat_interval
   * parity); invalid values fall back to the default with a warning.
   */
  readonly FRESHNESS_ALERT_SUPPRESSION_SECONDS?: string;

  // -- Ops access (task 3.2; names match the Nest OpsAccessGuard) -----------

  /** Operator bearer token (Authorization: Bearer …); null/absent = off. */
  readonly OPS_BEARER_TOKEN?: string;
  /** Comma-separated IPs / IPv4 CIDRs allowed to reach ops routes; absent = off. */
  readonly OPS_IP_ALLOWLIST?: string;

  // -- Contact intake (task 3.2, change first-impression-pass, design D8) ---

  /**
   * Salt for the contact intake's IP forensics hash — HMAC-SHA-256 over
   * the edge-asserted client IP before it ever touches storage. A
   * SECRET, never a wrangler var: set per environment with
   * `wrangler secret put CONTACT_IP_HASH_SALT`. The intake fails closed
   * (500, nothing stored) when it is absent: an unsalted IP hash would
   * violate the minimal-personal-data requirement, so misconfiguration
   * must be loud, not silent.
   */
  readonly CONTACT_IP_HASH_SALT?: string;
}

/** Hono environment: bindings + per-request variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by the request-ID middleware; stamped on every log line. */
    requestId: string;
    /** Set by the session-auth middleware (task 3.2) — server-derived identity. */
    user?: AuthenticatedAccount;
    /** Raw presented session token — for rotate/revoke handlers (task 2.2 parity). */
    sessionToken?: string;
  };
};
