/**
 * Validation suite for the internal send contract — every rejection path and
 * the conservative email rules mirrored from application-api (task 5.3).
 *
 * @module validation.test
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  MAX_DIGEST_FACTS,
  MAX_DIGEST_WEEK_LENGTH,
  MAX_SUBJECT_LENGTH,
  isValidEmailFormat,
  parseSendEmailRequest,
} from '../validation';

// ---------------------------------------------------------------------------
// isValidEmailFormat — rule parity with
// packages/application-api/src/accounts/email-verification.ts
// ---------------------------------------------------------------------------

describe('isValidEmailFormat (conservative syntactic rules)', () => {
  it.each([
    ['user@example.com', true],
    ['first.last@sub.example.co.uk', true],
    ['a@b.co', true],
    ['', false],
    ['no-at-sign', false],
    ['@example.com', false], // @ at position 0
    ['user@', false], // empty domain
    ['@', false],
    ['user@@example.com', false], // second @
    ['user@localhost', false], // domain without dot
    ['user name@example.com', false], // whitespace
    ['user@example .com', false], // whitespace in domain
    [`${'a'.repeat(310)}@example.com`, false], // > 320 chars
    [`${'a'.repeat(300)}@example.com`, true], // long but within cap
  ])('%j → %j', (email, expected) => {
    expect(isValidEmailFormat(email)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// parseSendEmailRequest — every rejection path
// ---------------------------------------------------------------------------

const validBase = { to: 'ops@example.com', subject: 'Alert', text: 'hello' };

function expectRejected(raw: unknown, status: number, messageIncludes: string) {
  const parsed = parseSendEmailRequest(raw);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.status).toBe(status);
  expect(parsed.message).toContain(messageIncludes);
}

describe('parseSendEmailRequest — rejections', () => {
  it('rejects a non-object body', () => {
    expectRejected('"string"', 400, 'JSON object');
    expectRejected([validBase], 400, 'JSON object');
    expectRejected(null, 400, 'JSON object');
    expectRejected(undefined, 400, 'JSON object');
  });

  it("rejects missing 'to'", () => {
    expectRejected({ subject: 's', text: 't' }, 422, "'to' is required");
  });

  it("rejects non-string 'to'", () => {
    expectRejected({ ...validBase, to: 42 }, 422, "'to' must be a string");
    expectRejected({ ...validBase, to: null }, 422, "'to' must be a string");
  });

  it("rejects syntactically invalid 'to'", () => {
    expectRejected({ ...validBase, to: 'not-an-email' }, 422, 'valid email address');
  });

  it("rejects missing 'subject'", () => {
    expectRejected({ to: 'ops@example.com', text: 't' }, 422, "'subject' is required");
  });

  it("rejects non-string 'subject'", () => {
    expectRejected({ ...validBase, subject: {} }, 422, "'subject' must be a string");
  });

  it("rejects empty 'subject'", () => {
    expectRejected({ ...validBase, subject: '' }, 422, "'subject' must not be empty");
  });

  it("rejects over-long 'subject'", () => {
    expectRejected(
      { ...validBase, subject: 'x'.repeat(MAX_SUBJECT_LENGTH + 1) },
      413,
      'character limit',
    );
  });

  it("rejects line breaks in 'subject' (header injection)", () => {
    expectRejected({ ...validBase, subject: 'ok\r\nBcc: victim@example.com' }, 422, 'line breaks');
    expectRejected({ ...validBase, subject: 'ok\nBcc: victim@example.com' }, 422, 'line breaks');
  });

  it("rejects non-string 'text'", () => {
    expectRejected({ ...validBase, text: 5 }, 422, "'text' must be a string");
  });

  it("rejects non-string 'html'", () => {
    expectRejected({ ...validBase, text: undefined, html: ['x'] }, 422, "'html' must be a string");
  });

  it("rejects over-long 'text'", () => {
    expectRejected(
      { ...validBase, text: 'x'.repeat(MAX_BODY_BYTES + 1) },
      413,
      "-byte limit",
    );
  });

  it("rejects over-long 'html' counting UTF-8 bytes", () => {
    // 'ä' is 2 bytes in UTF-8: 131072 chars → 262145 bytes > cap.
    expectRejected(
      { ...validBase, text: undefined, html: 'ä'.repeat(MAX_BODY_BYTES / 2 + 1) },
      413,
      '-byte limit',
    );
  });

  it('rejects when neither text nor html is present', () => {
    expectRejected(
      { to: 'ops@example.com', subject: 's' },
      422,
      "at least one of 'text' or 'html'",
    );
  });

  it("rejects invalid 'replyTo'", () => {
    expectRejected({ ...validBase, replyTo: 'nope' }, 422, "'replyTo' must be a valid email address");
    expectRejected({ ...validBase, replyTo: 3 }, 422, "'replyTo' must be a string");
  });
});

describe('parseSendEmailRequest — acceptance', () => {
  it('accepts text-only', () => {
    const parsed = parseSendEmailRequest(validBase);
    expect(parsed).toEqual({
      ok: true,
      value: { to: 'ops@example.com', subject: 'Alert', text: 'hello' },
    });
  });

  it('accepts html-only', () => {
    const parsed = parseSendEmailRequest({
      to: 'ops@example.com',
      subject: 'Alert',
      html: '<p>hello</p>',
    });
    expect(parsed).toEqual({
      ok: true,
      value: { to: 'ops@example.com', subject: 'Alert', html: '<p>hello</p>' },
    });
  });

  it('accepts both bodies plus replyTo and drops unknown fields', () => {
    const parsed = parseSendEmailRequest({
      ...validBase,
      html: '<p>hello</p>',
      replyTo: 'replies@example.com',
      bogus: 'ignored',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        to: 'ops@example.com',
        subject: 'Alert',
        text: 'hello',
        html: '<p>hello</p>',
        replyTo: 'replies@example.com',
      },
    });
  });

  it('accepts a subject at the exact cap', () => {
    const parsed = parseSendEmailRequest({
      ...validBase,
      subject: 'x'.repeat(MAX_SUBJECT_LENGTH),
    });
    expect(parsed.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSendEmailRequest — the structured digest payload kind (task 4.3b)
// ---------------------------------------------------------------------------

/** One shape-valid fact — every digest-fact rejection mutates a copy. */
const validFact = {
  category: 'beer',
  kind: 'CATEGORY_MINIMUM',
  priceCloseCents: 1234,
  productId: 42,
  merchant: null,
  periodStart: '2026-10-05',
};

