/**
 * Group order ledger types — proportional shared-cost allocation and
 * minimal-transfer settlement (spec: group-order-ledger, design R12,
 * task 9.2).
 *
 * The module is pure: item VALUES are INPUTS. The 9.1 schema deliberately
 * stores no values (R12 data minimization), so the caller (task 9.3's API
 * layer) resolves each item's value from product/offer data and maps it
 * in; this module resolves nothing itself and never imports data-platform,
 * a repository, NestJS, or any I/O type (the tripcalc allowances-in and
 * whatif rule-data-in precedents).
 *
 * ACCOUNTING-ONLY BOUNDARY (spec, design R12): this module computes
 * NUMBERS — who owes whom and how many cents — never payments. There are
 * no payment-instrument types, no payment-processing imports, and no
 * execution of any transfer. The "fronted by" figure on a shared-cost
 * line records which participant already laid out the money for the
 * group; it is bookkeeping provenance for the balance derivation, not a
 * payment field, and the schema (9.1) deliberately persists nothing of
 * the kind. The result carries a structural note stating that settlement
 * happens outside Rajahinta through participants' own methods (spec:
 * boundary stated) — see {@link GROUP_ORDER_DISCLAIMER_EN}.
 *
 * UNITS (documented decision): all money is integer euro cents; item
 * values are integer euro cents. Every division is exact integer
 * arithmetic (truncating division + remainder comparison, never a float
 * round — the tripcalc `roundHalfUpDiv` discipline), so no figure can
 * float-drift.
 *
 * ALLOCATION RULE (documented decision, design R12): each shared-cost
 * line (shipping, packaging duty, …) is split independently,
 * proportionally to each participant's item value share. The exact share
 * of participant i in a line of C cents is `C · v_i / V` where `v_i` is
 * their item value total and `V` the session total; the floored base
 * `⌊C · v_i / V⌋` leaves a remainder pool of fewer cents than there are
 * participants. The REMAINDER RULE: the largest fractional remainder
 * receives the cent (one cent per participant, pool exhausted in
 * remainder-descending order). Ties on fractional remainder are broken
 * deterministically by participant input order ascending (earlier input
 * position wins) — pinned by tests. Both rules are stated on every
 * allocation line: `baseCents`, `fractionalRemainderCents` (over the
 * echoed `totalItemValueCents` denominator), `remainderCentsReceived`,
 * and `exactShareNumeratorCents` (= `sharedCostCents · itemValueCents`)
 * make every cent reconstructible and auditable.
 *
 * BALANCE MODEL (documented decision): each shared-cost line names the
 * participant who fronted it (`frontedByParticipantId`). A participant's
 * balance is `fronted − allocated`: fronting credits them, their
 * allocation debits them. The sum of balances is always zero (money is
 * moved between participants, never created), which is what makes a
 * who-owes-whom settlement well-defined. Item values themselves produce
 * no balances — they are only the share basis (participants are assumed
 * to settle their own item costs as the caller resolves them; the ledger
 * only settles the SHARED costs).
 *
 * SETTLEMENT (documented decision): the transfer set is computed by the
 * standard greedy max-debtor/max-creditor algorithm — repeatedly match
 * the participant with the most negative balance against the one with
 * the most positive balance, transfer the smaller magnitude, zero out
 * whichever side hits zero. Ties on both sides are broken by participant
 * input order ascending (first in input order wins) — pinned by tests.
 * This yields at most n−1 transfers and skips zero-balance participants
 * entirely. `settleBalances` validates that balances sum to exactly zero:
 * a non-zero-sum set is a caller-contract violation, never silently
 * settled.
 *
 * RESULT STATES (documented decision, value-state precedent): expected
 * lifecycle states are result VALUES, not errors. `EMPTY_SESSION` — a
 * session with no participants and no shared costs (computed right after
 * creation, before anyone joins; the eventcalc zero-guest precedent).
 * `NO_ITEM_VALUE` — participants exist and shared costs exist, but the
 * total item value is zero, so a proportional basis does not exist;
 * no allocation and no transfers are stated because moving money
 * without a value-share basis would invent exactly the numbers this
 * module must not invent (tripcalc NO_BREAK_EVEN precedent). All-zero
 * totals (no shared costs at all, or zero-cost lines) remain `COMPUTED`
 * with exact zero allocations. Structural errors (malformed ids,
 * negative or non-integer cents, an unknown fronting participant,
 * overflow) are caller-contract violations and throw
 * {@link InvalidGroupOrderInputError}; values are never clamped or
 * silently substituted.
 *
 * @module GroupOrderTypes
 */

