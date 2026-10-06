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
 * Static task-card links (funnel-evidence-and-value-surfaces task 3.1,
 * D4). Order follows the visitor funnel: one basket, a whole trip, an
 * event's drink need, and a hypothetical duty scenario — the daily
 * landed-cost gap listing's card renders separately below, gated on the
 * overview confirming listing content (data-quality-and-publication-
 * trust 3.2). Icons are decorative (aria-hidden); each linked card is
 * ONE link, so the touch target is the full card (≥44 px, asserted by
 * the mobile e2e journeys).
 */
const TASK_CARDS = [
  {
    href: '/basket',
    titleKey: 'taskCardsBasketTitle',
    bodyKey: 'taskCardsBasketBody',
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
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
      </svg>
    ),
  },
  {
    href: '/trip',
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
  {
    href: '/what-if',
    titleKey: 'taskCardsWhatIfTitle',
    bodyKey: 'taskCardsWhatIfBody',
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
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
  },
] as const;

/**
 * The savings-listing card's decorative icon, shared by the linked and
 * the pending state (data-quality-and-publication-trust 3.2).
 */
function SavingsCardIcon() {
  return (
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
  );
}

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
 * guessed), a fixed worked example labeled as an example (task 3.1, D7 — no
 * API call, the figures cannot drift with live data), a task-card
 * section linking the task tools (links only — the hero search stays
 * the homepage's single input, funnel D4), a "Why Rajahinta.fi" feature
 * section surfacing the platform's genuine differentiators, the trust
 * row (data sources, reliability model, accuracy statistic,
 * methodology), and a FAQ section linking PUBLISHED guide entries. The
 * FAQ fetch follows the sitemap degradation contract: a fetch failure or
 * no published entries renders NO section at all. The savings-listing
 * card follows the same honesty contract one level up: with no rows
 * carrying an Alko reference (overview `withReference: 0`), or when the
 * overview cannot be read, the card states the pending state and does
 * NOT link into the listing; the CTA returns with no code change once
 * references exist. AccuracyStat is a self-contained client island.
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

      {/* ── Worked example (task 3.1, D7) ───────────────────────────────
          A fixed, illustrative breakdown labeled as an example — no API
          call, fully crawlable, cannot drift with live data. Live
          sophistication stays with the AccuracyStat island and the trust
          row. The difference line spells out cheaper/dearer in words;
          color alone never carries the comparison. */}
      <section
        aria-labelledby="home-example-heading"
        className="border-b border-gray-100 bg-gray-50 px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 text-center">
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-800">
              {t('exampleBadge')}
            </span>
          </div>

          <h2
            id="home-example-heading"
            className="mb-2 text-center text-2xl font-bold tracking-tight text-gray-900"
          >
            {t('exampleTitle')}
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
            {t('exampleIntro')}
          </p>

          <dl className="mx-auto max-w-xl divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-gray-600">
                {t('exampleForeignPriceLabel')}
              </dt>
              <dd className="text-sm font-semibold text-gray-900">
                {t('exampleForeignPriceValue')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-gray-600">
                {t('exampleTransportLabel')}
              </dt>
              <dd className="text-sm font-semibold text-gray-900">
                {t('exampleTransportValue')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm font-medium text-gray-900">
                {t('exampleLandedLabel')}
              </dt>
              <dd className="text-sm font-semibold text-gray-900">
                {t('exampleLandedValue')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-gray-600">
                {t('exampleReferenceLabel')}
              </dt>
              <dd className="text-sm font-semibold text-gray-900">
                {t('exampleReferenceValue')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm font-medium text-gray-900">
                {t('exampleDifferenceLabel')}
              </dt>
              <dd className="text-sm font-semibold text-gray-900">
                {t('exampleDifferenceValue')}
              </dd>
            </div>
          </dl>

          <p className="mx-auto mt-4 max-w-xl text-center text-xs leading-relaxed text-gray-500">
            {t('exampleNote')}
          </p>
        </div>
      </section>

      {/* ── Task cards (funnel-evidence-and-value-surfaces task 3.1, D4) ──
          Server-rendered links to the task tools; the savings-listing
          card links only once the overview confirms listing content
          (3.2). Links only — the hero search stays the homepage's
          single input (D4): no form, no origin selector. Each linked
          card is one anchor, so the touch target is the full card. */}
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
            {TASK_CARDS.map((card) => (
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
            ))}

            {/* ── Savings-listing card (3.2) ──────────────────────────
                Links into /savings only when the overview confirms
                rows with an Alko reference; zero references render the
                honest pending state and a failed overview read the
                could-not-verify state — both as a plain card, never a
                link into a listing that may have no content. The
                linked branch is byte-identical to the previous static
                card, so the CTA returns unchanged at non-zero. */}
            {savingsListingReady ? (
              <Link
                href="/savings"
                className="group flex flex-col rounded-xl border border-gray-100 bg-gray-50 p-5 transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                  <SavingsCardIcon />
                </div>
                <h3 className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary-800">
                  {t('taskCardsSavingsTitle')}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                  {t('taskCardsSavingsBody')}
                </p>
              </Link>
            ) : (
              <div
                data-testid="savings-card-pending"
                className="flex flex-col rounded-xl border border-gray-100 bg-gray-50 p-5"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-600">
                  <SavingsCardIcon />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {t('taskCardsSavingsTitle')}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                  {savingsOverview === null
                    ? t('taskCardsSavingsUnavailableBody')
                    : t('taskCardsSavingsPendingBody')}
                </p>
              </div>
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
