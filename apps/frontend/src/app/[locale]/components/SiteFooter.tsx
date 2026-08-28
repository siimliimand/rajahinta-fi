import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Layout-level footer. Carries the site-wide disclaimer (catalog copy in
 * both locales) and the methodology link. The per-result disclaimer on
 * calculation output stays with the API payload it describes.
 */
export default async function SiteFooter() {
  const t = await getTranslations('SiteFooter');

  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-xs leading-relaxed text-gray-500">
          {t('disclaimer')}
        </p>
        <p className="mt-3">
          <Link
            href="/ranking"
            className="text-xs font-medium text-primary-600 hover:text-primary-800"
          >
            {t('methodology')}
          </Link>
        </p>
      </div>
    </footer>
  );
}
