import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Homepage hero (OpenSpec: design-system-foundation, task 4.1).
 *
 * Static catalog copy only (D6): one-sentence value prop answering what
 * importing alcohol from Sweden to Finland costs, the calculator as the
 * primary call to action, and quiet secondary links to the comparison view
 * and the ranking methodology. Typography and spacing carry the hierarchy;
 * no API calls are made from this page.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Home');
  const tNav = await getTranslations('Nav');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        {/* One-sentence value prop; the cost components mirror the
            calculator's cost-category vocabulary (estimates, per the
            structural disclaimer). */}
        <h1 className="text-balance text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {t('heroValueProp')}
        </h1>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {/* Mirrors Button primary/lg — the primitive renders a <button>,
              and the primary action must be a real navigable link. */}
          <Link
            href="/calculator"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {tNav('openCalculator')}
          </Link>
        </div>

        {/* Secondary destinations — subordinate to the calculator CTA. */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link
            href="/compare"
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {tNav('compareProducts')}
          </Link>
          <Link
            href="/ranking"
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {tNav('howRankingWorks')}
          </Link>
        </div>
      </div>
    </main>
  );
}
