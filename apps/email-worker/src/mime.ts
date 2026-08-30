/**
 * MIME (RFC 5322 + MIME) message construction (migrate-to-cloudflare task
 * 5.3, design D7).
 *
 * Builds the full wire message — headers From/To/Reply-To/Subject/Date/
 * Message-ID plus a single text/plain or text/html part, or a
 * multipart/alternative body when both are present. Body parts travel
 * base64-encoded with UTF-8 charset so Finnish text survives every hop
 * regardless of intermediate line handling.
 *
 * The builder also emits the structured payload the Cloudflare `send_email`
 * binding consumes (the binding constructs its own MIME from those fields);
 * the full RFC 5322 message is the canonical reference for tests and for any
 * future raw-MIME transport.
 *
 * @module mime
 */

import type { SendEmailBindingMessage } from './env';

/** Domain used for generated Message-IDs. */
const MESSAGE_ID_DOMAIN = 'rajahinta.fi';

const CRLF = '\r\n';

export interface OutgoingEmail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: string;
}

export interface BuiltEmailMessage {
  /** Generated Message-ID including angle brackets, e.g. `<uuid@rajahinta.fi>`. */
  readonly messageId: string;
  /** RFC 5322 date string used in the Date header. */
  readonly date: string;
  /** Full RFC 5322 message (headers + CRLF + body). */
  readonly mime: string;
  /** Structured payload for the `send_email` binding. */
  readonly bindingMessage: SendEmailBindingMessage;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** RFC 5322 date-time in UTC (`+0000`). */
export function formatRfc5322Date(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${WEEKDAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ` +
    `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

/** Defense in depth against header injection — callers validate first. */
function assertNoCrlf(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} must not contain CR/LF (header injection)`);
  }
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Wrap base64 at the RFC-recommended 76 characters per line. */
function wrapBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join(CRLF);
}

/** RFC 2047 encoded-word for non-printable-ASCII subjects, passthrough otherwise. */
function encodeSubjectHeader(subject: string): string {
  if (/^[\x20-\x7E]+$/.test(subject)) return subject;
  return `=?UTF-8?B?${base64Utf8(subject)}?=`;
}

/**
 * Build the outbound message. `now` and `messageIdLocalPart` are injectable
 * so tests get deterministic Date/Message-ID headers.
 */
export function buildMimeMessage(
  email: OutgoingEmail,
  now: Date = new Date(),
  messageIdLocalPart: string = crypto.randomUUID(),
): BuiltEmailMessage {
  assertNoCrlf(email.from, 'from');
  assertNoCrlf(email.to, 'to');
  assertNoCrlf(email.subject, 'subject');
  if (email.replyTo !== undefined) assertNoCrlf(email.replyTo, 'replyTo');

  const messageId = `<${messageIdLocalPart}@${MESSAGE_ID_DOMAIN}>`;
  const date = formatRfc5322Date(now);

  const headers: string[] = [
    `From: ${email.from}`,
    `To: ${email.to}`,
    ...(email.replyTo !== undefined ? [`Reply-To: ${email.replyTo}`] : []),
    `Subject: ${encodeSubjectHeader(email.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];

  let mime: string;

  if (email.text !== undefined && email.html !== undefined) {
    const boundary = `=_rh_${crypto.randomUUID().replaceAll('-', '')}`;
    const part = (contentType: string, body: string): string =>
      `--${boundary}${CRLF}` +
      `Content-Type: ${contentType}; charset=utf-8${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}` +
      CRLF +
      `${wrapBase64(base64Utf8(body))}${CRLF}`;

    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mime =
      `${headers.join(CRLF)}${CRLF}${CRLF}` +
      part('text/plain', email.text) +
      part('text/html', email.html) +
      `--${boundary}--${CRLF}`;
  } else {
    const body = email.text ?? email.html ?? '';
    const contentType = email.html !== undefined ? 'text/html' : 'text/plain';
    headers.push(
      `Content-Type: ${contentType}; charset=utf-8`,
      'Content-Transfer-Encoding: base64',
    );
    mime = `${headers.join(CRLF)}${CRLF}${CRLF}${wrapBase64(base64Utf8(body))}${CRLF}`;
  }

  const bindingMessage: SendEmailBindingMessage = {
    from: email.from,
    to: email.to,
    subject: email.subject,
    ...(email.text !== undefined ? { text: email.text } : {}),
    ...(email.html !== undefined ? { html: email.html } : {}),
    ...(email.replyTo !== undefined ? { reply_to: email.replyTo } : {}),
  };

  return { messageId, date, mime, bindingMessage };
}
