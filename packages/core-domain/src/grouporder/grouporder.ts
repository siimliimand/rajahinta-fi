/**
 * Group order ledger — proportional shared-cost allocation and
 * minimal-transfer settlement (spec: group-order-ledger, design R12,
 * task 9.2).
 *
 * Pure functions only: no I/O, no clock, no randomness, no framework
 * imports. Item VALUES are inputs — the caller (task 9.3's API layer)
 * resolves them from product/offer data because the 9.1 schema
 * deliberately stores no values (R12); this module never imports
 * data-platform (tripcalc/whatif data-in precedents).
 *
 * ACCOUNTING-ONLY BOUNDARY (spec, design R12): this module computes
 * who owes whom how many cents — it never moves money, and it contains
 * no payment-instrument types and no payment-processing imports. The
 * fronted-by figure on a shared-cost line is bookkeeping provenance for
 * the balance derivation, not a payment field. Every result carries the
 * structural note that settlement happens outside Rajahinta through the
 * participants' own methods.
 *
 * ALLOCATION (documented decision): each shared-cost line is split
 * independently, proportionally to item value share, in exact integer
 * arithmetic — the floored base is `(numerator − numerator mod V) / V`
 * (never a float floor), which leaves a remainder pool strictly smaller
 * than the participant count. REMAINDER RULE: the largest fractional
 * remainder receives the cent; TIES break by participant input order
 * ascending (earlier input position wins). Both rules are pinned by
 * tests and every allocation line echoes its basis
 * (`exactShareNumeratorCents` over the echoed `totalItemValueCents`) so
 * any cent is auditable (project guardrail: every figure traceable).
 *
 * BALANCES AND SETTLEMENT (documented decision): a participant's balance
 * is `fronted − allocated` across all lines — fronting a line credits
 * the participant, their allocation debits them; balances always sum to
 * zero. The transfer set is the standard greedy max-debtor/max-creditor
 * settlement: repeatedly transfer from the most negative balance to the
 * most positive, zeroing whichever side is exhausted; TIES on both sides
 * break by participant input order ascending. At most n−1 transfers;
 * zero-balance participants never appear. Same input, same transfers
 * (spec: same input SHALL always yield the same transfers).
 *
 * VALIDATION PRECEDENCE (documented, deterministic): the empty-session
 * state first (no participants: no shared costs → EMPTY_SESSION value
 * state; shared costs present → error, since a cost with nobody to
 * attribute it to is unrepresentable), then participant rows in input
 * order (id, duplicates, item values, sums), then shared-cost lines in
 * input order (label, cents, fronting reference, total). The first
 * violation wins and throws {@link InvalidGroupOrderInputError}; values
 * are never clamped or ignored. Money figures must be safe integers and
 * every sum and product is overflow-guarded — the exactness contract
 * that keeps all arithmetic pure integer math. A zero total item value
 * with positive shared costs is NOT an error but the explicit
 * `NO_ITEM_VALUE` value state: no proportional basis exists, so no
 * allocation and no transfers are stated (module docs in
 * grouporder.types.ts).
 *
 * @module GroupOrder
 */

import { InvalidGroupOrderInputError } from './grouporder.types';
import type {
  GroupOrderInputErrorReason,
  GroupOrderLedgerInput,
  GroupOrderLedgerResult,
  GroupOrderParticipantInput,
  GroupOrderParticipantLedger,
  GroupOrderPerParticipantAllocation,
  GroupOrderSharedCostAllocation,
  GroupOrderSharedCostLineInput,
  MinimalTransfer,
  ParticipantBalance,
} from './grouporder.types';
import { GROUP_ORDER_DISCLAIMER_EN } from './grouporder.disclaimer';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Split every shared-cost line proportionally to item value share and
 * compute the minimal who-owes-whom transfer set. Deterministic: same
 * input, byte-identical result — participant lines keep input order, and
 * both remainder and settlement ties resolve by that same input order.
 */
