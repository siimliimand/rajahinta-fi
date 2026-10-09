// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BASE_URL } from '@/lib/api';
import { localizedAlternates, localizedPath } from '@/lib/i18n/localized-paths';

interface ContactPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** The intake endpoint the native form posts to (the worker's contract). */
const FORM_ACTION = `${BASE_URL}/api/v1/contact`;

/** Message cap — mirrors the endpoint's declared cap (5000 chars). */
const MESSAGE_MAX_LENGTH = 5000;

/** Read the first value of a possibly-repeated query parameter. */
function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Form copy is inline (not in the messages catalogs): the honest-terms
// wording is this page's own contract (design D8) and the messages files
// are owned by the i18n workstream of this change. Both locales change
// together, per the Finnish-first rule.
/** The copy contract — one interface, both locales (field sets must match). */
interface ContactCopy {
  readonly formTitle: string;
  readonly formIntro: string;
  readonly honesty: string;
  readonly dataNote: string;
  readonly topicLabel: string;
  readonly topicProductError: string;
  readonly topicStoreInquiry: string;
  readonly topicOther: string;
  readonly messageLabel: string;
  readonly messagePlaceholder: string;
  readonly emailLabel: string;
  readonly emailHint: string;
  readonly honeypotLabel: string;
  readonly submit: string;
  readonly ackTitle: string;
  readonly ackBody: string;
  readonly ackAgain: string;
  readonly errorTitle: string;
  readonly errorInvalid: string;
  readonly errorEmail: string;
  readonly errorSize: string;
  readonly errorRateLimited: string;
  readonly errorUnavailable: string;
}

const COPY: Record<'fi' | 'en', ContactCopy> = {
  fi: {
    formTitle: 'Lähetä viesti',
    formIntro:
      'Alla oleva lomake on palvelun yhteyskanava. Viestit lukee palvelun ylläpitäjä.',
    honesty:
      'Emme lupaa vastausta: viestit luetaan, mutta vastaamiseen ei ole aikataulua. Jos haluat mahdollisuuden vastaukseen, jätä sähköpostiosoite — ilman sitä viesti on yksisuuntainen. Emme jaa viestejä eteenpäin.',
    dataNote:
      'Viestin yhteyteen tallennetaan aihe, kieli, lähetysaika ja suojattu tarkistusarvo lähettäjästä — ei IP-osoitetta sellaisenaan. Viestit poistetaan viimeistään noin 90 päivän kuluttua lähettämisestä.',
    topicLabel: 'Aihe',
    topicProductError: 'Virhe tai puute tiedoissa',
    topicStoreInquiry: 'Kysymys kaupasta tai tietolähteestä',
    topicOther: 'Jotain muuta',
    messageLabel: 'Viesti',
    messagePlaceholder: 'Kuvaile asia mahdollisimman tarkasti.',
    emailLabel: 'Sähköpostisi (valinnainen)',
    emailHint: 'Vastaus on mahdollinen vain, jos jätät osoitteen.',
    honeypotLabel: 'Älä täytä tätä kenttää',
    submit: 'Lähetä viesti',
    ackTitle: 'Viesti on vastaanotettu',
    ackBody:
      'Viestisi on tallennettu ylläpitäjän luettavaksi. Vastaamme vain, jos jätit sähköpostiosoitteen — vastausta ei luvata.',
    ackAgain: 'Lähetä uusi viesti',
    errorTitle: 'Viestiä ei voitu hyväksyä',
    errorInvalid: 'Tarkista viestin sisältö, aihe ja kenttien pituudet.',
    errorEmail: 'Sähköpostiosoite näyttää virheelliseltä — tarkista se tai jätä kenttä tyhjäksi.',
    errorSize: 'Viesti on liian pitkä. Lyhennä viestiä ja lähetä uudelleen.',
    errorRateLimited:
      'Liian monta viestiä lyhyen ajan sisällä. Odota hetki ja yritä uudelleen.',
    errorUnavailable:
      'Vastaanotto ei ole juuri nyt mahdollista. Yritä myöhemmin uudelleen — viestiäsi ei ole tallennettu.',
  },
  en: {
    formTitle: 'Send a message',
    formIntro:
      'The form below is the service’s contact channel. Messages are read by the site’s operator.',
    honesty:
      'We do not promise a reply: messages are read, but there is no response schedule. If you want a reply to be possible, leave your email address — without one, your message is one-way. We do not share messages onward.',
    dataNote:
      'Alongside the message we store its topic, language, submission time, and a salted verification value derived from the sender’s address — never the raw IP. Messages are deleted at the latest roughly 90 days after submission.',
    topicLabel: 'Topic',
    topicProductError: 'An error or gap in the data',
    topicStoreInquiry: 'A question about a store or data source',
    topicOther: 'Something else',
    messageLabel: 'Message',
    messagePlaceholder: 'Describe the issue as precisely as you can.',
    emailLabel: 'Your email (optional)',
    emailHint: 'A reply is possible only if you leave an address.',
    honeypotLabel: 'Leave this field empty',
    submit: 'Send message',
    ackTitle: 'Message received',
    ackBody:
      'Your message has been stored for the operator to read. We reply only if you left an email address — no reply is guaranteed.',
    ackAgain: 'Send another message',
    errorTitle: 'The message could not be accepted',
    errorInvalid: 'Check the message content, topic, and field lengths.',
    errorEmail:
      'The email address looks invalid — check it, or leave the field empty.',
    errorSize: 'The message is too long. Shorten it and send again.',
    errorRateLimited:
      'Too many messages in a short time. Wait a moment and try again.',
    errorUnavailable:
      'The intake is unavailable right now. Try again later — your message was not stored.',
  },
} as const;

/** The redirect error codes the intake endpoint attaches to /contact?error=…. */
function errorCopy(code: string | undefined, copy: ContactCopy): string {
  switch (code) {
    case 'email':
      return copy.errorEmail;
    case 'size':
      return copy.errorSize;
    case 'rate_limited':
      return copy.errorRateLimited;
    case 'unavailable':
      return copy.errorUnavailable;
    default:
      return copy.errorInvalid;
  }
}

export async function generateMetadata({
  params,
}: {
  params: ContactPageProps['params'];
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  // Routing serves fi and en only; anything else renders as Finnish
  // (the products-page precedent).
  const locale = rawLocale === 'en' ? 'en' : 'fi';
  const t = await getTranslations({ locale, namespace: 'ContactPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // Localized canonical + hreflang pair (design D6, change
    // localize-fi-route-pathnames). The transactional ?sent/?error
    // states canonicalize to the clean route.
    alternates: localizedAlternates(locale, { pathname: '/contact' }),
  };
}

/**
 * Contact page (task 3.2, change first-impression-pass; design D8).
 *
 * The site's real contact channel: a plain-HTML form that POSTs natively
 * to the worker's rate-limited intake (POST /api/v1/contact) — no
 * client-side JavaScript anywhere on the path, so the form works with
 * scripting disabled. The endpoint answers the navigation with a 303
 * back to this page: `?sent=1` renders the acknowledgement state,
 * `?error=<code>` an honest error state.
 *
 * The honesty decisions of the former channel-free page are preserved
 * verbatim in spirit: no invented email address, no response-time
 * promise, no legal-review claim. The form adds a real channel instead
 * of a fabricated one — a reply is possible only when the sender leaves
 * a reply email, and the page says so. The data note states what is
 * stored (salted hash, never the raw IP) and the 90-day retention.
 */
export default async function ContactPage({
  params,
  searchParams,
}: ContactPageProps) {
  const { locale: rawLocale } = await params;
  // Routing serves fi and en only; anything else renders as Finnish
  // (the products-page precedent).
  const locale = rawLocale === 'en' ? 'en' : 'fi';
  setRequestLocale(locale);

  const t = await getTranslations('ContactPage');
  const copy = COPY[locale === 'en' ? 'en' : 'fi'];
  const query = await searchParams;
  const sent = firstParam(query.sent) === '1';
  const errorCode = firstParam(query.error);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('subtitle')}
      </p>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          {copy.formTitle}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {copy.formIntro}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {copy.honesty}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {copy.dataNote}
        </p>

        {sent ? (
          <div className="mt-5 rounded-md border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-800">
              {copy.ackTitle}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-green-800">
              {copy.ackBody}
            </p>
            {/* The ack state must not depend on JS: a plain link clears
               the query and re-renders the form. The href goes through
               the localized pathnames so the no-JS anchor carries the
               active locale's segment, the same URL the i18n Link would
               render (change localize-fi-route-pathnames). */}
            <a
              href={localizedPath(locale, { pathname: '/contact' })}
              className="mt-3 inline-block text-sm font-medium text-primary-700 underline"
            >
              {copy.ackAgain}
            </a>
          </div>
        ) : (
          <>
            {errorCode !== undefined && (
              <div
                className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4"
                role="alert"
              >
                <p className="text-sm font-semibold text-amber-900">
                  {copy.errorTitle}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-amber-900">
                  {errorCopy(errorCode, copy)}
                </p>
              </div>
            )}

            <form method="post" action={FORM_ACTION} className="mt-5 space-y-4">
              <input type="hidden" name="locale" value={locale} />
              <div>
                <label
                  htmlFor="contact-topic"
                  className="block text-sm font-medium text-gray-900"
                >
                  {copy.topicLabel}
                </label>
                <select
                  id="contact-topic"
                  name="topic"
                  required
                  defaultValue="product_error"
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="product_error">{copy.topicProductError}</option>
                  <option value="store_inquiry">{copy.topicStoreInquiry}</option>
                  <option value="other">{copy.topicOther}</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="contact-message"
                  className="block text-sm font-medium text-gray-900"
                >
                  {copy.messageLabel}
                </label>
                <textarea
                  id="contact-message"
                  name="message"
                  required
                  rows={6}
                  maxLength={MESSAGE_MAX_LENGTH}
                  placeholder={copy.messagePlaceholder}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
              </div>
              <div>
                <label
                  htmlFor="contact-reply-email"
                  className="block text-sm font-medium text-gray-900"
                >
                  {copy.emailLabel}
                </label>
                <input
                  id="contact-reply-email"
                  type="email"
                  name="reply_email"
                  maxLength={320}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">{copy.emailHint}</p>
              </div>
              {/* Honeypot: hidden via CSS so humans never see it; bots
                 that fill every field reveal themselves and are answered
                 with the uniform acknowledgement (nothing stored). */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="contact-website" className="block text-sm">
                  {copy.honeypotLabel}
                </label>
                <input
                  id="contact-website"
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                className="rounded-md bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {copy.submit}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          {t('correctionsTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t('correctionsBody')}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {t('correctionsReview')}
        </p>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          {t('generalTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t('generalBody')}
        </p>
      </section>
    </main>
  );
}
