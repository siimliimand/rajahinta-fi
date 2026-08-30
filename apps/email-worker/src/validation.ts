/**
 * Request validation for the internal send contract (migrate-to-cloudflare
 * task 5.3): conservative syntactic email checks + subject/body caps.
 *
 * `isValidEmailFormat` mirrors the rules in
 * packages/application-api/src/accounts/email-verification.ts rule-for-rule
 * (same RFC 5321 length cap, same single-@/dot rules). Duplicated on purpose:
 * application-api is NestJS-bound and the email Worker must not depend on it.
 * Keep the two implementations in sync.
 *
 * @module validation
 */

/** RFC 5321 practical maximum email length (same cap as application-api). */
const MAX_EMAIL_LENGTH = 320;

export const MAX_SUBJECT_LENGTH = 255;

/** Per-body-part cap. Transactional/operational mail is small by design. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Conservative syntactic email check — mirrors
 * packages/application-api/src/accounts/email-verification.ts.
 */
export function isValidEmailFormat(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const [local, domain] = [email.slice(0, at), email.slice(at + 1)];
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  return true;
}

export interface SendEmailRequest {
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: string;
}

export type SendEmailRequestParse =
  | { readonly ok: true; readonly value: SendEmailRequest }
  | { readonly ok: false; readonly status: number; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(
  status: number,
  message: string,
): Extract<SendEmailRequestParse, { ok: false }> {
  return { ok: false, status, message };
}

const encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Validate the send-request body. Field order is stable so callers get a
 * deterministic first-error message; every rejection carries a distinct
 * message for exact contract tests.
 */
export function parseSendEmailRequest(raw: unknown): SendEmailRequestParse {
  if (!isRecord(raw)) {
    return fail(400, 'Request body must be a JSON object');
  }

  const to = raw['to'];
  if (to === undefined) return fail(422, "'to' is required");
  if (typeof to !== 'string') return fail(422, "'to' must be a string");
  if (!isValidEmailFormat(to)) {
    return fail(422, "'to' must be a valid email address");
  }

  const subject = raw['subject'];
  if (subject === undefined) return fail(422, "'subject' is required");
  if (typeof subject !== 'string') {
    return fail(422, "'subject' must be a string");
  }
  if (subject.length === 0) return fail(422, "'subject' must not be empty");
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return fail(413, `'subject' exceeds the ${MAX_SUBJECT_LENGTH}-character limit`);
  }
  if (/[\r\n]/.test(subject)) {
    return fail(422, "'subject' must not contain line breaks");
  }

  const text = raw['text'];
  if (text !== undefined && typeof text !== 'string') {
    return fail(422, "'text' must be a string");
  }
  const html = raw['html'];
  if (html !== undefined && typeof html !== 'string') {
    return fail(422, "'html' must be a string");
  }

  if (text !== undefined && utf8ByteLength(text) > MAX_BODY_BYTES) {
    return fail(413, `'text' exceeds the ${MAX_BODY_BYTES}-byte limit`);
  }
  if (html !== undefined && utf8ByteLength(html) > MAX_BODY_BYTES) {
    return fail(413, `'html' exceeds the ${MAX_BODY_BYTES}-byte limit`);
  }

  if (text === undefined && html === undefined) {
    return fail(422, "at least one of 'text' or 'html' is required");
  }

  const replyTo = raw['replyTo'];
  if (replyTo !== undefined) {
    if (typeof replyTo !== 'string') {
      return fail(422, "'replyTo' must be a string");
    }
    if (!isValidEmailFormat(replyTo)) {
      return fail(422, "'replyTo' must be a valid email address");
    }
  }

  return {
    ok: true,
    value: {
      to,
      subject,
      ...(text !== undefined ? { text } : {}),
      ...(html !== undefined ? { html } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    },
  };
}
