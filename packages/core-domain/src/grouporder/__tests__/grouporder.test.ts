/**
 * Tests for the group order ledger (task 9.2, spec group-order-ledger,
 * design R12).
 *
 * Exact numeric expectations are computed by hand and were
 * float-verified in node before writing (tripcalc/whatif discipline);
 * the hand-derived vector "express 601 → bea" was CORRECTED by that
 * verification (remainder 3000 outranks 2000/1000 — the cent goes to
 * bea, not anna), which is exactly what the discipline is for.
 *
 * Boundary conventions (documented, pinned by tests):
 * - the remainder rule: the largest fractional remainder receives the
 *   cent, per shared-cost line independently; ties resolve by
 *   participant input order ascending (earlier position wins);
 * - the settlement algorithm: greedy max-debtor/max-creditor, ties on
 *   both sides by participant input order, zero-balance participants
 *   produce no transfers;
 * - reproducibility: identical input yields byte-identical JSON output;
 * - single participant: full shared cost on them, no transfers;
 * - expected lifecycle states are values, never errors: EMPTY_SESSION
 *   and NO_ITEM_VALUE carry no invented allocation or balance figures;
 * - conservation: allocations sum to the line's cents and balances sum
 *   to zero — money is moved between participants, never created.
 *
 * @module GroupOrderTests
 */
import { describe, it, expect } from 'vitest';
import { calculateGroupOrderLedger, settleBalances } from '../grouporder';
import { InvalidGroupOrderInputError } from '../grouporder.types';
import type {
  GroupOrderComputedLedger,
  GroupOrderLedgerInput,
  GroupOrderLedgerResult,
  ParticipantBalance,
} from '../grouporder.types';
import { GROUP_ORDER_DISCLAIMER_EN } from '../grouporder.disclaimer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Canonical session: three participants with unequal item values. */
function ledgerInput(overrides: Partial<GroupOrderLedgerInput> = {}): GroupOrderLedgerInput {
  return {
    participants: [
      { id: 'anna', itemValueCents: [1500, 500] },
      { id: 'bea', itemValueCents: [3000] },
      { id: 'carl', itemValueCents: [250, 250, 500] },
    ],
    sharedCostCents: [
      { label: 'shipping', cents: 1200, frontedByParticipantId: 'bea' },
      { label: 'packaging duty', cents: 1000, frontedByParticipantId: 'anna' },
      { label: 'express surcharge', cents: 601, frontedByParticipantId: 'carl' },
    ],
    ...overrides,
  };
}

/** Run the calculator, returning a thrown error (fails the test on no-throw). */
function errorOf(fn: () => unknown): InvalidGroupOrderInputError {
  try {
    fn();
  } catch (e) {
    return e as InvalidGroupOrderInputError;
  }
  throw new Error('expected the function to throw, but it returned');
}

/** Assert the rejection reason and that it is the module's own error type. */
function expectReason(fn: () => unknown, reason: string): void {
  const error = errorOf(fn);
  expect(error).toBeInstanceOf(InvalidGroupOrderInputError);
  expect(error.reason).toBe(reason);
}

/** The COMPUTED variant of a result (fails when a state value was returned). */
function asComputed(result: GroupOrderLedgerResult): GroupOrderComputedLedger {
  if (result.status !== 'COMPUTED') {
    throw new Error(`expected a COMPUTED result, got ${result.status}`);
  }
  return result;
}

/** Allocations of one line by participant id, in input order. */
function allocationsOf(
  computed: GroupOrderComputedLedger,
  label: string,
): Record<string, number> {
  const line = computed.sharedCosts.find((shared) => shared.label === label);
  if (!line) throw new Error(`no shared-cost line labelled "${label}"`);
  return Object.fromEntries(line.perParticipant.map((slice) => [slice.participantId, slice.allocatedCents]));
}

// ---------------------------------------------------------------------------
// Proportional allocation — the remainder rule, exactly
// ---------------------------------------------------------------------------

