/**
 * Group order create/manage entry page (task 9.4, change
 * product-roadmap-phases-1-4) at /group-order.
 *
 * Group order sessions are account-scoped coordination surfaces, not SEO
 * content: no sitemap entry, and the noindex treatment the repo applies
 * to session-scoped pages (ops page precedent, robots.ts disallow). The
 * interactive surface is the client view below; the server shell only
 * pins metadata.
 *
 * Flag gating lives in the client view (the inlined GROUP_ORDER_LEDGER
 * payload) — flag off renders nothing, consistently across the feature's
 * pages.
 *
 * @module GroupOrderCreatePage
 */

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import CreateGroupOrderView from './create-view';

interface GroupOrderPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: GroupOrderPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'GroupOrder' });
  return {
    title: t('metaTitle'),
    // Session-scoped coordination surface — never indexed (robots.ts
    // disallows the path as well; this covers direct crawls).
    robots: { index: false, follow: false },
  };
}

export default function GroupOrderPage() {
  return <CreateGroupOrderView />;
}
