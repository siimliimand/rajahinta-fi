/**
 * Contact routes (task 3.2, change first-impression-pass; design D8,
 * spec contact-intake) — the site's real, honest contact channel.
 *
 *   POST /api/v1/contact      CONTACT rate limit (5 / 10 min / IP)
 *
 * Two body dialects, one contract:
 * - JSON callers get JSON: the uniform 202 ack on success, the unified
 *   error envelope on rejection.
 * - Form-encoded callers are the no-JS HTML form: a native POST
 *   navigates, so every outcome — success included — is a 303 redirect
 *   back to /contact with `?sent=1` or `?error=<code>` for the page to
 *   render as an acknowledgement or error state.
 *
 * Honesty and data-minimization discipline (the page's own contract,
 * preserved from its channel-free era): no invented email address, no
 * response-time promise — the ack never implies a reply; a reply is
 * possible only when the sender left a reply email. The honeypot field
 * (`website`) answers the uniform ack while storing nothing — bots get
 * the same bytes as humans, so the endpoint is not a bot oracle. The
 * source IP is hashed with HMAC-SHA-256 under a deployment salt
 * (CONTACT_IP_HASH_SALT) before storage; the raw address is never
 * stored and never logged, and a missing salt fails closed (500,
 * nothing stored) because an unsalted hash would violate the
 * minimal-personal-data requirement.
 *
 * @module ContactRoutes
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { D1ContactMessageRepository } from '../../../../packages/data-platform/src/repositories/d1/contact-message.repository';
import type { ContactMessageTopic } from '../../../../packages/data-platform/src/abstracts';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { createLogger } from '../logger';
import { validationError } from './support';
import { isValidEmailFormat } from './auth.helpers';
import { requireRateLimit } from '../middleware/rate-limit';
import { resolveClientIdentity } from '../do/identity';

/** The message cap — mirrored by the schema's length CHECK (defense in depth). */
export const CONTACT_MESSAGE_MAX = 5000;

/** Reply-email cap — RFC 5321 practical maximum (isValidEmailFormat parity). */
export const CONTACT_EMAIL_MAX = 320;

/**
 * Whole-body cap. A valid submission is bounded by the field caps (5 KB
 * message + 320 B email + enum fields), so 16 KB is generous headroom
 * for form encoding — anything larger is rejected before parsing.
 */
const CONTACT_BODY_MAX_BYTES = 16_384;

/** The honeypot field — named like the trap it is; humans never see it. */
const HONEYPOT_FIELD = 'website';

const TOPICS: readonly ContactMessageTopic[] = [
  'product_error',
  'store_inquiry',
  'other',
];

const MESSAGE_REQUIRED = `"message" is required (1-${CONTACT_MESSAGE_MAX} characters)`;
const TOPIC_MESSAGE = `topic must be one of: ${TOPICS.join(', ')}`;
const LOCALE_MESSAGE = 'locale must be one of: fi, en';

const contactSchema = z.object({
  message: z
    .string({ required_error: MESSAGE_REQUIRED, invalid_type_error: MESSAGE_REQUIRED })
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1, MESSAGE_REQUIRED)
    .refine(
      (value) => value.length <= CONTACT_MESSAGE_MAX,
      `"message" must be at most ${CONTACT_MESSAGE_MAX} characters`,
    ),
  topic: z
    // Form fields arrive as strings; JSON callers may send anything —
    // coerce-first keeps one validation path for both dialects.
    .string({ invalid_type_error: TOPIC_MESSAGE })
    .refine((value): value is ContactMessageTopic =>
      (TOPICS as readonly string[]).includes(value), TOPIC_MESSAGE),
  reply_email: z
    .string({ invalid_type_error: '"reply_email" must be a string' })
    .max(CONTACT_EMAIL_MAX, `"reply_email" must be at most ${CONTACT_EMAIL_MAX} characters`)
    .optional(),
  locale: z
    .string({ invalid_type_error: LOCALE_MESSAGE })
    .refine((value) => value === 'fi' || value === 'en', LOCALE_MESSAGE)
    .optional(),
  // The honeypot is read before this schema runs; declared here so the
  // parsed shape is complete and stray fields stay explicit.
  [HONEYPOT_FIELD]: z.string().optional(),
});