describe('proportional allocation — remainder rule', () => {
  it('equal values, 100 c over 3: base 33 each, tie on remainder 1 → first participant receives the cent', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'p0', itemValueCents: [1] },
          { id: 'p1', itemValueCents: [1] },
          { id: 'p2', itemValueCents: [1] },
        ],
        sharedCostCents: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'p2' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ p0: 34, p1: 33, p2: 33 });

    const line = result.sharedCosts[0];
    expect(line.perParticipant.map((slice) => slice.baseCents)).toEqual([33, 33, 33]);
    expect(line.perParticipant.map((slice) => slice.fractionalRemainderCents)).toEqual([1, 1, 1]);
    expect(line.perParticipant.map((slice) => slice.remainderCentsReceived)).toEqual([1, 0, 0]);
  });

  it('unequal values: the largest fractional remainder receives the cent (16.67/33.33/50.00 → 17/33/50)', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'p0', itemValueCents: [1] },
          { id: 'p1', itemValueCents: [2] },
          { id: 'p2', itemValueCents: [3] },
        ],
        sharedCostCents: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'p0' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ p0: 17, p1: 33, p2: 50 });

    const line = result.sharedCosts[0];
    expect(line.perParticipant.map((slice) => slice.fractionalRemainderCents)).toEqual([4, 2, 0]);
    expect(line.perParticipant.map((slice) => slice.remainderCentsReceived)).toEqual([1, 0, 0]);
    // Traceability: the exact share numerator is echoed per slice.
    expect(line.perParticipant.map((slice) => slice.exactShareNumeratorCents)).toEqual([100, 200, 300]);
    expect(result.totalItemValueCents).toBe(6);
  });

  it('a two-cent remainder pool with an internal tie: first two positions win (C=100, v=[1,1,2,2] → 17/17/33/33)', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'p0', itemValueCents: [1] },
          { id: 'p1', itemValueCents: [1] },
          { id: 'p2', itemValueCents: [2] },
          { id: 'p3', itemValueCents: [2] },
        ],
        sharedCostCents: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'p0' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ p0: 17, p1: 17, p2: 33, p3: 33 });
    const line = result.sharedCosts[0];
    expect(line.perParticipant.map((slice) => slice.fractionalRemainderCents)).toEqual([4, 4, 2, 2]);
    expect(line.perParticipant.map((slice) => slice.remainderCentsReceived)).toEqual([1, 1, 0, 0]);
  });

  it('remainder magnitude beats input position: C=1000, v=[3,1,1,1] → 500/167/167/166 (later equal-remainder participant loses)', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'p0', itemValueCents: [3] },
          { id: 'p1', itemValueCents: [1] },
          { id: 'p2', itemValueCents: [1] },
          { id: 'p3', itemValueCents: [1] },
        ],
        sharedCostCents: [{ label: 'shipping', cents: 1000, frontedByParticipantId: 'p0' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ p0: 500, p1: 167, p2: 167, p3: 166 });
  });

  it('canonical three-participant session: each line splits independently; allocation and balances conserve', () => {
    const result = asComputed(calculateGroupOrderLedger(ledgerInput()));

    // Hand-computed per line (V = 6000 c):
    expect(allocationsOf(result, 'shipping')).toEqual({ anna: 400, bea: 600, carl: 200 });
    expect(allocationsOf(result, 'packaging duty')).toEqual({ anna: 333, bea: 500, carl: 167 });
    expect(allocationsOf(result, 'express surcharge')).toEqual({ anna: 200, bea: 301, carl: 100 });

    // Conservation: every line's allocations sum to its cents.
    for (const line of result.sharedCosts) {
      const sum = line.perParticipant.reduce((total, slice) => total + slice.allocatedCents, 0);
      expect(sum).toBe(line.sharedCostCents);
    }
    // Totals echo the inputs.
    expect(result.totalSharedCostCents).toBe(2801);
    expect(result.totalItemValueCents).toBe(6000);

    // Balances: fronted − allocated; sum is exactly zero.
    expect(result.participants.map((line) => line.netBalanceCents)).toEqual([67, -201, 134]);
    const balanceSum = result.participants.reduce((sum, line) => sum + line.netBalanceCents, 0);
    expect(balanceSum).toBe(0);

    // Settlement of [+67, −201, +134]: bea settles both creditors.
    expect(result.transfers).toEqual([
      { fromParticipantId: 'bea', toParticipantId: 'carl', cents: 134 },
      { fromParticipantId: 'bea', toParticipantId: 'anna', cents: 67 },
    ]);
  });

  it('every allocation slice satisfies the audit identity: allocated = base + received, base = (numerator − remainder) ÷ V', () => {
    const result = asComputed(calculateGroupOrderLedger(ledgerInput()));
    for (const line of result.sharedCosts) {
      for (const slice of line.perParticipant) {
        expect(slice.allocatedCents).toBe(slice.baseCents + slice.remainderCentsReceived);
        expect((slice.exactShareNumeratorCents - slice.fractionalRemainderCents) / result.totalItemValueCents).toBe(
          slice.baseCents,
        );
        expect(slice.exactShareNumeratorCents).toBe(line.sharedCostCents * slice.itemValueCents);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Single participant and degenerate shares
// ---------------------------------------------------------------------------

describe('single participant', () => {
  it('carries the full shared cost, owes items + shared, and produces no transfers', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [{ id: 'solo', itemValueCents: [4000] }],
        sharedCostCents: [{ label: 'shipping', cents: 2500, frontedByParticipantId: 'solo' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ solo: 2500 });
    expect(result.transfers).toEqual([]);

    const ledger = result.participants[0];
    expect(ledger.itemValueCents).toBe(4000);
    expect(ledger.allocatedSharedCostCents).toBe(2500);
    expect(ledger.frontedSharedCostCents).toBe(2500);
    expect(ledger.totalOwedCents).toBe(6500);
    expect(ledger.netBalanceCents).toBe(0);
  });

  it('a zero-item participant receives no allocation and no remainder cent, and no transfer exists', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'quiet', itemValueCents: [] },
          { id: 'buyer', itemValueCents: [1000] },
        ],
        sharedCostCents: [{ label: 'shipping', cents: 999, frontedByParticipantId: 'buyer' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ quiet: 0, buyer: 999 });
    const quiet = result.participants.find((line) => line.participantId === 'quiet');
    expect(quiet?.allocatedSharedCostCents).toBe(0);
    expect(quiet?.frontedSharedCostCents).toBe(0);
    expect(quiet?.netBalanceCents).toBe(0);
    expect(result.participants.map((line) => line.netBalanceCents)).toEqual([0, 0]);
    expect(result.transfers).toEqual([]);
  });

  it('a fronting participant with zero item share is repaid in full by the value holders', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'fronted', itemValueCents: [] },
          { id: 'holder', itemValueCents: [100] },
        ],
        sharedCostCents: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'fronted' }],
      }),
    );
    expect(allocationsOf(result, 'shipping')).toEqual({ fronted: 0, holder: 100 });
    expect(result.participants.map((line) => line.netBalanceCents)).toEqual([100, -100]);
    expect(result.transfers).toEqual([{ fromParticipantId: 'holder', toParticipantId: 'fronted', cents: 100 }]);
  });
});

