# Design

## Context

See proposal.md — Why. The spike (2026-10-16) measured every component against production: extraction quality on real label photos, the phrase-adjacency failure of the existing search endpoint (67% top-1 ceiling), the token-AND + band funnel landing 3/3 spike products in the top 2, and per-model Workers AI availability (`mistral-small-3.1-24b` runs; `llama-3.2-11b-vision` 403s; `moondream3.1` returns empty). Architectural constraints: Cloudflare Workers-only substrate (no GPU hosting), D1 as the only product store, the route-file composition discipline of `search.routes.ts` (funnel logic composes at the route; repositories stay free of surface concerns), and the platform's anonymous-session privacy posture.

## Goals / Non-Goals

**Goals:**
- Single-photo label recognition that reaches the right product row within a tap-confirmed top-3, independent of EAN coverage (which is 25.5% and structurally capped).
- Zero persistence of user imagery — a provable property (no storage-binding touch in the route's code path), not just policy text.
- Reuse the ingestion matcher's noisy-input discipline (band widening, catalog universe) rather than inventing a second matching vocabulary.

**Non-Goals:**
- Barcode capture, on-device OCR, live video scanning, photo/text persistence, scan-to-product binding submissions (proposal — Non-goals).

## Decisions

- **D1: all processing server-side via the AI binding** (client → `scan-label` route → Workers AI → funnel → candidates). Alternatives rejected: direct client→Workers AI REST (key exposure), on-device WASM OCR (weak on stylized/curved labels, +2–4 MB bundle), self-hosted vision models (breaks the Workers-only architecture). One round trip keeps rate limiting and the age gate ahead of model cost.
- **D2: pinned model constant + transcribe-first prompt.** `@cf/mistralai/mistral-small-3.1-24b-instruct` as a named constant; the prompt first transcribes all visible text, then emits one JSON object. The spike showed direct extraction misses small-print ABV where transcribe-then-extract reads it. Model output is parsed tolerantly (strip code fences, zod, null-on-absent) — never trusted structurally.
- **D3: funnel = token-AND FTS + band scoring in a new repository module.** The search endpoint's phrase-adjacency MATCH is wrong for OCR token soup (measured); `product_master_fts` supports AND terms directly. Band scoring copies `FIND_CANDIDATES_SQL` semantics: ABV in 0.5 pp buckets (weight ×10), volume in 0.05 l buckets (weight ×2), a null extraction drops its band term (widening is structural, in the SQL). Universe predicates mirror the listing universe (`name_quality='ok'`, no review hold). Diacritic folding is explicit — unicode61 does not fold `ż`→`z` (spike finding).
- **D4: top-3 confirm, never auto-redirect.** Fuzzy matches can be wrong; wrong price/tax display damages trust. Ties (identical ABV+volume siblings — Yeni Raki case) are surfaced, not resolved, by the UI.
- **D5: anonymous quota via RateLimiterDO, conservative default.** Every scan costs neurons; the quota (per-IP, hourly window, value in route constants) caps abuse before cost is observed in staging.
- **D6: client-side downscale before upload.** Longest edge ~1024 px JPEG (~150–300 kB) cuts Worker request size and model latency; capture guidance (fill-the-frame) is the cheap mitigation for the catalog-photo-vs-user-photo quality gap the spike acknowledged.
- **D7: privacy claim is enforced by construction.** The route's code path touches no storage binding; the unit suite asserts the route module imports no R2/KV/DO storage handles, making "processed in memory, never stored" a tested property, not a promise.

## Risks / Trade-offs

- **User photos are harder than catalog shots** (glare, angle, hands) — extraction quality will sit below the spike's 3/3. Mitigation: capture guidance, tolerant funnel (bands widen on nulls), no-result handoff to manual search keeps the flow useful at zero confidence.
- **Model entitlement drift** — per-model availability changed under us once already (llama-3.2-vision 403). The pinned constant localizes substitution; the typed 502 renders a retryable error instead of a broken flow.
- **Neuron cost per scan is unobserved** — staging smoke measures latency; quota constants may need tuning after the first week of real traffic.
- **Funnel recall ceiling** — token-AND requires the brand token to survive OCR at all; badly mangled text yields no candidates by design. The trade is deliberate: surfacing wrong products is worse than surfacing none (D4).
- **D1 FTS AND-query plan cost** — token-AND MATCH is index-served but unmeasured at production scale; the D1 suite runs EXPLAIN QUERY PLAN on the exact statement (house pattern from `findCandidatesSql`).
