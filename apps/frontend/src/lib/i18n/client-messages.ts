/**
 * Load-time client message split (first-impression-pass task 2.3,
 * design D6).
 *
 * Picks the requested namespaces out of a locale's catalog — the same
 * `src/messages/{locale}.json` the server request config loads — so a
 * `NextIntlClientProvider` receives a subset without any file
 * duplication. `fi.json`/`en.json` are untouched as the source of truth.
 *
 * Server components keep full-catalog access: this module is only for
 * feeding client providers (root layout chrome subset, per-route segment
 * layouts). Failures are loud by design — an unknown locale or a map
 * entry pointing outside the catalog means the split table has drifted,
 * and a silent empty bundle would only show up as missing copy in
 * production.
 *
 * @module i18n/client-messages
 */

import { routing } from '@/i18n/routing';
import type { ClientMessages, MessageNamespace } from './route-namespaces';

type Locale = (typeof routing.locales)[number];

/** Catalog type of the Finnish source of truth (en ships the same set). */
type Catalog = typeof import('@/messages/fi.json');

/**
 * Pick `namespaces` out of the locale catalog at load time. The locale
 * arrives as a plain string from segment params; it is validated against
 * `routing` here and a failure is loud — an unknown locale or a
 * namespace the catalog does not carry means the split table has
 * drifted, and a silent empty bundle would only show up as missing copy
 * in production.
 */
export async function getClientMessages(
  locale: string,
  namespaces: readonly MessageNamespace[],
): Promise<ClientMessages> {
  if (!routing.locales.includes(locale as Locale)) {
    throw new Error(
      `[i18n] getClientMessages: unknown locale "${locale}" (routing carries ${routing.locales.join(', ')})`,
    );
  }
  const catalog = (await import(`@/messages/${locale}.json`)).default as Catalog;
  const picked: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    if (!(namespace in catalog)) {
      throw new Error(
        `[i18n] getClientMessages: namespace "${namespace}" is missing from src/messages/${locale}.json — fix the split table in @/lib/i18n/route-namespaces`,
      );
    }
    picked[namespace] = catalog[namespace];
  }
  return picked as ClientMessages;
}
