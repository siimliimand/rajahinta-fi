import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import {
  calendarLocale,
  calendarPageMetadata,
  TaxChangeCalendarPageBody,
} from './calendar-page';
import { resolveCalendarYear } from './calendar-events';

interface VeroMuutoksetPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Metadata for the Finnish calendar route `/veromuutokset` (task 4.1):
 * the localized canonical + hreflang pair is the route pair's own —
 * the physical folders sit outside the localized-pathnames vocabulary,
 * so the pair is written in the shared module (design D6).
 */
export async function generateMetadata(): Promise<Metadata> {
  return calendarPageMetadata('fi');
}

/**
 * The Finnish-default tax-change calendar route (spec:
 * tax-change-calendar, "Calendar page").
 *
 * The English variant lives in its own physical folder
 * (`[locale]/tax-changes`, served at `/en/tax-changes`); the two folders
 * share the body module so the variants cannot drift. A request that
 * reaches THIS folder under the English negotiation (`/en/veromuutokset`)
 * redirects to the English canonical — one URL per locale, no duplicate
 * content between the variants.
 *
 * The year is URL state: `?year=` resolves forgivingly against the
 * server's current year (the value page's fallback precedent), and the
 * navigation renders plain prev/next anchors around it.
 */
export default async function VeroMuutoksetPage({
  params,
  searchParams,
}: VeroMuutoksetPageProps) {
  const { locale: rawLocale } = await params;
  const locale = calendarLocale(rawLocale);
  if (locale !== 'fi') {
    // /en/veromuutokset — the English canonical is /en/tax-changes.
    const query = await searchParams;
    const year = resolveCalendarYear(query.year, new Date().getFullYear());
    redirect(`/en/tax-changes?year=${year}`);
  }

  setRequestLocale(rawLocale);

  const query = await searchParams;
  const year = resolveCalendarYear(query.year, new Date().getFullYear());

  // The shared async body is CALLED, not rendered as an element (the
  // shared product-page body's precedent): the route owns the await.
  return TaxChangeCalendarPageBody({
    locale,
    year,
    basePath: '/veromuutokset',
  });
}
