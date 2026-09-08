/**
 * Tests for the pure blacklist domain logic — normalization, evidence
 * validation, the published standard, and both state machines.
 *
 * The published standard (3 independent confirmed non-delivery reports
 * or a confirmed invalid business registration) gates what the public
 * can be warned about, so the 2-vs-3 independence vectors are exact.
 * Pure functions — no DB, no mocks.
 *
 * @module BlacklistTests
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeMerchantDomain,
  normalizeMerchantName,
  normalizeMerchantIdentity,
  merchantIdentityKey,
  validateBlacklistReport,
  evaluatePublicationStandard,
  linkReportToEntry,
  reopenEntry,
  resolveEntry,
  isEntryPubliclyVisible,
} from '../blacklist';
import {
  ENTRY_INITIAL_STATUS,
  InvalidBlacklistReportError,
  InvalidBlacklistTransitionError,
  MIN_INDEPENDENT_NON_DELIVERY_REPORTS,
  REPORT_INITIAL_STATUS,
} from '../blacklist.types';
import type {
  BlacklistEntryStatus,
  BlacklistReportInput,
  BlacklistReportStatus,
  BlacklistTransitionAction,
} from '../blacklist.types';

/** Run `attempt`, returning the thrown error; fail loudly when nothing throws. */
function captureError(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('published-standard constants', () => {
  it('requires exactly 3 independent non-delivery reports', () => {
    expect(MIN_INDEPENDENT_NON_DELIVERY_REPORTS).toBe(3);
  });

  it('reports enter OPEN and entries are born PUBLISHED', () => {
    expect(REPORT_INITIAL_STATUS).toBe('OPEN');
    expect(ENTRY_INITIAL_STATUS).toBe('PUBLISHED');
  });
});

// ---------------------------------------------------------------------------
// Merchant identity normalization
// ---------------------------------------------------------------------------

describe('normalizeMerchantDomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeMerchantDomain('  EXAMPLE.COM ')).toBe('example.com');
  });

  it('strips a single leading www.', () => {
    expect(normalizeMerchantDomain('WWW.Example.com')).toBe('example.com');
    expect(normalizeMerchantDomain('www.example.co.uk')).toBe('example.co.uk');
  });

  it('strips www. only once — inner www. is part of the host', () => {
    expect(normalizeMerchantDomain('www.www.example.com')).toBe(
      'www.example.com',
    );
  });

  it('a domain without www. is unchanged apart from casing', () => {
    expect(normalizeMerchantDomain('ShopExample.COM')).toBe('shopexample.com');
  });

  it('blank or whitespace-bearing domains throw INVALID_MERCHANT_DOMAIN', () => {
    for (const bad of ['', '   ', 'exam ple.com', 'www.', 42, null, undefined]) {
      expect(() => normalizeMerchantDomain(bad)).toThrowError(
        InvalidBlacklistReportError,
      );
      expect(() => normalizeMerchantDomain(bad)).toThrowError(
        /INVALID_MERCHANT_DOMAIN/,
      );
    }
  });
});

describe('normalizeMerchantName', () => {
  it('trims, casefolds, and collapses internal whitespace', () => {
    expect(normalizeMerchantName('  Viini\u00A0\u00A0&  Whisky   Oy ')).toBe(
      'viini & whisky oy',
    );
  });

  it('tabs and newlines collapse to a single space', () => {
    expect(normalizeMerchantName('A\t\nB')).toBe('a b');
  });

  it('blank names throw INVALID_MERCHANT_NAME', () => {
    for (const bad of ['', '   ', '\t\n', 7, null, undefined]) {
      expect(() => normalizeMerchantName(bad)).toThrowError(
        InvalidBlacklistReportError,
      );
      expect(() => normalizeMerchantName(bad)).toThrowError(
        /INVALID_MERCHANT_NAME/,
      );
    }
  });
});

describe('merchant identity — deterministic pair, no registry row', () => {
  it('different spellings of the same merchant collapse to one identity', () => {
    const a = normalizeMerchantIdentity('www.WineShop.example', ' Wine  Shop ');
    const b = normalizeMerchantIdentity('wineshop.example', 'WINE SHOP');
    expect(a).toEqual(b);
    expect(merchantIdentityKey(a)).toBe('wineshop.example|wine shop');
  });

  it('different domains or names are different merchants', () => {
    const base = normalizeMerchantIdentity('wineshop.example', 'wine shop');
    expect(
      merchantIdentityKey(normalizeMerchantIdentity('other.example', 'wine shop')),
    ).not.toBe(merchantIdentityKey(base));
    expect(
      merchantIdentityKey(normalizeMerchantIdentity('wineshop.example', 'wine shop oy')),
    ).not.toBe(merchantIdentityKey(base));
  });
});

