/**
 * Calendar-events console page (task 5.1, change tax-change-calendar)
 * — the audited maintenance surface for the sourced price-change rhythm
 * at `/ops/calendar-events` (Finnish, default locale) and
 * `/en/ops/calendar-events`. Excluded from indexing: internal tool, not
 * product surface.
 *
 * @module OpsCalendarEventsPage
 */

import type { Metadata } from 'next';
import CalendarEventsConsole from '../components/CalendarEventsConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title:
      locale === 'en'
        ? 'Tax-change calendar — rajahinta ops'
        : 'Veromuutoskalenteri — rajahinta ops',
    robots: { index: false, follow: false },
  };
}

export default async function OpsCalendarEventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CalendarEventsConsole locale={locale} />;
}
