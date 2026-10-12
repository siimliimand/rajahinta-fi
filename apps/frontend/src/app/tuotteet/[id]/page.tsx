/**
 * Root-level Finnish product route (fi-path-isr task 3.1).
 *
 * The Finnish default locale serves product detail from the localized
 * bare path `/tuotteet/<id>` — middleware-managed negotiation replaced
 * by a physical route: the matcher excludes exactly one path segment
 * (`tuotteet/[^/]+`), so this page is served directly and its ISR key is
 * the literal URL. The page body and generateMetadata live in the
 * shared, locale-parameterized module
 * `@/app/[locale]/products/[id]/product-page` (extracted in fi-path-isr
 * 2.1); this file delegates with the pinned locale `'fi'`, mirroring the
 * `[locale]` adapter.
 *
 * The segment config is defined HERE, not re-exported: Next reads
 * segment options from the route module itself, and the cache-headers
 * audit pins the ISR constants to each route file's own source. The
 * same values are exported from the shared module (and the `[locale]`
 * adapter) — keep the copies in sync. The load-bearing
 * empty-generateStaticParams rationale (Next 15.5 engages the
 * dynamic-segment ISR fallback cache only when the route exports it;
 * 5.2 staging evidence) is documented there. Unlike the `[locale]`
 * tree, no 60 s layout sits above this route, so the tree minimum —
 * and the emitted `s-maxage` — is this page's own 300 s window.
 *
 * @module FiProductPageRoute
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ProductPageBody, {
  generateMetadata as sharedGenerateMetadata,
} from '@/app/[locale]/products/[id]/product-page';

// On-demand ISR — same window and on-demand param handling the shared
// module documents; carried here because Next reads segment options from
// the route module.
export const revalidate = 300;
export const dynamicParams = true;

// The empty generateStaticParams is load-bearing, not vestigial — see
// the shared module for the rationale and the 5.2 staging evidence. Sync
// shape, like the shared module's export.
export function generateStaticParams() {
  return [];
}

interface FiProductPageRouteProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: FiProductPageRouteProps): Promise<Metadata> {
  const { id } = await params;
  return sharedGenerateMetadata({
    params: Promise.resolve({ id }),
    locale: 'fi',
  });
}

export default async function FiProductPage({
  params,
}: FiProductPageRouteProps) {
  const { id } = await params;
  // Empty/missing id can never be a product — the shared body's
  // integer guard would 404 it too; stated here so the route's own
  // contract is visible at the route file.
  if (!id) {
    notFound();
  }
  return ProductPageBody({
    params: Promise.resolve({ id }),
    locale: 'fi',
  });
}
