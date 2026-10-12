/**
 * [locale] route adapter for the product detail page (fi-path-isr 2.1).
 *
 * The page body, generateMetadata, and the full design history live in
 * ./product-page — extracted as a locale-parameterized module (explicit
 * `locale` prop + `{ id }`-shaped params) so the upcoming root-level
 * route (task 3.1) can render it with locale 'fi' and no `[locale]`
 * segment. This file is the thin [locale] adapter: it awaits the route's
 * `{ locale, id }` params and delegates.
 *
 * The segment config is defined HERE, not re-exported: Next reads
 * segment options from the route module itself, and the cache-headers
 * audit pins the ISR constants to this file's source. The same values
 * are exported from ./product-page for the future root route — keep the
 * copies in sync. The load-bearing empty-generateStaticParams rationale
 * (Next 15.5 engages the dynamic-segment ISR fallback cache only when
 * the route exports it) is documented there.
 *
 * @module ProductPageRoute
 */

import type { Metadata } from 'next';
import ProductPageBody, {
  generateMetadata as sharedGenerateMetadata,
} from './product-page';

// On-demand ISR (product-page-cold-latency 1.1) — same window and
// on-demand param handling ./product-page documents; carried here
// because Next reads segment options from the route module.
export const revalidate = 300;
export const dynamicParams = true;

// The empty generateStaticParams is load-bearing, not vestigial — see
// ./product-page for the rationale and the 5.2 staging evidence. Sync
// shape, like the shared module's export.
export function generateStaticParams() {
  return [];
}

interface ProductPageRouteProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({
  params,
}: ProductPageRouteProps): Promise<Metadata> {
  const { locale, id } = await params;
  return sharedGenerateMetadata({ params: Promise.resolve({ id }), locale });
}

export default async function ProductPage({ params }: ProductPageRouteProps) {
  const { locale, id } = await params;
  return ProductPageBody({ params: Promise.resolve({ id }), locale });
}
