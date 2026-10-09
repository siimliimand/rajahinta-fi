/**
 * Locale routing configuration (next-intl).
 *
 * Finnish is the default locale and serves from the bare paths, which
 * are the localized Finnish segments (`/laskuri`, `/tuotteet`); English
 * lives under the `/en` prefix with the internal route names
 * (`localePrefix: 'as-needed'`). A `/fi/...` request redirects to the
 * unprefixed path. A request whose path segment belongs to the other
 * locale is 307-redirected to the negotiated locale's canonical URL.
 *
 * @module i18n/routing
 */

import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['fi', 'en'],
  defaultLocale: 'fi',
  localePrefix: 'as-needed',
  pathnames: {
    // Localized vocabulary (design D1): the fi segment is the site's own
    // Finnish label; en keeps the internal route name.
    '/': { fi: '/', en: '/' },
    '/calculator': { fi: '/laskuri', en: '/calculator' },
    '/compare': { fi: '/vertailu', en: '/compare' },
    '/basket': { fi: '/ostoskori', en: '/basket' },
    '/products': { fi: '/tuotteet', en: '/products' },
    '/products/[id]': { fi: '/tuotteet/[id]', en: '/products/[id]' },
    '/trip': { fi: '/matka', en: '/trip' },
    '/event': { fi: '/tilaisuus', en: '/event' },
    '/what-if': { fi: '/skenaario', en: '/what-if' },
    '/value': { fi: '/grammahinta', en: '/value' },
    '/ranking': { fi: '/jarjestys', en: '/ranking' },
    '/savings': { fi: '/saastolista', en: '/savings' },
    '/allowances': { fi: '/tullivapaat', en: '/allowances' },
    '/group-order': { fi: '/ryhmatilaus', en: '/group-order' },
    '/blog': { fi: '/blogi', en: '/blog' },
    '/blog/[slug]': { fi: '/blogi/[slug]', en: '/blog/[slug]' },
    '/guides': { fi: '/oppaat', en: '/guides' },
    '/guides/[slug]': { fi: '/oppaat/[slug]', en: '/guides/[slug]' },
    '/lists/[slug]': { fi: '/listat/[slug]', en: '/lists/[slug]' },
    '/about': { fi: '/tietoja', en: '/about' },
    '/contact': { fi: '/yhteystiedot', en: '/contact' },

    // Shared segments (design D2): auth/account, machine + token URLs,
    // email lifecycle, and the ops console keep one segment in both
    // locales. The `[...rest]` catch-all deliberately has no entry.
    '/login': '/login',
    '/register': '/register',
    '/account': '/account',
    '/account/alerts': '/account/alerts',
    '/account/saved-baskets': '/account/saved-baskets',
    '/account/forgot': '/account/forgot',
    '/account/reset': '/account/reset',
    '/account/verify': '/account/verify',
    '/age-gate': '/age-gate',
    '/age-gate/declined': '/age-gate/declined',
    '/calculator/result/[recordId]': '/calculator/result/[recordId]',
    '/group-order/[token]': '/group-order/[token]',
    '/share/[publicId]': '/share/[publicId]',
    '/newsletter/confirm': '/newsletter/confirm',
    '/newsletter/unsubscribe': '/newsletter/unsubscribe',
    '/ops': '/ops',
    '/ops/appeals': '/ops/appeals',
    '/ops/guides': '/ops/guides',
    '/ops/newsletter': '/ops/newsletter',
    '/ops/reports': '/ops/reports',
  },
});

export type AppLocale = (typeof routing.locales)[number];
export type AppPathnames = keyof typeof routing.pathnames;
