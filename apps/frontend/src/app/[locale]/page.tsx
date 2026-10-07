// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BASE_URL, SERVER_AGE_CONFIRMATION_TOKEN, SAVINGS_TOP_PATH } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import type { ReliabilityStatus } from '@/lib/types';
import { getServerGuidesIndex } from './guides/guides.server';
import AccuracyStat from './components/AccuracyStat';
import HomeGapHero, {
  type HomeGapHeroState,
  type SavingsTopResponse,
} from './components/HomeGapHero';

/**
 * Canonical status order for the trust-row legend: the same hue ladder the
 * result views use (green → blue → amber → gray, D1/D2).
 */
const TRUST_ROW_STATUSES = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
] as const satisfies readonly ReliabilityStatus[];

/**
 * The homepage's three task cards, mirroring the header's three task
 * groups in the same display order (three-task-navigation 3.2):
 * shopping — whose lead is the savings listing — trip, and event. The
 * titles speak the groups' task language (the header triggers' wording);
 * the bodies keep the tool descriptions. The shopping card is the only
 * gated one (`gated: true`, carrying over data-quality-and-publication-
 * trust 3.2): it links into /savings only while the overview confirms
 * listing content — zero references or an unreadable overview render its
 * pending/unavailable non-link variant instead (see the section below).
 * Icons are decorative (aria-hidden); each linked card is ONE link, so
 * the touch target is the full card (≥44 px, asserted by the mobile e2e
 * journeys). Links only — the hero search stays the homepage's single
 * input (funnel D4).
 */
