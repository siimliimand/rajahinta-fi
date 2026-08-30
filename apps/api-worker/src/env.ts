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
  /** Override for the ECB reference-rate source URL (FX review cron). */
  readonly FX_RATE_SOURCE_URL?: string;
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
   * Email Worker base URL (per-env wrangler var, design D9) — the
   * freshness-alert cron POSTs to its internal send contract
   * (`POST /internal/email/send`, apps/email-worker, task 5.3).
   */
  readonly EMAIL_WORKER_URL?: string;
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
   * Suppression window in seconds — repeats of an already-alerted
   * violation within the window are not re-emailed (IdempotencyDO
   * marker). Default 4 h when unset (Alertmanager repeat_interval
   * parity); invalid values fall back to the default with a warning.
   */
  readonly FRESHNESS_ALERT_SUPPRESSION_SECONDS?: string;

  // -- Feature flags (task 3.2; names match the Nest FeatureFlagService,
  //    read from the Worker env instead of process.env) ---------------------

  /** Gate new merchant data sources (scrapers, APIs, partner feeds). */
  readonly FF_NEW_MERCHANT_SOURCE?: string;
  /** Gate new tax rule versions before legal confirmation. */
  readonly FF_NEW_TAX_RULESET?: string;
  /** Gate new UI ranking/sorting behavior. */
  readonly FF_UI_RANKING_V2?: string;
  /** Gate historical price intelligence (price-history API + UI charts). */
  readonly FF_HISTORICAL_PRICE_INTELLIGENCE?: string;
  /** Gate basket optimization API and UI. */
  readonly FF_BASKET_OPTIMIZATION?: string;
  /** Gate advanced Phase 2 surfaces (scenario, report, reliability, guidance). */
  readonly FF_ADVANCED_FEATURES?: string;
  /** Gate the operator console at /ops/console/** (default off; new UI ships flag-off). */
  readonly FF_OPERATOR_CONSOLE?: string;
  /** Explicit rollout-percentage override per flag (`FF_ROLLOUT_<FLAG>`). */
  readonly FF_ROLLOUT_NEW_MERCHANT_SOURCE?: string;
  readonly FF_ROLLOUT_NEW_TAX_RULESET?: string;
  readonly FF_ROLLOUT_UI_RANKING_V2?: string;
  readonly FF_ROLLOUT_HISTORICAL_PRICE_INTELLIGENCE?: string;
  readonly FF_ROLLOUT_BASKET_OPTIMIZATION?: string;
  readonly FF_ROLLOUT_ADVANCED_FEATURES?: string;
  readonly FF_ROLLOUT_OPERATOR_CONSOLE?: string;

  // -- Launch gates (task 3.2; names match the Nest LaunchGateService) ------

  /** Legal opinion on calculator accuracy confirmed. */
  readonly LAUNCH_GATE_LEGAL_OPINION?: string;
  /** Tax-source mapping (excise rates, container duty) validated. */
  readonly LAUNCH_GATE_TAX_SOURCE_MAPPING?: string;
  /** User-facing correction mechanism in place and tested. */
  readonly LAUNCH_GATE_CORRECTION_MECHANISM?: string;
  /** Forces ALL gates open for dev/demo environments. */
  readonly LAUNCH_GATES_OVERRIDE?: string;

  // -- Ops access (task 3.2; names match the Nest OpsAccessGuard) -----------

  /** Operator bearer token (Authorization: Bearer …); null/absent = off. */
  readonly OPS_BEARER_TOKEN?: string;
  /** Comma-separated IPs / IPv4 CIDRs allowed to reach ops routes; absent = off. */
  readonly OPS_IP_ALLOWLIST?: string;
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