// ---------------------------------------------------------------------------
// Minimal-transfer settlement — greedy max-debtor/max-creditor
// ---------------------------------------------------------------------------

describe('settleBalances — determinism and minimality', () => {
  it('routes one debtor through two creditors (+30, +20, −50 → two transfers, both from the debtor)', () => {
    const balances: ParticipantBalance[] = [
      { participantId: 'p0', netCents: 30 },
      { participantId: 'p1', netCents: 20 },
      { participantId: 'p2', netCents: -50 },
    ];
    expect(settleBalances(balances)).toEqual([
      { fromParticipantId: 'p2', toParticipantId: 'p0', cents: 30 },
      { fromParticipantId: 'p2', toParticipantId: 'p1', cents: 20 },
    ]);
  });

  it('debtor tie: equal debts settle in input order (+50, −25, −25)', () => {
    const balances: ParticipantBalance[] = [
      { participantId: 'p0', netCents: 50 },
      { participantId: 'p1', netCents: -25 },
      { participantId: 'p2', netCents: -25 },
    ];
    expect(settleBalances(balances)).toEqual([
      { fromParticipantId: 'p1', toParticipantId: 'p0', cents: 25 },
      { fromParticipantId: 'p2', toParticipantId: 'p0', cents: 25 },
    ]);
  });

  it('ties on both sides: first debtor matches first creditor (−10, −10, +10, +10)', () => {
    const balances: ParticipantBalance[] = [
      { participantId: 'p0', netCents: -10 },
      { participantId: 'p1', netCents: -10 },
      { participantId: 'p2', netCents: 10 },
      { participantId: 'p3', netCents: 10 },
    ];
    expect(settleBalances(balances)).toEqual([
      { fromParticipantId: 'p0', toParticipantId: 'p2', cents: 10 },
      { fromParticipantId: 'p1', toParticipantId: 'p3', cents: 10 },
    ]);
  });

  it('zero-balance participants produce no transfers', () => {
    const balances: ParticipantBalance[] = [
      { participantId: 'settled', netCents: 0 },
      { participantId: 'creditor', netCents: 50 },
      { participantId: 'debtor', netCents: -50 },
    ];
    const transfers = settleBalances(balances);
    expect(transfers).toEqual([{ fromParticipantId: 'debtor', toParticipantId: 'creditor', cents: 50 }]);
    for (const transfer of transfers) {
      expect(transfer.fromParticipantId).not.toBe('settled');
      expect(transfer.toParticipantId).not.toBe('settled');
    }
  });

  it('all-zero balances settle with no transfers', () => {
    expect(
      settleBalances([
        { participantId: 'a', netCents: 0 },
        { participantId: 'b', netCents: 0 },
      ]),
    ).toEqual([]);
  });

  it('rejects balances that do not sum to exactly zero, duplicates, and non-integer cents', () => {
    expectReason(
      () =>
        settleBalances([
          { participantId: 'a', netCents: 10 },
          { participantId: 'b', netCents: 5 },
        ]),
      'BALANCES_NOT_ZERO_SUM',
    );
    expectReason(
      () =>
        settleBalances([
          { participantId: 'a', netCents: 0 },
          { participantId: 'a', netCents: 0 },
        ]),
      'DUPLICATE_BALANCE_ID',
    );
    expectReason(() => settleBalances([{ participantId: 'a', netCents: 1.5 }]), 'INVALID_NET_BALANCE');
  });
});

