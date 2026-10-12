# FI path ISR

## Why

The `product-page-cold-latency` change (merged 2026-10-12, PR #127) put `/products/[id]` on on-demand ISR, but staging verification proved a structural limitation: next-intl middleware rewrites (`localePrefix: 'as-needed'` maps `/tuotteet/[id]` to `/fi/products/[id]` internally) bypass the Next ISR cache. Every default-locale (FI) URL re-renders per request; only prefixed EN URLs cache. FI is the primary audience, so the headline win of the previous change does not reach it. The same bypass likely silences `/account`'s existing ISR for FI visitors (recorded as a candidate follow-up, out of scope here).

The fix is structural, not configurational: make `/tuotteet/[id]` a **real route** with its own ISR cache key and the locale pinned to `fi`, so no middleware rewrite stands between the visitor and the cache. URLs stay byte-identical: no redirects, no sitemap churn, no canonical changes.

The route cannot simply be added: today `app/[locale]/layout.tsx` is the html-owning root layout (the documented next-intl single-root pattern), and a page outside `[locale]` requires `app/layout.tsx` to exist. The change therefore includes a deliberate layout-tree refactor.

## What Changes

1. **Layout-tree refactor** — new `app/layout.tsx` owns `<html>`/`<body>`, the Inter font, and `globals.css`; `lang` resolves via next-intl `getLocale()` (the i18n request config already falls back to `fi` when `requestLocale` is undefined, which is exactly the middleware-bypassed case). `app/[locale]/layout.tsx` demotes to a nested chrome layout: NextIntlClientProvider, AgeGate with its pre-paint script, SiteHeader, SiteFooter, JSON-LD, `revalidate = 60`, `generateStaticParams`, and metadata all stay. Pages under `[locale]` must render identically after the move.
2. **Shared product-page module** — the product page body and `generateMetadata` extract into a locale-parameterized module; `[locale]/products/[id]/page.tsx` re-exports it with its params (EN behavior byte-identical). The module also carries the ISR exports (`revalidate = 300`, `dynamicParams = true`, empty `generateStaticParams`).
3. **Root FI route** — `app/tuotteet/[id]/` with a layout that renders the same shared chrome (extracted from the locale layout into a reusable component) with locale `fi`, and the re-exported shared page. The middleware matcher excludes exactly `/tuotteet/<segment>` — the `/tuotteet` listing stays middleware-managed (it is per-request by contract). Because no 60 s layout sits above the FI route, it emits the full `s-maxage=300, stale-while-revalidate=31535700` under `next start`, stricter than the EN tree.
4. **Test contract updates** — cache-headers pins gain the FI route (source-level ISR exports + reachable header shape + inventory mechanism per the current test design), the middleware matcher change gets coverage, and page/payload tests follow the extraction imports.

## Guardrail checks

- **Crawlable soft gate**: the shared chrome carries the gate overlay and the pre-paint script, so the FI route ships the same server HTML contract; shared cached HTML is safe by the established `/account` precedent (favorites/alerts are client components).
- **SEO**: URLs, canonicals, hreflang alternates, sitemap, robots unchanged. `html lang` correctness for both trees is pinned by test and covered by browser e2e.
- **Neutrality/display-only surfaces**: untouched; the page renders the same component tree.

## Non-goals

- `/account` (and account subtree) FI ISR — same bypass, lower value (post-login, no crawl surface); candidate follow-up.
- Other FI tool pages (`/laskuri` etc.) — per-request or client-fetch by design.
- Any URL, redirect, or i18n vocabulary change.

## Impact

- **Code**: new `app/layout.tsx`, new `app/tuotteet/[id]/{layout,page}.tsx`, demoted `[locale]/layout.tsx` (html/font/globals moved out, chrome extracted into a shared component), shared product-page module + re-exporting `[locale]` page, `middleware.ts` matcher.
- **Tests**: cache-headers, middleware, product page/payload suites.
- **Specs**: none — the cache and routing contracts live in the frontend test files, which this change updates deliberately (`skip_specs: true`). ARCHITECTURE.md and guardrails gain the layout-tree shape at archive time.
- **Expected outcome**: FI cold visits within a 300 s window become incremental-cache hits (EN staging evidence: HIT 0.75 s from a NA vantage; EU expected materially faster); FI first-of-window renders keep the batched/bound/streamed path from the previous change.
