/**
 * Newsletter template tests (task 5.3, change
 * trust-and-reach-roadmap) — pin the FI + EN body structure (the
 * verification-mail pattern: FI leads, `---` separator, EN follows),
 * the raw-token-never-in-text rule (tokens ride only inside link
 * URLs), and the compliance invariant that EVERY newsletter email
 * carries a one-click unsubscribe link.
 *
 * @module templates.test
 */

import { describe, expect, it } from 'vitest';
import {
  buildNewsletterBroadcastEmail,
  buildNewsletterConfirmationEmail,
  escapeHtml,
} from '../templates';

const CONFIRM = {
  confirmUrl: 'https://rajahinta.fi/fi/newsletter/confirm?token=tok-123',
  unsubscribeUrl: 'https://rajahinta.fi/fi/newsletter/unsubscribe?token=tok-123',
};

describe('buildNewsletterConfirmationEmail', () => {
  it('renders FI + EN blocks with both links', () => {
    const mail = buildNewsletterConfirmationEmail(CONFIRM);

    expect(mail.subject).toBe(
      'Vahvista uutiskirje tilaus / Confirm your newsletter subscription — rajahinta',
    );
    // FI block first, `---` separator, EN block (the verification-mail pattern).
    expect(mail.text.indexOf('Vahvista uutiskirjeen tilauksesi')).toBeGreaterThan(-1);
    expect(mail.text.indexOf('\n---\n')).toBeGreaterThan(0);
    expect(mail.text.indexOf('Confirm your newsletter subscription')).toBeGreaterThan(
      mail.text.indexOf('\n---\n'),
    );
    expect(mail.text).toContain(CONFIRM.confirmUrl);
    expect(mail.html).toContain(`href="${CONFIRM.confirmUrl}"`);
    expect(mail.html).toContain(`href="${CONFIRM.unsubscribeUrl}"`);
    expect(mail.html).toContain('Vahvista uutiskirjeen tilauksesi');
    expect(mail.html).toContain('<hr>');
  });

  it('keeps the token only inside URLs (never in prose)', () => {
    const mail = buildNewsletterConfirmationEmail(CONFIRM);
    const proseText = mail.text.split('\n').filter((line) => !line.includes('http'));
    expect(proseText.join('\n')).not.toContain('tok-123');
  });
});

describe('buildNewsletterBroadcastEmail', () => {
  const base = {
    subject: 'Rajahinta-uutiskirje / Newsletter',
    bodyFi: 'Tullimuutokset astuivat voimaan.\n\nHintaindeksi päivittyi.',
    bodyEn: 'The tax changes took effect.\n\nThe price index was updated.',
    unsubscribeUrl: 'https://rajahinta.fi/fi/newsletter/unsubscribe?token=tok-abc',
  };

  it('renders FI + EN paragraphs and the unsubscribe link in both parts', () => {
    const mail = buildNewsletterBroadcastEmail(base);

    expect(mail.subject).toBe(base.subject);
    expect(mail.text).toContain('Tullimuutokset astuivat voimaan.');
    expect(mail.text.indexOf('The tax changes took effect.')).toBeGreaterThan(
      mail.text.indexOf('Tullimuutokset astuivat voimaan.'),
    );
    expect(mail.text).toContain(`Lopeta tilaus / Unsubscribe: ${base.unsubscribeUrl}`);
    expect(mail.html).toContain('<p>Tullimuutokset astuivat voimaan.</p>');
    expect(mail.html).toContain('href="' + base.unsubscribeUrl + '"');
  });

  it('escapes HTML-significant characters in operator bodies', () => {
    const mail = buildNewsletterBroadcastEmail({
      ...base,
      bodyFi: 'Hinta <20 € & "tarjous" ei ole <b>leipätekstiä</b>',
    });
    expect(mail.html).toContain(
      '&lt;20 € &amp; &quot;tarjous&quot; ei ole &lt;b&gt;leipätekstiä&lt;/b&gt;',
    );
    expect(mail.html).not.toContain('<b>leipätekstiä</b>');
  });

  it('refuses to render without an unsubscribe URL or with an empty subject', () => {
    expect(() =>
      buildNewsletterBroadcastEmail({ ...base, unsubscribeUrl: '' }),
    ).toThrow('unsubscribe URL');
    expect(() => buildNewsletterBroadcastEmail({ ...base, subject: '  \n  ' })).toThrow(
      'subject',
    );
  });

  it('collapses line breaks in the subject (send-contract line-break rule)', () => {
    const mail = buildNewsletterBroadcastEmail({
      ...base,
      subject: 'Otsikko\njonka sisällä\r\nrivinvaihto',
    });
    expect(mail.subject).toBe('Otsikko jonka sisällä rivinvaihto');
  });
});

describe('escapeHtml', () => {
  it('escapes the characters significant in double-quoted HTML contexts', () => {
    expect(escapeHtml('<a href="x">&\'>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;\'&gt;',
    );
  });
});
