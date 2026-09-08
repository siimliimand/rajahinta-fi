/**
 * Newsletter mail templates (task 5.3, change trust-and-reach-roadmap;
 * design D4, spec content-publication) — the FI + EN body builders for
 * the two newsletter mails, following the existing body-template
 * pattern (email-token.service.ts buildVerificationEmail: the Finnish
 * block leads, a `---` / `<hr>` separator, the English block follows,
 * and the raw token appears ONLY inside the link URLs).
 *
 * Every newsletter email carries a one-click unsubscribe link (spec:
 * "Every newsletter email SHALL carry a one-click unsubscribe link") —
 * the builders REJECT an empty unsubscribe URL so a caller cannot
 * render a compliant-less mail by accident.
 *
 * This module is deliberately dependency-free (no Hono, no env types)
 * so the API Worker's newsletter route can import the builders without
 * dragging the email Worker's application in — the same trade the
 * duplicated secret-header constants document, resolved the better way
 * now that the shared thing is a function instead of one string.
 *
 * @module templates
 */

/** Minimal HTML escaping for operator-composed content interpolated into the HTML part. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip line breaks + trim — the send contract rejects subjects carrying line breaks. */
function sanitizeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Strip trailing CR/LF from every interpolated line value (header-injection hygiene). */
function sanitizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Rendered mail the send contract accepts (to/subject/text/html are the caller's to add). */
export interface NewsletterMailBody {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// ---------------------------------------------------------------------------
// Double opt-in confirmation mail
// ---------------------------------------------------------------------------

/** Input for the double opt-in confirmation mail. */
export interface NewsletterConfirmationInput {
  /** The one-click confirm URL — carries the raw single-use token. */
  readonly confirmUrl: string;
  /** The unsubscribe URL carried for parity (a pending recipient can opt out too). */
  readonly unsubscribeUrl: string;
}

/**
 * Render the double opt-in confirmation mail. FI + EN in one mail (the
 * subscriber preference is unknown pre-confirmation — the verification
 * mail's bilingual pattern).
 */
export function buildNewsletterConfirmationEmail(
  input: NewsletterConfirmationInput,
): NewsletterMailBody {
  const confirmUrl = sanitizeLine(input.confirmUrl);
  const unsubscribeUrl = sanitizeLine(input.unsubscribeUrl);
  return {
    subject: sanitizeSubject(
      'Vahvista uutiskirje tilaus / Confirm your newsletter subscription — rajahinta',
    ),
    text: [
      'Hei!',
      '',
      'Vahvista uutiskirjeen tilauksesi avaamalla seuraava linkki:',
      confirmUrl,
      '',
      'Jos et tilannut uutiskirjettä, voit jättää tämän viestin huomiotta —',
      'tilausta ei aktivoidu ilman vahvistusta.',
      '',
      '---',
      '',
      'Hello!',
      '',
      'Confirm your newsletter subscription by opening the link below:',
      confirmUrl,
      '',
      'If you did not subscribe to the newsletter, you can ignore this',
      'message — the subscription is not activated without confirmation.',
      '',
      `Lopeta tilaus / Unsubscribe: ${unsubscribeUrl}`,
      '',
      '-- rajahinta.fi',
      '',
    ].join('\n'),
    html: [
      '<p>Hei!</p>',
      `<p>Vahvista uutiskirjeen tilauksesi avaamalla <a href="${confirmUrl}">tämä linkki</a>.</p>`,
      '<p>Jos et tilannut uutiskirjettä, voit jättää tämän viestin huomiotta — tilausta ei aktivoidu ilman vahvistusta.</p>',
      '<hr>',
      '<p>Hello!</p>',
      `<p>Confirm your newsletter subscription by opening <a href="${confirmUrl}">this link</a>.</p>`,
      '<p>If you did not subscribe to the newsletter, you can ignore this message — the subscription is not activated without confirmation.</p>',
      `<p style="font-size:12px;color:#666"><a href="${unsubscribeUrl}">Unsubscribe / Peruta tilaus</a></p>`,
      '<p style="font-size:12px;color:#666">— rajahinta.fi</p>',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Broadcast mail (ops notify-subscribers)
// ---------------------------------------------------------------------------

/** Input for one recipient's broadcast mail. */
export interface NewsletterBroadcastInput {
  /** Subject line (FI/EN composed by the operator — one line). */
  readonly subject: string;
  /** Finnish body — plain text paragraphs. */
  readonly bodyFi: string;
  /** English body — plain text paragraphs. */
  readonly bodyEn: string;
  /** This recipient's one-click unsubscribe URL (per-subscriber token). */
  readonly unsubscribeUrl: string;
}

/** Split an operator body into non-empty trimmed paragraphs. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * Render one recipient's broadcast mail. The unsubscribe link is
 * per-recipient (it carries the subscriber's token), so the body is
 * rendered per recipient — every newsletter email carries it (spec).
 */
export function buildNewsletterBroadcastEmail(
  input: NewsletterBroadcastInput,
): NewsletterMailBody {
  const subject = sanitizeSubject(input.subject);
  if (subject.length === 0) {
    throw new Error('newsletter broadcast subject is required');
  }
  if (sanitizeLine(input.unsubscribeUrl).length === 0) {
    // A newsletter without the one-click unsubscribe link is not
    // sendable (spec content-publication).
    throw new Error('newsletter broadcast requires an unsubscribe URL');
  }
  const fi = paragraphs(input.bodyFi);
  const en = paragraphs(input.bodyEn);
  const unsubscribeUrl = sanitizeLine(input.unsubscribeUrl);

  return {
    subject,
    text: [
      ...fi,
      '',
      '---',
      '',
      ...en,
      '',
      '--',
      `Lopeta tilaus / Unsubscribe: ${unsubscribeUrl}`,
      '',
      '-- rajahinta.fi',
      '',
    ].join('\n'),
    html: [
      ...fi.map((p) => `<p>${escapeHtml(p)}</p>`),
      '<hr>',
      ...en.map((p) => `<p>${escapeHtml(p)}</p>`),
      `<p style="font-size:12px;color:#666"><a href="${unsubscribeUrl}">Lopeta tilaus / Unsubscribe</a></p>`,
      '<p style="font-size:12px;color:#666">— rajahinta.fi</p>',
    ].join('\n'),
  };
}
