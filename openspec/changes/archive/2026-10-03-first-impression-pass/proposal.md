# Proposal: first-impression-pass

## Why

Six frictions, all verified in code and production on 2026-10-02, share one thesis: the first thirty seconds of the site should cost nothing and assume nothing. Today they cost a wrong tax estimate, a junk-looking catalog, a signup wall stricter than banks, a dead-end contact page, developer jargon on consumer pages, and a 406 KB uncached HTML payload (100 KB of which is a stranger's i18n keys — TTFB 2.1 s measured from Finland, 1.3 s from Cloudflare ORD).

The heaviest is not cosmetic: the category classifier places 26 spirit products (ABV 25–58 %: akvavit, sambuca, arrak, bitter) into `other_fermented`, and the excise engine keys duty rate by category — fermented beverages are taxed per litre of product on wine bands while spirits are taxed per litre of pure alcohol, so the landed-cost calculator materially understates duty (~3×) for those rows. The catalog's alphabetical default sort surfaces the family first ("1 Enkelt 1. Klasses Bitter…"), making a data defect the site's opening statement.

Separately, one `cookies()` read in the root layout (the age gate's initial state) forces every route into dynamic rendering — defeating the layout's own `revalidate = 60` — so every visit is a full SSR with `private, no-store` and the entire ~100 KB locale catalog inlined into the RSC payload. The data behind those pages is already behind a 900 s fetch cache and the ingest cron runs daily, so cacheable HTML costs zero data freshness.

The rest are trust frictions with deliberate-but-revisitable design histories: the 12-character password floor (cites NIST SP 800-63B, whose actual guidance is a floor of 8 plus compromised-password screening — 12-without-screening is stricter on length and weaker where it matters), a contact page that honestly refuses to invent an email address but offers no real channel (a merchant asking "add our store?" has none), developer jargon leaking into consumer pages (the ranking transparency section explains `NeutralSortInput` and type-level tests; an "(V2)" suffix in the event-calculator toggle; "€ kaava-yksikköä kohti" in the what-if), and the age gate passing any non-empty cookie — honest per docs, but weak against its stated 18+ intent.

## What Changes

1. **Classify (correctness).** Category classification gains an ABV guard: the `other_fermented` bucket requires ABV ≤ 22 % (the EU intermediate-products boundary — lawful re-assignment, not a guess); higher-ABV fermented-bucket rows re-derive to `spirits`. The ingestion mapper's bitter/snaps/akvavit keyword families are audited against the misclassified rows, and the tax engine's own raw-category fallthrough (`alcohol-excise.math.ts` `default → other_fermented`) gets the same guard. A one-time backfill script (mirroring `backfill-unit-volume.mts`: stats → sample → dry-run → SQL artifact → operator executes) corrects the stored rows. The catalog default sort becomes `LOWEST_PRICE` with price-less rows pinned last deterministically (SQLite NULLs sort first in ASC — the ordering must be explicit); alphabetical remains a selectable option.

2. **Slim (platform).** The age gate's initial state is established client-side by an inline pre-paint script reading the `age_confirmed` cookie (the cookie remains the single source of truth; the script is a reader, not a second store). The root layout stops reading `cookies()`, which makes the ISR intent (`revalidate = 60`) effective and HTML cacheable at the CDN. The i18n catalog is split at load time into per-route namespace subsets so the client provider ships only the strings each route's client components use (`fi.json`/`en.json` stay the source of truth); a payload-budget test pins the catalog page's HTML ceiling in both locales.

3. **Speak human (product).** The password floor drops to 8 characters plus a local common-password blocklist (no external breach-API dependency), applied at registration and reset; existing 12-char accounts are unaffected. `/contact` gains a real channel: a plain-HTML POST form (works without client-side JS) to a rate-limited `/api/v1/contact` endpoint storing into D1 `contact_messages`, with honeypot, size caps, and a hashed-IP abuse counter (90-day retention); the operator reads messages via documented wrangler SQL — no invented email address, no response-time promise, optional reply email. The ranking transparency section keeps its three-layer neutrality proof but renders it in consumer language (no type-system names, no build-time terminology); the event-calculator's foreign-compare toggle drops its "(V2)" suffix; the what-if rate input names its physical unit per rate family ("€ per litra puhdasta alkoholia" / "€ per litra juomaa") instead of "kaava-yksikkö".

## Capabilities

### New Capabilities
- `contact-intake`: operator-read message intake from the contact page — honest presentation, plain-HTML form POST, rate-limited worker endpoint, D1 persistence with minimal personal data, anti-abuse controls, and a documented operator read path.

### Modified Capabilities
- `product-normalization`: source-category normalization gains the fermented-bucket ABV ceiling and audited spirit-family keywords; the tax engine's raw-category fallback gets the same guard so unknown categories above the boundary cannot normalize to a fermented duty key.
- `product-search`: catalog sorting's default order changes from alphabetical to `LOWEST_PRICE`; the existing products-without-offers-last contract is pinned by tests against SQLite's NULLs-first ascending order.
- `product-catalog`: the catalog page defaults to price ordering and keeps sort in URL state as plain links.
- `session-authentication`: the password policy becomes a floor of 8 characters plus a local common-password blocklist at registration and reset (previously 12); storage, rate limiting, and reset semantics unchanged.
- `accounts-age-gate`: the gate presentation requirement changes from server-read initial state to client-side pre-paint state; the cookie stays the single confirmation state, the overlay UX / crawlability / decline recovery are unchanged, and routes become cacheable.
- `web-application`: new per-route message payload budget — client bundles carry only the namespaces each route uses, pinned by a test ceiling on server HTML size.
- `ranking-sorting`: documentable-logic gains a consumer-copy scenario — the transparency proof renders in plain language without implementation jargon.
- `event-calculator`: the V2 sourcing plan's consumer label carries no version suffix; the V2 identity remains internal.
- `excise-what-if-simulator`: scenario labeling names the physical unit of each rate family instead of the "kaava-yksikkö" formula unit.

## Impact

- **Code:** `packages/core-domain/src/normalization/source-category.mapper.ts`, `packages/core-domain/src/tax/services/alcohol-excise.math.ts`, `packages/data-platform/src/repositories/d1/product-search.repository.ts`, `apps/api-worker/src/routes/{search,accounts,contact}.routes.ts`, `apps/api-worker/src/auth/password.ts`, `apps/api-worker/migrations/**`, `apps/frontend/src/app/[locale]/{layout.tsx,products/**,register/**,account/reset/**,contact/**,ranking/**,what-if/**,calculator/**}`, `apps/frontend/src/messages/**`, `apps/frontend/src/lib/i18n/**`, `scripts/reclassify-category.mts` (new).
- **Production data:** one-time category backfill of the misclassified rows (26 expected above the 22 % guard; exact count fixed by task 1.1's audit). Category is not part of the Tier-2 identity compound key, so the backfill is deploy-order-safe; it still runs before the gated deploy so the corrected surfaces ship with corrected data.
- **Performance:** catalog page HTML expected to shrink from ~406 KB to well under half; ISR makes HTML CDN-cacheable with unchanged data freshness (900 s fetch cache, daily ingest cron).
- **No change:** unit-price metrics, offer embeds, price-alert or outcome flows, the API-side age gate (`403 AGE_GATE_REQUIRED` unchanged), auth storage and session semantics beyond the password policy, publish lifecycle.
