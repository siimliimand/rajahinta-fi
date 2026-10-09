/**
 * Homepage task-card section tests (three-task-navigation task 3.2;
 * carries over the gating contract of data-quality-and-publication-
 * trust 3.2).
 *
 * Renders the REAL server component to an HTML string (page.ssr.test.tsx
 * precedent; only Next server plumbing is mocked), pinning the static
 * task-card contract in BOTH locales (layout.ssr.test.tsx precedent for
 * steering the catalog):
 *
 *   1. The section renders server-side with its localized heading and
 *      mirrors the header's three task groups in display order:
 *      shopping (→ /savings), trip (→ /trip), event (→ /event).
 *   2. Each card is ONE anchor wrapping the localized task-language
 *      title and tool body — the whole card is the touch target.
 *   3. The section is static: links only — no form, input, or button.
 *      The hero search stays the homepage's single input (funnel D4),
 *      so the only form on the page remains the hero search.
 *   4. The demoted cards are gone: no /basket or /what-if anchor and no
 *      basket-optimization/scenario catalog copy anywhere on the page
 *      (the footer owns those destinations — three-task-navigation
 *      D5/D6).
 *   5. The shopping card mirrors the savings overview honestly (3.2):
 *      zero rows with an Alko reference (`withReference: 0`) and a
 *      failed overview read BOTH render the non-link pending card — no
 *      CTA into an empty or unverified listing; a non-zero count
 *      restores the linked card with no copy change.
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
// The i18n Link double serializes typed href objects through the real
// routing vocabulary, prefixed for the steered EN locale (as-needed).
vi.mock('@/i18n/navigation', async () => {
  const { createTestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: createTestI18nLink(() => state.locale) };
});

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
// established three-anchor pins keep exercising the linked shopping
// card (savings-page.test.tsx stubbing precedent). The honest-state
// tests override it.
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
// Fixtures — verbatim catalog copy (source of truth: messages/{fi,en}.json),
// in the header's group order: shopping, trip, event. The shopping card's
// pending/unavailable bodies are pinned separately (5).
// ---------------------------------------------------------------------------

const HEADING = {
  fi: 'Valitse tilanteesi',
  en: 'Pick your task',
} as const;

const TASK_CARDS = [
  {
    href: '/savings',
    fi: {
      title: 'Mitä kannattaa ostaa?',
      body: 'Päivittäin päivitetty luettelo arvioiduista kokonaishinnoista ja niiden erosta Alkon viitehintaan kategorioittain.',
    },
    en: {
      title: "What's worth buying?",
      body: 'A daily updated listing of estimated landed totals and their gap against the Alko reference price, by category.',
    },
  },
  {
    href: '/trip',
    fi: {
      title: 'Suunnittele matka',
      body: 'Vertaa kokonaisen matkan ostoskoreja: matkakustannuksen osuus, kategoriakohtainen hintaero ja tullivapaiden määrien vaikutus.',
    },
    en: {
      title: 'Plan a trip',
      body: 'Compare baskets for a whole trip: the shared travel cost, the per-category price difference, and the effect of the duty-free allowances.',
    },
  },
  {
    href: '/event',
    fi: {
      title: 'Suunnittele juhlat',
      body: 'Arvioi juomatarve vieraiden määrän ja tilaisuuden keston perusteella — eriteltynä ostoslistana rivi riviltä.',
    },
    en: {
      title: 'Plan a party',
      body: 'Estimate the drink demand from the guest count and the event duration, itemized line by line as a shopping list.',
    },
  },
] as const;

const SHOPPING_PENDING_BODY = {
  fi: 'Alkon viitehintoja ei ole vielä yhdistetty tuotteiden kokonaishintalaskelmiin, joten luetteloa ei ole vielä julkaistu.',
  en: "Alko reference prices are not yet matched to the products' landed-cost calculations, so the listing is not published yet.",
} as const;

const SHOPPING_UNAVAILABLE_BODY = {
  fi: 'Luettelon saatavuutta ei voitu tarkistaa juuri nyt.',
  en: "The listing's availability could not be verified just now.",
} as const;

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

describe('HomePage task cards (three-task-navigation 3.2)', () => {
  it.each(['fi', 'en'] as const)(
    'renders the static task-card section with its localized heading (%s)',
    async (locale) => {
      const section = taskCardSection(await renderHome(locale));

      expect(section.querySelector('h2')?.textContent).toBe(HEADING[locale]);
      // Exactly three cards: the section mirrors the header's three
      // task groups, one anchor per group.
      expect(section.querySelectorAll('a')).toHaveLength(TASK_CARDS.length);
    },
  );

  it.each(['fi', 'en'] as const)(
    'links the three task groups in header order, each card one anchor with the task-language title (%s)',
    async (locale) => {
      const section = taskCardSection(await renderHome(locale));

      const anchors = Array.from(
        section.querySelectorAll<HTMLAnchorElement>('a'),
      );
      expect(anchors.map((a) => a.getAttribute('href'))).toEqual(
        TASK_CARDS.map((card) => localizedHref(card.href, locale)),
      );

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
      // Heading, all three titles, and all three bodies resolved from
      // this locale's catalog — a missing key would render __MISSING__.
      expect(page.textContent).not.toContain('__MISSING_');
    },
  );

  it.each(['fi', 'en'] as const)(
    'renders no demoted card: no /basket or /what-if anchor or copy (%s)',
    async (locale) => {
      const page = await renderHome(locale);

      // The basket card and the what-if card were removed with the
      // header's flat links (three-task-navigation D5/D6) — their
      // destinations and catalog copy are absent from the homepage.
      expect(page.querySelector('a[href*="basket"], a[href*="what-if"]'))
        .toBeNull();
      expect(page.textContent).not.toContain('Ostoskorin optimointi');
      expect(page.textContent).not.toContain('Skenaariolaskuri');
      expect(page.textContent).not.toContain('Basket optimization');
      expect(page.textContent).not.toContain('Scenario calculator');
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
      // The action carries the active locale's segment (/laskuri fi,
      // /en/calculator en — the localized pathnames).
      expect(page.querySelectorAll('form')).toHaveLength(1);
      expect(
        page.querySelector('form[action="/laskuri"], form[action^="/en"]'),
      ).not.toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Shopping-card honesty (3.2, carried over) — the card mirrors the
// overview: `withReference: 0` (the overview's summed productCount) and
// a failed read render the non-link pending state; a non-zero count
// keeps the established anchor.
// ---------------------------------------------------------------------------

describe('HomePage shopping-card honest state (3.2)', () => {
  it.each(['fi', 'en'] as const)(
    'keeps the three anchors when the overview reports a non-zero reference count (%s)',
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
      // The card stays present and names the pending state, keeping
      // the section at three cards (the other two keep their anchors).
      const pending = section.querySelector('[data-testid="savings-card-pending"]');
      expect(pending).not.toBeNull();
      expect(
        pending?.querySelector('h3')?.textContent,
      ).toBe(TASK_CARDS.find((card) => card.href === '/savings')![locale].title);
      expect(pending?.textContent).toContain(SHOPPING_PENDING_BODY[locale]);
      expect(section.querySelectorAll('a')).toHaveLength(2);
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
      expect(pending?.textContent).toContain(SHOPPING_UNAVAILABLE_BODY[locale]);
      expect(section.querySelectorAll('a')).toHaveLength(2);
    },
  );
});