// ---------------------------------------------------------------------------
// Evidence validation
// ---------------------------------------------------------------------------

describe('validateBlacklistReport', () => {
  const valid = {
    reporterAccountId: ' acct-1 ',
    merchantDomain: 'www.Example.com',
    merchantName: ' Example ',
    orderReference: ' ORD-9 ',
    correspondenceSummary: 'Merchant refused refund.',
  };

  it('accepts complete evidence and returns trimmed, normalized canonical form', () => {
    expect(validateBlacklistReport(valid)).toEqual({
      merchantIdentity: { domain: 'example.com', name: 'example' },
      evidence: {
        reporterAccountId: 'acct-1',
        orderReference: 'ORD-9',
        correspondenceSummary: 'Merchant refused refund.',
      },
    });
  });

  it.each([
    ['reporterAccountId', 'MISSING_REPORTER_ACCOUNT'],
    ['orderReference', 'MISSING_ORDER_REFERENCE'],
    ['correspondenceSummary', 'MISSING_CORRESPONDENCE_SUMMARY'],
  ] as const)('blank %s throws %s', (field, reason) => {
    for (const bad of [undefined, null, '', '   ']) {
      const payload = { ...valid, [field]: bad } as BlacklistReportInput;
      const err = captureError(() => validateBlacklistReport(payload));
      expect(err).toBeInstanceOf(InvalidBlacklistReportError);
      expect((err as InvalidBlacklistReportError).reason).toBe(reason);
    }
  });

  it('non-string evidence throws the corresponding missing reason', () => {
    expect(() =>
      validateBlacklistReport({ ...valid, orderReference: 12345 }),
    ).toThrowError(/MISSING_ORDER_REFERENCE/);
  });

  it('an unusable merchant identity rejects the report', () => {
    expect(() => validateBlacklistReport({ ...valid, merchantDomain: '' })).toThrowError(
      /INVALID_MERCHANT_DOMAIN/,
    );
    expect(() => validateBlacklistReport({ ...valid, merchantName: '  ' })).toThrowError(
      /INVALID_MERCHANT_NAME/,
    );
  });
});

// ---------------------------------------------------------------------------
// Published standard
// ---------------------------------------------------------------------------

describe('evaluatePublicationStandard — confirmed non-delivery path', () => {
  const confirmed = (accountId: string) => ({
    reporterAccountId: accountId,
    confirmedNonDelivery: true,
  });
  const unconfirmed = (accountId: string) => ({
    reporterAccountId: accountId,
    confirmedNonDelivery: false,
  });

  it('3 distinct confirmed reporters meet the standard', () => {
    expect(
      evaluatePublicationStandard({
        nonDeliveryReports: [confirmed('a'), confirmed('b'), confirmed('c')],
        businessRegistration: null,
      }),
    ).toEqual({ met: true, basis: 'CONFIRMED_NON_DELIVERY_REPORTS' });
  });

  it('3 reports from 2 accounts do NOT meet the standard (independence is exact)', () => {
    const result = evaluatePublicationStandard({
      nonDeliveryReports: [confirmed('a'), confirmed('a'), confirmed('b')],
      businessRegistration: null,
    });
    expect(result).toEqual({
      met: false,
      reason: 'INSUFFICIENT_INDEPENDENT_NON_DELIVERY_REPORTS',
      independentConfirmedCount: 2,
    });
  });

  it('exactly 2 distinct confirmed reporters do NOT meet the standard', () => {
    expect(
      evaluatePublicationStandard({
        nonDeliveryReports: [confirmed('a'), confirmed('b')],
        businessRegistration: null,
      }),
    ).toEqual({
      met: false,
      reason: 'INSUFFICIENT_INDEPENDENT_NON_DELIVERY_REPORTS',
      independentConfirmedCount: 2,
    });
  });

  it('unconfirmed reports do not count toward independence', () => {
    const result = evaluatePublicationStandard({
      nonDeliveryReports: [
        confirmed('a'),
        confirmed('b'),
        unconfirmed('c'),
        unconfirmed('d'),
        unconfirmed('e'),
      ],
      businessRegistration: null,
    });
    expect(result).toMatchObject({
      met: false,
      independentConfirmedCount: 2,
    });
  });
});

