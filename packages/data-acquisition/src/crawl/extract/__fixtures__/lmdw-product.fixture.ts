/**
 * Golden detail page for www.whisky.fr — La Maison du Whisky (task 3.1,
 * change onboard-lmdw-crawl-merchant).
 *
 * Synthetic-but-faithful to the 300-page crawl probe (notes 1.1): a
 * Next.js `__NEXT_DATA__` state JSON carrying the canonical
 * `props.pageProps.productFromServer` product (`volume` litres as the
 * measured string-dot form, `strength` ABV percent as the measured bare
 * number, the `ean` string, and the m3 taxonomy as `LmdwProductSelect`-
 * shaped `{ label }` arrays), next to a JSON-LD Product with `gtin13`
 * and an EUR offer. The probe measured the state `ean` and the JSON-LD
 * `gtin13` carrying IDENTICAL values — the fixture pins that dual
 * attestation, while the extractor reads the GTIN only through the
 * JSON-LD path (design D4).
 *
 * The i18n dictionary subtree is kept on purpose: digit-free
 * `"volume"`/`"strength"` strings appear on 300/300 probed pages, and
 * the guarded reader must never take them (only the canonical product
 * path is read). The breadcrumb JSON-LD (geography/brand vocabulary per
 * the probe) and the description/image are likewise unread decoys —
 * payload drift must fail the golden test instead of leaking data.
 *
 * @module LmdwProductFixture
 */

export const LMDW_PRODUCT_URL = 'https://www.whisky.fr/ardbeg-uigeadail.html';

export const LMDW_PRODUCT_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
  <title>Ardbeg Uigeadail - La Maison du Whisky</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Ardbeg Uigeadail",
    "brand": { "@type": "Brand", "name": "Ardbeg" },
    "gtin13": "5000277000982",
    "sku": "1000425",
    "image": "https://www.whisky.fr/media/catalog/product/a/r/ardbeg-uigeadail.jpg",
    "description": "L'Ardbeg Uigeadail est un single malt tourbé de l'île d'Islay.",
    "url": "${LMDW_PRODUCT_URL}",
    "offers": {
      "@type": "Offer",
      "price": "58.90",
      "priceCurrency": "EUR",
      "availability": "https://schema.org/InStock"
    }
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "name": "Accueil" },
      { "@type": "ListItem", "name": "ecosse" },
      { "@type": "ListItem", "name": "ARDBEG" }
    ]
  }
  </script>
  <script id="__NEXT_DATA__" type="application/json">
  {
    "props": {
      "pageProps": {
        "productFromServer": {
          "id": 1000425,
          "sku": "1000425",
          "url_key": "ardbeg-uigeadail",
          "name": "Ardbeg Uigeadail",
          "volume": "0.7",
          "strength": 40,
          "ean": "5000277000982",
          "m3_category": [ { "id": 2, "label": "whisky" } ],
          "m3_family": [ { "id": 12, "label": "single malt whisky" } ],
          "m3_subfamily": [ { "id": 121, "label": "single malt whisky" } ]
        },
        "__N_SSG": true
      },
      "i18n": {
        "volume": "Volume : ",
        "strength": "Degré d'alcool : "
      }
    },
    "runtime": { "buildId": "fixture-build-id" }
  }
  </script>
</head>
<body>
  <div id="__next">
    <h1>Ardbeg Uigeadail</h1>
    <span class="price">58,90 €</span>
  </div>
</body>
</html>`;
