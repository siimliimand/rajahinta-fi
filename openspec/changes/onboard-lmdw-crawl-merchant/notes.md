# Onboard LMDW crawl merchant — Notes

> Operator/engineer log. The spike baseline below comes from the archived
> change `onboard-shopify-lmdw-merchants` (notes §1.3, verified
> 2026-10-08). Probe/sweep numbers are filled by whoever runs them — TBD
> placeholders are filled by the operator only, never pre-filled.

## Spike baseline (inherited, archived change notes §1.3)

- Full GraphQL walk: 6,814 distinct SKUs / 6,821 total_count (69 pages, 0
  failures); feed-side ABV (short_description) only 10.3 % → the NO-GO.
- Product pages `https://www.whisky.fr/<url_key>.html`: 10/10 HTTP 200 under
  the honest crawler UA; state JSON `"volume"` (litres) + `"strength"` (ABV)
  on 10/10 sampled pages — the full-coverage ABV/volume source.
- `m3_family` GraphQL census: 137 labels (reference evidence only — this
  change wires the page-side census, not the GraphQL one).
- EUR × 6,814, zero non-EUR; SKUs numeric; no weight field seen;
  `custom_attributesV2` internal-errors (rejected).
- GraphQL contract: `filter` OR `search` mandatory on `products`; pagination
  `pageSize`/`currentPage` to `total_count`.

## 1.1 Crawl probe results + URL-source decision

TBD (operator fills: sitemap availability + evidence, extraction coverage on
~300 pages, category-signal census, GTIN13 presence, EUR check, the
URL-source decision, go for 3.1)

## 2.1 Mapper re-probe drop rate

TBD (drop rate before/after the FR page-side vocabulary)

## 5.1 Local rollout evidence

TBD (registry/governance ids, watermark/cursor rows, chunking behavior,
ingested counts, idempotency second-run proof, correction rows)

## 6.1 PR + merge evidence

TBD (PR number, CI summary, merge SHA, staging deploy run id)

## 6.2 Staging rollout evidence

TBD (grant result, egress smoke, workflow instance + status, offer counts,
API/page checks)

## 7.1 Production deploy evidence

TBD (run id, health gate)

## 7.2 Production rollout evidence

TBD (registration audit entries, first crawl outcome — honest about
throttling if any, next-scheduled checklist)

## 8.1 Verification evidence

TBD (suite table, consolidated pointers, hold-rule note, correction-noise
observation)
