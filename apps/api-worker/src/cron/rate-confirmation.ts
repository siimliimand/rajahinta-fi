/**
 * Rate-version confirmation hooks (task 5.1, change
 * trust-and-reach-roadmap; design D3/D5) — the ONE fire-and-forget seam
 * the confirmation action invokes. Both post-confirmation reactions
 * ride it:
 *
 * - TAX_CHANGE alert evaluation (task 4.1), scoped to the confirmed
 *   versions,
 * - blog draft creation (task 5.1), scoped to the same versions.
 *
 * Neither hook can block or fail the confirmation: each is individually
 * fail-open (its own wrapper catches and logs) and this aggregator adds
 * isolation between them (a throw from one cannot skip the other). The
 * rate-dataset-review cron only DETECTS changes — this module runs at
 * the human confirmation, wherever the operator action lands (the
 * /ops/console tax approve route today; a D1-backed confirmation store
 * later keeps calling this same function).
 *
 * @module RateConfirmationHooks
 */

import type { Env } from '../env';
import type { Logger } from '../logger';
import { enqueueTaxChangeAlertEvaluation } from './tax-change-alert-evaluation';
import { enqueueRateChangeBlogDrafts } from './blog-drafts';

/**
 * Fire both confirmation hooks without awaiting their outcomes. The
 * `waitUntil` keeps the Worker alive for the writes after the operator's
 * HTTP response is already on the wire; without an execution context
 * (unit tests) the promises simply run detached. `ctx` matches the
 * Workers global ExecutionContext's `waitUntil` face (cron/router.ts
 * precedent — the ambient workers-types global, not a module import).
 */
export function runRateConfirmationHooks(
  env: Env,
  log: Logger,
  ctx: { waitUntil(promise: Promise<unknown>): void } | null,
  confirmedVersions: readonly string[],
): void {
  const versions = [...confirmedVersions];
  ctx?.waitUntil(enqueueTaxChangeAlertEvaluation(env, log, versions));
  ctx?.waitUntil(enqueueRateChangeBlogDrafts(env, log, versions));
}