export function calculateGroupOrderLedger(input: GroupOrderLedgerInput): GroupOrderLedgerResult {
  // Precedence step 1: the empty-session state (module docs).
  if (input.participants.length === 0) {
    if (input.sharedCostCents.length > 0) {
      throw new InvalidGroupOrderInputError(
        'SHARED_COST_WITHOUT_PARTICIPANTS',
        `${String(input.sharedCostCents.length)} shared-cost line(s) cannot be attributed: the session has no participants`,
      );
    }
    return {
      status: 'EMPTY_SESSION',
      totalItemValueCents: 0,
      totalSharedCostCents: 0,
      sharedCosts: [],
      participants: [],
      transfers: [],
      note: GROUP_ORDER_DISCLAIMER_EN,
    };
  }

  // Precedence step 2: participant rows, in input order.
  const { ids, values } = validateParticipants(input.participants);
  const totalItemValueCents = values.reduce((sum, value) => addSafe(sum, value, 'ITEM_VALUE_OVERFLOW'), 0);

  // Precedence step 3: shared-cost lines, in input order.
  const totalSharedCostCents = input.sharedCostCents.reduce(
    (sum, line) => addSafe(sum, validateSharedCostLine(line, ids).cents, 'SHARED_COST_OVERFLOW'),
    0,
  );

  // State selection: a proportional basis must exist to allocate.
  if (totalItemValueCents === 0 && totalSharedCostCents > 0) {
    return {
      status: 'NO_ITEM_VALUE',
      totalItemValueCents,
      totalSharedCostCents,
      sharedCosts: [],
      participants: ids.map((participantId, index) => ({
        participantId,
        itemValueCents: values[index],
      })),
      transfers: [],
      note: GROUP_ORDER_DISCLAIMER_EN,
    };
  }

  // COMPUTED: per-line allocations, then balances fronted − allocated.
  const allocated: number[] = ids.map(() => 0);
  const fronted: number[] = ids.map(() => 0);

  const sharedCosts: GroupOrderSharedCostAllocation[] = input.sharedCostCents.map((line) => {
    const perParticipant = allocateSharedCostLine(line, ids, values, totalItemValueCents);
    for (const slice of perParticipant) {
      allocated[ids.indexOf(slice.participantId)] += slice.allocatedCents;
    }
    fronted[ids.indexOf(line.frontedByParticipantId)] += line.cents;
    return {
      label: line.label,
      sharedCostCents: line.cents,
      frontedByParticipantId: line.frontedByParticipantId,
      perParticipant,
    };
  });

  const participants: GroupOrderParticipantLedger[] = ids.map((participantId, index) => {
    const itemValueCents = values[index];
    const allocatedSharedCostCents = allocated[index];
    const frontedSharedCostCents = fronted[index];
    return {
      participantId,
      itemValueCents,
      allocatedSharedCostCents,
      frontedSharedCostCents,
      totalOwedCents: itemValueCents + allocatedSharedCostCents,
      netBalanceCents: frontedSharedCostCents - allocatedSharedCostCents,
    };
  });

  return {
    status: 'COMPUTED',
    totalItemValueCents,
    totalSharedCostCents,
    sharedCosts,
    participants,
    transfers: settleBalances(
      participants.map((line) => ({ participantId: line.participantId, netCents: line.netBalanceCents })),
    ),
    note: GROUP_ORDER_DISCLAIMER_EN,
  };
}

// ---------------------------------------------------------------------------
// Minimal-transfer settlement — greedy max-debtor/max-creditor
// ---------------------------------------------------------------------------

/**
 * Compute the minimal-transfer set that settles a zero-sum balance list,
 * via the standard greedy max-debtor/max-creditor algorithm (module
 * docs). Deterministic: ties on both sides resolve by input order (first
 * in, matched first) because the scans keep only strictly better
 * candidates; zero balances are never selected, so settled participants
 * produce no transfers. Throws {@link InvalidGroupOrderInputError} when
 * balances do not sum to exactly zero — money cannot be settled into or
 * out of existence.
 */