/** Parsed + validated submission (honeypot removed — it never reaches here). */
interface ValidContactSubmission {
  message: string;
  topic: ContactMessageTopic;
  replyEmail: string | null;
  locale: 'fi' | 'en';
}

/** Ack payload — identical for humans and honeypot fills (no bot oracle). */
const ACK_BODY = { status: 'received' } as const;

/** Form redirect targets: one ack state, one error code per rejection. */
const FORM_SENT_PATH = '/contact?sent=1';

const isJsonRequest = (c: Context<AppEnv>): boolean =>
  (c.req.header('content-type') ?? '').toLowerCase().includes('application/json');

/** The frontend origin the native POST navigates back to (newsletter parity). */
function frontendOrigin(c: Context<AppEnv>): string {
  return (
    (c.env as { APP_PUBLIC_URL?: string }).APP_PUBLIC_URL ?? 'https://rajahinta.fi'
  );
}

/** 303 back to the contact page's acknowledgement or error state. */
function formRedirect(c: Context<AppEnv>, target: string): Response {
  return c.redirect(`${frontendOrigin(c)}${target}`, 303);
}

/**
 * The per-source admission for the intake, composed over the shared
 * requireRateLimit('CONTACT') middleware. The only deviation from the
 * plain accounts-rotate pattern: a 429 must ALSO render for the no-JS
 * form (the middleware would otherwise hand the browser a raw JSON
 * envelope), so form requests get the honest error-state redirect while
 * JSON callers keep the unified 429 envelope.
 */
export function requireContactRateLimit(): MiddlewareHandler<AppEnv> {
  const admission = requireRateLimit('CONTACT');
  return async (c, next) => {
    try {
      await admission(c, next);
      // Admitted (or fail-open): the handler chain produced the response.
      return;
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 429 && !isJsonRequest(c)) {
        return formRedirect(c, '/contact?error=rate_limited');
      }
      throw err;
    }
  };
}

/**
 * Salted HMAC-SHA-256 of the source IP — the only IP-derived value that
 * ever reaches storage or logs (which see just the hex). The salt comes
 * from the deployment secret; absent salt ⇒ refused upstream.
 */
async function saltedIpHash(salt: string, ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Normalize the raw body fields (both dialects) into a string map. */
function fieldsFromJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiHttpError(400, 'Request body must be a JSON object');
  }
  return raw as Record<string, unknown>;
}

async function fieldsFromForm(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body = await c.req.parseBody();
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    // File parts pass through as non-strings so each field's own
    // invalid-type message rejects them — a contact form has no upload.
    fields[key] = value;
  }
  return fields;
}

/** Validate the normalized fields; null ⇒ the submission is a honeypot fill. */
function validateSubmission(
  fields: Record<string, unknown>,
): ValidContactSubmission | null {
  // Honeypot first: a non-empty trap field answers the uniform ack and
  // stores nothing — no validation, no hash, no row.
  const honeypot = fields[HONEYPOT_FIELD];
  if (typeof honeypot === 'string' ? honeypot.trim() !== '' : honeypot != null) {
    return null;
  }

  const result = contactSchema.safeParse(fields);
  if (!result.success) {
    throw validationError(result.error);
  }

  const replyEmail = result.data.reply_email?.trim() ?? '';
  if (replyEmail !== '' && !isValidEmailFormat(replyEmail)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"reply_email" is optional but must be a valid email address when present',
      error: 'InvalidEmail',
    });
  }

  return {
    message: result.data.message,
    topic: result.data.topic,
    // Absent, empty, and whitespace-only reply_email all mean "no reply
    // possible" — one stored shape (NULL), not three spellings.
    replyEmail: replyEmail === '' ? null : replyEmail,
    locale: result.data.locale ?? 'fi',
  };
}

