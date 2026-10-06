/**
 * Per-route client message namespaces (first-impression-pass task 2.3,
 * design D6).
 *
 * `fi.json`/`en.json` remain the single source of truth — nothing here
 * duplicates or relocates strings. This module is the explicit, hand
 * maintained split table: which translation namespaces each part of the
 * app feeds its `NextIntlClientProvider` at load time, so a page's RSC
 * payload carries only the messages its client components can actually
 * resolve instead of the whole ~86 KB-per-locale catalog.
 *
 * Wiring (replace semantics, verified against next-intl 4.14: a nested
 * provider's `messages` replace the parent's for its subtree — they do
 * not merge):
 *
 *   - The `[locale]` root layout provides `SHARED_CHROME_NAMESPACES`.
 *     It wraps only the chrome that renders on every route (header,
 *     footer newsletter island, age gate) plus the pieces that render
 *     outside any route segment (the 404 boundary, the home island).
 *   - Routes whose client tree needs more than chrome get a small
 *     segment `layout.tsx` that renders `RouteMessages` (a nested
 *     provider) with the route's entry from `ROUTE_CLIENT_NAMESPACES`.
 *     The page subtree then resolves against exactly that subset.
 *   - Server components are unaffected: they read through
 *     `next-intl/server` (`getTranslations`/`getMessages`), which keeps
 *     full-catalog access via `src/i18n/request.ts`.
 *
 * Maintenance rules:
 *
 *   - Route keys use site paths with `:param` spellings for dynamic
 *     segments (`/products/:id`), matching the route a page renders.
 *   - Adding a `useTranslations` call to a client component requires
 *     its route's entry here (or a new entry + segment layout) — a miss
 *     renders an empty string in production. `payload-budget.test.ts`
 *     re-enumerates the client trees from source and fails on any
 *     drift in either direction (missing namespace, stale entry).
 *
 * Known, documented deviation from strict per-route minimality: the
 * home route (`/`) has no dedicated segment to host a route provider
 * (moving `page.tsx` into a route group is out of scope), so its island
 * namespaces (`AccuracyStat`, `Common`) ride in the chrome subset.
 */

type FiCatalog = typeof import('@/messages/fi.json');

/** Top-level namespace of the message catalogs (fi/en ship the same set). */
export type MessageNamespace = keyof FiCatalog;

/** Catalog subset shape handed to a NextIntlClientProvider. */
export type ClientMessages = Partial<FiCatalog>;

/**
 * Namespaces provided by the root `[locale]` layout to every route.
 *
 * - `SiteHeader`/`AuthNav` — the header renders above every segment and
 *   outside any route provider.
 * - `AgeGate` — the gate wraps every page as chrome.
 * - `Newsletter` — the footer's subscribe island (chrome, like above).
 * - `NotFound` — the `[locale]/not-found.tsx` boundary renders under the
 *   root layout, outside every route provider.
 * - `AccuracyStat` + `Common` — home-route island namespaces; the home
 *   route has no segment layout of its own (see the deviation note).
 */
export const SHARED_CHROME_NAMESPACES = [
  'SiteHeader',
  'AuthNav',
  'AgeGate',
  'Newsletter',
  'NotFound',
  'AccuracyStat',
  'Common',
] as const satisfies readonly MessageNamespace[];

/**
 * Per-route namespaces for routes whose client tree uses more than the
 * chrome subset. A route listed here MUST render `RouteMessages` from a
 * segment layout (key = the route the page renders); routes whose needs
 * are covered by `SHARED_CHROME_NAMESPACES` intentionally have no entry.
 *
 * Derived by enumerating every `use client` component in each route's
 * import tree and its `useTranslations('<namespace>')` calls — root
 * namespace calls (`useTranslations()` with no argument) resolve the
 * dotted keys from `@/lib/design/status`, i.e. `Common` — and pinned by
 * the enumeration tripwire in `payload-budget.test.ts`.
 */
export const ROUTE_CLIENT_NAMESPACES = {
  '/account': [
    'Account',
    'Common',
    'OutcomeReport',
    'ReportExport',
    'SavedScenarios',
  ],
  '/account/alerts': ['Common', 'PriceAlerts', 'ProductSearch', 'ProductSelector'],
  '/account/forgot': ['Auth', 'ForgotPassword'],
  '/account/reset': ['Auth', 'ResetPassword'],
  '/account/saved-baskets': ['Common', 'SavedBaskets'],
  '/account/verify': ['VerifyEmail'],
  '/age-gate': ['AgeGate', 'AgeGatePage'],
  '/basket': [
    'BasketCommon',
    'BasketPacking',
    'BasketPage',
    'BasketResults',
    'Calculator',
    'Common',
    'ConfidenceMeter',
    'DisclaimerBanner',
    'ProductSearch',
    'ProductSelector',
    'QuantitySelector',
  ],
  '/calculator': [
    'AgeGate',
    'Calculator',
    'CalculatorResult',
    'Common',
    'DisclaimerBanner',
    'HistoryChart',
    'MerchantWarning',
    'ProductHistoryPanel',
    'ProductPage',
    'ProductSearch',
    'ProductSelector',
    'QuantitySelector',
    'ScenarioControls',
    'ShareResult',
  ],
  '/calculator/result/:recordId': [
    'CalculatorResult',
    'Common',
    'ConfidenceMeter',
    'CorrectionFlag',
    'DeclarationGuidance',
    'DisclaimerBanner',
    'HistoryChart',
    'Nav',
    'ProductHistoryPanel',
    'ReportExport',
    'ResultPage',
    'ShareResult',
  ],
  '/compare': [
    'BasketCommon',
    'BasketComparison',
    'BasketPage',
    'BasketResults',
    'Calculator',
    'CalculatorResult',
    'Common',
    'Compare',
    'DisclaimerBanner',
    'HistoryChart',
    'MerchantFreshness',
    'MerchantWarning',
    'ProductHistoryPanel',
    'ProductSearch',
    'ProductSelector',
    'QuantitySelector',
    'SortOrders',
    'SortSelector',
  ],
  '/event': ['Common', 'ConfidenceMeter', 'DisclaimerBanner', 'EventPage'],
  '/group-order': ['GroupOrder'],
  '/group-order/:token': ['GroupOrder', 'ProductSearch', 'ProductSelector'],
  '/login': ['Auth', 'Login'],
  '/newsletter/confirm': ['NewsletterConfirm'],
  '/newsletter/unsubscribe': ['NewsletterUnsubscribe'],
  '/ops': ['OperatorConsole'],
  '/products': ['Common', 'PriceAlerts'],
  '/products/:id': ['Common', 'MerchantWarning', 'PriceAlerts', 'PriceHistoryChart'],
  '/ranking': ['AccuracyStat', 'Common', 'Nav', 'Ranking', 'SortOrders'],
  '/register': ['Auth', 'Register'],
  '/savings': ['Common', 'SavingsPage'],
  '/share/:publicId': ['DisclaimerBanner'],
  '/trip': [
    'Common',
    'ConfidenceMeter',
    'DisclaimerBanner',
    'ProductSearch',
    'ProductSelector',
    'TripPage',
  ],
  '/value': ['Common', 'ValuePage'],
  '/what-if': ['Common', 'DisclaimerBanner', 'WhatIfPage'],
} as const satisfies Record<string, readonly MessageNamespace[]>;

/** Keys a segment layout may pass to `RouteMessages`. */
export type RouteNamespaceKey = keyof typeof ROUTE_CLIENT_NAMESPACES;