import type { Disclaimer } from '../calculator/calculator.types';

// ---------------------------------------------------------------------------
// Inputs — item values are resolved by the caller, never queried here
// ---------------------------------------------------------------------------

/**
 * One participant of the session. `id` is the session-scoped participant
 * identifier (the 9.1 nickname is resolved to it by the caller); it is
 * the only identity this module sees — no account ids, no personal data
 * (spec: sessions carry no personal data beyond nicknames).
 */
export interface GroupOrderParticipantInput {
  readonly id: string;
  /**
   * The values of the participant's items, in integer euro cents each,
   * resolved by the caller (9.3) from product/offer data — the 9.1
   * schema deliberately stores no values (R12). An empty list is a real
   * state (joined, added nothing): share basis zero, no allocation.
   */
  readonly itemValueCents: readonly number[];
}

/**
 * One shared cost to distribute — e.g. shipping or packaging duty.
 * `label` is a free-form accounting label echoed on the result;
 * `frontedByParticipantId` names the participant who laid out the money
 * (bookkeeping provenance for the balance derivation — see module docs;
 * accounting only, never a payment instruction).
 */
export interface GroupOrderSharedCostLineInput {
  readonly label: string;
  /** Total cost of the line in integer euro cents (≥ 0). */
  readonly cents: number;
  readonly frontedByParticipantId: string;
}

/** Group order ledger input — participants and the shared costs to split. */
export interface GroupOrderLedgerInput {
  readonly participants: readonly GroupOrderParticipantInput[];
  /**
   * The shared-cost lines to distribute. An empty list is a real state:
   * the ledger computes before a shipping cost is known — every
   * allocation is exactly zero and no transfers exist.
   */
  readonly sharedCostCents: readonly GroupOrderSharedCostLineInput[];
}

// ---------------------------------------------------------------------------
// Allocation result — per-line, per-participant, every cent auditable
// ---------------------------------------------------------------------------

/**
 * One participant's slice of one shared-cost line. Figures satisfy the
 * audit identity `allocatedCents === baseCents + remainderCentsReceived`
 * with `baseCents = (exactShareNumeratorCents − fractionalRemainderCents)
 * ÷ totalItemValueCents` (exact integer division), and
 * `fractionalRemainderCents ÷ totalItemValueCents` is the fractional
 * cent the remainder rule ranks by.
 */
export interface GroupOrderPerParticipantAllocation {
  readonly participantId: string;
  /** The participant's item value total — the share basis numerator input. */
  readonly itemValueCents: number;
  /** `sharedCostCents · itemValueCents`, exact and overflow-guarded. */
  readonly exactShareNumeratorCents: number;
  /** `⌊exactShareNumeratorCents ÷ totalItemValueCents⌋`, exact integer floor. */
  readonly baseCents: number;
  /** `exactShareNumeratorCents mod totalItemValueCents` — the ranked remainder. */
  readonly fractionalRemainderCents: number;
  /** 1 when the remainder rule granted this participant the cent, else 0. */
  readonly remainderCentsReceived: 0 | 1;
  /** `baseCents + remainderCentsReceived` — what the participant owes of the line. */
  readonly allocatedCents: number;
}

/** One shared-cost line's allocation across all participants (input order). */
export interface GroupOrderSharedCostAllocation {
  readonly label: string;
  readonly sharedCostCents: number;
  readonly frontedByParticipantId: string;
  readonly perParticipant: readonly GroupOrderPerParticipantAllocation[];
}

/**
 * A participant's full ledger line under `COMPUTED`: what they owe of
 * the shared costs, what they fronted, and the resulting balance.
 * `totalOwedCents = itemValueCents + allocatedSharedCostCents` (their
 * whole accounting position in the order); `netBalanceCents =
 * frontedSharedCostCents − allocatedSharedCostCents` (positive: the
 * group owes them; negative: they owe the group).
 */
export interface GroupOrderParticipantLedger {
  readonly participantId: string;
  readonly itemValueCents: number;
  readonly allocatedSharedCostCents: number;
  readonly frontedSharedCostCents: number;
  readonly totalOwedCents: number;
  readonly netBalanceCents: number;
}

/**
 * One who-owes-whom transfer in cents. An instruction about amounts
 * between participants — the transfer itself happens outside Rajahinta
 * through the participants' own methods (structural note on the result).
 */
export interface MinimalTransfer {
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly cents: number;
}

/** A participant's settled balance for direct settlement computation. */
export interface ParticipantBalance {
  readonly participantId: string;
  /** Positive: the group owes them; negative: they owe the group; zero: settled. */
  readonly netCents: number;
}

