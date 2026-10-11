/**
 * Event → group-order estimate handoff (change
 * seasonal-occasion-templates, task 3.1) — the payload contract for the
 * "Jaa kustannukset" action, in ONE module so both ends of the URL
 * handshake pin the same format.
 *
 * ACCOUNTING-ONLY BOUNDARY: the handoff carries item NAMES and
 * QUANTITIES only — never prices, never payment-adjacent fields, never
 * settlement semantics (spec: group-order-ledger "Estimate-derived
 * prefill intake"). The name is the canonical drink-type key, resolved
 * to a label at render time by the receiving surface, so the URL is
 * locale-stable and shareable across locales. Rows land in the
 * group-order create view as ordinary editable entries; they are a
 * client-side checklist and never cross the API (the group-order item
 * contract is productId-keyed — the estimate has no productIds).
 *
 * Mechanism: the handoff rides the URL as a single `items` parameter
 * (`/group-order?items=beer:24,wine_sparkling:2`), the same
 * visible-query-param handshake the calculator → trip prefill uses
 * (`/trip?product=&quantity=`). Six canonical keys cannot carry commas
 * or colons, so the `name:quantity,` encoding is unambiguous.
 *
 * @module EstimateHandoff
 */

import type { EventCalcResponse } from './event.types';

/** One handoff row — and the ONLY keys the handoff payload ever carries. */
export interface EventEstimateHandoffItem {
  /** Canonical drink-type key (an `EventDrinkType` value). */
  readonly name: string;
  /** Suggested container count for the line (integer ≥ 1). */
  readonly quantity: number;
}

/** The canonical drink-type keys the builder emits, in line order. */
export const ESTIMATE_HANDOFF_ITEM_NAMES: readonly string[] = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
];

/** Whether a handoff row name is a canonical drink-type key. */
export function isEstimateHandoffItemName(name: string): boolean {
  return ESTIMATE_HANDOFF_ITEM_NAMES.includes(name);
}

/**
 * The handoff rows for a completed estimate: one row per shopping-list
 * line with something to buy, names and quantities only. Lines without
 * a suggested purchase (totalUnits 0) carry nothing to share and are
 * dropped. Non-COMPUTED results (NO_PUBLISHED_NORMS) have no item list
 * — an empty handoff, so no action is offered.
 */
export function estimateHandoffItems(
  result: EventCalcResponse,
): readonly EventEstimateHandoffItem[] {
  if (result.status !== 'COMPUTED') return [];
  const rows: EventEstimateHandoffItem[] = [];
  for (const line of result.lines) {
    if (!Number.isInteger(line.totalUnits) || line.totalUnits < 1) continue;
    rows.push({ name: line.drinkType, quantity: line.totalUnits });
  }
  return rows;
}

/**
 * The serialized `items` parameter value for the handoff URL. Empty
 * string when there is nothing to share — the caller renders no action
 * for a completed estimate with no purchasable rows.
 */
export function serializeEstimateHandoffItems(
  items: readonly EventEstimateHandoffItem[],
): string {
  return items
    .map((item) => `${item.name}:${String(item.quantity)}`)
    .join(',');
}

/** Sanity window for one parsed quantity — rows are a client-side
 * checklist that never crosses the API, so this is wider than the
 * ledger's per-item 1..999: large events legitimately need more
 * containers than 999, and clamping would silently understate. */
const MAX_HANDOFF_QUANTITY = 999_999;

/** Row cap for a hand-carved URL (the sharedCosts cap precedent). */
const MAX_HANDOFF_ROWS = 50;

/**
 * Forgiving `?items=` parsing on the receiving side: absent, blank, and
 * malformed values yield an empty list — the standard empty creation
 * state, never an error surface (spec: invalid prefill degrades to the
 * empty state). A pair is valid when the name is 1–100 characters and
 * the quantity is a positive integer within the sanity window; invalid
 * pairs are dropped, valid ones survive, so a partially damaged URL
 * still prefills the intact rows.
 */
export function parseEstimateHandoffParam(
  raw: string | null | undefined,
): readonly EventEstimateHandoffItem[] {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return [];
  const rows: EventEstimateHandoffItem[] = [];
  for (const pair of trimmed.split(',')) {
    if (rows.length >= MAX_HANDOFF_ROWS) break;
    const separator = pair.lastIndexOf(':');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const quantity = pair.slice(separator + 1).trim();
    if (name.length === 0 || name.length > 100) continue;
    if (!/^\d+$/.test(quantity)) continue;
    const parsed = Number.parseInt(quantity, 10);
    if (parsed < 1 || parsed > MAX_HANDOFF_QUANTITY) continue;
    rows.push({ name, quantity: parsed });
  }
  return rows;
}