export function settleBalances(balances: readonly ParticipantBalance[]): readonly MinimalTransfer[] {
  const remaining = balances.map((balance) => {
    if (typeof balance.participantId !== 'string' || balance.participantId.trim() === '') {
      throw new InvalidGroupOrderInputError(
        'INVALID_BALANCE_ID',
        `participant id must be a non-empty string, got ${String(balance.participantId)}`,
      );
    }
    if (!Number.isSafeInteger(balance.netCents)) {
      throw new InvalidGroupOrderInputError(
        'INVALID_NET_BALANCE',
        `netCents for "${balance.participantId}" must be an integer, got ${String(balance.netCents)}`,
      );
    }
    return { id: balance.participantId, net: balance.netCents };
  });

  const seen = new Set<string>();
  let sum = 0;
  for (const entry of remaining) {
    if (seen.has(entry.id)) {
      throw new InvalidGroupOrderInputError(
        'DUPLICATE_BALANCE_ID',
        `participant id "${entry.id}" appears more than once in the balance list`,
      );
    }
    seen.add(entry.id);
    sum = addSafe(sum, entry.net, 'BALANCES_NOT_ZERO_SUM');
  }
  if (sum !== 0) {
    throw new InvalidGroupOrderInputError(
      'BALANCES_NOT_ZERO_SUM',
      `balances sum to ${String(sum)} cents, not zero — a zero-sum balance set is required for settlement`,
    );
  }

  const transfers: MinimalTransfer[] = [];
  for (;;) {
    // Scans run in input order and replace only on strict improvement,
    // so equal candidates keep the earliest input position (tie rule).
    let debtor = -1;
    let creditor = -1;
    for (let index = 0; index < remaining.length; index++) {
      const entry = remaining[index];
      if (entry.net < 0 && (debtor === -1 || entry.net < remaining[debtor].net)) debtor = index;
      if (entry.net > 0 && (creditor === -1 || entry.net > remaining[creditor].net)) creditor = index;
    }
    if (debtor === -1) {
      break; // no debtor ⇔ no creditor (sum is zero): fully settled
    }
    const cents = Math.min(-remaining[debtor].net, remaining[creditor].net);
    transfers.push({
      fromParticipantId: remaining[debtor].id,
      toParticipantId: remaining[creditor].id,
      cents,
    });
    remaining[debtor].net += cents;
    remaining[creditor].net -= cents;
  }
  return transfers;
}

// ---------------------------------------------------------------------------
// Per-line proportional allocation — exact integer arithmetic
// ---------------------------------------------------------------------------

/**
 * Split one shared-cost line across participants by item value share,
 * applying the remainder rule (largest fractional remainder receives the
 * cent; ties by input position — see the sort comparator). `ids` and
 * `values` are indexed by participant input position; the result
 * preserves that order.
 */
function allocateSharedCostLine(
  line: GroupOrderSharedCostLineInput,
  ids: readonly string[],
  values: readonly number[],
  totalValueCents: number,
): GroupOrderPerParticipantAllocation[] {
  // Zero total basis is reachable here only when the line itself is
  // zero-cost (a positive total with a zero basis is the NO_ITEM_VALUE
  // state, returned before this function runs). Zero shares are then
  // exact — modulo-by-zero would produce NaN, so state it instead.
  if (totalValueCents === 0) {
    return ids.map((participantId, index) => ({
      participantId,
      itemValueCents: values[index],
      exactShareNumeratorCents: 0,
      baseCents: 0,
      fractionalRemainderCents: 0,
      remainderCentsReceived: 0 as const,
      allocatedCents: 0,
    }));
  }

  const numerators = values.map((value) => {
    const numerator = line.cents * value;
    if (!Number.isSafeInteger(numerator)) {
      throw new InvalidGroupOrderInputError(
        'SHARE_NUMERATOR_OVERFLOW',
        `sharedCostCents × itemValueCents (${String(line.cents)} × ${String(value)}) exceeds the safe-integer range on line "${line.label}"`,
      );
    }
    return numerator;
  });

  // Exact integer floor: `%` is exact for safe integers, the subtraction
  // stays in range, and the division is then exact — no float floor.
  const bases = numerators.map((numerator) => (numerator - (numerator % totalValueCents)) / totalValueCents);
  const remainders = numerators.map((numerator) => numerator % totalValueCents);

  let flooredTotal = 0;
  for (const base of bases) {
    flooredTotal += base;
  }
  const remainderPool = line.cents - flooredTotal;

  // Remainder rule: remainder descending, ties by input position
  // ascending. The explicit index comparison pins the tie even though
  // Array.prototype.sort is stable (belt and braces, tested).
  const byLargestRemainder = remainders
    .map((_, index) => index)
    .sort((a, b) => (remainders[b] - remainders[a]) || (a - b));

  const remainderRecipients = new Set(byLargestRemainder.slice(0, remainderPool));

  return bases.map((base, index) => {
    const received: 0 | 1 = remainderRecipients.has(index) ? 1 : 0;
    return {
      participantId: ids[index],
      itemValueCents: values[index],
      exactShareNumeratorCents: numerators[index],
      baseCents: base,
      fractionalRemainderCents: remainders[index],
      remainderCentsReceived: received,
      allocatedCents: base + received,
    };
  });
}

