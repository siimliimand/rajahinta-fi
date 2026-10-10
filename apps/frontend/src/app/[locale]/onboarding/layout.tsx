import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getClientMessages } from '@/lib/i18n/client-messages';
import {
  ROUTE_CLIENT_NAMESPACES,
  type MessageNamespace,
} from '@/lib/i18n/route-namespaces';

/**
 * Per-route client message subset (first-impression-pass task 2.3,
 * design D6): the nested provider below REPLACES the root layout's
 * shared-chrome subset for this page subtree, so only the namespaces the
 * route's client components use reach the RSC payload. The namespace
 * list is the '/onboarding' entry of `ROUTE_CLIENT_NAMESPACES`
 * (`@/lib/i18n/route-namespaces`), pinned against the source tree by
 * the payload-budget test's enumeration tripwire. Chrome above (header,
 * footer, age gate) keeps reading the root provider.
 *
 * The '/onboarding' split-table entry lands together with the copy
 * (add-onboarding-preferences 5.1 owns `route-namespaces.ts` and the
 * catalogs). The lookup is written against that key so it resolves the
 * moment the entry is registered, with no edit here; until then the
 * route subset ships empty and the page's copy is missing — the
 * payload-budget enumeration tripwire flags that loudly by design.
 */
const ROUTE_NAMESPACES: readonly MessageNamespace[] =
  (ROUTE_CLIENT_NAMESPACES as Record<
    string,
    readonly MessageNamespace[] | undefined
  >)['/onboarding'] ?? [];

export default async function OnboardingRouteLayout({
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
      messages={await getClientMessages(locale, ROUTE_NAMESPACES)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
