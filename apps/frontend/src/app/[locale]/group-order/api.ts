/**
 * Group order API client (task 9.4, change product-roadmap-phases-1-4).
 *
 * Typed wiring for the endpoints committed in task 9.3
 * (apps/api-worker/src/routes/group-order.routes.ts + group-order-dto.ts —
 * the contract this module mirrors field-for-field):
 *
 *   POST /api/v1/group-orders                       session create (authenticated owner)
 *   POST /api/v1/group-orders/:shareToken/join      join by share link (no account)
 *   POST /api/v1/group-orders/:shareToken/items     add an item under a nickname
 *   POST /api/v1/group-orders/:shareToken/ledger    compute the ledger (stateless)
 *
 * Money crosses this boundary as integer euro cents only — the UI works
 * in euros and converts at the form edge (alerts threshold precedent).
 *
 * Error classification helpers drive the page's explained states: an
 * expired share token (410) and an unknown token (404) are lifecycle
 * states with dedicated calm copy, never raw errors; the accounting-only
 * payment-field rejection (400 naming the field) is surfaced verbatim so
 * the API's named-field error stays legible (spec: group-order-ledger).
 *
 * @module GroupOrderApi
 */

import { ApiFetchError, request } from '@/lib/api';

// ---------------------------------------------------------------------------
// Response types — mirrors of the API serialization (ISO timestamps, cents)
// ---------------------------------------------------------------------------

