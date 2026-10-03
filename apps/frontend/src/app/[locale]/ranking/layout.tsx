import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getClientMessages } from '@/lib/i18n/client-messages';
import { ROUTE_CLIENT_NAMESPACES } from '@/lib/i18n/route-namespaces';

/**
 * Per-route client message subset (first-impression-pass task 2.3,
 * design D6): the nested provider below REPLACES the root layout's
 * shared-chrome subset for this page subtree, so only the namespaces the
 * route's client components use reach the RSC payload. The namespace
 * list is the '/ranking' entry of `ROUTE_CLIENT_NAMESPACES`
 * (`@/lib/i18n/route-namespaces`), pinned against the source tree by
 * the payload-budget test's enumeration tripwire. Chrome above (header,
 * footer, age gate) keeps reading the root provider.
 */
export default async function RankingRouteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={await getClientMessages(locale, ROUTE_CLIENT_NAMESPACES['/ranking'])}
    >
      {children}
    </NextIntlClientProvider>
  );
}