/**
 * POST /api/v1/contact — accept one message. Every success path answers
 * the uniform ack (202 JSON / 303 `?sent=1` form); every rejection is
 * honest and machine-readable (JSON envelope) or renders (form error
 * redirect). Nothing is stored for a honeypot fill or a rejection.
 */
async function submitContact(c: Context<AppEnv>): Promise<Response> {
  const jsonMode = isJsonRequest(c);

  // Size cap before any parsing — content-length is declarative, so the
  // check is free and bounds what we are willing to read.
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > CONTACT_BODY_MAX_BYTES) {
    throw new ApiHttpError(413, {
      statusCode: 413,
      message: `Request body must be at most ${CONTACT_BODY_MAX_BYTES} bytes`,
      error: 'PayloadTooLarge',
    });
  }

  let fields: Record<string, unknown>;
  try {
    fields = jsonMode
      ? fieldsFromJson(await c.req.json())
      : await fieldsFromForm(c);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(400, 'Request body could not be parsed');
  }

  const submission = validateSubmission(fields);
  if (submission === null) {
    // Honeypot: the uniform ack, byte-identical to a human success —
    // store nothing, tell the bot nothing.
    return jsonMode ? c.json(ACK_BODY, 202) : formRedirect(c, FORM_SENT_PATH);
  }

  const salt = c.env.CONTACT_IP_HASH_SALT;
  if (salt === undefined || salt.trim() === '') {
    // Fail closed: an unsalted IP hash would violate minimal personal
    // data, so an unconfigured deployment refuses loudly instead.
    throw new ApiHttpError(500, {
      statusCode: 500,
      message: 'Contact intake is not configured',
      error: 'InternalServerError',
    });
  }

  // The raw address exists only inside this hash call — never in logs,
  // never in storage, never in an error payload.
  const ipHash = await saltedIpHash(
    salt,
    resolveClientIdentity(c.req.raw.headers),
  );

  try {
    await new D1ContactMessageRepository(c.env.DB).insert({
      message: submission.message,
      topic: submission.topic,
      replyEmail: submission.replyEmail,
      locale: submission.locale,
      ipHash,
    });
  } catch (err) {
    // A storage failure must not lose the sender silently: form senders
    // get the error state to retry from, JSON callers the envelope.
    createLogger(c.env.LOG_LEVEL).error({
      message: `Contact message store failed: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    });
    if (jsonMode) throw err;
    return formRedirect(c, '/contact?error=unavailable');
  }

  return jsonMode ? c.json(ACK_BODY, 202) : formRedirect(c, FORM_SENT_PATH);
}

/**
 * Map a thrown rejection onto the form redirect targets. Used by the
 * handler boundary below — validation/email/size failures thrown as
 * ApiHttpError inside {@link submitContact} would otherwise hit the
 * app-level boundary and hand the no-JS browser raw JSON.
 */
function formErrorRedirect(err: unknown): { code: string } | null {
  if (!(err instanceof ApiHttpError)) return null;
  const message = String(err.payload.message ?? '');
  switch (err.status) {
    case 400:
      if (err.payload.error === 'InvalidEmail') return { code: 'email' };
      // A cap violation ("must be at most …") is its own honest state —
      // "too long" — distinct from a generic invalid submission.
      if (message.includes('must be at most')) return { code: 'size' };
      return { code: 'invalid' };
    case 413:
      return { code: 'size' };
    default:
      return { code: 'unavailable' };
  }
}

/**
 * Register the contact handlers. The rate limit rides the route (the
 * accounts session/rotate precedent: `app.on('POST', …)` middleware
 * ahead of the handler) — the intake has no guard prefixes.
 */
export function registerContactRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('POST', '/api/v1/contact', requireContactRateLimit());
  app.post('/api/v1/contact', async (c) => {
    try {
      return await submitContact(c);
    } catch (err) {
      if (!isJsonRequest(c)) {
        const mapped = formErrorRedirect(err);
        if (mapped !== null) return formRedirect(c, `/contact?error=${mapped.code}`);
      }
      throw err;
    }
  });
  return app;
}
