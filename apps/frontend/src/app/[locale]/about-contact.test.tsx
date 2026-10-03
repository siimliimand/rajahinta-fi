/**
 * About + Contact page tests (task 3.3, change
 * price-intelligence-roadmap; contact form task 3.2, change
 * first-impression-pass).
 *
 * Renders the REAL async server components the way Next's RSC runtime
 * would (the savings/blog server-shell test precedent: only Next server
 * plumbing is mocked). Pinned here:
 *
 *   About (/about):
 *   1. The page renders its sections from the fi catalog.
 *   2. generateMetadata emits its own (unique) title/description.
 *
 *   Contact (/contact):
 *   3. The page renders AND names the data-correction mechanism —
 *      the calculator page's "Ilmoita virheestä" control and its
 *      operator-resolved review queue — copy-level.
 *   4. generateMetadata emits its own (unique) title/description.
 *   5. The contact form (task 3.2, design D8) is a NATIVE HTML POST
 *      form (no JS on the path): endpoint action, all field names
 *      (message, topic enum, optional reply email, locale, honeypot
 *      hidden via CSS), and the honest-terms copy — read by the
 *      operator, no response promise, reply requires an email, no
 *      invented address.
 *   6. The ?sent=1 redirect target renders the acknowledgement state
 *      (form absent), and ?error=<code> an honest error state — the
 *      no-JS POST path's rendered outcomes.
 *
 * @module AboutContactPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import AboutPage, { generateMetadata as aboutMetadata } from './about/page';
import ContactPage, { generateMetadata as contactMetadata } from './contact/page';

// Mocked Next server plumbing — next-intl/server resolved straight from
// the Finnish catalog, with {param} interpolation (blog-pages precedent).
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

async function renderPageHtml(
  element: Promise<React.ReactElement>,
): Promise<string> {
  const messages = (await import('@/messages/fi.json')).default;
  return renderToString(
    <NextIntlClientProvider locale="fi" messages={messages}>
      {await element}
    </NextIntlClientProvider>,
  );
}

describe('AboutPage (task 3.3)', () => {
  it('renders the service description sections from the fi catalog', async () => {
    const html = await renderPageHtml(
      AboutPage({ params: Promise.resolve({ locale: 'fi' }) }),
    );

    expect(html).toContain('Tietoja Rajahinta.fi:stä');
    expect(html).toContain('Mitä palvelu tekee');
    expect(html).toContain('Mistä tiedot tulevat');
    // The estimates-not-advice stance stays on the page.
    expect(html).toContain('ei tarjoa vero- tai tullineuvontaa');
  });

  it('emits unique metadata', async () => {
    const meta = await aboutMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Tietoja Rajahinta.fi:stä');
    expect(meta.description).toContain('Mikä Rajahinta.fi on');
  });
});

describe('ContactPage (task 3.3)', () => {
  it('renders and mentions the data-correction mechanism', async () => {
    const html = await renderPageHtml(
      ContactPage({
        params: Promise.resolve({ locale: 'fi' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('Yhteystiedot');
    // The mechanism is named the way the calculator names its control,
    // and its operator-resolved, audit-trailed review is stated.
    expect(html).toContain('Ilmoita tietojen oikaisusta');
    expect(html).toContain('Ilmoita virheestä');
    expect(html).toContain('tarkastusjonoon');
    expect(html).toContain('operaattorin tunnuksella ja aikaleimalla');
  });

  it('emits unique metadata distinct from the About page', async () => {
    const meta = await contactMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Yhteystiedot');
    expect(meta.description).toContain('oikaisusta');
  });
});

describe('ContactPage form (task 3.2, design D8 — the no-JS POST channel)', () => {
  async function renderContact(
    searchParams: Record<string, string> = {},
    locale = 'fi',
  ): Promise<string> {
    return renderPageHtml(
      ContactPage({
        params: Promise.resolve({ locale }),
        searchParams: Promise.resolve(searchParams),
      }),
    );
  }

  it('renders a native HTML POST form with the intake fields and no JS hooks', async () => {
    const html = await renderContact();

    // Native form POST to the intake endpoint — works with JS disabled.
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<form[^>]*action="[^"]*\/api\/v1\/contact"/);
    expect(html).toContain('name="locale" value="fi"');
    expect(html).toContain('name="topic"');
    // The fixed topic enum, as the endpoint validates it.
    for (const topic of ['product_error', 'store_inquiry', 'other']) {
      expect(html).toContain(`value="${topic}"`);
    }
    expect(html).toMatch(/name="message"[^>]*required=/);
    expect(html).toMatch(/required=[^>]*name="message"|name="message"[^>]*required/);
    expect(html).toContain('name="reply_email"');
    expect(html).toContain('type="email"');
    // The honeypot is a trap field hidden via CSS, not removed from
    // markup — bots that fill every field reveal themselves.
    expect(html).toContain('name="website"');
    expect(html).toMatch(/class="hidden"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="hidden"/);
    // No client-side JS anywhere on the submit path.
    expect(html).not.toMatch(/on(submit|click)=/i);
    expect(html).not.toMatch(/type="module"/);
  });

  it('states the honest terms — operator reads, no response promise, reply needs email', async () => {
    const html = await renderContact();

    // What happens to the message: the operator reads it.
    expect(html).toContain('Viestit lukee palvelun ylläpitäjä');
    // No response-time promise.
    expect(html).toContain('Emme lupaa vastausta');
    // A reply is possible only with a reply email.
    expect(html).toContain('Vastaus on mahdollinen vain, jos jätät osoitteen');
    // Data note: hashed source identity and the 90-day retention.
    expect(html).toContain('ei IP-osoitetta sellaisenaan');
    expect(html).toContain('90 päivän');
  });

  it('invents no contact address', async () => {
    const html = await renderContact();

    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('@rajahinta.fi');
  });

  it('renders the acknowledgement state for the ?sent=1 redirect target', async () => {
    const html = await renderContact({ sent: '1' });

    expect(html).toContain('Viesti on vastaanotettu');
    expect(html).toContain(
      'Vastaamme vain, jos jätit sähköpostiosoitteen — vastausta ei luvata',
    );
    // The form is replaced by the ack state (with a JS-free way back).
    expect(html).not.toContain('method="post"');
    expect(html).toContain('Lähetä uusi viesti');
  });

  it('renders an honest error state for the ?error=<code> redirect target', async () => {
    const rateLimited = await renderContact({ error: 'rate_limited' });
    expect(rateLimited).toContain('Liian monta viestiä lyhyen ajan sisällä');
    // The form stays available for the retry the copy asks for.
    expect(rateLimited).toContain('method="post"');

    const oversize = await renderContact({ error: 'size' });
    expect(oversize).toContain('Viesti on liian pitkä');

    const badEmail = await renderContact({ error: 'email' });
    expect(badEmail).toContain('Sähköpostiosoite näyttää virheelliseltä');

    const unavailable = await renderContact({ error: 'unavailable' });
    expect(unavailable).toContain('ei ole tallennettu');
  });

  it('renders the form and honest terms in English too', async () => {
    const html = await renderContact({}, 'en');

    expect(html).toContain('Send a message');
    expect(html).toContain('Messages are read by the site’s operator');
    expect(html).toContain('We do not promise a reply');
    expect(html).toContain('A reply is possible only if you leave an address');
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<form[^>]*action="[^"]*\/api\/v1\/contact"/);
    expect(html).toContain('name="locale" value="en"');
  });
});
