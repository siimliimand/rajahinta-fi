/**
 * Guide console page (insight-surfaces 5.1, spec guides-hub) — guide
 * draft create/edit/publish at `/ops/guides` (Finnish, default locale)
 * and `/en/ops/guides`. Excluded from indexing: internal tool, not
 * product surface.
 *
 * @module OpsGuidesPage
 */

import type { Metadata } from 'next';
import GuidesConsole from '../components/GuidesConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'en' ? 'Guides — rajahinta ops' : 'Oppaat — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsGuidesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <GuidesConsole locale={locale} />;
}