const validDigestBase = {
  to: 'digest@example.com',
  digest: { week: '2026-W41', facts: [validFact] },
};

describe('parseSendEmailRequest — digest acceptance', () => {
  it('accepts the cron payload and defaults the locale to fi', () => {
    const parsed = parseSendEmailRequest(validDigestBase);
    expect(parsed).toEqual({
      ok: true,
      value: {
        to: 'digest@example.com',
        locale: 'fi',
        digest: { week: '2026-W41', facts: [validFact] },
      },
    });
  });

  it('accepts an explicit en locale', () => {
    const parsed = parseSendEmailRequest({ ...validDigestBase, locale: 'en' });
    expect(parsed).toEqual({
      ok: true,
      value: {
        to: 'digest@example.com',
        locale: 'en',
        digest: { week: '2026-W41', facts: [validFact] },
      },
    });
  });

  it('accepts a string merchant and drops unknown fields', () => {
    const parsed = parseSendEmailRequest({
      ...validDigestBase,
      bogus: 'ignored',
      digest: {
        week: '2026-W41',
        facts: [{ ...validFact, merchant: 'Alko' }],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !('digest' in parsed.value)) return;
    expect(parsed.value.digest.facts[0]!.merchant).toBe('Alko');
  });

  it('accepts a week at the exact cap', () => {
    const parsed = parseSendEmailRequest({
      ...validDigestBase,
      digest: {
        week: 'x'.repeat(MAX_DIGEST_WEEK_LENGTH),
        facts: [validFact],
      },
    });
    expect(parsed.ok).toBe(true);
  });
});

describe('parseSendEmailRequest — digest rejections', () => {
  it("rejects subject/body fields combined with 'digest'", () => {
    expectRejected(
      { ...validDigestBase, subject: 's' },
      422,
      "'subject' must not be combined with 'digest'",
    );
    expectRejected(
      { ...validDigestBase, text: 't' },
      422,
      "'text' must not be combined with 'digest'",
    );
    expectRejected(
      { ...validDigestBase, html: '<p>t</p>' },
      422,
      "'html' must not be combined with 'digest'",
    );
    expectRejected(
      { ...validDigestBase, replyTo: 'replies@example.com' },
      422,
      "'replyTo' must not be combined with 'digest'",
    );
  });

  it("rejects an invalid 'locale'", () => {
    expectRejected({ ...validDigestBase, locale: 'sv' }, 422, "'locale' must be 'fi' or 'en'");
    expectRejected({ ...validDigestBase, locale: 5 }, 422, "'locale' must be 'fi' or 'en'");
  });

  it("rejects a non-object 'digest'", () => {
    expectRejected({ to: 'digest@example.com', digest: 'nope' }, 422, "'digest' must be a JSON object");
    expectRejected({ to: 'digest@example.com', digest: [1] }, 422, "'digest' must be a JSON object");
  });

  it("rejects an invalid 'digest.week'", () => {
    expectRejected(
      { to: 'digest@example.com', digest: { facts: [validFact] } },
      422,
      "'digest.week' is required",
    );
    expectRejected(
      { to: 'digest@example.com', digest: { week: 41, facts: [validFact] } },
      422,
      "'digest.week' must be a string",
    );
    expectRejected(
      { to: 'digest@example.com', digest: { week: '', facts: [validFact] } },
      422,
      "'digest.week' must not be empty",
    );
    expectRejected(
      { to: 'digest@example.com', digest: { week: '2026-W41\r\nBcc: v@x.co', facts: [validFact] } },
      422,
      "'digest.week' must not contain line breaks",
    );
    expectRejected(
      {
        to: 'digest@example.com',
        digest: { week: 'x'.repeat(MAX_DIGEST_WEEK_LENGTH + 1), facts: [validFact] },
      },
      413,
      'character limit',
    );
  });

  it("rejects invalid 'digest.facts' containers", () => {
    expectRejected(
      { to: 'digest@example.com', digest: { week: '2026-W41' } },
      422,
      "'digest.facts' is required",
    );
    expectRejected(
      { to: 'digest@example.com', digest: { week: '2026-W41', facts: 'all' } },
      422,
      "'digest.facts' must be an array",
    );
    expectRejected(
      { to: 'digest@example.com', digest: { week: '2026-W41', facts: [] } },
      422,
      "'digest.facts' must contain at least one fact",
    );
    expectRejected(
      {
        to: 'digest@example.com',
        digest: {
          week: '2026-W41',
          facts: Array.from({ length: MAX_DIGEST_FACTS + 1 }, () => validFact),
        },
      },
      413,
      'fact limit',
    );
  });

  it('rejects a non-object fact and reports the index', () => {
    expectRejected(
      { ...validDigestBase, digest: { week: '2026-W41', facts: [validFact, 'beer'] } },
      422,
      "'digest.facts[1]' must be a JSON object",
    );
  });

  it.each([
    ['missing category', {}, 'category'],
    ['missing kind', { category: 'beer' }, 'kind'],
    ['missing priceCloseCents', { category: 'beer', kind: 'CATEGORY_MINIMUM' }, 'priceCloseCents'],
    [
      'missing productId',
      { category: 'beer', kind: 'CATEGORY_MINIMUM', priceCloseCents: 1234 },
      'productId',
    ],
  ])('rejects a fact with %s', (_name, fact, field) => {
    expectRejected(
      { ...validDigestBase, digest: { week: '2026-W41', facts: [fact] } },
      422,
      `'digest.facts[0].${field}' is required`,
    );
  });

  it('rejects a category outside the canonical set', () => {
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, category: 'vodka' }] },
      },
      422,
      "'digest.facts[0].category' must be one of",
    );
  });

  it('rejects a kind outside the closed union', () => {
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, kind: 'AVERAGE' }] },
      },
      422,
      "'digest.facts[0].kind' must be one of CATEGORY_MINIMUM, NOTABLE_NEW_LOW",
    );
  });

  it('rejects a non-integer or non-positive priceCloseCents', () => {
    for (const price of [0, -5, 12.5, '12,34']) {
      expectRejected(
        {
          ...validDigestBase,
          digest: { week: '2026-W41', facts: [{ ...validFact, priceCloseCents: price }] },
        },
        422,
        "'digest.facts[0].priceCloseCents' must be",
      );
    }
  });

  it('rejects a non-integer productId', () => {
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, productId: 4.2 }] },
      },
      422,
      "'digest.facts[0].productId' must be an integer",
    );
  });

  it('rejects an invalid merchant', () => {
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, merchant: 5 }] },
      },
      422,
      "'digest.facts[0].merchant' must be null or a string",
    );
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, merchant: '' }] },
      },
      422,
      "'digest.facts[0].merchant' must not be empty",
    );
  });

  it('rejects an invalid periodStart', () => {
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, periodStart: '' }] },
      },
      422,
      "'digest.facts[0].periodStart' must be a non-empty ISO date string",
    );
    expectRejected(
      {
        ...validDigestBase,
        digest: { week: '2026-W41', facts: [{ ...validFact, periodStart: 20261005 }] },
      },
      422,
      "'digest.facts[0].periodStart' must be a non-empty ISO date string",
    );
  });
});
