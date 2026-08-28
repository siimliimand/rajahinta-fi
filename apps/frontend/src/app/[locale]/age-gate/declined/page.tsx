import { getTranslations, setRequestLocale } from 'next-intl/server';

/**
 * Neutral in-house destination for declining the age gate. Deliberately
 * bypassed by the AgeGate wrapper: no alcohol-related content, no external
 * links — the page only explains why access is restricted.
 */
export default async function AgeGateDeclinedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('AgeGateDeclined');

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-600">
        {t('body')}
      </p>
    </main>
  );
}
