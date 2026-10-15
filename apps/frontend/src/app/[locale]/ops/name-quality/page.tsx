/**
 * Name-quality quarantine console page (task 3.1, change
 * product-name-quality-gate) — the enrichment queue of the rows the
 * informativeness gate stored quarantined at `/ops/name-quality`
 * (Finnish, default locale) and `/en/ops/name-quality`. Excluded from
 * indexing: internal tool, not product surface.
 *
 * @module OpsNameQualityPage
 */

import type { Metadata } from 'next';
import NameQualityConsole from '../components/NameQualityConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title:
      locale === 'en'
        ? 'Name quality — quarantine queue — rajahinta ops'
        : 'Nimien laatu — karanteenijono — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsNameQualityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <NameQualityConsole locale={locale} />;
}
