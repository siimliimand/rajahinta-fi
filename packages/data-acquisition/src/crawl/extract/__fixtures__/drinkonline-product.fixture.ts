/**
 * Golden detail page for drinkonline.eu (task 1.2, change
 * sitemap-crawl-merchants).
 *
 * Pinned from the live page sample captured during the 2026-10-07
 * reconnaissance (read-only, one request, descriptive UA): JSON-LD
 * Product whose `offers` is an ARRAY of offers (price a JSON NUMBER —
 * 3.68 — not a string), `brand` a plain string, `sku` present, and no
 * GTIN. Verdict: JSON-LD suffices once the reader selects the first
 * offer with a usable price instead of failing on the array. The URL
 * is category-prefixed with a trailing slash and no id
 * (`/<category>/<slug>/`), so the record's productId is the slug-side
 * SKU.
 *
 * @module DrinkonlineProductFixture
 */

export const DRINKONLINE_PRODUCT_URL =
  'https://www.drinkonline.eu/vodka/koskenkorva-vodka-60-500-ml/';

export const DRINKONLINE_PRODUCT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Koskenkorva Vodka 60% 500 ml - Drinkonline</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Koskenkorva Vodka 60% 500 ml",
    "brand": "Koskenkorva",
    "sku": "DN-78901",
    "description": "Koskenkorva Vodka 60% is a strong Finnish vodka made from six-row barley.",
    "offers": [
      {
        "@type": "Offer",
        "price": 3.68,
        "priceCurrency": "EUR",
        "availability": "https://schema.org/InStock",
        "itemCondition": "https://schema.org/NewCondition"
      }
    ]
  }
  </script>
</head>
<body>
  <div class="product-main">
    <h1>Koskenkorva Vodka 60% 500 ml</h1>
    <span class="regular-price">3,68 €</span>
  </div>
</body>
</html>`;
