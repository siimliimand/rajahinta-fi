/**
 * Locale tests for the tax-change calendar surfaces (task 4.3, change
 * tax-change-calendar).
 *
 * The two surfaces render from two real catalog namespaces:
 *
 *   - the calendar page (`/veromuutokset`, `/en/tax-changes`) from
 *     `TaxChangeCalendarPage` plus the reused `Common.retry`, and
 *   - the homepage widget from `NextTaxChange` (four keys; the EXPECTED
 *     branch's rhythm disclaimer arrives verbatim from the API and the
 *     window label is mechanically derived — deliberately NO catalog
 *     keys for either, so extras here would be dead copy).
 *
 * The page namespace's per-locale wording is pinned verbatim to the
 * committed stub `app/[locale]/veromuutokset/test-catalog.ts` (the
 * reviewable source of truth the surfaces shipped against); the widget
 * wording is pinned to the task-4.2 stubs. Exact key-set and
 * exact-string assertions make a missing or extra key — in either
 * locale — fail.
 */
import { describe, expect, it } from 'vitest';
import fi from '../messages/fi.json';
import en from '../messages/en.json';
import {
  EN_CATALOG_STUB,
  FI_CATALOG_STUB,
} from '../app/[locale]/veromuutokset/test-catalog';

type Catalog = Record<string, unknown>;

const catalogs: Record<'fi' | 'en', Catalog> = {
  fi: fi as unknown as Catalog,
  en: en as unknown as Catalog,
};

/** The stub table for one locale (its only two top-level namespaces). */
function stubTable(locale: 'fi' | 'en'): Record<string, unknown> {
  return (locale === 'fi' ? FI_CATALOG_STUB : EN_CATALOG_STUB) as Record<
    string,
    unknown
  >;
}

/** Sorted string keys of a namespace object. */
function keysOf(table: unknown): string[] {
  return Object.keys((table ?? {}) as Record<string, unknown>).sort();
}

/** ICU argument placeholders (`{name}`) of a message, sorted. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

// ---------------------------------------------------------------------------
// Calendar page — namespace `TaxChangeCalendarPage` + reused `Common.retry`
// ---------------------------------------------------------------------------

describe('TaxChangeCalendarPage catalog entries (calendar page, task 4.3)', () => {
  const stubNamespaces = {
    fi: stubTable('fi').TaxChangeCalendarPage as Record<string, string>,
    en: stubTable('en').TaxChangeCalendarPage as Record<string, string>,
  };

  for (const locale of ['fi', 'en'] as const) {
    it(`${locale} carries exactly the stub key set — no missing, no extra`, () => {
      expect(keysOf(catalogs[locale].TaxChangeCalendarPage)).toEqual(
        keysOf(stubNamespaces[locale]),
      );
    });

    it(`${locale} resolves every key with the stub wording verbatim`, () => {
      const table = catalogs[locale]
        .TaxChangeCalendarPage as Record<string, string>;
      for (const [key, expected] of Object.entries(stubNamespaces[locale])) {
        expect(table[key], `${locale}.TaxChangeCalendarPage.${key}`).toBe(
          expected,
        );
      }
    });

    it(`${locale} preserves the stub's ICU placeholders per key`, () => {
      const table = catalogs[locale]
        .TaxChangeCalendarPage as Record<string, string>;
      for (const [key, expected] of Object.entries(stubNamespaces[locale])) {
        expect(placeholders(table[key]), `${locale}.${key}`).toEqual(
          placeholders(expected),
        );
      }
    });
  }

  it('the reused Common.retry matches the stub wording in both locales', () => {
    for (const locale of ['fi', 'en'] as const) {
      const expected = (stubTable(locale).Common as Record<string, string>)
        .retry;
      const actual = (catalogs[locale].Common as Record<string, string>).retry;
      expect(actual, `Common.retry (${locale})`).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Homepage widget — namespace `NextTaxChange`, pinned to the task-4.2
// stubs (NextTaxChangeWidget.test.tsx, page.calendar-widget.test.tsx)
// ---------------------------------------------------------------------------

describe('NextTaxChange catalog entries (homepage widget, task 4.3)', () => {
  const widgetWording: Record<'fi' | 'en', Record<string, string>> = {
    fi: {
      heading: 'Seuraava veromuutos',
      inDays: '{days} päivän kuluttua',
      today: 'Tänään',
      linkLabel: 'Katso veromuutokset',
    },
    en: {
      heading: 'Next tax change',
      inDays: '{days, plural, one {in # day} other {in # days}}',
      today: 'Today',
      linkLabel: 'See tax changes',
    },
  };
  const expectedKeys = Object.keys(widgetWording.fi).sort();

  for (const locale of ['fi', 'en'] as const) {
    it(`${locale} carries exactly the four widget keys — no missing, no extra`, () => {
      expect(keysOf(catalogs[locale].NextTaxChange)).toEqual(expectedKeys);
    });

    it(`${locale} resolves every widget key with the pinned wording`, () => {
      const table = catalogs[locale].NextTaxChange as Record<string, string>;
      for (const [key, expected] of Object.entries(widgetWording[locale])) {
        expect(table[key], `NextTaxChange.${key} (${locale})`).toBe(expected);
      }
    });
  }

  it('the countdown placeholder survives: fi uses the {days} argument, en the ICU plural', () => {
    const fiInDays = (catalogs.fi.NextTaxChange as Record<string, string>)
      .inDays;
    const enInDays = (catalogs.en.NextTaxChange as Record<string, string>)
      .inDays;
    expect(placeholders(fiInDays)).toContain('days');
    expect(enInDays).toMatch(/\{days, plural,/);
  });
});
