/**
 * Appeal inbox console page (task 2.3, change trust-and-reach-roadmap)
 * — REOPENED blacklist entries with REPUBLISH/REJECT resolution at
 * `/ops/appeals` (Finnish, default locale) and `/en/ops/appeals`.
 * Excluded from indexing: internal tool, not product surface.
 *
 * @module OpsAppealsPage
 */

import type { Metadata } from 'next';
import AppealsConsole from '../components/AppealsConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'en' ? 'Appeal inbox — rajahinta ops' : 'Valitusjono — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsAppealsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AppealsConsole locale={locale} />;
}
