import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Neutral in-house destination for declining the age gate. Deliberately
 * bypassed by the AgeGate wrapper: no alcohol-related content, no external
 * links — the page only explains why access is restricted.
 *
 * Decline recovery (task 1.4): the decline is not persisted anywhere
 * (declining CLEARS the confirmation cookie), so the recovery action is a
 * plain link home — with the cookie absent, the AgeGate overlay (which
 * ships in every server HTML and converges on the cookie) re-presents
 * the confirmation. Works without JavaScript and never touches the
 * crawlable soft-gate contract.
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
      <p className="mt-6 max-w-md text-sm leading-relaxed text-gray-500">
        {t('recoveryIntro')}
      </p>
      <Link
        href="/"
        data-testid="age-gate-recovery"
        className="mt-6 inline-flex items-center justify-center rounded-lg border border-primary-300 bg-white px-5 py-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {t('recoveryAction')}
      </Link>
    </main>
  );
}
