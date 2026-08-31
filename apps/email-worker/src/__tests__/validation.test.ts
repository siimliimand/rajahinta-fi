/**
 * Validation suite for the internal send contract — every rejection path and
 * the conservative email rules mirrored from application-api (task 5.3).
 *
 * @module validation.test
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
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
