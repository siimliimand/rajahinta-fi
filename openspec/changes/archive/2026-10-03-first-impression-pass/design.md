# Design: first-impression-pass

## Context

Six verified frictions span three layers. Correctness: the excise engine keys duty by canonical category, and 26 products above the EU intermediate-products boundary sit in `other_fermented` (a source-category keyword outcome, not a mapper bug — the ingestion mapper already nulls unmapped strings to the correction queue; the tax engine's own raw-category normalizer still has a `default → other_fermented` fallthrough at `alcohol-excise.math.ts`). Platform: the root layout reads `cookies()` for the age gate's initial state (`layout.tsx:112`, consumed at `:132` as `(ageConfirmed?.length ?? 0) > 0`), which forces every route dynamic — silently defeating the layout's own `export const revalidate = 60` — so Next emits `private, no-store` on every response and `getMessages()` inlines the full ~100 KB locale catalog into every page's RSC payload (measured: `/fi/products` = 406 KB raw HTML, 64 flight chunks; data behind a 900 s fetch cache; ingest cron daily at 00:00 UTC). Product: the password floor (12, NIST-cited), the contact page (deliberately channel-free), and three jargon leaks are deliberate past decisions whose premises this change revisits.

House constraints that shape everything: D1 gates reject to absence (never fabricate), honest refusals over plausible guesses, no feature flags for gating, EUR-only, Finnish-first copy, and the publish lifecycle is repository/operator-only.

## Goals / Non-Goals

**Goals:**
- Calculator duty is correct for every classification the site shows (fermented bucket bounded by taxonomy law).
- The catalog's first screen leads with the site's thesis (lowest price), not lexicographic artifacts.
- HTML is CDN-cacheable with zero data-freshness regression; the catalog page stops shipping strangers' translation keys.
- Signup, contact, and copy assume a consumer, not a TypeScript compiler.

**Non-Goals:**
- No re-classification of sub-boundary oddities (0 % ABV rows, mixed fermentates) beyond the 22 % guard — no guessing where taxonomy is ambiguous.
- No HIBP/external breach-API dependency; no forced migration of existing 12-char accounts.
- No admin UI for contact messages; no reply workflow.
- No PPR/dynamicIO/experimental rendering; ISR via existing App Router mechanics only.
- No age-gate strengthening beyond the honest click-through (verification-grade age checks stay out of scope — the gate remains documented self-attestation).

## Decisions

**D1 — ABV guard at 22 %, enforced in both normalizers.** The EU intermediate-products boundary is the guard threshold: above it, "fermented beverage" is not a lawful retail category, so re-assigning to `spirits` is taxonomy law, not a guess — consistent with the house rule that refusals beat guesses, because this is not a guess. Applied in the ingestion mapper (keyword outcome + boundary) and in the tax engine's raw-category fallback (`default` may only yield `other_fermented` when the product is ≤ 22 %). Spirit-family keywords (bitter, snaps, akvavit/aquavit, sambuca, arrak and market spellings) get explicit mappings so the audit trail is attributional. Alternative considered: per-product override table — rejected as unbounded maintenance; the guard generalizes.

**D2 — Default sort `LOWEST_PRICE`, offer-less rows explicitly last.** The API contract already promised offer-less-last; the default flip must pin it against SQLite's NULLs-first ascending order with an explicit `(expr IS NULL), expr` ordering and a deterministic tiebreak. Alphabetical stays a selectable option and remains the fallback for unknown sort values rendered forgivingly by the page. Alternative considered: popularity/relevance default — rejected: no honest popularity signal exists yet.

**D3 — Backfill before deploy, but deploy-order-safe.** Category is not part of the Tier-2 identity compound key, so unlike the unit-volume backfill there is no re-keying hazard; running the backfill before the gated deploy is for immediate consumer correctness, not ingest safety. `scripts/reclassify-category.mts` mirrors `backfill-unit-volume.mts` (stats → sample → dry-run → SQL artifact → operator executes via wrangler; the script never touches production itself). The same script output counts the correction-queue volume the guard will produce going forward, so task 1.1's audit fixes the final number.

**D4 — Age-gate initial state moves client-side; cookie stays the single source of truth.** An inline pre-paint script reads `age_confirmed` and sets a flag/class the gate component consumes as initial state; the root layout stops calling `cookies()`. This is a reader, not a second store — "Single client confirmation state" is untouched. All presentation invariants survive: overlay, focus, blocked interaction, 90-day TTL, decline path, 403-recovery re-open, crawlable content-in-HTML. Trade-off accepted: a no-JS browser with a confirmed cookie sees the overlay again on navigation (content is visible in HTML; the gate still blocks interaction; no-JS confirmed-state persistence is not worth a cookie-dependent render path). Alternative considered: `Vary: Cookie` two-variant caching — rejected: poisons CDN hit rate for a binary condition an inline script solves for free.

**D5 — ISR on existing mechanics.** With `cookies()` gone from the layout, `export const revalidate = 60` becomes effective; the 900 s fetch cache is unchanged, so a regenerated page serves the same data the dynamic page would have — freshness is unchanged by construction (daily cron). Routes that genuinely need request state (account pages reading session cookies) remain dynamic automatically via their own cookie reads; no explicit opt-outs anticipated. Cache-header verification is a task, not an assumption: ISR responses must carry the shared `s-maxage`/stale-while-revalidate shape before deploy.

**D6 — i18n split at load time; budget test as the regression gate.** `fi.json`/`en.json` stay the source of truth; an explicit per-route namespace map feeds `NextIntlClientProvider` subsets (server components keep the full catalog server-side, so server copy is unaffected). The map is hand-maintained and a payload-budget test fails loudly when the catalog page's uncompressed HTML in either locale exceeds a pinned ceiling (target: well under half of the measured 406 KB; exact ceiling set by task 2.3 from the achieved baseline, never tuned to pass). Trade-off accepted: a missing namespace shows a raw key in dev and an empty string in prod — the budget test plus per-suite rendering of every route in the golden set catches omissions before they ship.

**D7 — Password: floor 8 plus a local common-password blocklist.** This is the NIST 800-63B shape: a modest length floor combined with compromised-password screening, no external dependency (HIBP adds an availability + privacy surface a price-alert account does not justify). The blocklist is a maintained, pinned local list (top common passwords, versioned in-repo); rejection messages never disclose list contents. Existing 12-char accounts are untouched — policy applies at set/reset time only. The code comment citing 800-63B is corrected to cite what it actually says.

**D8 — Contact channel: form intake, operator-read, honesty preserved.** Plain-HTML POST (no-JS is a house pattern for consumer forms) to a rate-limited worker endpoint → D1 `contact_messages` (message, topic enum, optional reply email, locale, timestamp, hashed IP; 90-day retention). The existing page's honesty decisions are preserved verbatim in spirit: no invented email, no response promise — the form adds a real channel instead of a fabricated one. No admin UI this change; the runbook documents the wrangler SQL read path. Alternatives considered: mailto-only (no channel exists to cite; inventing one is forbidden by the page's own contract) and a full admin surface (out of scope).

