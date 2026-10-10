/**
 * Request validation for the internal send contract (migrate-to-cloudflare
 * task 5.3): conservative syntactic email checks + subject/body caps.
 *
 * Two payload kinds share the contract (change add-onboarding-preferences,
 * task 4.3b): the generic `{ to, subject, text?, html?, replyTo? }` mail and
 * the structured digest payload `{ to, locale?, digest: { week, facts } }`
 * the preference-digest cron dispatches — recognized by its `digest` field
 * and validated field-by-field against the core-domain `DigestFact` shape
 * before the worker renders it (apps/email-worker owns digest rendering).
 *
 * `isValidEmailFormat` mirrors the rules in
 * packages/application-api/src/accounts/email-verification.ts rule-for-rule
 * (same RFC 5321 length cap, same single-@/dot rules). Duplicated on purpose:
 * application-api is NestJS-bound and the email Worker must not depend on it.
 * Keep the two implementations in sync.
 *
 * @module validation
 */

import {
  DIGEST_CATEGORY_VALUES,
  type DigestFact,
} from '../../../packages/core-domain/src/digest/digest.types';
import type { DigestEmailLocale } from './preference-digest-email';

/** RFC 5321 practical maximum email length (same cap as application-api). */
const MAX_EMAIL_LENGTH = 320;

export const MAX_SUBJECT_LENGTH = 255;

/** Per-body-part cap. Transactional/operational mail is small by design. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * ISO week-key cap (`2026-W41` is 8 chars) — the week renders into the
 * digest subject, so the same hygiene bounds the subject-line input.
 */
export const MAX_DIGEST_WEEK_LENGTH = 16;

/**
 * Fact-count cap — a real digest is at most two facts per category (six
 * canonical categories); this bounds abuse, not real payloads.
 */
export const MAX_DIGEST_FACTS = 64;

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

/**
 * The structured digest payload (the cron's dispatch shape): `to` plus the
 * `digest` field the shared send path recognizes it by. `locale` defaults
 * to `'fi'` — accounts carry no locale column (design open question), so
 * the site's primary language is the default until a per-account choice
 * exists.
 */
export interface DigestEmailRequest {
  readonly to: string;
  readonly locale: DigestEmailLocale;
  readonly digest: {
    /** The ISO week key the digest covers, e.g. `2026-W41`. */
    readonly week: string;
    /** The cited facts, validated against the core-domain `DigestFact` shape. */
    readonly facts: readonly DigestFact[];
  };
}

