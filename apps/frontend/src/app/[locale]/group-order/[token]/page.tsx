/**
 * Group order share-link session page (task 9.4, change
 * product-roadmap-phases-1-4) at /group-order/[token] — the shareable
 * link the owner distributes; the token is the capability participants
 * join under (no account).
 *
 * Group order sessions are account-scoped coordination surfaces, not SEO
 * content: no sitemap entry, and the noindex treatment the repo applies
 * to session-scoped pages (ops page precedent, robots.ts disallow).
 * Metadata stays generic — nothing token-specific is claimed in the head.
 *
 * The token itself is only consumed by the API through the client view;
 * the server shell never resolves it.
 *
 * @module GroupOrderSessionPage
 */

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import GroupOrderSessionView from '../session-view';

interface SessionPageProps {
  params: Promise<{ locale: string; token: string }>;
}

export async function generateMetadata({
  params,
}: SessionPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'GroupOrder' });
  return {
    title: t('metaTitle'),
    // Session-scoped coordination surface — never indexed (robots.ts
    // disallows the path as well; this covers direct crawls).
    robots: { index: false, follow: false },
  };
}

export default async function GroupOrderSessionPage({
  params,
}: SessionPageProps) {
  const { token } = await params;
  return <GroupOrderSessionView token={token} />;
}
