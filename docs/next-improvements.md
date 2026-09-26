# Next improvements

Working list after `unit-integrity-and-result-trust` (merged 2026-09-26). Items come from implementation follow-ups, verification findings, and the deferred non-goals recorded in the archived change. Ordered by user impact; each item names the problem, the approach, and the rough scope. Nothing here is committed work until it goes through a plan.

## 1. Product data residue and parser hardening

The litres backfill left documented residue that the new invariant now flags. Production numbers from the 2026-09-26 backfill: 3,775 rows total, 19 legit litre values ≥ 5 (BIBs and cases), 20 local / 1+ production zero-volume rows, one ≥ 100 L row.

- **Row 952 "Pepsi Classic 240.33 l"**: a non-alcohol row whose feed name embeds a 240,330 ml pack figure. The port guard degrades it correctly today, but the row is a data error, not a calculator input. Decide whether non-alcohol rows belong in the catalog at all; if yes, teach the parser to skip volume capture for non-alcohol categories.
- **Two "0. 7 l" rows** parsed as 7.0 l: the volume regex misses the space inside the number. Tighten `VOLUME_PATTERN` in `alks.parser.ts` (and the longero mirror) to reject or normalize spaced decimals, then re-sweep affected feeds.
- **Zero-volume rows** (feed names without a parsable volume): they persist as ESTIMATED by design. Consider a review queue instead of permanent residue, or accept and document them as a permanent state.
- Scope: parser + a sweep script run. Small.

## 2. Catalog browse aggregates: latest-per-merchant parity

Task 3.1 fixed the ids and ranked-q search paths, but `listCatalogPage` (the blank-q browse path) still aggregates over ALL offer rows. When a merchant rescrapes at a higher price, the browse row can report a lower minimum than the detail endpoint shows for the same product. The spec (product-search, added 2026-09-26) requires row aggregates from the same offer set the detail endpoint serves.

- Approach: extend the repository's catalog aggregate SQL with the same `MAX(id) GROUP BY product_id, merchant` filter task 3.1 used in the route, or move the route helper into the repository and use it on all three paths.
- Scope: one repository method plus tests in `packages/data-platform`. Small, spec-backed.

## 3. Embed calculator: shared formatters

`apps/frontend/src/app/[locale]/embed/calculator/view.ts` still renders the raw ABV fraction through the `Common.abvValue` message (the `0.38% ABV` bug class). The main surfaces use `formatAbv`/`formatVolume` since 4.1.

- Approach: apply the formatters in the embed view; keep the `abvValue` messages only if another consumer remains, otherwise remove them from both catalogs (parity test follows).
- Scope: one file plus message cleanup. Trivial.

## 4. account-export e2e spec is stale

`account-export.spec.ts` expects the harness to render "Tilin tietojen lataaminen epäonnistui." when `/api/v1/account/me` is unavailable, but the API worker serves the endpoint and returns 401, which redirects to `/login` (pre-existing on master; blocks the browser e2e suite from going green).

- Approach: rewrite the spec's assumptions for the credentials-auth world (assert the redirect and the absent session cookie; drop the failure-text expectation), or repoint it at a route that still fails closed.
- Scope: one spec file. Small. Do this before the next change that wants a green browser suite.

## 5. Seller-country signal for kippis offers

Deferred non-goal from the archived change: kippis (alks) offers are stamped `country: FI` while the operator sells from abroad. The seller-country signal drives import VAT, so FI-stamped offers suppress the VAT line that should apply.

- Approach: registry-level market correction (registry row carries the true seller country; mapping stamps offers from it), plus a backfill for stored rows. Coordinate with the operator on the correct country value first.
- Scope: registry + mapping + backfill + calculator VAT regression tests. Medium; needs an operator decision.

## 6. Governance-gated ingestion backlog

Merchants ingested while their governance record is PENDING were a deferred non-goal. The fail-closed machinery works; the backlog is operational: decide per merchant whether PENDING ingestion history is kept, purged, or re-scored after a grant.

- Approach: operator runbook step plus, if purge is chosen, a one-time cleanup script with audit entries.
- Scope: operational with a small script. Needs an owner decision.

## 7. Product dedupe across feeds

Duplicate Corona/Saku entries appear once per feed because `upsertByEan()` keys on EAN and feeds without EAN fall back to SKU-prefix or name matching. Duplicates split offer counts and price context.

- Approach: extend `ProductMatcherService` scoring into an ingestion-time merge decision (EAN match is authoritative; name+volume+brand above a score threshold proposes a merge into a review queue, never auto-merges). The manual-review machinery already exists.
- Scope: medium. Needs a spec delta for the data model.

## 8. Real transport dataset

€0.00 UNAVAILABLE transport remains the known gap (also suppresses import VAT confidence in live results). The Fransberg curated dataset covers parcels; the gap is a maintained carrier source with fresh rates rather than new code.

- Approach: operator decision on a data source (carrier API vs manual curation cadence), then rows in the existing carrier-rate machinery. No engine work expected.
- Scope: operational, small code.

## 9. Per-unit price display for multi-pack entries

Deferred non-goal: "24 × 0.33 l" cases show the box price and box volume; no per-unit or per-litre figure renders next to them. The ethanol-gram metric already normalizes per litre, so the data work is presentation only.

- Approach: parse pack counts from names (the parser already extracts volume; extend to the `N × volume` pattern), render a per-litre or per-unit price where the row already shows a price.
- Scope: small-medium frontend plus parser extension.

## 10. Operational debt (no user impact, cheap)

- Wire the D1 port's implausible-volume counter to the Analytics Engine `METRICS` binding: today it is a module counter plus `console.warn` (the port cannot reach `env`); emit from `calculator.routes.ts` where the binding is available.
- Local seed fixture naming: notes reference both fixture id 2 ("Koskenkorva Salmiakki") and swept row 10439 (the €98.70 box shape); pin one canonical regression product name in the seed fixtures to stop the confusion recurring in plans.
- Kill the stale local `workerd` process on :8787 before the next local stack run.
