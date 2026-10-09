/**
 * Localized path and metadata-alternates helpers over the routing
 * config (change localize-fi-route-pathnames, design D6).
 *
 * The i18n `Link`/`useRouter` primitives from `@/i18n/navigation`
 * localize hrefs at render time, but three surfaces need the localized
 * URL as a plain string computed on the server:
 *
 *   1. `generateMetadata` canonicals — the canonical must carry the
 *      active locale's segment (`/tuotteet` in Finnish, `/en/products`
 *      in English) with the English query parameters (design D7).
 *   2. hreflang `alternates.languages` — the localized pair plus the
 *      `x-default` entry, which keeps pointing at the negotiating bare
 *      (fi) URL (design D6).
 *   3. No-JS plain anchors and GET form actions (the contact page's
 *      ack-state link, the catalog's no-JS forms) — real URLs in
 *      server-rendered HTML, with no client router to localize them.
 *
 * Why not `getPathname` from `@/i18n/navigation`: that module pulls in
 * `next/navigation`, which cannot load under the vitest environment
 * (the seo-smoke test mocks the whole module away for exactly that
 * reason). This module reads `routing.pathnames` directly instead —
 * the same pinned vocabulary, one small prefix rule, so the metadata
 * stays unit-testable and the two never drift apart in vocabulary.
 *
 * @module lib/i18n/localized-paths
 */

import type { Metadata } from 'next';
import { routing, type AppLocale, type AppPathnames } from '@/i18n/routing';

/** Values a path parameter may take (next-intl parity: stringified). */
type PathParamValue = string | number | boolean;

/** Values a query entry may take (design D7: English contract values). */
type QueryValue = PathParamValue | readonly PathParamValue[];

/** Query record; `undefined`/`null` entries are omitted from the URL. */
type QueryRecord = Record<string, QueryValue | undefined>;

/**
 * A localized-href input. Dynamic pathnames (containing `[param]`
 * segments) REQUIRE the params record; static pathnames forbid the
 * required form — the same shape next-intl's typed hrefs enforce, so a
 * canonical can never compile a template with a missing parameter.
 */
type LocalizedHref<Pathname extends AppPathnames = AppPathnames> =
  Pathname extends `${string}[${string}`
    ? {
        readonly pathname: Pathname;
        readonly params: Readonly<Record<string, PathParamValue>>;
        readonly query?: QueryRecord;
      }
    : {
        readonly pathname: Pathname;
        readonly params?: Readonly<Record<string, PathParamValue>>;
        readonly query?: QueryRecord;
      };

/**
 * The URL prefix a locale serves under — `localePrefix: 'as-needed'`:
 * the default locale (fi) serves bare paths, every other locale lives
 * under `/<locale>`. Derived from the routing config so a prefix-mode
 * change surfaces here rather than silently diverging.
 */
function localePrefix(locale: AppLocale): string {
  return locale === routing.defaultLocale ? '' : `/${locale}`;
}

/** The pathname's localized template (`/products` → `/tuotteet` in fi). */
function localizedTemplate(pathname: AppPathnames, locale: AppLocale): string {
  const template = routing.pathnames[pathname];
  return typeof template === 'string' ? template : template[locale];
}

/** Serialize the query record the way the URL state round-trips:
 * insertion order kept, `undefined`/`null` entries dropped (the same
 * contract the catalog's previous URLSearchParams builder had). */
function serializeQuery(query: QueryRecord | undefined): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/**
 * The full localized URL path for one href in one locale: the locale's
 * segment, its `/en` prefix when any, the English query string (design
 * D7 — parameters are API contract values, never translated), in the
 * exact form `getPathname` would emit for the same input.
 */
export function localizedPath(
  locale: AppLocale,
  href: LocalizedHref,
): string {
  let path = localizedTemplate(href.pathname, locale);
  for (const [key, value] of Object.entries(href.params ?? {})) {
    path = path.replaceAll(`[${key}]`, String(value));
  }
  return `${localePrefix(locale)}${path}${serializeQuery(href.query)}`;
}

/**
 * The metadata `alternates` entry for one href (design D6): the
 * canonical is the ACTIVE locale's URL, and `languages` pairs both
 * locales' localized URLs with `x-default` pointing at the negotiating
 * bare (fi) URL. Spread into any `generateMetadata` return:
 *
 *     return { title: t('metaTitle'), alternates: localizedAlternates(locale, { pathname: '/about' }) };
 */
export function localizedAlternates(
  locale: AppLocale,
  href: LocalizedHref,
): NonNullable<Metadata['alternates']> {
  const fi = localizedPath('fi', href);
  const en = localizedPath('en', href);
  return {
    canonical: locale === 'en' ? en : fi,
    languages: { fi, en, 'x-default': fi },
  };
}