**D9 — Copy: translate the proof, never delete it.** The ranking transparency section keeps all three enforcement facts but states them as facts about the system, not about its types ("the sort input has no field for paid placement; tests pin that shape; unexpected fields are rejected at runtime"). The "(V2)" suffix is internal identity, not consumer information. "Kaava-yksikkö" exists because the Finnish schedule genuinely has two formula units — the fix is to name the physical unit per rate family, which is more precise, not less. The Finnish-first rule applies: both locales change together.

## Risks / Trade-offs

- **Golden/snapshot churn dominates the diff.** The i18n split and copy rewrites touch every rendered route's fixtures; the verification matrix (4.1) reviews churn explicitly rather than rubber-stamping regenerated snapshots.
- **Pre-paint script edge cases.** The gate flash must be verified on cold cache and warm cache, with and without JS; the crawlability test suite is the guard for the bot path. A regression here is visible immediately post-deploy (runbook check).
- **Correction-queue volume after the guard.** Unknown source categories above the boundary now normalize to `spirits` (lawful), but genuinely unmapped ≤22 % strings still queue; 1.1's audit measures the volume before the number is treated as stable.
- **Namespace-map omissions.** A route whose client components gain a new `t()` call without a map entry renders empty strings in prod; mitigated by the budget test's sibling assertion (no raw keys in rendered HTML across the golden route set) and by keeping the map adjacent to the provider wiring.
- **NULLS-last regression risk in search paths.** The explicit ordering must hold across keyword search, category views, and empty-query paths — the route tests pin all three, not just the default view.
