# Label-scan product lookup

## Why

Barcode scanning was explored first and measured a dead end: production `product_master` carries an EAN on only **25.5% of rows** (5,602 of 21,948; 5,383 scannable-and-visible). The gaps are structural, not fixable by ingestion work — Alko (10,536 solo rows, 48% of the catalog) publishes no EAN anywhere (search API and product pages verified live, zero `gtin`/`ean`/`barcode` occurrences in a 483 kB product page), Shopify stores ship empty `variants[].barcode` (0/500 sampled across bottleofitaly and kuhns), and Estonian WooCommerce shops use internal SKU schemes. Name-based label recognition has no such ceiling: the catalog name exists for 100% of rows.

A spike (2026-10-16) validated every component of the label-OCR route against the live catalog:

- **Extraction** — Cloudflare Workers AI `@cf/mistralai/mistral-small-3.1-24b-instruct` on real label photos (alks feed imagery): brand/product 3/3 including diacritics (`Żołądkowa`), ABV/volume extracted whenever printed on the visible label, honest nulls otherwise; latency 1.9–4.4 s. The "transcribe all visible text first, then emit JSON" prompt was decisive over direct extraction. `llama-3.2-11b-vision` answers 403 on this plan and `moondream3.1` returns empty results — mistral is the pinned pick.
- **Retrieval** — the existing `/api/v1/products` search is unusable as the OCR funnel: its FTS expression is phrase-adjacency (`"gran mirador brandy" *`), so mid-name numbers and suffixes break matches (measured ceiling 67% top-1 / 27% miss on simulated-perfect OCR). A token-AND FTS query plus the ingestion matcher's band discipline (ABV 0.5 pp buckets, 0.05 l volume bands — `FIND_CANDIDATES_SQL` pattern) landed **3/3 spike products in the top 2** end-to-end from real OCR output, including a variant tie (Yeni Raki 45% vs Yeni Seri 45%) that the top-3 confirm UI resolves by design.
- **Data-quality side effect** — OCR read `0.7 L` on the Żołądkowa label while the catalog row says `1 l`; the band score quantified the disagreement (0.6). The funnel surfaces such conflicts for free.
- **Privacy posture** (operator decision): frames are processed in-memory and never stored.

## What Changes

- **`POST /api/v1/products/scan-label`** (Hono, AgeGate + anonymous per-IP quota via RateLimiterDO): accepts one image (≤ 4 MB, JPEG/PNG/WebP), downscales are client-side; the Worker runs the pinned Workers AI vision model with the transcribe-first extraction prompt, tolerantly parses the JSON (fenced-output stripping, zod-validated), folds diacritics, runs the candidate funnel, and returns `{extracted, candidates[]}`. **The image is never persisted** — no R2, no KV, no logs, no DO storage; response bodies carry extracted fields only.
- **Workers AI binding** (`ai`) in `apps/api-worker/wrangler.jsonc` + `AppEnv` typing.
- **Label-candidates repository** (D1, data-platform): token-AND `MATCH` over `product_master_fts`, ABV/volume band scoring that widens structurally when the extraction is null (matcher discipline), `name_quality = 'ok'` + review-hold universe, and an explicit diacritic-fold step (unicode61 does not fold `ż`→`z` — spike finding).
- **`/scan` page** (mobile-first, locale-aware): capture guidance ("fill the frame"), client-side downscale (~1024 px, JPEG), extracted-fields summary, top-3 candidate cards (name, ABV, volume, lowest observed price) with tap-to-confirm navigation to `/products/[id]`; no-result state hands off to manual catalog search with the transcribed brand prefilled; camera-denied and unsupported states; a one-line privacy notice (fi/en: processed in memory, never stored).
- **Entry point**: a scan affordance in the products-page search area.
- **Docs**: footer privacy copy gains the in-memory sentence; ARCHITECTURE.md gains the module note.

## Non-goals

- Barcode scanning (operator decision: label-only; the barcode route stays unexplored territory).
- On-device WASM OCR (dropped in favor of Workers AI).
- Persisting photos or transcribed text — never, not even behind a flag.
- Scan-to-product binding submissions (the "scan missed → bind this code/product" flow that would grow Alko-row coverage) — a follow-up change; it needs a review-queue schema extension and governance review.
- Continuous live video scanning — single-shot capture only.

## Dependencies

Workers AI is enabled on the account (model listing and a mistral REST run succeeded with the deployment token, 2026-10-16). Model availability is entitlement-sensitive (`llama-3.2-11b-vision` 403s on this plan), so the model is pinned and the route degrades to a typed 502 envelope the UI renders as a retryable error. Anonymous scan quota must be conservative until neuron cost per scan is observed in staging.
