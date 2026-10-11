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

## 5.1 Staging rollout + 5.2 production rollout — 2026-10-11

Owner-approved full ship (PR → merge → staging → production, governance
grants and dataset ingestion on BOTH environments). Executed in order;
every gate green; no step bypassed.

### PR + merge

| Step | Record |
|---|---|
| PR | [#121](https://github.com/siimliimand/rajahinta-fi/pull/121) `feature/ferry-onboard-prices` → `master` (6 commits, 0743c77…c880e8c) |
| Checks | all 31 required checks `pass` at head c880e8c (incl. Compliance, D1 suite, Browser E2E, Load test) |
| Merge | 2026-10-11T07:49:58Z, merge commit `07a23715` (repo convention: merge commits) |

### Staging (auto-deploy on merge)

| Step | Record |
|---|---|
| Deploy | `Deploy Staging` run [`38122701887`](https://github.com/siimliimand/rajahinta-fi/actions/runs/38122701887) — success (migrate → seed → deploy); `/api/v1/health/ready` 200 |
| Migration 0034 | applied; `ferry_price_observations` exists and is **EMPTY** (0 rows) pre-ingestion |
| Pre-ingestion empty state | `POST /api/v1/trip-feasibility` → 200 with `ferryPrices: []`, `ferryOffers: []` — renders nothing when unpublished |

**Staging pre-requisite fixed en route (pre-existing gap, not this change's
defect):** the trip endpoints 409'd (`NoPublishedAllowances`) because
`traveller_allowance_datasets` had **0 rows** on staging — production has had
the published `eu-2007-74-2026.1` dataset since 2026-10-02 (finnish-first
change notes) but the seed never ran there. Fix: the seed module's exact
statements (`wrangler d1 execute --remote --env staging`, 6 guarded
upserts generated verbatim from
`packages/data-platform/src/seed/traveller-allowances.seed.ts`) + the
repository's only publish transition (guarded
`PENDING_CONFIRMATION → PUBLISHED`, `confirmed_by` "owner-directed
(ferry-onboard-prices task 5.1 staging verification; mirrors production
eu-2007-74-2026.1 published 2026-10-02)"). Read-back: 1 dataset PUBLISHED,
5 limits. The empty-state check above was taken after this fix (the 409
itself is the pre-fix evidence that nothing ferry-related leaks through
an erroring endpoint).

### Governance grants (staging, then production)

The ops-console grant route could not be used —
`POST /ops/console/governance/:merchantId/grant` resolves the id in
`merchant_registry` and 404s on unknown merchants, and ferry operator keys
deliberately have no registry rows (runbook §10.4). Grants were written as
**direct guarded `source_governance` INSERTs** — the recorded curated-source
precedent (Omniva remediation 2026-10-04; pakettipojat/norrlog 2026-10-09;
fransberg/posti 2026-09-28). Guard: `… SELECT … WHERE NOT EXISTS (SELECT 1
FROM source_governance WHERE merchant_id = ? AND acquisition_method =
'MANUAL_VERIFICATION' AND permission_status = 'GRANTED')` (the table has no
unique key; `changes: 1` per env per operator; re-run-safe).

| Key | Status | Method | source_url | Note |
|---|---|---|---|---|
| `tallink` | GRANTED | MANUAL_VERIFICATION | `https://shopping-onboard.tallink.com/en/mystar` | owner-approved curated transcription grant, ferry-price-refresh cron gate |
| `eckero` | GRANTED | MANUAL_VERIFICATION | `https://www.eckeroline.com/shopping/preorder` | same |
| `viking` | **no record** | — | — | designed empty state — fail-closed PENDING; no rows AND no grant, either alone suffices |

`status_reason` carries the change name + date; no tokens echoed anywhere.
No `audit_events` rows — consistent with all prior curated-carrier grants
(the de-fi carriers change recorded the same).

### Dataset ingestion (staging, then production)

Trigger: the handler's documented out-of-band sync against real bindings
(the proven curated-rate-refresh path, transport-confidence-unlock notes):

```
wrangler dev --env <env> --remote --test-scheduled --port <p> \
  --show-interactive-dev-session false
curl "http://localhost:<p>/__scheduled?cron=0+5+1+*+*"
```

Wrangler 4.127.1. On staging the runbook §7's `/cdn-cgi/handler/scheduled`
form returned `error code: 1042`; the older `/__scheduled` form
("Ran scheduled event") worked and is what both runs used. The session
banner confirmed the real per-env D1 binding (`rajahinta-api-staging` /
`rajahinta-api-production`).

First sync per env (handler log):

- `Running monthly ferry price refresh for tallink` → `Upserted 42 curated tallink ferry price observations`
- `Running monthly ferry price refresh for eckero` → `Upserted 28 curated eckero ferry price observations`
- `Skipping ferry operator "viking": no governance records found — defaulting to PENDING` (fail-closed, both envs)
- curated-rate-refresh on the same tick: fransberg/posti/omniva/pakettipojat/norrlog all unchanged-skip (expected)

D1 read-back after the first sync:

| Env | tallink | eckero | viking | MAX(observed_at) |
|---|---|---|---|---|
| staging | 42 | 28 | 0 | `2026-10-11` |
| production | 42 | 28 | 0 | `2026-10-11` |

Re-trigger (second `__scheduled` fire per env) — unchanged-skip evidence:
`Ferry tallink dataset unchanged since 2026-10-11T00:00:00.000Z — skipping
the upsert` + same for `eckero`; total `Upserted` lines per env stayed at 2;
row counts unchanged. Append-only history clean.

### Live verification (staging + production)

`POST /api/v1/trip-feasibility` (car, 2 pax, beer+spirits prices,
2026-10-11) and `POST /api/v1/trip/fill` (2 staged product lines):

| Check | Staging | Production |
|---|---|---|
| feasibility HTTP | 200 | 200 (`api.rajahinta.fi`) |
| `ferryPrices` rows served | 50 (cap; 70 stored) | 50 (cap; 70 stored) |
| operators present | tallink + eckero | tallink + eckero |
| viking rows | 0 | 0 |
| provenance complete (operator, route, label, priceCents > 0, observedAt 2026-10-11, citation) | yes | yes |
| fill HTTP | 200 | 200 |
| fill field set | `status, travelDate, allowanceDatasetVersion, filledValueCents, filledUnits, lines, categoryHeadroom, disclaimer` intact | same |

Byte-identity spot-check (compliance property, live): the staging
feasibility response captured **before** ingestion vs **after** differs in
exactly one top-level key — `ferryPrices`; `result` is identical. The
frontend "Laivaston havaitut hinnat" block renders from this same
`ferryPrices` payload (component-tested, 1549 frontend green); the API-level
confirmation is the runbook's sanctioned check. The viking-only scenario is
the designed empty state: zero viking rows stored AND no viking grant —
observed as no viking entries in any response plus the fail-closed skip
warning on every tick.

### Monthly-cron ingest behavior (task 5.2 record)

The monthly curated tick `0 5 1 * *` (next natural fire: 2026-11-01 05:00
UTC) now carries `ferry-price-refresh` beside the curated carriers. Exactly
one ingest behavior is specced and now demonstrated per operator: sync once
per dataset revision — upsert the 70 curated rows on the revision's first
tick, then unchanged-skip while stored `MAX(observed_at)` equals
`FERRY_OBSERVED_AT` (both envs already at `2026-10-11`, so the 2026-11-01
tick will skip; the re-trigger runs above are the demonstration). A future
transcription lands by bumping `FERRY_OBSERVED_AT` + deploy (runbook §10.3).
The first sync happened out-of-band on 2026-10-11 (documented path above)
rather than waiting for the tick, mirroring the fransberg/posti precedent.

### Blockers / follow-ups

- None. Production health 200 pre/post; no gate failed; nothing pushed through.
- Note for the next wrangler bump: if `/cdn-cgi/handler/scheduled` keeps
  1042-ing in remote dev sessions, prefer the `/__scheduled` form (both are
  documented; §7 to be updated only if a future wrangler drops it).

## 6.1 Full verification — 2026-10-11

Node 24.21.0 (`nvm use 24` — shell default 22 lacks FTS5), master at
`2d5338f`, clean tree, `@rajahinta/core-domain` rebuilt first. Every
command exited 0; no suite skipped or weakened.

| Check | Command | Result |
|---|---|---|
| core-domain build | `pnpm --filter @rajahinta/core-domain build` | exit 0 |
| workspace typecheck (8 projects) | `pnpm typecheck` | exit 0 |
| lint | `pnpm lint` | exit 0 |
| content lint | `pnpm lint:content` | exit 0 |
| frontend unit | `pnpm --filter @rajahinta/frontend test` | 125 files, 1549 green |
| api-worker unit | `pnpm --filter @rajahinta/api-worker test` | 79 files, 1366 green |
| core-domain unit | `pnpm --filter @rajahinta/core-domain test` | 60 files, 1722 green |
| data-platform unit | `pnpm --filter @rajahinta/data-platform test` | 72 files, 933 green |
| data-acquisition unit | `pnpm --filter @rajahinta/data-acquisition test` | 46 files, 658 green |
| application-api unit | `pnpm --filter @rajahinta/application-api test` | 55 files, 745 green |
| email-worker unit | `pnpm --filter @rajahinta/email-worker test` | 6 files, 120 green |
| backend unit | `pnpm --filter @rajahinta/backend test` | 5 files, 19 green |
| D1-integration | `pnpm test:d1` | 19 files, 190 green |
| compliance (`COMPLIANCE_ENFORCED=true`) | `bash scripts/test-compliance.sh` | 23 files, 254 green |
| golden dataset | `pnpm test:golden` | 2 files, 51 green |

Unit total: 7,112 tests across the 8 packages.

### Compliance extension summary (task 3.2, as verified)

`trip-affiliate-neutrality` and `trip-fill-ferry-neutrality` now prove
byte-identity of all calculation/fill output across zero, one, and many
PUBLISHED `ferryPrices` rows (fresh compute per composition; cached HIT
serves pre-ingestion bytes with the same `X-Content-Hash` while the fresh
block reflects the new rows; a superseding revision collapses the block to
the latest revision only, fill bytes stable). Both green inside the
compliance run above; `COMPLIANCE_ENFORCED=true` so any violation would
have failed the run.

### Live re-check (production `api.rajahinta.fi`, this session)

`POST /api/v1/trip-feasibility` (car, 2 pax, beer+spirits, 2026-10-11):
HTTP 200; `ferryPrices` block present and additive in the top-level key set
(all pre-ferry fields untouched); 50 rows served (cap; 70 stored) —
tallink 22 + eckero 28, viking 0 by design; every row carries complete
provenance (`operator, route, label, priceCents > 0, observedAt 2026-10-11,
citation`), 0 rows missing fields. Confirms the 5.2 staging/production
verification above rather than duplicating it — the unchanged-skip
demonstration (second `__scheduled` fire per env, "dataset unchanged …
skipping the upsert") stands as recorded there. Re-checked
2026-10-11T08:25Z.

### Follow-ups

- Viking Line curated dataset pending operator input (0 rows by design;
  fail-closed PENDING governance holds until the transcription exists).
- Next dataset revision = bump `FERRY_OBSERVED_AT` + deploy per runbook
  §10.3; the 2026-11-01 tick unchanged-skips until then.
- Full-catalog transcription for tallink/eckero (beyond the current 70
  cited rows) as an ongoing owner operation.