export type SendEmailRequestParse =
  | {
      readonly ok: true;
      readonly value: SendEmailRequest | DigestEmailRequest;
    }
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

  // The `digest` field is what distinguishes the structured digest payload
  // from the generic subject/body mail on the shared send path.
  const digest = raw['digest'];
  if (digest !== undefined) {
    return parseDigestSendRequest(raw, to, digest);
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

/**
 * Validate the structured digest payload. Field order is stable (same
 * deterministic first-error contract as the generic kind) and every fact
 * field is checked against the `DigestFact` shape — the same constraints
 * the pure computation enforces on its inputs (canonical category set,
 * closed kind union, integer price > 0, integer product id, nullable
 * merchant, non-empty bucket day). An empty fact set is rejected here so
 * the never-send-an-empty-digest rule fails as a 422, not as a render-time
 * 500. The post-validation `facts` cast is sound: every item passed the
 * per-field checks above.
 */
function parseDigestSendRequest(
  raw: Record<string, unknown>,
  to: string,
  digest: unknown,
): SendEmailRequestParse {
  // The digest kind carries ONLY the structured fields — subject/body
  // fields would be silently ignored, so their presence is a caller bug.
  for (const field of ['subject', 'text', 'html', 'replyTo'] as const) {
    if (raw[field] !== undefined) {
      return fail(422, `'${field}' must not be combined with 'digest'`);
    }
  }

  let locale: DigestEmailLocale = 'fi';
  const localeValue = raw['locale'];
  if (localeValue !== undefined) {
    if (localeValue !== 'fi' && localeValue !== 'en') {
      return fail(422, "'locale' must be 'fi' or 'en'");
    }
    locale = localeValue;
  }

  if (!isRecord(digest)) {
    return fail(422, "'digest' must be a JSON object");
  }

  const week = digest['week'];
  if (week === undefined) return fail(422, "'digest.week' is required");
  if (typeof week !== 'string') {
    return fail(422, "'digest.week' must be a string");
  }
  if (week.length === 0) return fail(422, "'digest.week' must not be empty");
  if (/[\r\n]/.test(week)) {
    return fail(422, "'digest.week' must not contain line breaks");
  }
  if (week.length > MAX_DIGEST_WEEK_LENGTH) {
    return fail(
      413,
      `'digest.week' exceeds the ${MAX_DIGEST_WEEK_LENGTH}-character limit`,
    );
  }

  const facts = digest['facts'];
  if (facts === undefined) return fail(422, "'digest.facts' is required");
  if (!Array.isArray(facts)) return fail(422, "'digest.facts' must be an array");
  if (facts.length === 0) {
    return fail(422, "'digest.facts' must contain at least one fact");
  }
  if (facts.length > MAX_DIGEST_FACTS) {
    return fail(413, `'digest.facts' exceeds the ${MAX_DIGEST_FACTS}-fact limit`);
  }
  for (let index = 0; index < facts.length; index++) {
    const rejection = validateDigestFact(facts[index], index);
    if (rejection !== null) return rejection;
  }

  return {
    ok: true,
    value: {
      to,
      locale,
      digest: { week, facts: facts as readonly DigestFact[] },
    },
  };
}

/** Validate one fact against the `DigestFact` shape (stable field order). */
function validateDigestFact(
  fact: unknown,
  index: number,
): Extract<SendEmailRequestParse, { ok: false }> | null {
  const at = (field: string): string => `'digest.facts[${index}].${field}'`;

  if (!isRecord(fact)) {
    return fail(422, `'digest.facts[${index}]' must be a JSON object`);
  }

  const category = fact['category'];
  if (category === undefined) return fail(422, `${at('category')} is required`);
  if (!(DIGEST_CATEGORY_VALUES as readonly string[]).includes(category as string)) {
    return fail(
      422,
      `${at('category')} must be one of ${DIGEST_CATEGORY_VALUES.join(', ')}`,
    );
  }

  const kind = fact['kind'];
  if (kind === undefined) return fail(422, `${at('kind')} is required`);
  if (kind !== 'CATEGORY_MINIMUM' && kind !== 'NOTABLE_NEW_LOW') {
    return fail(422, `${at('kind')} must be one of CATEGORY_MINIMUM, NOTABLE_NEW_LOW`);
  }

  const priceCloseCents = fact['priceCloseCents'];
  if (priceCloseCents === undefined) {
    return fail(422, `${at('priceCloseCents')} is required`);
  }
  if (typeof priceCloseCents !== 'number') {
    return fail(422, `${at('priceCloseCents')} must be a number`);
  }
  if (!Number.isInteger(priceCloseCents) || priceCloseCents <= 0) {
    return fail(422, `${at('priceCloseCents')} must be an integer > 0`);
  }

  const productId = fact['productId'];
  if (productId === undefined) return fail(422, `${at('productId')} is required`);
  if (typeof productId !== 'number') {
    return fail(422, `${at('productId')} must be a number`);
  }
  if (!Number.isInteger(productId)) {
    return fail(422, `${at('productId')} must be an integer`);
  }

  const merchant = fact['merchant'];
  if (merchant === undefined) return fail(422, `${at('merchant')} is required`);
  if (merchant !== null && typeof merchant !== 'string') {
    return fail(422, `${at('merchant')} must be null or a string`);
  }
  if (merchant === '') {
    return fail(422, `${at('merchant')} must not be empty`);
  }

  const periodStart = fact['periodStart'];
  if (periodStart === undefined) {
    return fail(422, `${at('periodStart')} is required`);
  }
  if (typeof periodStart !== 'string' || periodStart.length === 0) {
    return fail(422, `${at('periodStart')} must be a non-empty ISO date string`);
  }

  return null;
}
