import React from 'react';
import { getMessages, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import NewsletterSubscribeForm from './NewsletterSubscribeForm';

/**
 * Layout-level footer — three-column navigation layout with brand column,
 * services column, and about/meta column; newsletter subscribe form in the
 * brand column; and a subdued legal disclaimer strip at the very bottom.
 *
 * Structural contract (OpenSpec: design-system-foundation, task 3.2):
 * - The disclaimer stays byte-identical to the message catalog (pinned by
 *   the compliance tests) and renders on every page load.
 * - The newsletter form (task 5.4, trust-and-reach-roadmap) sits in the
 *   brand column with the explicit consent checkbox visible.
 * - Hand-rolls the Card surface for the disclaimer strip because the Card
 *   primitive crashes under the classic-JSX vitest runtime; swap to
 *   <Card> once it carries the React import.
 */
export default async function SiteFooter() {
  const t = await getTranslations('SiteFooter');
  const languageNames = readLanguageNames(await getMessages());

  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      {/* ── Three-column content area ── */}
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">

          {/* ── Column 1: Brand + newsletter ── */}
          <div>
            {/* Brand wordmark (text-only so this stays a server component) */}
            <p className="text-base font-bold tracking-tight text-gray-900">
              Rajahinta<span className="text-primary-700">.fi</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              {t('tagline')}
            </p>

            {/* Newsletter form rides in the footer as a client island */}
            <div className="mt-6">
              <NewsletterSubscribeForm />
            </div>
          </div>

          {/* ── Column 2: Services ── */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('servicesHeading')}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {[
                { href: '/calculator', labelKey: 'linkCalculator' },
                { href: '/compare',    labelKey: 'linkCompare' },
                { href: '/basket',     labelKey: 'linkBasket' },
                { href: '/trip',       labelKey: 'linkTrip' },
                { href: '/event',      labelKey: 'linkEvent' },
                { href: '/value',      labelKey: 'linkValue' },
              ].map(({ href, labelKey }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-gray-600 transition-colors hover:text-primary-700"
                  >
                    {t(labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Column 3: About ── */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('aboutHeading')}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {[
                { href: '/ranking', labelKey: 'methodology' },
                { href: '/blog',    labelKey: 'linkBlog' },
              ].map(({ href, labelKey }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-gray-600 transition-colors hover:text-primary-700"
                  >
                    {t(labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Legal disclaimer strip ── */}
      <div className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-2xl text-xs leading-relaxed text-gray-500">
              {t('disclaimer')}
            </p>
            <div className="shrink-0 text-right">
              {languageNames && (
                <p className="text-xs text-gray-400">{languageNames.join(' · ')}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {t('copyright')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Localized names of the site's content languages, in routing order
 * (Finnish first). Reuses the only existing language-name copy,
 * DisclaimerBanner.languageName — the footer has no dedicated key yet
 * and catalog additions belong to task 4.3. Returns null when the
 * entries are missing so the note degrades to nothing rather than raw
 * locale codes.
 */
function readLanguageNames(messages: unknown): string[] | null {
  if (typeof messages !== 'object' || messages === null) {
    return null;
  }
  const banner = (messages as Record<string, unknown>).DisclaimerBanner;
  if (typeof banner !== 'object' || banner === null) {
    return null;
  }
  const names = (banner as Record<string, unknown>).languageName;
  if (typeof names !== 'object' || names === null) {
    return null;
  }
  const record = names as Record<string, unknown>;
  const entries = routing.locales
    .map((locale) => record[locale])
    .filter((name): name is string => typeof name === 'string' && name !== '');
  return entries.length === routing.locales.length ? entries : null;
}
