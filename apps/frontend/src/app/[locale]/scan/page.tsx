// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { localizedAlternates } from '@/lib/i18n/localized-paths';
import ScanLoader from './scan-loader';

interface ScanPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ScanPageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  // Routing serves fi and en only; anything else renders as Finnish
  // (the products-page precedent).
  const locale = rawLocale === 'en' ? 'en' : 'fi';
  const t = await getTranslations({ locale, namespace: 'Scan' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    // Localized canonical + hreflang pair (design D6, change
    // localize-fi-route-pathnames) through the /scan pathnames entry.
    alternates: localizedAlternates(locale, { pathname: '/scan' }),
  };
}

/**
 * /scan route adapter (task 3.1, change label-scan-product-lookup).
 *
 * A server shell in the about-page precedent — unique localized metadata
 * over a client island. The island mounts through next/dynamic with
 * ssr:false (see ./scan-loader) so the camera surface — getUserMedia,
 * the canvas downscale, the scan-label upload — never renders on the
 * server and never enters the main bundle: its chunk loads only when a
 * visitor actually opens this route.
 *
 * @module ScanPageRoute
 */
export default async function ScanPage({ params }: ScanPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ScanLoader />;
}
