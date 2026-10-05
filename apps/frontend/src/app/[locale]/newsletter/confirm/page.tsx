// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getServerBlogIndex } from '../../blog/blog.server';
import NewsletterConfirmView from './confirm-view';

interface NewsletterConfirmPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Newsletter confirmation page shell (fi-locale-surface-hardening task
 * 2.7, design D4; the ranking page's D2 server-shell + client-view
 * split). The token confirmation itself stays client-side
 * (`NewsletterConfirmView`, verify-email precedent); this shell exists
 * so the `/blog` link is decided the way the footer decides it — from
 * the CURRENT locale's published-post count through the same
 * `getServerBlogIndex` helper. Zero published posts omit the link, and
 * an index fetch failure hides it (the honest default), so a new
 * subscriber's first click can never land on a 404. The first
 * publication restores the link with no flag and no deploy.
 *
 * @module NewsletterConfirmPage
 */
export default async function NewsletterConfirmPage({
  params,
}: NewsletterConfirmPageProps) {
  const { locale } = await params;
  const blogOutcome = await getServerBlogIndex(locale);
  const showBlogLink =
    blogOutcome.kind === 'ok' && blogOutcome.items.length > 0;
  return <NewsletterConfirmView showBlogLink={showBlogLink} />;
}
