/**
 * Homepage task-card section tests (funnel-evidence-and-value-surfaces
 * tasks 3.1 + 3.2, D4; data-quality-and-publication-trust 3.2).
 *
 * Renders the REAL server component to an HTML string (page.ssr.test.tsx
 * precedent; only Next server plumbing is mocked), pinning the static
 * task-card contract in BOTH locales (layout.ssr.test.tsx precedent for
 * steering the catalog):
 *
 *   1. The section renders server-side with its localized heading.
 *   2. All five task destinations are linked (/basket, /trip, /event,
 *      /what-if, /savings), each card being ONE anchor wrapping the
 *      localized title and body — /savings only while the savings
 *      overview confirms listing content.
 *   3. The section is static: links only — no form, input, or button.
 *      The hero search stays the homepage's single input (funnel D4),
 *      so the only form on the page remains the hero search.
 *   4. The savings card mirrors the overview honestly (3.2): zero
 *      rows with an Alko reference (`withReference: 0`) and a failed
 *      overview read BOTH render the non-link pending card — no CTA
 *      into an empty or unverified listing; a non-zero count restores
 *      the linked card with no copy change.
 *
 * @module HomePageTaskCardsTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './page';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — locale is steerable per render through this
// hoisted object (layout.ssr.test.tsx precedent); catalogs resolve from the
// REAL fi/en message files so both locales are exercised (page.*.test.tsx
// precedent). The root-scoped translator resolves full dotted keys so the
// trust row can consume RELIABILITY_STATUS_META's labelKey contract.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  locale: 'fi' as string,
}));

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const locale = (typeof opts === 'object' && opts.locale) || state.locale;
    const table = (await import(`@/messages/${locale}.json`)).default as Record<
      string,
      unknown
    >;
    return (key: string) => {
      const value = ns
        ? (table[ns] as Record<string, unknown> | undefined)?.[key]
        : key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            table,
          );
      return typeof value === 'string' ? value : `__MISSING_${ns}.${key}__`;
    };
  },
}));

// The i18n Link applies the routing config's localePrefix: 'as-needed' —
// Finnish serves bare paths, English gets the /en prefix
// (layout.ssr.test.tsx precedent). Under renderToString it renders as a
// plain anchor.
vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
  ) => {
    const { href, children, ...rest } = props;
    const target = String(href ?? '');
    const prefixed =
      state.locale === 'en' && target.startsWith('/') ? `/en${target}` : target;
    return React.createElement('a', { ...rest, href: prefixed }, children);
  },
}));

// The task-card section is independent of the guides fetch; mock it so
// this render stays fully offline (page.example.test.tsx precedent).
vi.mock('./guides/guides.server', () => ({
  getServerGuidesIndex: vi.fn(async () => ({ kind: 'error' as const })),
}));

// The accuracy statistic (task 3.3) is a client island with its own
// fetch; stub it so this SSR render stays offline (page.ssr.test.tsx
// precedent).
vi.mock('./components/AccuracyStat', () => ({
  default: () => React.createElement('div'),
}));

// ---------------------------------------------------------------------------
// Savings overview — the homepage's server fetch (3.2) goes through
// global fetch; default every render to a POPULATED overview so the
// established five-anchor pins keep exercising the linked card
// (savings-page.test.tsx stubbing precedent). The honest-state tests
// override it.
// ---------------------------------------------------------------------------

/** Shape GET /api/v1/savings/overview serves; only the fields page.tsx reads. */
function overviewBody(
  categories: readonly { category: string; productCount: number }[],
): unknown {
  return { asOf: '2026-09-29T00:00:00.000Z', categories };
}

const OVERVIEW_POPULATED = overviewBody([{ category: 'beer', productCount: 2 }]);
const OVERVIEW_EMPTY = overviewBody([]);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => OVERVIEW_POPULATED,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Point the homepage's overview fetch at `body`, or at a failure. */
function mockOverviewFetch(body: unknown | null): void {
  vi.stubGlobal(
    'fetch',
    body === null
      ? vi.fn().mockRejectedValue(new Error('overview fetch not mocked'))
      : vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
  );
}

// ---------------------------------------------------------------------------
// Fixtures — verbatim catalog copy (source of truth: messages/{fi,en}.json).
// ---------------------------------------------------------------------------

