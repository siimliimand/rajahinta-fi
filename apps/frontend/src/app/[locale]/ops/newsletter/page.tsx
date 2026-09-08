/**
 * Newsletter broadcast console page (task 5.3, change
 * trust-and-reach-roadmap) — the ops notify-subscribers action at
 * `/ops/newsletter` (Finnish, default locale) and `/en/ops/newsletter`.
 * Excluded from indexing: internal tool, not product surface.
 *
 * @module OpsNewsletterPage
 */

import type { Metadata } from 'next';
import NewsletterConsole from '../components/NewsletterConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title:
      locale === 'en' ? 'Newsletter broadcast — rajahinta ops' : 'Uutiskirjeen lähetys — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsNewsletterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <NewsletterConsole locale={locale} />;
}
