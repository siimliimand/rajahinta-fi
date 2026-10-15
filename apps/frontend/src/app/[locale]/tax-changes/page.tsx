import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import {
  calendarLocale,
  calendarPageMetadata,
  TaxChangeCalendarPageBody,
} from '../veromuutokset/calendar-page';
import { resolveCalendarYear } from '../veromuutokset/calendar-events';

interface TaxChangesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Metadata for the English calendar route (task 4.1): served at
 * `/en/tax-changes`, canonical to itself, with the localized hreflang
 * pair from the shared module (design D6).
 */
export async function generateMetadata(): Promise<Metadata> {
  return calendarPageMetadata('en');
}

/**
 * The English variant of the tax-change calendar (spec:
 * tax-change-calendar, "Calendar page": an English variant at
 * `/tax-changes`).
 *
 * The physical folder sits under `[locale]`, so the bare `/tax-changes`
 * path negotiates to the DEFAULT locale (fi) — there the Finnish
 * canonical is `/veromuutokset`, and this folder redirects instead of
 * rendering a Finnish duplicate (one URL per locale, no duplicate
 * content between the variants; the same rule the fi folder applies to
 * `/en/veromuutokset`). The body module is shared with the Finnish
 * folder so the two variants cannot drift.
 */
export default async function TaxChangesPage({
  params,
  searchParams,
}: TaxChangesPageProps) {
  const { locale: rawLocale } = await params;
  const locale = calendarLocale(rawLocale);
  if (locale !== 'en') {
    // /tax-changes under the Finnish negotiation → the Finnish canonical.
    const query = await searchParams;
    const year = resolveCalendarYear(query.year, new Date().getFullYear());
    redirect(`/veromuutokset?year=${year}`);
  }

  setRequestLocale(rawLocale);

  const query = await searchParams;
  const year = resolveCalendarYear(query.year, new Date().getFullYear());

  // The shared async body is CALLED, not rendered as an element (the
  // shared product-page body's precedent): the route owns the await.
  return TaxChangeCalendarPageBody({
    locale,
    year,
    basePath: '/en/tax-changes',
  });
}