describe('evaluatePublicationStandard — business-registration path', () => {
  it('a confirmed invalid registration meets the standard with zero reports', () => {
    expect(
      evaluatePublicationStandard({
        nonDeliveryReports: [],
        businessRegistration: { confirmedInvalid: true },
      }),
    ).toEqual({ met: true, basis: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION' });
  });

  it('an unconfirmed registration does NOT meet the standard', () => {
    const result = evaluatePublicationStandard({
      nonDeliveryReports: [],
      businessRegistration: { confirmedInvalid: false },
    });
    expect(result).toEqual({
      met: false,
      reason: 'NO_EVIDENCE',
      independentConfirmedCount: 0,
    });
  });

  it('a confirmed registration rescues an otherwise-failing report corpus', () => {
    expect(
      evaluatePublicationStandard({
        nonDeliveryReports: [
          { reporterAccountId: 'a', confirmedNonDelivery: true },
          { reporterAccountId: 'b', confirmedNonDelivery: true },
        ],
        businessRegistration: { confirmedInvalid: true },
      }),
    ).toEqual({ met: true, basis: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION' });
  });

  it('an empty corpus has no evidence', () => {
    expect(
      evaluatePublicationStandard({
        nonDeliveryReports: [],
        businessRegistration: null,
      }),
    ).toEqual({
      met: false,
      reason: 'NO_EVIDENCE',
      independentConfirmedCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Report state machine — OPEN → LINKED
// ---------------------------------------------------------------------------

describe('linkReportToEntry', () => {
  it('OPEN → LINKED on publication', () => {
    expect(linkReportToEntry('OPEN')).toBe('LINKED');
  });

  it('LINKED is terminal — relinking throws', () => {
    const err = captureError(() => linkReportToEntry('LINKED'));
    expect(err).toBeInstanceOf(InvalidBlacklistTransitionError);
    const transition = err as InvalidBlacklistTransitionError;
    expect(transition.action).toBe('LINK_REPORT');
    expect(transition.from).toBe('LINKED');
  });
});

// ---------------------------------------------------------------------------
// Entry state machine — PUBLISHED → REOPENED → PUBLISHED | REJECTED
// ---------------------------------------------------------------------------

describe('entry state machine', () => {
  it('appeal: PUBLISHED → REOPENED', () => {
    expect(reopenEntry('PUBLISHED')).toBe('REOPENED');
  });

  it('resolve REPUBLISH: REOPENED → PUBLISHED', () => {
    expect(resolveEntry('REOPENED', 'REPUBLISH')).toBe('PUBLISHED');
  });

  it('resolve REJECT: REOPENED → REJECTED', () => {
    expect(resolveEntry('REOPENED', 'REJECT')).toBe('REJECTED');
  });

  const invalidTransitions: ReadonlyArray<
    [label: string, attempt: () => unknown, action: BlacklistTransitionAction, from: BlacklistReportStatus | BlacklistEntryStatus]
  > = [
    ['appeal', () => reopenEntry('REOPENED'), 'APPEAL', 'REOPENED'],
    ['appeal', () => reopenEntry('REJECTED'), 'APPEAL', 'REJECTED'],
    ['resolve REPUBLISH', () => resolveEntry('PUBLISHED', 'REPUBLISH'), 'RESOLVE', 'PUBLISHED'],
    ['resolve REJECT', () => resolveEntry('PUBLISHED', 'REJECT'), 'RESOLVE', 'PUBLISHED'],
    ['resolve REPUBLISH', () => resolveEntry('REJECTED', 'REPUBLISH'), 'RESOLVE', 'REJECTED'],
    ['resolve REJECT', () => resolveEntry('REJECTED', 'REJECT'), 'RESOLVE', 'REJECTED'],
  ];

  it.each(invalidTransitions)(
    '%s from an invalid state throws',
    (_label, attempt, action, from) => {
      const err = captureError(attempt);
      expect(err).toBeInstanceOf(InvalidBlacklistTransitionError);
      const transition = err as InvalidBlacklistTransitionError;
      expect(transition.action).toBe(action);
      expect(transition.from).toBe(from);
    },
  );

  it('full lifecycle: publish → appeal → republish → appeal → reject', () => {
    let entry = ENTRY_INITIAL_STATUS;
    entry = reopenEntry(entry); // appeal 1
    entry = resolveEntry(entry, 'REPUBLISH');
    expect(entry).toBe('PUBLISHED');
    entry = reopenEntry(entry); // appeal 2
    entry = resolveEntry(entry, 'REJECT');
    expect(entry).toBe('REJECTED');
  });
});

describe('isEntryPubliclyVisible', () => {
  it('exactly PUBLISHED is visible', () => {
    expect(isEntryPubliclyVisible('PUBLISHED')).toBe(true);
  });

  it('REOPENED disappears from display immediately; REJECTED never returns', () => {
    expect(isEntryPubliclyVisible('REOPENED')).toBe(false);
    expect(isEntryPubliclyVisible('REJECTED')).toBe(false);
  });
});
