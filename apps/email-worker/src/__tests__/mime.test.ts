/**
 * MIME construction suite (task 5.3): header set/order, single-part and
 * multipart/alternative bodies, UTF-8 base64 payload round-trips, RFC 2047
 * subject encoding, and header-injection guards.
 *
 * @module mime.test
 */

import { describe, expect, it } from 'vitest';
import { buildMimeMessage, formatRfc5322Date, type OutgoingEmail } from '../mime';

const NOW = new Date('2026-08-30T12:34:56Z');
const ID = '0a1b2c3d-0000-4000-8000-000000000000';

function build(email: Omit<OutgoingEmail, 'from'> & { from?: string }) {
  return buildMimeMessage(
    { from: 'alerts@rajahinta.fi', ...email },
    NOW,
    ID,
  );
}

function decodeBase64Utf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Body = everything after the header/body blank line, unwrapped. */
function bodyOf(mime: string): string {
  const separator = mime.indexOf('\r\n\r\n');
  return mime.slice(separator + 4).replace(/\r\n/g, '');
}

describe('formatRfc5322Date', () => {
  it('formats UTC date-time with +0000', () => {
    expect(formatRfc5322Date(NOW)).toBe('Sun, 30 Aug 2026 12:34:56 +0000');
  });

  it('pads single digits', () => {
    expect(formatRfc5322Date(new Date('2026-01-05T03:04:05Z'))).toBe(
      'Mon, 05 Jan 2026 03:04:05 +0000',
    );
  });
});

