/**
 * Empirical-margin composition (tasks 2.2/4.3, change
 * hedge-dedup-confidence-meter; design D3/D4/D6) — the display-only
 * `empiricalMargin` field attached to the calculator, basket, trip, and
 * event responses, and frozen into new share snapshots.
 *
 * The domain results stay pure: exactly like the `packing` section on
 * the basket response (and unlike `alkoBenchmark`, which is assembled
 * in-domain), the margin is resolved HERE, after the domain result
 * exists, from the persisted `outcome_margins` snapshot — the same
 * snapshot `GET /api/v1/accuracy/margins` serves. The resolution itself
 * is core-domain's {@link resolveEmpiricalMarginFromCells} (deepest
 * floored rung wins, quantile clamped across the path — no math here).
 *
 * The ladder query is join-honest, keyed the way the corpus attribution
 * keys its cells:
 *
 * - calculator: the result's `metadata.category` (the same
 *   product_master column the attribution read joins) plus the stored
 *   carrier of `metadata.transportOfferId` — the `tor.carrier` value
 *   the carrier cells were calibrated from, never the client echo;
 * - basket: no single product category (the result spans merchants and
 *   products); the carrier is the request's transport method through
 *   the domain's own normalization (D2). There is no carrier-only rung,
 *   so an unknown category leaves only the global rung reachable —
 *   the carrier still rides the query honestly;
 * - trip / event: a traveller fill has no carrier (the traveller IS
 *   the carrier) and an event list has no single category — only the
 *   global rung is reachable.
 *
 * Absence contract (the `travellerAlternative` precedent): an
 * unresolvable margin leaves the key ABSENT — render-nothing, never
 * null, never a placeholder. Old payloads without the field parse
 * exactly as before.
 *
 * @module EmpiricalMarginComposition
 */

import type { EmpiricalMargin, MarginLadderQuery } from '../../../../packages/core-domain/src/outcomes/margin-calibration.types';
import { resolveEmpiricalMarginFromCells } from '../../../../packages/core-domain/src/outcomes/margin-calibration';
import { normalizeCarrierId } from '../../../../packages/core-domain/src/transport/transport-estimation.service';
import {
  D1OutcomeMarginRepository,
  marginRowToEmpiricalMargin,
} from '../../../../packages/data-platform/src/repositories/d1/outcome-margin.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/**
 * The response-face margin — the resolved {@link EmpiricalMargin} with
 * `asOf` on the wire (ISO-8601). The sample count and as-of MUST be
 * rendered beside the quantile wherever the frontend shows it (design
 * D3); they are part of the field so no client can drop them.
 */
export interface EmpiricalMarginView {
  readonly quantile: number;
  readonly sampleCount: number;
  readonly cell: { readonly dimension: string; readonly key: string };
  readonly asOf: string;
}

/** A response body carrying the optional display-only field. */
export type WithEmpiricalMargin<T> = T & {
  readonly empiricalMargin?: EmpiricalMarginView;
};

/**
 * The persisted ladder — one small read of the `outcome_margins`
 * snapshot, verbatim in the cron's write order (deepest rung first,
 * keys ascending). An empty store yields an empty ladder and every
 * composition then resolves null (the honest degrade; the cron persists
 * no rows when the outcome corpus is empty or under the floor).
 */
export async function readEmpiricalMarginLadder(
  d1: D1DatabaseLike,
): Promise<EmpiricalMargin[]> {
  const rows = await new D1OutcomeMarginRepository(d1).findMargins();
  return rows.map(marginRowToEmpiricalMargin);
}

/**
 * The stored carrier of one transport offer — the value the corpus
 * attribution joins as `tor.carrier` (outcome-margin.repository), so
 * the query keys the same cells the calibration did. A null offer id
 * (no matched transport) or a pruned offer row resolves to null, and
 * the ladder path simply cannot enter the rungs that need it.
 */
export async function resolveStoredCarrierById(
  d1: D1DatabaseLike,
  transportOfferId: number | null,
): Promise<string | null> {
  if (transportOfferId === null) {
    return null;
  }
  const row = await d1
    .prepare(`SELECT carrier FROM transport_offers WHERE id = ?`)
    .bind(transportOfferId)
    .first<{ carrier: string }>();
  return row === null ? null : row.carrier;
}

/**
 * Normalize a request-echoed transport method the way the estimation
 * path does (D2) before it keys a ladder lookup — stored cell keys are
 * the normalized lowercase carrier ids.
 */
export function normalizedTransportMethod(
  transportMethod: string | undefined,
): string | null {
  return transportMethod === undefined ? null : normalizeCarrierId(transportMethod);
}

/**
 * Attach the display-only `empiricalMargin` to a response body — the
 * resolved margin for `query`, or the body unchanged (key absent) when
 * the ladder offers none. Strictly additive display enrichment: the
 * callers run it AFTER the idempotency store and content hash (the
 * basket `packing` precedent), so a cached payload keeps identifying
 * the optimization and every monetary figure is the domain result
 * verbatim.
 */
export function withEmpiricalMargin<T extends object>(
  body: T,
  ladder: readonly EmpiricalMargin[],
  query: MarginLadderQuery,
): WithEmpiricalMargin<T> {
  const margin = resolveEmpiricalMarginView(ladder, query);
  if (margin === null) {
    return body;
  }
  return { ...body, empiricalMargin: margin };
}

/**
 * The resolved wire-face margin for `query`, or null when no ladder
 * rung qualifies — the one place the domain {@link EmpiricalMargin}
 * (as-of as Date) becomes the wire view (as-of as ISO string). Shared
 * by the read-time response attachment ({@link withEmpiricalMargin})
 * and the share-snapshot FREEZE side (design D6: the snapshot carries
 * the same view the result routes render, resolved at freeze time — a
 * snapshot is immutable, so the figure must be frozen, not recomposed
 * per read).
 */
export function resolveEmpiricalMarginView(
  ladder: readonly EmpiricalMargin[],
  query: MarginLadderQuery,
): EmpiricalMarginView | null {
  const margin = resolveEmpiricalMarginFromCells(ladder, query);
  if (margin === null) {
    return null;
  }
  return {
    quantile: margin.quantile,
    sampleCount: margin.sampleCount,
    cell: margin.cell,
    asOf: margin.asOf.toISOString(),
  };
}