/** The session block every token-route response carries. */
export interface GroupOrderSessionJson {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** POST /api/v1/group-orders — 201. */
export interface CreateSessionResponse extends GroupOrderSessionJson {
  readonly shareToken: string;
}

/** One participant of the session — the nickname is the only identity. */
export interface GroupOrderParticipantJson {
  readonly nickname: string;
  readonly itemCount: number;
  readonly firstAddedAt: string;
  readonly lastAddedAt: string;
}

/** One item of the session. */
export interface GroupOrderItemJson {
  readonly id: string;
  readonly participantNickname: string;
  readonly productId: number;
  readonly quantity: number;
  readonly addedAt: string;
}

/** POST /api/v1/group-orders/:shareToken/join — the session state the share-link page shows. */
export interface JoinResponse {
  readonly session: GroupOrderSessionJson;
  readonly joinedAs: string;
  readonly participants: readonly GroupOrderParticipantJson[];
  readonly items: readonly GroupOrderItemJson[];
}

/** POST /api/v1/group-orders/:shareToken/items — 201. */
export type AddItemResponse = GroupOrderItemJson;

// ---------------------------------------------------------------------------
// Ledger response — mirrors the 9.2 module output (discriminated on status)
// ---------------------------------------------------------------------------

/** Per-item valuation echo; `unitValueCents: null` = no VERIFIED EUR offer — a stated gap. */
export interface ItemValuationJson {
  readonly productId: number;
  readonly quantity: number;
  readonly unitValueCents: number | null;
  readonly itemValueCents: number;
}

/** One who-owes-whom transfer in cents — an instruction, never a payment. */
export interface MinimalTransferJson {
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly cents: number;
}

/** One participant's ledger line under COMPUTED. */
export interface ParticipantLedgerJson {
  readonly participantId: string;
  readonly itemValueCents: number;
  readonly allocatedSharedCostCents: number;
  readonly frontedSharedCostCents: number;
  readonly totalOwedCents: number;
  readonly netBalanceCents: number;
}

/** One shared-cost line's allocation across participants. */
export interface SharedCostAllocationJson {
  readonly label: string;
  readonly sharedCostCents: number;
  readonly frontedByParticipantId: string;
  readonly perParticipant: readonly {
    readonly participantId: string;
    readonly itemValueCents: number;
    readonly exactShareNumeratorCents: number;
    readonly baseCents: number;
    readonly fractionalRemainderCents: number;
    readonly remainderCentsReceived: 0 | 1;
    readonly allocatedCents: number;
  }[];
}

/** The COMPUTED state: allocations, participant lines, minimal transfers. */
export interface ComputedLedgerJson {
  readonly status: 'COMPUTED';
  readonly totalItemValueCents: number;
  readonly totalSharedCostCents: number;
  readonly note: string;
  readonly sharedCosts: readonly SharedCostAllocationJson[];
  readonly participants: readonly ParticipantLedgerJson[];
  readonly transfers: readonly MinimalTransferJson[];
}

/** EMPTY_SESSION: no participants, no shared costs — no invented figures. */
export interface EmptySessionLedgerJson {
  readonly status: 'EMPTY_SESSION';
  readonly totalItemValueCents: number;
  readonly totalSharedCostCents: number;
  readonly note: string;
  readonly sharedCosts: readonly [];
  readonly participants: readonly [];
  readonly transfers: readonly [];
}

/** NO_ITEM_VALUE: shared costs exist but the value basis is zero — the gap is stated. */
export interface NoItemValueLedgerJson {
  readonly status: 'NO_ITEM_VALUE';
  readonly totalItemValueCents: number;
  readonly totalSharedCostCents: number;
  readonly note: string;
  readonly sharedCosts: readonly [];
  readonly participants: readonly {
    readonly participantId: string;
    readonly itemValueCents: number;
  }[];
  readonly transfers: readonly [];
}

export type LedgerResultJson =
  | ComputedLedgerJson
  | EmptySessionLedgerJson
  | NoItemValueLedgerJson;

/** POST /api/v1/group-orders/:shareToken/ledger — value-state passthrough. */
export interface LedgerResponse {
  readonly session: GroupOrderSessionJson;
  readonly valuationRule: string;
  readonly itemValuations: readonly ItemValuationJson[];
  readonly ledger: LedgerResultJson;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Create a session (authenticated owner; 7-day TTL is server-set). */
export function createGroupOrderSession(): Promise<CreateSessionResponse> {
  return request<CreateSessionResponse>('/api/v1/group-orders', {
    method: 'POST',
  });
}

/** Join by share link under a nickname (persists nothing — the response is the session state). */
export function joinGroupOrder(
  shareToken: string,
  nickname: string,
): Promise<JoinResponse> {
  return request<JoinResponse>(`/api/v1/group-orders/${shareToken}/join`, {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
}

/** Add an item under a nickname (the nickname must name a joined participant). */
export function addGroupOrderItem(
  shareToken: string,
  body: { nickname: string; productId: number; quantity: number },
): Promise<AddItemResponse> {
  return request<AddItemResponse>(`/api/v1/group-orders/${shareToken}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Compute the ledger for the staged shared costs (stateless). */
export function computeGroupOrderLedger(
  shareToken: string,
  sharedCosts: readonly {
    label: string;
    cents: number;
    frontedByParticipantId: string;
  }[],
): Promise<LedgerResponse> {
  return request<LedgerResponse>(
    `/api/v1/group-orders/${shareToken}/ledger`,
    {
      method: 'POST',
      body: JSON.stringify({ sharedCosts }),
    },
  );
}

// ---------------------------------------------------------------------------
// Error classification — the page's explained states
// ---------------------------------------------------------------------------

/**
 * Classify a token-scope failure into the page's lifecycle states.
 * Expired → 410 (the server-set exclusive expiry edge), unknown → 404
 * (the token either names a session or it does not). Everything else is
 * not a token lifecycle state.
 */
export function classifyTokenError(
  err: unknown,
): 'expired' | 'unknown' | null {
  if (err instanceof ApiFetchError && err.status === 410) return 'expired';
  if (err instanceof ApiFetchError && err.status === 404) return 'unknown';
  return null;
}

/**
 * The API's accounting-only rejection message: a 400 whose body names the
 * offending payment-instrument field (`field 'x.y' is not accepted`). The
 * page never sends such fields — this surfaces the API's named-field
 * error cleanly if one ever occurs, instead of a generic failure.
 */
export function paymentFieldRejection(err: unknown): string | null {
  if (
    err instanceof ApiFetchError &&
    err.status === 400 &&
    err.body !== null &&
    /field '.*' is not accepted/.test(err.body.message)
  ) {
    return err.body.message;
  }
  return null;
}
