/**
 * Locale routing configuration (next-intl).
 *
 * Finnish is the default locale and serves from the bare paths (`/`,
 * `/calculator`); English lives under the `/en` prefix (`localePrefix:
 * 'as-needed'`). A `/fi/...` request redirects to the unprefixed path.
 *
 * @module i18n/routing
 */

import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['fi', 'en'],
  defaultLocale: 'fi',
  localePrefix: 'as-needed',
});

export type AppLocale = (typeof routing.locales)[number];