// ---------------------------------------------------------------------------
// Result states — expected lifecycle states are values, not errors
// ---------------------------------------------------------------------------

describe('result states', () => {
  it('an empty session (no participants, no shared costs) is an explicit EMPTY_SESSION value state', () => {
    const result = calculateGroupOrderLedger({ participants: [], sharedCostCents: [] });
    expect(result.status).toBe('EMPTY_SESSION');
    expect(result.participants).toEqual([]);
    expect(result.sharedCosts).toEqual([]);
    expect(result.transfers).toEqual([]);
    expect(result.totalItemValueCents).toBe(0);
    expect(result.totalSharedCostCents).toBe(0);
    expect(result.note).toEqual(GROUP_ORDER_DISCLAIMER_EN);
  });

  it('shared costs with no participants are a caller-contract error, not a state', () => {
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [],
          sharedCostCents: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'ghost' }],
        }),
      'SHARED_COST_WITHOUT_PARTICIPANTS',
    );
  });

  it('zero item value with positive shared costs is NO_ITEM_VALUE: basis-only lines, no allocation, no transfers', () => {
    const result = calculateGroupOrderLedger({
      participants: [
        { id: 'a', itemValueCents: [] },
        { id: 'b', itemValueCents: [0] },
      ],
      sharedCostCents: [{ label: 'shipping', cents: 500, frontedByParticipantId: 'a' }],
    });
    expect(result.status).toBe('NO_ITEM_VALUE');
    expect(result.totalItemValueCents).toBe(0);
    expect(result.totalSharedCostCents).toBe(500);
    expect(result.sharedCosts).toEqual([]);
    expect(result.participants).toEqual([
      { participantId: 'a', itemValueCents: 0 },
      { participantId: 'b', itemValueCents: 0 },
    ]);
    expect(result.transfers).toEqual([]);
    expect(result.note).toEqual(GROUP_ORDER_DISCLAIMER_EN);
  });

  it('no shared costs (or all-zero costs) is COMPUTED with exact zero allocations and no transfers', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'a', itemValueCents: [100] },
          { id: 'b', itemValueCents: [300] },
        ],
        sharedCostCents: [],
      }),
    );
    expect(result.sharedCosts).toEqual([]);
    expect(result.participants.map((line) => line.allocatedSharedCostCents)).toEqual([0, 0]);
    expect(result.participants.map((line) => line.totalOwedCents)).toEqual([100, 300]);
    expect(result.participants.map((line) => line.netBalanceCents)).toEqual([0, 0]);
    expect(result.transfers).toEqual([]);
  });

  it('a zero-cent line over a zero item-value total is COMPUTED with exact zero slices (never NaN)', () => {
    const result = asComputed(
      calculateGroupOrderLedger({
        participants: [
          { id: 'a', itemValueCents: [] },
          { id: 'b', itemValueCents: [0] },
        ],
        sharedCostCents: [{ label: 'free shipping', cents: 0, frontedByParticipantId: 'a' }],
      }),
    );
    expect(allocationsOf(result, 'free shipping')).toEqual({ a: 0, b: 0 });
    for (const slice of result.sharedCosts[0].perParticipant) {
      expect(slice.baseCents).toBe(0);
      expect(slice.fractionalRemainderCents).toBe(0);
      expect(slice.remainderCentsReceived).toBe(0);
      expect(Number.isNaN(slice.allocatedCents)).toBe(false);
    }
    expect(result.participants.map((line) => line.netBalanceCents)).toEqual([0, 0]);
    expect(result.transfers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reproducibility — same input, byte-identical output
// ---------------------------------------------------------------------------

describe('reproducibility', () => {
  it('identical input yields byte-identical JSON output across runs', () => {
    const first = JSON.stringify(calculateGroupOrderLedger(ledgerInput()));
    const second = JSON.stringify(calculateGroupOrderLedger(ledgerInput()));
    const third = JSON.stringify(calculateGroupOrderLedger(ledgerInput()));
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('participant lines keep input order (the documented tie-break basis), not alphabetical order', () => {
    const result = asComputed(calculateGroupOrderLedger(ledgerInput()));
    expect(result.participants.map((line) => line.participantId)).toEqual(['anna', 'bea', 'carl']);
    for (const line of result.sharedCosts) {
      expect(line.perParticipant.map((slice) => slice.participantId)).toEqual(['anna', 'bea', 'carl']);
    }
  });

  it('settlement is byte-stable for a fixed balance set', () => {
    const balances: ParticipantBalance[] = [
      { participantId: 'z', netCents: 67 },
      { participantId: 'a', netCents: -201 },
      { participantId: 'm', netCents: 134 },
    ];
    expect(JSON.stringify(settleBalances(balances))).toBe(JSON.stringify(settleBalances(balances)));
  });
});

// ---------------------------------------------------------------------------
// Validation — first violation wins
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('rejects malformed and duplicate participant ids', () => {
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [{ id: '', itemValueCents: [1] }],
          sharedCostCents: [],
        }),
      'INVALID_PARTICIPANT_ID',
    );
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [
            { id: 'a', itemValueCents: [1] },
            { id: 'a', itemValueCents: [2] },
          ],
          sharedCostCents: [],
        }),
      'DUPLICATE_PARTICIPANT_ID',
    );
  });

  it('rejects negative, non-integer, and overflowing item values', () => {
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [{ id: 'a', itemValueCents: [-1] }],
          sharedCostCents: [],
        }),
      'INVALID_ITEM_VALUE',
    );
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [{ id: 'a', itemValueCents: [1.5] }],
          sharedCostCents: [],
        }),
      'INVALID_ITEM_VALUE',
    );
    // 2^52 + 2^52 = 2^53 exceeds the safe-integer range.
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [{ id: 'a', itemValueCents: [4503599627370496, 4503599627370496] }],
          sharedCostCents: [],
        }),
      'ITEM_VALUE_OVERFLOW',
    );
  });

  it('rejects malformed shared-cost lines: label, cents, unknown fronting participant, overflow total', () => {
    const participants = [{ id: 'a', itemValueCents: [100] }];
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants,
          sharedCostCents: [{ label: '', cents: 100, frontedByParticipantId: 'a' }],
        }),
      'INVALID_SHARED_COST_LABEL',
    );
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants,
          sharedCostCents: [{ label: 'shipping', cents: -5, frontedByParticipantId: 'a' }],
        }),
      'INVALID_SHARED_COST_CENTS',
    );
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants,
          sharedCostCents: [{ label: 'shipping', cents: 5, frontedByParticipantId: 'nobody' }],
        }),
      'UNKNOWN_FRONTING_PARTICIPANT',
    );
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants,
          sharedCostCents: [
            { label: 'shipping', cents: 4503599627370496, frontedByParticipantId: 'a' },
            { label: 'duty', cents: 4503599627370496, frontedByParticipantId: 'a' },
          ],
        }),
      'SHARED_COST_OVERFLOW',
    );
  });

  it('rejects a share numerator (cents × value) beyond the safe-integer range instead of float-drifting', () => {
    expectReason(
      () =>
        calculateGroupOrderLedger({
          participants: [{ id: 'a', itemValueCents: [4294967296] }], // 2^32, safe
          sharedCostCents: [{ label: 'shipping', cents: 2097152, frontedByParticipantId: 'a' }], // 2^21
        }),
      // 2^21 × 2^32 = 2^53 — one past the exactness boundary.
      'SHARE_NUMERATOR_OVERFLOW',
    );
  });
});