describe('buildMimeMessage — headers', () => {
  const built = build({ to: 'ops@example.com', subject: 'Freshness alert', text: 'body' });

  it('emits the required header set in canonical order', () => {
    const headerBlock = built.mime.split('\r\n\r\n')[0];
    expect(headerBlock).toBe(
      [
        'From: alerts@rajahinta.fi',
        'To: ops@example.com',
        'Subject: Freshness alert',
        `Date: ${formatRfc5322Date(NOW)}`,
        `Message-ID: <${ID}@rajahinta.fi>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
      ].join('\r\n'),
    );
  });

  it('uses the injected Message-ID and returns it in the outcome', () => {
    expect(built.messageId).toBe(`<${ID}@rajahinta.fi>`);
    expect(built.mime).toContain(`Message-ID: <${ID}@rajahinta.fi>`);
  });

  it('adds Reply-To only when provided', () => {
    const withReplyTo = build({
      to: 'ops@example.com',
      subject: 's',
      text: 'b',
      replyTo: 'replies@example.com',
    });
    expect(withReplyTo.mime).toContain('Reply-To: replies@example.com');
    const withoutReplyTo = build({ to: 'ops@example.com', subject: 's', text: 'b' });
    expect(withoutReplyTo.mime).not.toContain('Reply-To:');
  });

  it('encodes non-ASCII subjects as an RFC 2047 UTF-8 encoded-word', () => {
    const subject = 'Määräpäivä hälytys';
    const built = build({ to: 'ops@example.com', subject, text: 'b' });
    const subjectLine = built.mime.split('\r\n').find((l) => l.startsWith('Subject: '));
    const encoded = subjectLine!.replace('Subject: ', '');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[\w+/=]+\?=$/);
    // Round-trip: decode the encoded word back to the original subject.
    const b64 = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
    expect(decodeBase64Utf8(b64)).toBe(subject);
  });

  it('throws on CR/LF in header-derived fields (header injection)', () => {
    expect(() => build({ to: 'ops@example.com', subject: 'x\r\nBcc: a@b.co', text: 'b' })).toThrow();
    expect(() => build({ to: 'ops@example.com', subject: 'x\nBcc: a@b.co', text: 'b' })).toThrow();
    expect(() =>
      build({ to: 'ops@example.com', subject: 's', text: 'b', replyTo: 'a@b.co\r\nBcc: x@y.co' }),
    ).toThrow();
  });
});

describe('buildMimeMessage — single-part bodies', () => {
  it('builds text/plain when only text is present', () => {
    const built = build({ to: 'ops@example.com', subject: 's', text: 'Hello, maailma!' });
    expect(built.mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(built.mime).not.toContain('text/html');
    expect(built.mime).not.toContain('multipart/alternative');
    expect(decodeBase64Utf8(bodyOf(built.mime))).toBe('Hello, maailma!');
  });

  it('builds text/html when only html is present', () => {
    const built = build({ to: 'ops@example.com', subject: 's', html: '<p>Hello, <b>maailma</b>!</p>' });
    expect(built.mime).toContain('Content-Type: text/html; charset=utf-8');
    expect(built.mime).not.toContain('text/plain');
    expect(decodeBase64Utf8(bodyOf(built.mime))).toBe('<p>Hello, <b>maailma</b>!</p>');
  });

  it('wraps long base64 bodies at 76 characters', () => {
    const built = build({ to: 'ops@example.com', subject: 's', text: 'x'.repeat(500) });
    const rawBody = built.mime.slice(built.mime.indexOf('\r\n\r\n') + 4);
    for (const line of rawBody.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

describe('buildMimeMessage — multipart/alternative', () => {
  const built = build({
    to: 'ops@example.com',
    subject: 'Alert',
    text: 'Plain version with ääkköset',
    html: '<p>HTML <b>version</b></p>',
  });

  it('declares multipart/alternative with a quoted boundary', () => {
    const contentType = built.mime.split('\r\n').find((l) => l.startsWith('Content-Type: multipart'));
    expect(contentType).toMatch(/^Content-Type: multipart\/alternative; boundary="=.+"/);
  });

  it('contains text/plain and text/html parts in that order', () => {
    const plainIndex = built.mime.indexOf('Content-Type: text/plain; charset=utf-8');
    const htmlIndex = built.mime.indexOf('Content-Type: text/html; charset=utf-8');
    expect(plainIndex).toBeGreaterThan(-1);
    expect(htmlIndex).toBeGreaterThan(plainIndex);
  });

  it('opens every part with the boundary and closes with the final boundary', () => {
    const boundary = /boundary="([^"]+)"/.exec(built.mime)![1];
    const lines = built.mime.split('\r\n').filter((l) => l.length > 0);
    expect(lines.filter((l) => l === `--${boundary}`).length).toBe(2);
    expect(lines[lines.length - 1]).toBe(`--${boundary}--`);
  });

  it('decodes each part back to its source body', () => {
    const boundary = /boundary="([^"]+)"/.exec(built.mime)![1];
    const parts = built.mime
      .split(`--${boundary}\r\n`)
      .slice(1)
      .map((part) => part.replace(`--${boundary}--\r\n`, ''));
    expect(parts.length).toBe(2);
    const plainPayload = parts[0].split('\r\n\r\n')[1];
    const htmlPayload = parts[1].split('\r\n\r\n')[1];
    expect(decodeBase64Utf8(plainPayload!.replace(/\r\n$/, ''))).toBe('Plain version with ääkköset');
    expect(decodeBase64Utf8(htmlPayload!.replace(/\r\n$/, ''))).toBe('<p>HTML <b>version</b></p>');
  });

  it('uses CRLF line endings throughout', () => {
    expect(built.mime).toContain('\r\n');
    expect(built.mime).not.toMatch(/(?<!\r)\n/);
  });
});

describe('buildMimeMessage — binding payload', () => {
  it('emits the structured binding message with reply_to mapping and raw subject', () => {
    const built = build({
      to: 'ops@example.com',
      subject: 'Määräpäivä',
      text: 't',
      html: '<p>h</p>',
      replyTo: 'replies@example.com',
    });
    expect(built.bindingMessage).toEqual({
      from: 'alerts@rajahinta.fi',
      to: 'ops@example.com',
      subject: 'Määräpäivä', // raw — the binding encodes its own headers
      text: 't',
      html: '<p>h</p>',
      reply_to: 'replies@example.com',
    });
  });

  it('omits html key for text-only messages', () => {
    const built = build({ to: 'ops@example.com', subject: 's', text: 't' });
    expect('html' in built.bindingMessage).toBe(false);
    expect('reply_to' in built.bindingMessage).toBe(false);
  });
});