const TASK_CARDS = [
  {
    href: '/savings',
    gated: true,
    titleKey: 'taskCardsShoppingTitle',
    bodyKey: 'taskCardsShoppingBody',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
  {
    href: '/trip',
    gated: false,
    titleKey: 'taskCardsTripTitle',
    bodyKey: 'taskCardsTripBody',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    href: '/event',
    gated: false,
    titleKey: 'taskCardsEventTitle',
    bodyKey: 'taskCardsEventBody',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
] as const;

// ---------------------------------------------------------------------------
// Savings-listing overview — server read (data-quality-and-publication-
// trust 3.2). The card linking into /savings may only promise listing
// content the overview confirms.
// ---------------------------------------------------------------------------

/** One category's aggregates as GET /api/v1/savings/overview serves them. */
interface SavingsOverviewCategory {
  readonly category: string;
  readonly productCount: number;
}

interface SavingsOverviewResponse {
  readonly asOf: string | null;
  readonly categories: readonly SavingsOverviewCategory[];
}

/**
 * Server-side overview read — the savings page's own getSavingsOverview
 * fetch verbatim (age-gated endpoint, so the server presents the fixed
 * first-party prerender token; 900 s revalidation). Any failure or
 * unexpected shape degrades to null and the homepage card renders its
 * honest non-link state — never an error, never a guessed figure.
 */
async function getSavingsOverview(): Promise<SavingsOverviewResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/savings/overview`, {
      headers: {
        accept: 'application/json',
        'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
      },
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SavingsOverviewResponse | null;
    if (body === null || typeof body !== 'object' || !Array.isArray(body.categories)) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live gap hero — server read (homepage-live-gap-hero task 2.2). The
// cross-category top-N import-favourable listing, fetched exactly like
// the overview above: the fixed first-party prerender token (age-gated
// endpoint), 900 s revalidation, and degrade-to-null on any failure or
// unexpected shape.
// ---------------------------------------------------------------------------

/**
 * Design D4 freshness cutoff: a snapshot day older than this renders the
 * unavailable state instead of figures — a stalled cron must not headline
 * old numbers as current. Coarse at the 15-minute ISR grain, acceptable
 * for a daily-grain dataset.
 */
const FRESHNESS_CUTOFF_DAYS = 3;
const FRESHNESS_CUTOFF_MS = FRESHNESS_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

/**
 * Server-side top-N read of GET /api/v1/savings/top (no query params —
 * the API's default limit is the hero's five rows). Any failure or
 * unexpected shape degrades to null and the section renders its honest
 * unavailable state — never an error, never a guessed figure.
 */
async function getSavingsTop(): Promise<SavingsTopResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}${SAVINGS_TOP_PATH}`, {
      headers: {
        accept: 'application/json',
        'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
      },
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SavingsTopResponse | null;
    if (
      body === null ||
      typeof body !== 'object' ||
      !Array.isArray(body.rows) ||
      (body.asOf !== null && typeof body.asOf !== 'string')
    ) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * Resolve the hero's render state from the top read (D3/D4): a failed
 * read is unavailable; no materialized day or no eligible rows is the
 * pending state (the comparison has not compiled yet — not an outage);
 * a day older than the freshness cutoff — or an unparseable one, which
 * fails closed — is unavailable rather than stale-as-current figures.
 */
function deriveHomeGapHeroState(
  read: SavingsTopResponse | null,
  nowMs: number,
): HomeGapHeroState {
  if (read === null) return { kind: 'unavailable' };
  if (read.asOf === null || read.rows.length === 0) return { kind: 'pending' };
  // The day-grain as-of parses as UTC midnight — the listing's own
  // formatAsOf construction.
  const dayMs = Date.parse(`${read.asOf}T00:00:00.000Z`);
  if (Number.isNaN(dayMs) || nowMs - dayMs > FRESHNESS_CUTOFF_MS) {
    return { kind: 'unavailable' };
  }
  return { kind: 'ready', asOf: read.asOf, rows: read.rows };
}

/**
 * Homepage (OpenSpec: design-system-foundation, tasks 4.1 + 4.2;
 * trust-and-reach-roadmap task 3.3 extends the trust row;
 * funnel-evidence-and-value-surfaces task 3.1 adds the task cards;
 * homepage-live-gap-hero task 2.2 adds the live observed-difference
 * section).
 *
 * Static catalog copy plus server-side reads that degrade gracefully
 * (D6, D4): the gradient hero with a floating search card as the primary
 * CTA, a live observed-difference section over the day's top-N savings
 * snapshot (homepage-live-gap-hero task 2.2 — pending when no eligible
 * rows exist, unavailable on a failed or stale read, figures never
 * guessed), a compact worked-example step strip below the live section
 * (homepage-live-gap-hero task 2.3, demoting the task 3.1 D7 breakdown
 * — labeled as an example, no API call, the figures cannot drift with
 * live data), a task-card
 * section mirroring the header's three task groups (three-task-
 * navigation 3.2 — links only, the hero search stays the homepage's
 * single input, funnel D4), a "Why Rajahinta.fi" feature
 * section surfacing the platform's genuine differentiators, the trust
 * row (data sources, reliability model, accuracy statistic,
 * methodology), and a FAQ section linking PUBLISHED guide entries. The
 * FAQ fetch follows the sitemap degradation contract: a fetch failure or
 * no published entries renders NO section at all. The shopping card
 * (the savings listing, the header's shopping-group lead) follows the
 * same honesty contract: with no rows carrying an Alko reference
 * (overview `withReference: 0`), or when the overview cannot be read,
 * the card states the pending/unavailable state and does NOT link into
 * the listing; the CTA returns with no code change once references
 * exist. AccuracyStat is a self-contained client island.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Home');
  const tNav = await getTranslations('Nav');
  // Root-scoped so the status labels resolve through the canonical
  // labelKey contract in RELIABILITY_STATUS_META.
  const tAll = await getTranslations();

  // Published guide entries for the FAQ section (task 3.4, D4). The
  // guides endpoint serves PUBLISHED rows for one locale; a fetch
  // failure or an empty index degrades to no section, never an error —
  // the same inert-degradation contract as the sitemap's guide slugs.
  const guides = await getServerGuidesIndex(locale);

  // Savings-listing state for the task-card section (3.2). The overview
  // carries no explicit withReference field: a category is emitted only
  // over snapshot rows that have a computed Alko reference AND a
  // resolvable product name, so the summed productCount IS the
  // with-reference count the spec's `withReference: 0` names — the same
  // rows the listing itself lists.
  const savingsOverview = await getSavingsOverview();
  const savingsWithReference =
    savingsOverview?.categories.reduce(
      (total, category) => total + category.productCount,
      0,
    ) ?? 0;
  // Degrade-honestly choice for a failed overview read: the card renders
  // its non-link state with "could not be verified" copy — no CTA into
  // an unverified listing, no invented figures, no claimed data state.
  const savingsListingReady =
    savingsOverview !== null && savingsWithReference > 0;

  // Live gap hero state (homepage-live-gap-hero task 2.2). The top-N
  // read rides the same 15-minute ISR cadence as the overview; the D3/D4
  // degradation split is derived here so the component stays
  // presentational: a failed read → unavailable, no day or no eligible
  // rows → pending, a day older than the freshness cutoff → unavailable.
  const savingsTop = await getSavingsTop();
  const homeGapHeroState = deriveHomeGapHeroState(savingsTop, Date.now());

  // The hero form is plain HTML (GET), so it navigates before hydration.
  // next-intl's `as-needed` prefixing: Finnish serves the bare path,
  // every other locale the prefixed one.
  const searchAction = locale === 'fi' ? '/calculator' : `/${locale}/calculator`;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Hero section ──────────────────────────────────────────────── */}
      <section
        aria-labelledby="home-hero-heading"
        className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-primary-800 px-4 pb-24 pt-16 sm:pb-32 sm:pt-20"
      >
        {/* Subtle radial glow centred behind the content */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[600px] w-[600px] rounded-full bg-primary-700 opacity-20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-3xl text-center">
          {/* Trust pill badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-blue-100 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" aria-hidden="true" />
            {t('heroPillBadge')}
          </div>

          {/* Primary headline — larger scale overrides the base h1 style */}
          <h1
            id="home-hero-heading"
            className="text-balance text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            {t('heroHeadline')}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100">
            {t('heroSubline')}
          </p>

          {/* ── Real hero search (task 1.1) ──
              A functional GET form: submission navigates to
              /calculator?q={term}, where the calculator pre-fills and
              runs the product search. Plain HTML — no JS required. ── */}
          <form
            method="get"
            action={searchAction}
            className="mx-auto mt-10 flex max-w-xl flex-col gap-3 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-white/10 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-gray-50 px-4 py-2.5 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-primary-500">
              <svg
                aria-hidden="true"
                focusable="false"
                className="h-4 w-4 shrink-0 text-gray-400"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="9" cy="9" r="6" />
                <path d="M15 15l3 3" strokeLinecap="round" />
              </svg>
              <label htmlFor="hero-search" className="sr-only">
                {t('heroSearchLabel')}
              </label>
              <input
                id="hero-search"
                name="q"
                type="search"
                placeholder={t('heroSearchPlaceholder')}
                aria-label={t('heroSearchLabel')}
                className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {t('heroSearchSubmit')}
              <svg
                aria-hidden="true"
                focusable="false"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </form>

          {/* Micro trust badges below the card */}
          <p className="mt-4 text-center text-xs text-blue-300">
            {t('heroTrustLine')}
          </p>
        </div>
      </section>

      {/* ── Live observed-difference section (homepage-live-gap-hero
          task 2.2, D3/D4) ──────────────────────────────────────────────
          The day's largest observed landed-cost gaps against the Alko
          reference, re-read every 15 minutes. Pending when the snapshot
          day has no eligible rows yet, unavailable when the read fails
          or the day is older than the freshness cutoff — figures are
          never guessed and never shown stale-as-current. Links only —
          the hero search stays the homepage's single input (D4). */}
      <HomeGapHero state={homeGapHeroState} locale={locale} t={t} />

      {/* ── Worked example — demoted how-it-works step strip
          (homepage-live-gap-hero task 2.3; superseding the task 3.1 D7
          hero-adjacent breakdown) ─────────────────────────────────────
          Below the live section, the example is a compact three-step
          strip: pick the foreign retail price, land transport + taxes
          into the total, compare against the Alko reference. The
          figures stay the fixed illustrative Home-namespace strings —
          explicitly labeled as an example, no API call, unable to
          drift with live data. The exampleNote (fixed figures, totals
          compared, dearer possibility) survives under the steps; the
          difference line spells out cheaper in words, color alone
          never carries it. */}
      <section
        aria-labelledby="home-example-heading"
        className="border-b border-gray-100 bg-gray-50 px-4 py-12 sm:px-6"
      >
        <div className="mx-auto max-w-4xl">
          <div className="mb-3 text-center">
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-800">
              {t('exampleBadge')}
            </span>
          </div>

          <h2
            id="home-example-heading"
            className="mb-2 text-center text-xl font-bold tracking-tight text-gray-900"
          >
            {t('howItWorksHeading')}
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
            {t('exampleTitle')}
          </p>

          <ol className="grid gap-4 text-left sm:grid-cols-3">
            <li className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                {t('exampleStepLabel', { step: 1 })}
              </h3>
              <p className="mt-2 text-sm font-medium text-gray-900">
                {t('exampleForeignPriceLabel')}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-900">
                {t('exampleForeignPriceValue')}
              </p>
            </li>

            <li className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                {t('exampleStepLabel', { step: 2 })}
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                {t('exampleTransportLabel')}:{' '}
                <span className="font-semibold tabular-nums text-gray-900">
                  {t('exampleTransportValue')}
                </span>
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {t('exampleLandedLabel')}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-900">
                {t('exampleLandedValue')}
              </p>
            </li>

            <li className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                {t('exampleStepLabel', { step: 3 })}
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                {t('exampleReferenceLabel')}:{' '}
                <span className="font-semibold tabular-nums text-gray-900">
                  {t('exampleReferenceValue')}
                </span>
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {t('exampleDifferenceLabel')}
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {t('exampleDifferenceValue')}
              </p>
            </li>
          </ol>

          <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-gray-500">
            {t('exampleNote')}
          </p>
        </div>
      </section>

      {/* ── Task cards — the header's three task groups (three-task-
          navigation 3.2) ──────────────────────────────────────────────
          Server-rendered links, same display order as the header groups.
          The shopping card links into /savings only once the overview
          confirms listing content; zero references or an unreadable
          overview render its honest non-link state instead (3.2).
          Links only — the hero search stays the homepage's single
          input (D4): no form, no origin selector. Each linked card is
          one anchor, so the touch target is the full card. */}
      <section
        aria-labelledby="home-taskcards-heading"
        className="border-b border-gray-100 bg-white px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          <h2
            id="home-taskcards-heading"
            className="mb-10 text-center text-2xl font-bold tracking-tight text-gray-900"
          >
            {t('taskCardsHeading')}
          </h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TASK_CARDS.map((card) =>
              card.gated && !savingsListingReady ? (
                /* The gated shopping card's honest non-link state (3.2):
                   pending at `withReference: 0`, could-not-verify on a
                   failed overview read — never a CTA into a listing that
                   may have no content. Same title and icon as the linked
                   branch, so the card set stays at three in every state. */
                <div
                  key={card.href}
                  data-testid="savings-card-pending"
                  className="flex flex-col rounded-xl border border-gray-100 bg-gray-50 p-5"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-600">
                    {card.icon}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {t(card.titleKey)}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                    {savingsOverview === null
                      ? t('taskCardsShoppingUnavailableBody')
                      : t('taskCardsShoppingPendingBody')}
                  </p>
                </div>
              ) : (
                <Link
                  key={card.href}
                  href={card.href}
                  className="group flex flex-col rounded-xl border border-gray-100 bg-gray-50 p-5 transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                    {card.icon}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary-800">
                    {t(card.titleKey)}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                    {t(card.bodyKey)}
                  </p>
                </Link>
              ),
            )}
          </div>
        </div>
      </section>

      {/* ── "Why Rajahinta.fi" feature section ───────────────────────── */}
      <section
        aria-labelledby="home-why-heading"
        className="border-b border-gray-100 bg-white px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          <h2
            id="home-why-heading"
            className="mb-10 text-center text-2xl font-bold tracking-tight text-gray-900"
          >
            {t('whyTitle')}
          </h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Feature 1 — Total landed cost */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M16 8h-6a2 2 0 100 4h4a2 2 0 110 4H8M12 6v2m0 8v2" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature1Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature1Body')}</p>
            </div>

            {/* Feature 2 — Verified data */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-status-verified">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature2Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature2Body')}</p>
            </div>

            {/* Feature 3 — Neutral ranking */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-600">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature3Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature3Body')}</p>
            </div>

            {/* Feature 4 — Price history */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature4Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature4Body')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust row (task 4.2, D6) ──────────────────────────────────── */}
      <section
        aria-labelledby="home-trust-heading"
        className="bg-gray-50 px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          {/* Section landmark needs an accessible name; the three item
              titles below are visible and self-describing. */}
          <h2 id="home-trust-heading" className="sr-only">
            {t('trustHeading')}
          </h2>

          <div className="grid gap-8 text-left sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {t('trustSourcesTitle')}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                {t('trustSourcesBody')}
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {t('trustReliabilityTitle')}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                {t('trustReliabilityBody')}
              </p>
              {/* The four reliability statuses with their canonical dots —
                  shape + adjacent label, so hue is never the sole carrier
                  of meaning. Explains the model; shows no live data. */}
              <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {TRUST_ROW_STATUSES.map((status) => {
                  const meta = RELIABILITY_STATUS_META[status];
                  return (
                    <li
                      key={status}
                      className="flex items-center gap-1.5 text-xs text-gray-600"
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 shrink-0 ${meta.dot}`}
                      />
                      {tAll(meta.labelKey)}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {t('trustMethodologyTitle')}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                {t('trustMethodologyBody')}
              </p>
              {/* Same destination the header and footer link to. */}
              <Link
                href="/ranking"
                className="mt-2 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
              >
                {tNav('howRankingWorks')} →
              </Link>
            </div>

            {/* ── Accuracy statistic (task 3.3) ──
                The user-reported outcome share in the trust row: always
                with its sample size and the API-supplied wording, honest
                empty state until outcomes exist. The fetch failure
                degrades quietly inside the component. */}
            <AccuracyStat variant="trust-row" />
          </div>
        </div>
      </section>

      {/* ── FAQ section (task 3.4, D4) ──────────────────────────────────
          Links the PUBLISHED guide entries authored through the ops
          guides console. Renders NOTHING while none exist (fetch
          failure or empty index) — the section first appears when the
          entries are published (task 5.3). */}
      {guides.kind === 'ok' && guides.items.length > 0 && (
        <section
          aria-labelledby="home-faq-heading"
          className="border-t border-gray-100 bg-white px-4 py-16 sm:px-6"
        >
          <div className="mx-auto max-w-5xl">
            <h2
              id="home-faq-heading"
              className="mb-8 text-center text-2xl font-bold tracking-tight text-gray-900"
            >
              {t('faqHeading')}
            </h2>
            <ul className="mx-auto max-w-2xl space-y-3">
              {guides.items.map((guide) => (
                <li key={guide.slug}>
                  <Link
                    href={`/guides/${guide.slug}`}
                    className="text-sm font-medium text-primary-700 transition-colors hover:text-primary-800"
                  >
                    {guide.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
