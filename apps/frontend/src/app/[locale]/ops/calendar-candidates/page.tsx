/**
 * Calendar-candidates console page (task 4.1, change
 * calendar-event-automation) — the source-watcher's review queue at
 * `/ops/calendar-candidates` (Finnish, default locale) and
 * `/en/ops/calendar-candidates`. Excluded from indexing: internal tool,
 * not product surface.
 *
 * @module OpsCalendarCandidatesPage
 */

import type { Metadata } from 'next';
import CalendarCandidatesConsole from '../components/CalendarCandidatesConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title:
      locale === 'en'
        ? 'Calendar candidates — rajahinta ops'
        : 'Kalenteriehdotukset — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsCalendarCandidatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CalendarCandidatesConsole locale={locale} />;
}
