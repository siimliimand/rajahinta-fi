import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/api';
import LocaleChrome from '@/app/_chrome/LocaleChrome';

/**
 * Root layout of the localized tree (fi-path-isr task 1.1). The
 * document shell and site chrome (<html> with the locale's `lang`, the
 * Inter font, globals.css, age gate + pre-paint script, structured
 * data, client-intl provider, header/footer) live in the shared
 * `LocaleChrome`; this layout carries only what is specific to the
 * `[locale]` segment: the ISR window, the param enumeration, the
 * metadata, and the request-locale priming that keeps every page under
 * it eligible for static rendering.
 */

// ISR window for the locale tree: server-fetched pages under this layout
// (metadata, curated lists, sitemap inputs) re-render at most this far
// behind the backend's data instead of staying fully static.
export const revalidate = 60;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  const title = t('title');
  const description = t('description');

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Rajahinta.fi',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  // Static rendering (see next-intl docs): primes the request locale
  // so next-intl reads in this segment and below resolve without
  // touching request headers, keeping pages here eligible for
  // prerendering instead of opting into dynamic rendering.
  setRequestLocale(locale);

  // The gate decision is made on the client (design D4 of
  // first-impression-pass): rendering no longer reads request cookies,
  // so every route under this layout is cacheable and `revalidate`
  // above is effective. The server HTML always ships the overlay; the
  // inline pre-paint script inside LocaleChrome plus the base-CSS rule
  // keyed on <html data-age-confirmed> keep confirmed visitors
  // flash-free before hydration, and AgeGate converges on the cookie
  // at mount.
  return <LocaleChrome locale={locale}>{children}</LocaleChrome>;
}
