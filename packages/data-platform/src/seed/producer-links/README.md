# Producer-links curated seed import — JSON format v1

The import format for the curated sibling-product evidence store
(`producer_links`, task 6.1) loaded by
`scripts/import-producer-links.ts` (task 6.2, change
`product-roadmap-phases-1-4`; spec: `producer-matching`, design R9).

Rules that outrank anything below:

- **Never fabricate evidence.** A case is only authored for products you
  can actually verify (public catalog pages, producer sites). The import
  refuses unreachable source URLs (online mode) and skips cases whose
  product references do not resolve — it never invents references.
- **Rows land DRAFT.** The import is one of the two sanctioned write
  paths (spec "Curated governance"); the audited operator console is the
  other, and its publish action is the human gate. The importer cannot
  publish.

## File shape

```jsonc
{
  "formatVersion": 1,                          // literal — the only format this reads
  "bootstrap": true,                           // true for machine-assisted bootstrap loads (see below)
  "reviewer": "bootstrap-seed-import-v1",      // who reviewed these cases (max 128 chars)
  "reviewedAt": "2026-09-05T00:00:00.000Z",    // when (any ISO-8601; canonicalized at import)
  "cases": [ /* 1..500 case objects */ ]
}
```

## Case fields (ALL mandatory — schema-strict, unknown keys rejected)

| Field                | Type           | Role |
|----------------------|----------------|------|
| `alkoProductId`      | positive int   | **Identity.** Alko product number (leading zeros dropped — `006654` → `6654`). |
| `alkoProductName`    | text ≤256      | **Verification aid.** The product name you verified at alko.fi. Reported on import, not persisted. |
| `producerKey`        | text ≤256      | **Evidence.** The exact-match producer token. Stored normalized (`normalizeProducerKey`: trim → lowercase → collapse whitespace). Near-miss keys match nothing by design — keep the token identical across markets. |
| `manufacturer`       | text ≤256      | **Evidence.** The manufacturer behind the link, shown with every sibling (R9). |
| `siblingProductId`   | positive int   | **Identity.** The foreign sibling's catalog id in the merchant named by `siblingMerchant`. |
| `siblingMerchant`    | text ≤64       | **Verification aid.** Which foreign catalog `siblingProductId` belongs to (bootstrap: `systembolaget`). |
| `siblingProductName` | text ≤256      | **Verification aid.** The sibling name you verified at the source URL. Reported, not persisted. |
| `sourceUrl`          | http(s) ≤2048  | **Evidence.** Verifiable URL of the foreign sibling claim. Reachability-checked in online mode. |

Mandatory **evidence** fields per R9: `producerKey`, `manufacturer`,
`sourceUrl`, plus review metadata (`reviewer`, `reviewedAt` at file
level). The schema rejects empty-after-trim evidence, self-pairs
(`alkoProductId === siblingProductId`), non-integer ids, non-http(s)
URLs, wrong `formatVersion`, and any unknown key — an unevidenced or
sloppily-referenced row is unrepresentable.

## How a run behaves

```
tsx scripts/import-producer-links.ts <file.json> --db-file <sqlite-path> [--offline] [--dry-run] [--timeout-ms 10000]
```

1. **Parse + validate** — every field, schema-strict; all issues are
   reported in one pass (exit 1 on any).
2. **Reachability (online)** — every `sourceUrl` gets HEAD with a GET
   fallback (per-URL timeout, default 10 s); 2xx/3xx passes. Any failure
   fails the run (exit 1): evidence must be verifiable at import time.
   `--offline` skips this — documented for tests and CI, which run
   without network; run it when you change a sourceUrl.
3. **Resolution** — each product id is looked up against
   `product_master` (both references are FKs to it). A case whose
   products are not ingested under those ids is reported
   `skippedMissingProduct` — never written with invented references.
   The bootstrap file's ids are the merchants' own catalog ids (Alko
   product number, Systembolaget artikelnummer); until the platform's
   product rows carry them (ETL / merchant adapters), imports will
   mostly report skips. That is the intended pending state, not an
   error (exit 0).
4. **Write** — surviving cases go through
   `ProducerLinksRepository.create` → **DRAFT**, with `reviewer` and
   `reviewedAt` from the file.

### Re-run semantics (idempotency, 6.1 lifecycle)

Identity is the `(alkoProductId, siblingProductId)` pair.

- **Absent pair** → inserted (DRAFT).
- **Existing DRAFT** → `skippedExistingDraft`, never rewritten. After
  the initial load the console owns DRAFT rows; a re-run must not
  clobber operator edits. To refresh: delete + re-create via the
  console, or delete the row and re-run.
- **Existing PUBLISHED** → `skippedExistingPublished`, never rewritten.
  Published evidence is immutable (6.1); the import path has no update
  call at all, so it cannot violate that even in principle.

`--dry-run` reports exactly what a run would do (validation,
reachability, and — with `--db-file` — resolution + per-case outcomes)
without writing.

## The bootstrap load (`producer-links-bootstrap.json`)

`bootstrap: true` marks this file as a machine-assisted curation load:

- **Reviewer identity.** `reviewer: "bootstrap-seed-import-v1"` — a
  documented bootstrap identity. Every row is DRAFT and each one is
  re-reviewed by an operator at console publish; the reviewer field
  records where the row came from, not a human sign-off.
- **`reviewedAt`.** The date the verification pass actually ran
  (2026-09-05): each case's Alko-side identity (product number, name,
  manufacturer/brand) was verified against alko.fi's product pages
  (schema.org JSON-LD) and each `sourceUrl` was fetched and confirmed
  to resolve to the claimed producer's product (HTTP GET, producer
  token present).
- **Verification split (honest accounting).**
  - 45 cases loaded: evidence verified as above; sibling ids/URLs are
    real Systembolaget product pages (artikelnummer from the URL,
    page fetched 200 with the producer's product).
  - Pending curation (candidates, NOT loaded — no verified Systembolaget
    sibling was found for them): Concha y Toro, Jack Daniel's,
    Jacob's Creek, Yellow Tail. Anyone curating further should follow
    the same bar: verify the Alko side on alko.fi, the sibling side at
    a reachable foreign-shop URL, and only then add the case.
- **Id caveat.** The two product ids are the merchants' public catalog
  ids. Imports resolve them against `product_master` and skip cases
  that do not resolve — expected until products are ingested under
  those ids. The human publish gate is the final integrity check
  before any row becomes publicly visible.