// ---------------------------------------------------------------------------
// Result — a discriminated union so the no-basis state carries no invented
// figures (tripcalc NO_BREAK_EVEN / eventcalc NO_PUBLISHED_NORMS precedent)
// ---------------------------------------------------------------------------

/** Common result fields — totals echo the inputs for traceability. */
interface GroupOrderLedgerBase {
  readonly status: GroupOrderLedgerStatus;
  /** Σ of all participants' item values — the allocation denominator V. */
  readonly totalItemValueCents: number;
  /** Σ of all shared-cost line cents. */
  readonly totalSharedCostCents: number;
  /**
   * Structural settlement-boundary note — travels with every rendering
   * or share (spec: boundary stated). Not a UI-only string.
   */
  readonly note: Disclaimer;
}

/** The computed ledger: allocations, participant lines, minimal transfers. */
export interface GroupOrderComputedLedger extends GroupOrderLedgerBase {
  readonly status: 'COMPUTED';
  readonly sharedCosts: readonly GroupOrderSharedCostAllocation[];
  /** Participant ledger lines in input order — deterministic, tie-break basis. */
  readonly participants: readonly GroupOrderParticipantLedger[];
  /** The minimal who-owes-whom transfer set; empty when all balances are zero. */
  readonly transfers: readonly MinimalTransfer[];
}

/** A session with no participants and no shared costs — nothing to ledger. */
export interface GroupOrderEmptySessionLedger extends GroupOrderLedgerBase {
  readonly status: 'EMPTY_SESSION';
  readonly sharedCosts: readonly [];
  readonly participants: readonly [];
  readonly transfers: readonly [];
}

/**
 * Shared costs exist but the total item value is zero, so no proportional
 * basis exists. Participant lines carry only the (zero) basis — no
 * allocation and no balance figures, and no transfers: the module states
 * the gap instead of inventing numbers (module docs, NO_ITEM_VALUE).
 */
export interface GroupOrderNoItemValueLedger extends GroupOrderLedgerBase {
  readonly status: 'NO_ITEM_VALUE';
  readonly sharedCosts: readonly [];
  readonly participants: readonly {
    readonly participantId: string;
    readonly itemValueCents: number;
  }[];
  readonly transfers: readonly [];
}

/** All ledger result states. */
export type GroupOrderLedgerResult =
  | GroupOrderComputedLedger
  | GroupOrderEmptySessionLedger
  | GroupOrderNoItemValueLedger;

/**
 * Result status vocabulary — typed for parity with the other core-domain
 * calculators; the union members above are the canonical carriers.
 */
export type GroupOrderLedgerStatus = 'COMPUTED' | 'EMPTY_SESSION' | 'NO_ITEM_VALUE';

// ---------------------------------------------------------------------------
// Errors — caller-contract violations only. Expected lifecycle states are
// result values above, never these.
// ---------------------------------------------------------------------------

/** Why a group order ledger input was rejected. */
export type GroupOrderInputErrorReason =
  | 'SHARED_COST_WITHOUT_PARTICIPANTS'
  | 'INVALID_PARTICIPANT_ID'
  | 'DUPLICATE_PARTICIPANT_ID'
  | 'INVALID_ITEM_VALUE'
  | 'ITEM_VALUE_OVERFLOW'
  | 'INVALID_SHARED_COST_LABEL'
  | 'INVALID_SHARED_COST_CENTS'
  | 'SHARED_COST_OVERFLOW'
  | 'UNKNOWN_FRONTING_PARTICIPANT'
  | 'SHARE_NUMERATOR_OVERFLOW'
  | 'INVALID_BALANCE_ID'
  | 'DUPLICATE_BALANCE_ID'
  | 'INVALID_NET_BALANCE'
  | 'BALANCES_NOT_ZERO_SUM';

/**
 * Structurally invalid group order input: a shared cost with no
 * participants to attribute it to, a malformed or duplicate participant
 * id, a negative/non-integer/overflowing money figure, an unknown
 * fronting participant, or a balance set that does not sum to exactly
 * zero. A validating API layer (task 9.3's zod bounds) should prevent
 * these from ever reaching the module; values are never clamped or
 * silently substituted.
 */
export class InvalidGroupOrderInputError extends Error {
  readonly reason: GroupOrderInputErrorReason;

  constructor(reason: GroupOrderInputErrorReason, detail: string) {
    super(`invalid group order ledger input (${reason}): ${detail}`);
    this.name = 'InvalidGroupOrderInputError';
    this.reason = reason;
  }
}
