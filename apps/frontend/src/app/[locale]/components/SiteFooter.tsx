import React from 'react';
import { getMessages, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

/**
 * Layout-level footer as a structured legal layout (OpenSpec:
 * design-system-foundation, task 3.2): a visually distinct disclaimer
 * block, the methodology link, and a locale note naming the content
 * languages. The disclaimer copy is structural and stays byte-identical
 * to the catalogs (pinned by the SSR and compliance tests). The
 * per-result disclaimer on calculation output stays with the API
 * payload it describes.
 */
export default async function SiteFooter() {
  const t = await getTranslations('SiteFooter');
  const languageNames = readLanguageNames(await getMessages());

  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Legal block: a quiet white surface sets the disclaimer apart
            from the gray footer without raising the volume; no shadow —
            a border is distinction enough. Hand-rolls the Card surface
            (padding sm, shadow none) because the Card primitive does
            not import React and crashes under the classic JSX runtime
            the vitest chrome tests use; swap to <Card padding="sm"
            shadow="none"> once the primitive carries that import. */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs leading-relaxed text-gray-600">
            {t('disclaimer')}
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <Link
            href="/ranking"
            className="text-xs font-medium text-primary-600 hover:text-primary-800"
          >
            {t('methodology')}
          </Link>
          {languageNames && (
            <p className="text-xs text-gray-500">{languageNames.join(' · ')}</p>
          )}
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
