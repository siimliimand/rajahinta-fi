/**
 * Per-product OG image — `[locale]` route `/en/products/<id>`
 * (seo-aeo-agent-surfaces 1.7).
 *
 * The [locale]-tree twin of `tuotteet/[id]/opengraph-image.tsx`: Next
 * auto-discovers this module per route segment and wires the generated
 * PNG into the served `og:image` meta — no generateMetadata changes. The
 * composition lives in ONE shared module
 * (`lib/seo/product-og-image.tsx`) so both product route trees render
 * identical geometry; this file is the adapter: it resolves the identity
 * inputs and delegates.
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
 * Locale: routing serves fi and en only (localePrefix 'as-needed'), so
 * anything but 'en' normalizes to 'fi' — the products-page precedent.
 * The static `alt` is English: the [locale] segment only appears on
 * English URLs, and one static string per route tree is the site-wide
 * image's export shape (per-product alt would require generateMetadata
 * changes, deliberately out of scope here).
 *
 * Render constraints (app/opengraph-image.tsx precedent): rendered with
 * next/og's bundled default font — no network font fetch at build;
 * Satori supports inline styles only.
 *
 * @module LocaleProductOgImageRoute
 */

import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { getServerProductDetail } from '@/lib/server-api';
import {
  isProductCategoryKey,
  productOgIdentity,
  productOgImageElement,
} from '@/lib/seo/product-og-image';

export const alt = 'Rajahinta.fi — product name, brand, and category';
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
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'fi';
  const t = await getTranslations({ locale, namespace: 'ProductPage' });

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
