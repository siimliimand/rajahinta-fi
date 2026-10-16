/**
 * Per-product OG image — physical FI route `/tuotteet/<id>`
 * (seo-aeo-agent-surfaces 1.7).
 *
 * Next auto-discovers this module per route segment and wires the
 * generated PNG into the served `og:image` meta — no generateMetadata
 * changes. The composition lives in ONE shared module
 * (`lib/seo/product-og-image.tsx`) so both product route trees (this one
 * and the `[locale]` adapter) render identical geometry; this file is the
 * adapter: it resolves the identity inputs and delegates.
 *
 * IDENTITY-ONLY (spec-pinned): the image renders the product name, brand,
 * and localized category label — no price, availability, or observation
 * dates, because the image is cached far longer than the 300 s price
 * window. The volatile payload fields are stripped structurally, by the
 * shared `productOgIdentity` projection, before anything renders.
 *
 * Degradation: an unknown/non-integer id, a failed detail fetch, a
 * missing brand, or an unknown category key each degrade the composition
 * (down to the static site composition) — the route always renders a
 * valid PNG and never throws, never emits a placeholder error image.
 *
 * Render constraints (app/opengraph-image.tsx precedent): rendered with
 * next/og's bundled default font — Inter is deliberately NOT fetched; a
 * network-dependent build asset would violate the no-fetch-at-build
 * constraint. Satori supports inline styles only; the shared composition
 * mirrors the design tokens as literals.
 *
 * Finnish is the site's primary locale (unprefixed paths), so the static
 * `alt` is Finnish — one string per route tree, the same static-export
 * shape the site-wide image uses (per-product alt would require
 * generateMetadata changes, deliberately out of scope here).
 *
 * @module FiProductOgImageRoute
 */

import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { getServerProductDetail } from '@/lib/server-api';
import {
  isProductCategoryKey,
  productOgIdentity,
  productOgImageElement,
} from '@/lib/seo/product-og-image';

export const alt = 'Rajahinta.fi — tuotteen nimi, merkki ja kategoria';
// Keep in sync with PRODUCT_OG_IMAGE_SIZE in the shared module — Next
// reads the image route's static exports from the route module itself.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// On-demand ISR (product-page-cold-latency 1.1) — the same window and
// on-demand param handling the sibling page route documents: the empty
// generateStaticParams + dynamicParams true engages the fallback cache so
// each product's image renders on demand and is then served from the
// incremental cache, with the route's own 300 s revalidation. Next reads
// segment options from the route module itself, hence the local copies.
export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations({ locale: 'fi', namespace: 'ProductPage' });

  // Same integer guard as the page route: a non-integer id can never be
  // a product, so no fetch is attempted and the identity degrades to the
  // static composition below.
  const productId = Number.parseInt(id, 10);
  const detail =
    Number.isInteger(productId) && productId > 0
      ? await getServerProductDetail(productId)
      : null;

  // Localized category label through the same ProductPage namespace the
  // product page resolves — an unknown storage key contributes no label,
  // never raw text.
  const categoryLabel =
    detail !== null && isProductCategoryKey(detail.product.category)
      ? t(`category.${detail.product.category}`)
      : null;

  return new ImageResponse(
    productOgImageElement(productOgIdentity(detail, categoryLabel)),
    { ...size },
  );
}
