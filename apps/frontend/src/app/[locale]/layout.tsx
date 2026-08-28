import React from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { getServerFeatureFlags, SITE_URL } from '@/lib/api';
import { FeatureFlagsProvider } from '@/lib/feature-flags';
import { AgeGate } from './components/AgeGate';
import SiteHeader from './components/SiteHeader';
import SiteFooter from './components/SiteFooter';
import '../globals.css';

/**
 * Inter via next/font (D3): self-hosted at build time, full Finnish
 * glyph coverage (latin + latin-ext subsets), and metric-adjusted
 * fallbacks so there is no layout shift while it loads. Exposed as the
 * --font-inter variable consumed by the base typography in globals.css.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * Root layout for every locale. The `lang` attribute follows the active
 * locale instead of a hardcoded value; Finnish serves from the unprefixed
 * paths, English from `/en`.
 */

// ISR window for the inlined flag states: a failed build-time flag fetch
// must not bake stale states into fully-static pages — they re-render at
// most this far behind the backend's actual flag configuration.
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

  return {
    metadataBase: new URL(SITE_URL),
    title: t('title'),
    description: t('description'),
  };
}

export default async function RootLayout({
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
  setRequestLocale(locale);

  // Messages are inherited by every client component below the provider.
  const messages = await getMessages();

  // Flag states are resolved server-side and inlined with the page payload
  // so flag-gated UI renders at the correct visibility on the first paint.
  const flags = await getServerFeatureFlags();

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        {/* Explicit locale: the provider must not depend on the RSC
            request store to know which catalog it carries. */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Header and footer stay outside the gate: navigation chrome is
              not restricted content and belongs in the SSR payload. */}
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <div className="flex-1">
              <FeatureFlagsProvider flags={flags}>
                <AgeGate>{children}</AgeGate>
              </FeatureFlagsProvider>
            </div>
            <SiteFooter />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