const HEADING = {
  fi: 'Laskurityökalut muihin tilanteisiin',
  en: 'Calculation tools for other tasks',
} as const;

const TASK_CARDS = [
  {
    href: '/basket',
    fi: {
      title: 'Ostoskorin optimointi',
      body: 'Yhdistä useita tuotteita yhdeksi ostoskoriksi ja laske optimaalinen myyjäyhdistelmä kokonaiskustannusarviona Suomeen.',
    },
    en: {
      title: 'Basket optimization',
      body: 'Combine several products into one basket and compute the optimal store combination as a landed-cost estimate for Finland.',
    },
  },
  {
    href: '/trip',
    fi: {
      title: 'Matkalaskuri',
      body: 'Vertaa kokonaisen matkan ostoskoreja: matkakustannuksen osuus, kategoriakohtainen hintaero ja tullivapaiden määrien vaikutus.',
    },
    en: {
      title: 'Trip calculator',
      body: 'Compare baskets for a whole trip: the shared travel cost, the per-category price difference, and the effect of the duty-free allowances.',
    },
  },
  {
    href: '/event',
    fi: {
      title: 'Tilaisuuslaskuri',
      body: 'Arvioi juomatarve vieraiden määrän ja tilaisuuden keston perusteella — eriteltynä ostoslistana rivi riviltä.',
    },
    en: {
      title: 'Event calculator',
      body: 'Estimate the drink demand from the guest count and the event duration, itemized line by line as a shopping list.',
    },
  },
  {
    href: '/what-if',
    fi: {
      title: 'Skenaariolaskuri',
      body: 'Korvaa valmisteveron verokanta valitsemallasi arvolla ja vertaa tuotteiden kokonaishintoja. Laskelma on hypoteettinen.',
    },
    en: {
      title: 'Scenario calculator',
      body: 'Substitute the excise duty rate with a value of your choice and compare product totals. The calculation is hypothetical.',
    },
  },
  {
    href: '/savings',
    fi: {
      title: 'Kokonaishinta-ero Alko-viitehintaan',
      body: 'Päivittäin päivitetty luettelo arvioiduista kokonaishinnoista ja niiden erosta Alkon viitehintaan kategorioittain.',
    },
    en: {
      title: 'Landed-cost gap versus the Alko reference',
      body: 'A daily updated listing of estimated landed totals and their gap against the Alko reference price, by category.',
    },
  },
] as const;

/** Localized href the Link mock produces for a bare app path. */
function localizedHref(href: string, locale: 'fi' | 'en'): string {
  return locale === 'en' ? `/en${href}` : href;
}

async function renderHome(locale: 'fi' | 'en'): Promise<HTMLElement> {
  state.locale = locale;
  const element = await HomePage({
    params: Promise.resolve({ locale }),
  });
  const container = document.createElement('div');
  container.innerHTML = renderToString(element);
  return container;
}

