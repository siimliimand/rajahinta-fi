# Design: seo-aeo-agent-surfaces

## Context

Explore-mode findings this change builds on (2026-10-16):

- The product page (`/tuotteet/<id>` physical FI route + `[locale]` adapter, both
  delegating to the shared `product-page.tsx` module) renders zero structured
  data; schema.org exists only for the WebSite graph (`LocaleChrome`) and curated
  lists.
- `retail_offers` rows are collected observations ("Kerätyt hintahavainnot, eivät
  myyjien tarjouksia"), not offers — this is pinned copy and pinned semantics.
- Content policy (`apps/frontend/src/lib/content-policy.ts` + the backend lint)
  bans promotional and advice phrasing on all public surfaces.
- ISR contract: `revalidate = 300`, `dynamicParams = true`, load-bearing empty
  `generateStaticParams`; cache-header tests pin the emitted shape. The FI product
  tree owns its ISR key because the middleware matcher excludes
  `tuotteet/<segment>`; no shared `app/layout.tsx` may be introduced.
- Sitemap emits product URLs with hreflang pairs and `changeFrequency`/`priority`
  but no `lastmod`.
- WebMCP status (verified 2026-10-16): W3C proposal, `document.modelContext`
  registration surface; ChatGPT desktop's built-in browser calls page tools;
  Chrome/Edge origin trial extended to 2027-03-30. Cloudflare offers an edge
  toggle (HTMLRewriter-injected bridge) whose Site MCP Server pack forwards to a
  same-origin `/mcp` endpoint — the site already runs on OpenNext/Cloudflare
  Workers.

## Decisions

### D1. Product JSON-LD uses the safe no-Offer variant

`Offer` in schema.org asserts a merchant offer. Mapping collected observations
onto `Offer` would misrepresent the data to rich-result consumers and drift from
the pinned `dataNote` copy. The graph therefore carries identity and attributes
plus `dateModified`; no offer, rating, or review semantics. If offer-grade
structured data is ever wanted, it requires an owner decision about what an
"offer" is on this platform — out of scope here.

### D2. All product structured data lives in the shared module

The JSON-LD builders go into a new `lib/seo` server module and render from the
shared `product-page.tsx` body, so the physical FI route and the `[locale]`
adapter inherit everything without route-file duplication (the fi-path-isr
extraction precedent). The ISR segment config, cache windows, and route files
stay untouched; structured data rides the cached HTML shell.

### D3. Sitemap lastmod stays governed by sitemap-tree-coverage (amended 2026-10-16)

The propose-stage premise "no product lastmod" became stale during apply: the
`sitemap-tree-coverage` change shipped the sitemap index tree with the
enumeration endpoint's truthful lastmod (`MAX(updated_at, latest observed_at)`)
the same day. The originally proposed `updated_at`-only contract is dropped —
overriding a just-shipped owner-approved implementation would create a competing
spec. This change verifies composition only; task 1.3 is a no-code parity check.

### D4. Q&A is template-composed, never generated

The AEO answer block composes two or three factual answers from the payloads the
page already fetches (price context, master attributes). Deterministic templates
keep the content lint enforceable, keep every claim traceable to stored data, and
produce zero new failure modes. The FAQPage JSON-LD serializes exactly the
rendered pairs — schema never exceeds visible content.

### D5. `/mcp` is closed, read-only, and gate-honest

Tool set fixed at `search_products`, `get_product`, `calculate_landed_cost`
(implementation via the Cloudflare agents SDK on the api-worker). The age gate
stays enforced at the API boundary per the crawlable-soft-gate rule: confirmed
sessions ride through, unconfirmed callers get the contract gate error. The owner
decision recorded 2026-10-16: exposing the already-public catalog/calculation
data through tools is approved; write tools are not.

### D6. WebMCP exposure via the Cloudflare edge toggle

Enable Agent Readiness > WebMCP with the Site MCP Server pack pointing at `/mcp`:
zero origin code, spec evolution handled at the edge. The dashboard toggle is an
operator step documented in the runbook. If the toggle is unavailable on the
account plan, the fallback is a small client module registering the same tools
via `document.modelContext` — kept as documented fallback, not built upfront.

### D7. No feature flags

House rule: everything ships unconditionally; rollback is `wrangler rollback`.
No `FF_*` gating is introduced for any of these surfaces.

## Risks / Trade-offs

- `[Product]` rich results without `Offer` render fewer enhancements — accepted;
  the alternative misrepresents observations as offers.
- `lastmod` understates freshness for fast-moving prices — accepted; stable
  sitemap entries are worth more than aggressive recrawl hints.
- OG images are identity-only, so shared links lack price hooks — accepted;
  price-bearing images would be stale within minutes.
- WebMCP is still an origin-trial-stage standard; the surface degrades to
  nothing in unsupported browsers (bridge no-ops), so the risk is bounded.

## Migration Plan

Additive only: new lib module, new Q&A section, new api-worker module and
endpoint, sitemap field, message keys. No data migration, no backfill, no
breaking payload change (the listing `updated_at` addition is additive).

### D8. `product.updatedAt` is serialized at day precision (amended during apply)

The verification wave caught a real interaction: the additive `updatedAt` SEO
field on the shared product serializer (detail + listing + MCP `get_product`)
was emitted with millisecond precision, and the byte-identity compliance suites
(warnings / distance-selling badges / benchmarks additivity) reseed a fresh
composition per state — the differing insert timestamps broke byte-identity on
master-green suites. Fix: the field is the stored date at DAY precision
(`YYYY-MM-DD`), which is all the Product JSON-LD `dateModified` needs
(schema.org accepts a bare date), keeps the field truthful and explainable, and
restores cross-composition determinism. The savings-snapshot isolation
import-analysis allowlist gained `apps/api-worker/src/mcp/tools.ts` as a
display reader: its savings embeds are route-parity display blocks, its
calculator tool is the G3 route composition (parity-pinned), and the
input-producer scan set is unchanged.

## Open Questions

None — age-gate exposure and read-only scope were decided by the owner
(2026-10-16); the no-Offer variant was chosen by the owner.
