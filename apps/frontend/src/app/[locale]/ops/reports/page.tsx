/**
 * Report moderation console page (task 2.3, change
 * trust-and-reach-roadmap) — the shop-report review queue with its
 * evidence, the blacklist publish action, and the entry overview at
 * `/ops/reports` (Finnish, default locale) and `/en/ops/reports`.
 * Excluded from indexing: internal tool, not product surface.
 *
 * @module OpsReportsPage
 */

import type { Metadata } from 'next';
import ReportsConsole from '../components/ReportsConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'en' ? 'Report moderation — rajahinta ops' : 'Raporttien käsittely — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <ReportsConsole locale={locale} />;
}
