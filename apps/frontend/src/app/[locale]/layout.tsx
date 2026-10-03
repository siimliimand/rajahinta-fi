import React from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/api';
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

/** JSON-LD schema for rich search results (WebApplication). */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Rajahinta.fi',
  url: SITE_URL,
  description:
    'Finnish cross-border beverage landed-cost calculator. Calculate retail price, transport, excise duty and container tax in one estimate.',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'EUR',
  },
  inLanguage: ['fi', 'en'],
};

/**
 * Pre-paint age-gate state (first-impression-pass task 2.1, design D4).
 *
 * Rendered into the SSR'd HTML as the first element of <body>, this
 * script executes synchronously during parsing — before the overlay
 * further down can exist, hence before first paint. It reads the
 * `age_confirmed` cookie and, for any non-empty value, sets
 * `data-age-confirmed` on <html>. The base CSS (unlayered rule in
 * globals.css) keeps the server-rendered overlay unpainted for
 * confirmed visitors until AgeGate hydration removes it — no gate
 * flash, on fresh and CDN-cached HTML alike.
 *
 * Reader, not a store: the cookie remains the single source of truth
 * (AgeGate converges on it at hydration). The parse below mirrors
 * AgeGate's getAgeVerified exactly — split/trim/starts-with, an empty
 * value counts as unconfirmed. The cookie and attribute names are
 * restated here because importing a constant across the 'use client'
 * boundary hands the server a client reference, not the string.
 */
const AGE_GATE_PREPAINT_SCRIPT = `try {
var confirmed = false;
var parts = document.cookie.split(';');
for (var i = 0; i < parts.length; i++) {
var segment = parts[i].trim();
if (segment.startsWith('age_confirmed=')) {
confirmed = segment.slice('age_confirmed='.length).length > 0;
break;
}
}
if (confirmed) document.documentElement.setAttribute('data-age-confirmed', '');
} catch (e) {}`;

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

  // The gate decision is made on the client (design D4 of
  // first-impression-pass): rendering no longer reads request cookies,
  // so every route under this layout is cacheable and `revalidate`
  // above is effective. The server HTML always ships the overlay; the
  // inline pre-paint script below plus the base-CSS rule keyed on
  // <html data-age-confirmed> keep confirmed visitors flash-free before
  // hydration, and AgeGate converges on the cookie at mount.

  // Messages are inherited by every client component below the provider.
  const messages = await getMessages();

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        {/* First element in the body: the gate verdict is set during
            parsing, before the overlay markup below can be painted. */}
        <script dangerouslySetInnerHTML={{ __html: AGE_GATE_PREPAINT_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Explicit locale: the provider must not depend on the RSC
            request store to know which catalog it carries. */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Header and footer stay outside the age gate: navigation chrome
              is not restricted content and belongs in the SSR payload. */}
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <div className="flex-1">
              <AgeGate>{children}</AgeGate>
            </div>
            <SiteFooter />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