// ---------------------------------------------------------------------------
// Validation — first violation wins
// ---------------------------------------------------------------------------

/** Validated participant data: ids (input order) and per-participant value sums. */
interface ValidatedParticipants {
  readonly ids: string[];
  readonly values: number[];
}

function validateParticipants(participants: readonly GroupOrderParticipantInput[]): ValidatedParticipants {
  const ids: string[] = [];
  const values: number[] = [];
  const seen = new Set<string>();
  for (const participant of participants) {
    if (typeof participant.id !== 'string' || participant.id.trim() === '') {
      throw new InvalidGroupOrderInputError(
        'INVALID_PARTICIPANT_ID',
        `participant id must be a non-empty string, got ${String(participant.id)}`,
      );
    }
    if (seen.has(participant.id)) {
      throw new InvalidGroupOrderInputError(
        'DUPLICATE_PARTICIPANT_ID',
        `participant id "${participant.id}" appears more than once`,
      );
    }
    seen.add(participant.id);
    let sum = 0;
    for (const value of participant.itemValueCents) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new InvalidGroupOrderInputError(
          'INVALID_ITEM_VALUE',
          `itemValueCents for "${participant.id}" must be a non-negative integer, got ${String(value)}`,
        );
      }
      sum = addSafe(sum, value, 'ITEM_VALUE_OVERFLOW');
    }
    ids.push(participant.id);
    values.push(sum);
  }
  return { ids, values };
}

function validateSharedCostLine(
  line: GroupOrderSharedCostLineInput,
  participantIds: readonly string[],
): GroupOrderSharedCostLineInput {
  if (typeof line.label !== 'string' || line.label.trim() === '') {
    throw new InvalidGroupOrderInputError(
      'INVALID_SHARED_COST_LABEL',
      `shared-cost label must be a non-empty string, got ${String(line.label)}`,
    );
  }
  if (!Number.isSafeInteger(line.cents) || line.cents < 0) {
    throw new InvalidGroupOrderInputError(
      'INVALID_SHARED_COST_CENTS',
      `shared-cost cents for "${line.label}" must be a non-negative integer, got ${String(line.cents)}`,
    );
  }
  if (!participantIds.includes(line.frontedByParticipantId)) {
    throw new InvalidGroupOrderInputError(
      'UNKNOWN_FRONTING_PARTICIPANT',
      `frontedByParticipantId "${String(line.frontedByParticipantId)}" on "${line.label}" is not a participant of the session`,
    );
  }
  return line;
}

// ---------------------------------------------------------------------------
// Exact-arithmetic helpers
// ---------------------------------------------------------------------------

/** Exact integer addition with an overflow guard — cents never float. */
function addSafe(a: number, b: number, overflowReason: GroupOrderInputErrorReason): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new InvalidGroupOrderInputError(overflowReason, `${String(a)} + ${String(b)} exceeds the safe-integer range`);
  }
  return sum;
}
