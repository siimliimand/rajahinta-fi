# Design — price intelligence roadmap

## Context

The frontend is Next.js App Router with next-intl, deployed through OpenNext on Cloudflare Workers. `RootLayout` wraps `{children}` in `AgeGate`, a client component. During SSR the cookie has not been read, `verified === null`, and the component renders an inert placeholder — so no page content reaches the server HTML, including fully server-rendered pages (blog, products, guides, lists). The API independently enforces the gate: gated endpoints return 403 `AGE_GATE_REQUIRED` without the `age_confirmed` cookie or `x-age-confirmed` header, and server-side data fetches already send `SERVER_AGE_CONFIRMATION_TOKEN`.

## Decisions

### D1: Soft gate — content in HTML, overlay for humans

`RootLayout` reads `age_confirmed` via `cookies()` from `next/headers` and passes the boolean to `AgeGate` as `initialVerified`. `AgeGate` renders `{children}` unconditionally. When unconfirmed, it additionally renders the modal as a fixed overlay on top; the placeholder branch is removed.

- Rationale: crawlability without cloaking; the Alko/Systembolaget pattern; Finland imposes no statutory hard block. The one decision this depends on was confirmed by the owner.
- The API boundary remains the enforcement point. Rendering HTML that a human is asked to confirm before use does not weaken data protection: gated data endpoints keep their 403s.
- Hydration: the server passes the decision; the client's first render matches it. The `useEffect` cookie re-read stays as a fallback (cookie may expire between HTML and hydration; the `age-gate:required` recovery event still opens the overlay).
- The declined path (`/age-gate/declined`) keeps its exclusion — it must not re-ask.
- Accessibility: the overlay traps focus while open, labels its controls, and returns focus to the triggering flow on confirm.

### D2: Server shell + client view conversion

Each tool page (`calculator`, `compare`, `basket`, `trip`, `event`, `what-if`, `ranking`) becomes: `page.tsx` as a server component owning `generateMetadata`, the intro copy, and a "How this calculation works" section; the existing client body moves to `<name>-view.tsx` unchanged in behavior. This is the pattern `group-order`, `ops`, `value`, and `lists` already use. The calculator is converted first as the reference; the rest replicate it.

Metadata titles follow the reviewed per-page scheme (e.g. calculator: cross-border cost calculator framing; products already has its own). All new copy lands in `messages/en.json` and `messages/fi.json` with Finnish written to the repo's Finnish copy conventions.

### D3: "Scenario calculator" is a label change only

The route stays `/what-if`. Only nav, footer, and page labels change. No redirect, no link churn, no sitemap delta.

### D4: FAQ lives in the guides platform

Guide entries (8–10, both locales) published through the existing ops guides console, PUBLISHED status. The homepage FAQ section links them. No new route, no new surface to maintain.

### D5: Break-even is a displayed derivation

`break-even baskets = (transport + other trip costs) / per-basket saving`, computed from figures the trip and basket views already have. The card shows the formula with its inputs so every number stays explainable. It is not a new engine output and does not enter the result object contract.

### D6: Market overview is deterministic

Aggregates only: average observed price per category, largest observed cross-border difference (objective delta, fixed sort, ties broken deterministically), count of observed products. No editorial picks, no "trending" ranking, satisfying the neutrality-in-code rule. If the existing reports/aggregation endpoints cannot serve this, one read-only aggregate endpoint is added to `apps/api-worker`; otherwise presentation-only.

### D7: Homepage worked example is static

The example section ships fixed illustrative figures labeled as an example ("Example calculation", not live data). No API call, fully crawlable, and it cannot drift with data. Live sophistication is delegated to the existing AccuracyStat island and trust row.

### D8: No flags, direct ship

Everything ships unconditionally per the standing no-feature-flags rule. Rollback is `wrangler rollback`.

## Presentation invariants (Phase 3)

- The result card consumes the structural disclaimer from the result object; it never restates disclaimer copy as a UI string.
- Reliability display uses `RELIABILITY_STATUS_META` statuses and timestamps; no invented confidence score.
- Savings are never color-alone: figure plus explicit "cheaper/dearer" text, per the existing accessibility convention.
- Charts ship with data-table alternatives; headings stay semantic; touch targets and focus states follow the existing Tailwind conventions.

## Testing strategy

- `layout.ssr.test.tsx` and the AgeGate tests assert: content present in HTML with and without the cookie; overlay (not replacement) when unconfirmed; declined path un-gated; recovery event re-opens the overlay.
- A cookie-less server-fetch test asserts content markers on `/`, `/en/blog`, `/en/products` (the crawlability regression guard).
- Each conversion keeps its page's existing tests green; new metadata tests assert unique title/description per route.
- Break-even, presets, and templates get unit tests at the view level.
- Final gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e-browser`, plus an SEO smoke (unique metadata, sitemap covers new routes, JSON-LD intact).
