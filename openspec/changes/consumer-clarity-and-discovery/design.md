# Design: consumer-clarity-and-discovery

## Context

Five surfaces, one shared failure mode: the honest-data pipeline is
Finnish-first, but the last mile of presentation, vocabulary, and entry
points was never swept. Each fix below is scoped to the last mile — the
engines, the classification module's outputs, and every monetary figure stay
exactly as they are, pinned by the byte-identity compliance rails.

## Decisions

### D1 — Disclaimer language is an explicit input; `fi` is the default

`calculateWhatIfExcise` gains `disclaimerLanguage?: 'fi' | 'en'` on its input
and selects from the existing `WHATIF_DISCLAIMER_FI` / `WHATIF_DISCLAIMER_EN`
pair (`default: 'fi'`). The module stays pure — it selects a versioned
constant, it does not compose prose — and the structural-disclaimer rule is
strengthened, not relaxed: the disclaimer still rides every 200 response.

Why `fi` as the default: `event-calc` already pins `language: 'fi'`
(`event-calc.routes.ts:181`); the site is Finnish-first with an English
secondary; an absent language means "domestic user" more often than not.
`en` is an explicit request. The POST route validates the field into the
zod DTO; the frontend sends it from `[locale]`; the embed route derives it
from its own `[locale]` segment (already in its params, so the share token
stays inputs-only — no envelope format change).

### D2 — Suggestion vocabulary is a closed union; the contract is otherwise frozen

`suggestBrand` becomes `suggestQuery` in behavior (name kept for the port
contract, or renamed with the port — implementation detail) comparing against:

- distinct brand tokens (existing),
- distinct product-name tokens,
- curated `FINNISH_SYNONYM_GROUPS` members.

Everything else is frozen: bounded edit distance ≤ 2, folded comparison keys
only, `(distance, then alphabetical)` ordering, zero-result-only firing,
advisory-only rendering. The union is bounded (catalog-scale DISTINCT
queries on a path that runs only when the primary search found nothing), and
determinism is preserved by the unchanged total ordering. A hit like
`votka` → `vodka` now resolves because "vodka" exists in name tokens and
synonym members; clicking the chip runs it as a query, where the synonym
expansion does the rest.

Deliberately NOT done: fuzzy result matching (D5 of
finnish-first-client-experience stands — a misspelling never silently
rewrites itself), and no catalog enrichment (a `sahti` miss is a data gap).

### D3 — Evidence localization travels as codes, not localized strings

`EvidenceDetail` gains an additive, closed-set `code` (e.g.
`SELLER_CARRIAGE`, `BUYER_TRAVELLING`) alongside the existing English
`observation` prose. The classification rules emit the code where they
already emit the observation; the frontend maps
`code + structured values → Finnish/English sentence` in messages files.
Rationale: core-domain stays locale-free (its only locale-bearing constants
today are the versioned disclaimer pairs — a deliberate exception, not a
pattern to extend with evidence prose); the wire adds a field instead of
changing one, so `evidenceSummary` stays byte-identical for API consumers
and no compliance pin moves.

The classification label itself localizes via the existing
`ClassificationLabel` enum ('DistanceSelling' | 'DistanceBuying' |
'TravellerImport') mapped to messages — no API change.

### D4 — Traveller promotion is a display-layer move inside the existing contract

`travellerAlternative` already rides the delivery-mode POST response with
allowance framing and a pre-filled `/trip` link (pinned by the web-application
spec). This change re-renders it as a co-equal labeled block adjacent to the
hero total instead of a section far below, so the ferry user sees both
transaction-shaped numbers at the same rank. Amounts, statuses, payload
shape, and the callout's conditional presence (live POST only, never
persisted GET results) are untouched; the compliance suites that pin
monetary byte-identity must stay green unmodified — if one needs an update,
that is a bug in this change, not a pin to relitigate.

The LOW confidence badge stays on the delivery hero: with both numbers
side by side, LOW reads as the honest property of the *carrier* scenario
rather than a verdict on the user's options. Sanity notes and confidence
breakdown keep their positions.

### D5 — Citation provenance is preserved verbatim; only its presentation collapses

The allowance-explorer spec currently pins "each source citation rendered
verbatim as an evidence link" per category row. This change modifies that
requirement to decouple content from layout: the stored citation text must
still reach the page unmodified and evidence-linked, but inside a collapsed
evidence disclosure per dataset block instead of repeated inline on every
row; each row gains a Finnish summary line (category name + cap). The
server contract (`sourceCitation` verbatim passthrough) does not change —
`allowances.server.ts` keeps passing the stored string through.

Container-equivalent helper lines (e.g. "10 l ≈ 20 × 0,5 l") are static,
category-level, display-only conversions computed from the cap and fixed
container sizes. They state arithmetic, not advice — phrasing must pass the
content-vocabulary lint (no "best deal"/"good time to buy" family), which
the verification task checks.

### D6 — Group-order launches through the footer and the sitemap; robots narrows to tokens

- `SiteFooter` gains a group-order link (label keys in both locales) in the
  tools column next to trip/event/what-if.
- `sitemap.ts` adds `/group-order` to `STATIC_PATHS`.
- `robots.ts` replaces the blanket `/group-order` + `/en/group-order`
  disallow with `/group-order/*` + `/en/group-order/*` — token session
  pages stay non-indexable (share-token-scoped, per the original robots
  rationale), the create page becomes crawlable.
- The header nav stays closed on purpose: the desktop set is a curated
  nine, the mobile planning set a curated four; a coordination tool for
  shared baskets is a footer-class surface.
- The spec's `Feature gating` requirement (`enable_group_order_ledger`,
  default off) is REMOVED: the flag system left the repo on 2026-09-07
  (owner decision, guardrail "No feature flags"), the code registers the
  routes unconditionally, and the requirement documents a mechanism the
  repo can no longer express.

Age-gate interaction needs no change: the RootLayout gate wraps every page
including group-order, and the gated API endpoints keep their 403s.

### D7 — One change, five independent phases, one delta phase

The five fixes touch disjoint files except the shared messages files; the
task annotations serialize those via `touches`. Phase order is otherwise
free — each phase lands on its own green battery. Spec deltas are finalized
last, against implemented behavior.

## Risks

- **Suggestion quality regression (D2):** a wider vocabulary can suggest a
  product name where a brand was a better answer. Mitigation: the unchanged
  total ordering prefers distance first; the route-level test pins the
  `votka` case; determinism tests guard stability.
- **Evidence-code drift (D3):** codes must stay a closed set or the
  frontend mapping silently degrades. Mitigation: exhaustive switch in the
  frontend with a type-level exhaustiveness check against the union.
- **Citation collapse read as de-provenancing (D5):** the disclosure keeps
  the full verbatim text one click away and the dataset citation inline;
  the delta scenario pins "unmodified from the stored text".
