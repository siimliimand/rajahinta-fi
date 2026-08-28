/**
 * Request-scoped i18n configuration (next-intl server side).
 *
 * Loads the message catalog for the requested locale. Catalogs live in
 * `src/messages/{locale}.json`; Finnish is the source of truth and the
 * English catalog mirrors it.
 *
 * Unknown locales fall back to the default locale (Finnish) rather than
 * a 404, so a bad `Accept-Language` negotiation still renders.
 *
 * @module i18n/request
 */

import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(
    requested as (typeof routing.locales)[number],
  )
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