function taskCardSection(page: HTMLElement): HTMLElement {
  const section = page.querySelector<HTMLElement>(
    'section[aria-labelledby="home-taskcards-heading"]',
  );
  if (!section) throw new Error('task-card section did not render');
  return section;
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('HomePage task cards (funnel-evidence-and-value-surfaces task 3.1, D4)', () => {
  it.each(['fi', 'en'] as const)(
    'renders the static task-card section with its localized heading (%s)',
    async (locale) => {
      const section = taskCardSection(await renderHome(locale));

      expect(section.querySelector('h2')?.textContent).toBe(HEADING[locale]);
      // Exactly five cards: the section is one anchor per task tool.
      expect(section.querySelectorAll('a')).toHaveLength(TASK_CARDS.length);
    },
  );

  it.each(['fi', 'en'] as const)(
    'links all five task destinations, each card one anchor with the localized title (%s)',
    async (locale) => {
      const section = taskCardSection(await renderHome(locale));

      for (const card of TASK_CARDS) {
        const anchor = section.querySelector<HTMLAnchorElement>(
          `a[href="${localizedHref(card.href, locale)}"]`,
        );
        // The whole card is the anchor, so the touch target is the
        // full card — the title lives inside it.
        expect(anchor).not.toBeNull();
        expect(anchor?.querySelector('h3')?.textContent).toBe(
          card[locale].title,
        );
      }
    },
  );

  it.each(['fi', 'en'] as const)(
    'resolves every taskCards catalog key with no missing messages (%s)',
    async (locale) => {
      const page = await renderHome(locale);
      const section = taskCardSection(page);

      for (const card of TASK_CARDS) {
        const anchor = section.querySelector(
          `a[href="${localizedHref(card.href, locale)}"]`,
        );
        expect(anchor?.querySelector('p')?.textContent).toBe(
          card[locale].body,
        );
      }
      // Heading, all five titles, and all five bodies resolved from
      // this locale's catalog — a missing key would render __MISSING__.
      expect(page.textContent).not.toContain('__MISSING_');
    },
  );

  it.each(['fi', 'en'] as const)(
    'keeps the section links-only: no form, input, or button inside it (%s)',
    async (locale) => {
      const page = await renderHome(locale);
      const section = taskCardSection(page);

      expect(
        section.querySelector('form, input, button, select, textarea'),
      ).toBeNull();
      // The hero search stays the homepage's single input (funnel D4):
      // exactly one form on the page, and it is the hero's, not the
      // section's — so the scoping assertion above is not vacuous.
      expect(page.querySelectorAll('form')).toHaveLength(1);
      expect(page.querySelector('form[action="/calculator"], form[action^="/en"]')).not.toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Savings-card honesty (data-quality-and-publication-trust 3.2) — the
// card mirrors the overview: `withReference: 0` (the overview's summed
// productCount) and a failed read render the non-link pending state;
// a non-zero count keeps the established anchor.
// ---------------------------------------------------------------------------

describe('HomePage savings-card honest state (3.2)', () => {
  it.each(['fi', 'en'] as const)(
    'keeps the five anchors when the overview reports a non-zero reference count (%s)',
    async (locale) => {
      const section = taskCardSection(await renderHome(locale));

      const anchor = section.querySelector<HTMLAnchorElement>(
        `a[href="${localizedHref('/savings', locale)}"]`,
      );
      expect(anchor).not.toBeNull();
      expect(anchor?.querySelector('h3')?.textContent).toBe(
        TASK_CARDS.find((card) => card.href === '/savings')![locale].title,
      );
      // The pending card is gone on the linked path.
      expect(section.querySelector('[data-testid="savings-card-pending"]'))
        .toBeNull();
    },
  );

  it.each(['fi', 'en'] as const)(
    'renders the honest pending state and no /savings CTA at withReference: 0 (%s)',
    async (locale) => {
      mockOverviewFetch(OVERVIEW_EMPTY);
      const section = taskCardSection(await renderHome(locale));

      // No CTA into the empty listing — in either locale's href form.
      expect(
        section.querySelector(
          'a[href="/savings"], a[href="/en/savings"]',
        ),
      ).toBeNull();
      // The card stays present and names the pending state, keeping the
      // section's grid at five cards.
      const pending = section.querySelector('[data-testid="savings-card-pending"]');
      expect(pending).not.toBeNull();
      expect(
        pending?.querySelector('h3')?.textContent,
      ).toBe(TASK_CARDS.find((card) => card.href === '/savings')![locale].title);
      expect(pending?.textContent).toContain(
        locale === 'fi'
          ? 'Alkon viitehintoja ei ole vielä yhdistetty tuotteiden kokonaishintalaskelmiin, joten luetteloa ei ole vielä julkaistu.'
          : "Alko reference prices are not yet matched to the products' landed-cost calculations, so the listing is not published yet.",
      );
      // The other four task tools keep their anchors.
      expect(section.querySelectorAll('a')).toHaveLength(4);
      // Every catalog key resolved (a missing key would render __MISSING__).
      expect(section.textContent).not.toContain('__MISSING_');
    },
  );

  it.each(['fi', 'en'] as const)(
    'degrades honestly on an overview fetch failure: non-link card, no invented data claims (%s)',
    async (locale) => {
      mockOverviewFetch(null);
      const section = taskCardSection(await renderHome(locale));

      expect(
        section.querySelector('a[href="/savings"], a[href="/en/savings"]'),
      ).toBeNull();
      const pending = section.querySelector('[data-testid="savings-card-pending"]');
      expect(pending).not.toBeNull();
      expect(pending?.textContent).toContain(
        locale === 'fi'
          ? 'Luettelon saatavuutta ei voitu tarkistaa juuri nyt.'
          : "The listing's availability could not be verified just now.",
      );
      expect(section.querySelectorAll('a')).toHaveLength(4);
    },
  );
});
