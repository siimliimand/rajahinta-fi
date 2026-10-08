/**
 * Golden detail page for licorea.com (task 1.2, change
 * sitemap-crawl-merchants).
 *
 * Pinned from the live page sample captured during the 2026-10-07
 * reconnaissance (read-only, one request, descriptive UA): licorea
 * exposes a COMPLETE JSON-LD Product — name, brand node, `gtin13`,
 * `sku`, `mpn`, image, description, url, and a single Offer with EUR
 * price, availability, condition, and `priceValidUntil`. Verdict:
 * JSON-LD suffices — the record must come out without any fallback
 * parsing.
 *
 * The image, `mpn`, `priceValidUntil`, and the hreflang alternates are
 * kept in the fixture on purpose: the extractor reads none of them
 * (data minimization — no image or description field exists on the
 * record), and future payload drift must fail the golden test instead
 * of silently leaking new data.
 *
 * @module LicoreaProductFixture
 */

export const LICOREA_PRODUCT_URL =
  'https://www.licorea.com/brugal-aniejo-rum-07l-en-p-31415.html';

export const LICOREA_PRODUCT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="alternate" hreflang="es" href="https://www.licorea.com/brugal-aniejo-rum-07l-es-p-31415.html">
  <link rel="alternate" hreflang="en" href="${LICOREA_PRODUCT_URL}">
  <title>Brugal Añejo Rum 40% 0.7 l - Licorea</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Brugal Añejo Rum 40% 0.7 l",
    "brand": { "@type": "Brand", "name": "Brugal" },
    "gtin13": "8410184100115",
    "sku": "LIC-31415",
    "mpn": "BRU-AN-07",
    "image": "https://www.licorea.com/31415-large_default/brugal-aniejo.jpg",
    "description": "Brugal Añejo is a Dominican rum aged in American oak barrels.",
    "url": "${LICOREA_PRODUCT_URL}",
    "offers": {
      "@type": "Offer",
      "price": "18.95",
      "priceCurrency": "EUR",
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      "priceValidUntil": "2026-12-31"
    }
  }
  </script>
</head>
<body>
  <div id="product-31415">
    <img src="https://www.licorea.com/31415-large_default/brugal-aniejo.jpg" alt="Brugal Añejo Rum">
    <h1 class="product_name">Brugal Añejo Rum 40% 0.7 l</h1>
    <span class="price">18,95 €</span>
  </div>
</body>
</html>`;
