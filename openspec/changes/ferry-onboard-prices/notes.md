# Ferry onboard prices — change notes

## 1.1 Pre-order shop sweep (gate) — 2026-10-11

Method: `scripts/ferry-shop-sweep.ts` (read-only GETs only, sequential, honest
crawler UA `rajahinta-crawler/1.0 (+https://rajahinta.fi)`, per-operator polite
delay — Eckerö's robots `Crawl-delay: 10` honored). No auth bypass, no
bot-protection circumvention; a 403/challenge is recorded as a finding.
Probe request budget: Tallink 5, Viking 3, Eckerö 4. Reproduce with:

```
pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/ferry-shop-sweep.ts [--operator tallink|viking|eckero]
```

### Tallink Silja

| Aspect | Finding |
|---|---|
| Shop endpoints | `shopping.tallink.com` (E-SHOP pre-order) + `shopping-onboard.tallink.com` (per-ship onboard price lists). Storefront migrated: `tallinksilja.com` 301s everything to `www.tallink.com/en` (Next.js + headless WP at `cms-web-wp.fleet.zone`); booking at `travel.tallink.com`. `shop.tallink.com` NXDOMAIN. `preorder.tallink.com` resolves but the TLS handshake hangs from datacenter egress (Posti-pattern rejection — a Worker live fetch would fail identically). `konakart.tallink.com` (the engine host referenced by the SPA) is not publicly resolvable — the product data path is server-side only. |
| Platform / feed shape | **Custom**: Next.js SSR over a Konakart commerce engine (`konakartServer` in `__NEXT_DATA__`). NOT WooCommerce (no `/wp-json/wc/store/v1`; the headless WP REST is content-only), NOT Shopify (no `/products.json`). Category pages 200 with the full product array in `__NEXT_DATA__`: `productArray` (30/page), `totalNumProducts`, `currentPage` pagination, manufacturer/origin/spec facets, `taxMultiplier`. |
| Currency | No explicit currency field; `priceExTax` + `priceIncTax` dual prices with `taxMultiplier: 1.24` — EUR implied (FI-market e-shop, 7 locales fi/en/sv/et/lv/ru/lt). |
| Regular vs sale | `specialStatus` flag + `custom4` campaign window (`campaign_from`/`campaign_to`); 0 of 30 sampled vodka rows on sale at probe time. |
| Category vocabulary | E-SHOP category sitemap: 1519 URLs (en slugs; hreflang alternates per locale on the same numeric ID — FI slugs not enumerated here). Alcohol sample: `strong-alcohol-1147`, `vodka-1802`, `whisky-1159`, `gin-1804`, `rum-1149`, `liqueur-1858`, `flavoured-spirits-1864`, `other-strong-spirit-1806`, `wines-1859`, `red-wine-1982`, `white-wine-1985`, `rose-wine-1983`, `sparkling-wine-1861`, `champagne-1868`, `mulled-wine-1977`, `port-wine-1981`, `madeira-wine-1978`, `marsala-wine-1979`, `dessert-wine-1976`, `alcohol-free-drinks-1798`, `soft-drink-1807`, `tallink-special-drinks-3156`. **Beer/cider/long-drink categories NOT found in the E-SHOP category list** (grep over all 1519) — may be classified otherwise or absent; onboard taxonomy not fully enumerated. |
| Label format | `Name + volume` ("Finlandia Redberry 100 cl", "Koskenkorva Vanilla 70 cl"). `custom1` carries the **EAN** (GTIN-13/14), `manufacturerName` the producer. No ABV in the name. Both existing parsers consume the volume token; ABV absent from labels (name-only parse: 0/30). |
| Pagination | Category SSR `currentPage` (30/page) + complete product sitemaps (both shops) — a walk would use the sitemaps. |
| Catalog size | E-SHOP: 14 product-sitemap files ≈ 693 products/file → order **9 700 SKUs** (fashion/beauty included). Onboard: 51 product-sitemap files, 5000 URLs/file ÷ 7 locales ≈ order **36 000 ship-product rows** across all ships. |
| Routes | Onboard shop is **per-ship** (`/en/balticprincess/product/…`) → Helsinki–Tallinn (MyStar, Megastar), Helsinki–Stockholm (Silja Serenade/Symphony), Turku–Stockholm (Baltic Princess/Queen), Tallinn–Stockholm (Victoria I) all covered. E-SHOP pre-order is shop-wide with onboard pickup desk (info page names MyStar deck 7 Traveller Superstore, Victoria I). |
| Terms posture | `shopping.tallink.com/robots.txt` permissive: 172 Disallow rules, all session paths (cart/checkout per locale); catalog publicly browsable without login. No published API/feed terms; site footer carries a reCAPTCHA notice. No sanctioned feed found. |
| Parser verdict | 30 fetched labels: volume **30/30**, ABV 0/30, pack 0/30 — volume always machine-readable; ABV is not on the label (curated rows are display-only labels, so acceptable). |
| **GO/NO-GO** | (a) Live feed: **NO-GO** — no sanctioned feed, no published API, engine host not publicly resolvable, one host already rejects datacenter egress. Would be unsanctioned scraping; revisit only with an operator grant. (b) Curated transcription: **GO** — EUR prices, labels, ship/route and URL citations all publicly browsable; the per-ship onboard shop matches the operator+route+label dataset shape directly. |

### Viking Line

| Aspect | Finding |
|---|---|
| Shop endpoints | `www.vikingline.fi/taxfree/` and `/verkkokauppa/` exist (an initial redirect-following request got 200 text/html). No WooCommerce/Shopify fingerprints observable. |
| Platform | Episerver CMS (`Disallow: /episerver/`) behind **Imperva Incapsula + Distil** bot protection — challenge fingerprints `/_Incapsula_Resource`, `distil_referrer`, "Pardon Our Interruption". Both shop paths return 403 challenges to non-browser fetches; a soft-200 challenge body was also observed once (intermittent shapes, same gate). |
| Currency | Not obtainable — every shop-path fetch is the challenge page. |
| Category vocabulary | Not obtainable (gated). |
| Label format / parser | Not obtainable → parser compatibility **UNMEASURED** (gated, not failed). |
| Pagination / catalog size | Not obtainable (gated). |
| Routes | Not discoverable from here — **route taxonomy unclear, operator transcription needed**. |
| Terms posture | `robots.txt` permissive on shop paths (12 Disallow rules; `/protheus-api/` blocked, `/taxfree/` not disallowed) — but the Imperva/Distil layer is the de-facto posture: automated non-browser access is actively rejected. No published API terms. Circumvention is out of scope per the sweep guardrails. |
| **GO/NO-GO** | (a) Live feed: **NO-GO** — bot-gated; nothing reachable without circumvention. (b) Curated transcription: **GO, via operator transcription** — the site is publicly browsable to humans, so rows can come from an operator contact / app price list; until then Viking stays an empty operator (the specced designed empty state covers this). |

### Eckerö Line

| Aspect | Finding |
|---|---|
| Shop endpoints | `www.eckeroline.com/shopping/*` ("Eckerö Market") — the site **is** the webshop. Pre-order tree `/shopping/preorder/*`: strong-alcohol, liqueur, beer, cider, long-drink, sparkling-wine-and-champagne, wine-bottle-boxes, bag-in-box-wine, non-alcoholic (+ confectionary). Onboard context page `/onboard/msfinlandia/shopping-at-the-sea`. |
| Platform / feed shape | **Magento 2** (Luma fingerprints: `Magento_Catalog/js/price-utils`, `/checkout/`, `/wishlist/`, `/pkginfo/` robots rules), Cloudflare in front. Server-rendered HTML with per-product `data-name` / `data-price` / `data-currency` / `data-currency-base` / `data-quantity` attributes. No public JSON feed: `/rest/V1/store/storeConfigs` → **401** (Magento auth), `/graphql` → **403** (Cloudflare WAF). Luma HTML is the only public data path. |
| Currency | Explicit: `data-currency="EUR"`, base currency identical. |
| Regular vs sale | Magento `regular-price` + `special-price` markup in product tiles. |
| Category vocabulary | FI slugs with EN display names, ABV bands in the slug: `miedot-alkoholijuomat` → `aperitiivit-katkerot-ja-vermutit`, `flavoured-spirits`, `katkerot`, `likoorit-15`, `likoorit-16-21`; `oluet-siiderit-ja-long-drinkit` → `oluet`, `siiderit`, `long-drinkit`; `multipacks/{3,4,6,8,10,12,24}-packs`; `non-alcoholic/{mixers,soft-drinks}`; `premium-selection`, `sales-products`, `newly-added`, `parfymeria-miehet/naiset`, `s-etukorttitarjoukset`, `confectionary-snacks`. |
| Label format | `Brand Product ABV%, N x VOL` — "Jaloviina Yrtti 30%, 3 x 50 cl" @ EUR 41.7, "Koskenkorva Vodka 40%, 3 x 70 cl". Caveats: `data-brand` is a slot value ("simple_preorder"), **not** the producer; some names carry a `*` placeholder ("Jaloviina * x 3 (PET)") or pack-word only ("Engine Pure Organic Gin 3-pack"); tiles duplicate each product's data attributes (45 tags → 24 unique). HTML entities reach the name (`Crafter&apos;s`) — the Woo parser's entity-decoding note applies. |
| Pagination | Magento toolbar (items X–Y of N; strong-alcohol pre-order shows 102 items). |
| Catalog size | Pre-order strong alcohol ≈ 102 items; full pre-order tree (9 alcohol categories) order of a few hundred SKUs; whole Market spans dozens of categories (no public total). |
| Routes | **M/S Finlandia, Helsinki–Tallinn** (single-route operator; ship named in the shop context). |
| Terms posture | `robots.txt` allows the SEO `/shopping/` paths; blocks native `/catalog/`, `/catalogsearch/`, checkout, wishlist, customer; **Crawl-delay: 10** (honored). Prices publicly browsable without login. No published API terms; API surface closed. A live feed would be HTML scraping, which the change explicitly rules out ("no auto-scraping"). |
| Parser verdict | 24 unique fetched labels: volume 16/24, ABV 2/24, `parseVolume` pack count 15/24, pack-notation unit volume 15/24. The `N x VOL` pack form parses reliably (including `5 x 5 cl`); misses are names with **no volume token at all** (rely on the pack-word form, which production `parsePackUnits` reads) or a `*` placeholder. Good enough for display-only curated rows; do not expect every row to yield a volume. |
| **GO/NO-GO** | (a) Live feed: **NO-GO** — HTML-only, Magento API closed, robots crawl-delay; unsanctioned scraping. Candidate for a live upgrade only with an operator grant. (b) Curated transcription: **GO** — explicit EUR, clean labels, single route; the easiest operator to transcribe with citations. |

### Product-label overlap spot-check (5 candidates)

| Candidate | Tallink | Viking | Eckerö |
|---|---|---|---|
| Koskenkorva | FOUND (12 vodka SKUs in facets; "Koskenkorva Vanilla 70 cl" fetched) | unmeasured (gated) | FOUND ("Koskenkorva Salmiakki (PET), 3 x 50 cl", "…Vodka 40%, 3 x 70 cl") |
| Jack Daniel's | category-level yes (`whisky-1159`; onboard sitemap shows whisky URLs) — brand not in the vodka sample | unmeasured | not in probed sample (sample 24 of 102 strong-alcohol; whisky/liqueur categories unprobed) |
| Absolut | FOUND (4 vodka SKUs in facets) | unmeasured | not in probed sample |
| sparkling wine / champagne | category-level yes (`sparkling-wine-1861`, `champagne-1868`) | unmeasured | category-level yes (`pre-order-sparkling-wine-and-champagne`) |
| lonkero / long drink (RTD) | not found as a category (`tallink-special-drinks-3156` candidate, unverified) | unmeasured | category-level yes (`pre-order-long-drink`) |

Category-level coverage exists for all five candidates on Tallink and Eckerö;
brand-level overlap is *measured* only for Koskenkorva and Absolut. Sufficient
for later curated-row labeling; do not treat unprobed cells as absences.

### Verdict for tasks 2.x

**No operator offers a sanctioned public feed → live-feed ingestion is NO-GO
for all three; the curated-dataset path (Fransberg/Posti pattern, task 2.2's
documented default) is GO for all three.** Proceed:

1. **Task 2.1 (D1 migration + repository)** proceeds unchanged — operator +
   route + label + price + observed-at + citation fits all three operators
   (Tallink's route dimension = ship; Eckerö fixed `helsinki-tallinn`; Viking
   pending operator input).
2. **Task 2.2 (curated dataset)** starts with Tallink (richest, per-ship, EUR,
   EAN-bearing labels, stable URL citations) and Eckerö (single route, explicit
   EUR). Viking enters only after operator transcription; until then it simply
   has no rows — the specced designed empty state covers it.
3. If an operator later grants feed access, the source generalizes to a live
   fetch without a dataset-shape change (per proposal) — Tallink would need an
   egress fix for `preorder.tallink.com`/`konakart.tallink.com` (Posti-pattern),
   Eckerö a sanctioned API or an operator-granted scraping window, Viking an
   Incapsula/Distil exemption.

Blockers: none for 2.x. Open items for the transcription act itself: decide
Tallink per-ship vs shop-wide route keys, and obtain Viking price source
(operator contact, app, or published price list) before claiming Viking rows.
