/**
 * Message catalog tests.
 *
 * Finnish is the source of truth; the English catalog must mirror it
 * exactly in structure so no locale renders a missing message. The
 * English sort-order descriptions must additionally stay verbatim-identical
 * to `SORT_ORDER_DESCRIPTIONS` (which the compliance suite
 * `tests/compliance/ranking-lockstep.test.ts` pins to the backend
 * `RankingService.describeSortOrder()`), preserving the backend ↔
 * reference ↔ catalog lockstep chain.
 */
import { describe, expect, it } from 'vitest';
import fi from '../messages/fi.json';
import en from '../messages/en.json';
import { SORT_ORDER_DESCRIPTIONS } from '../lib/ranking-descriptions';
import type { SortOrder } from '../lib/types';

/** Recursively collect dotted key paths to string leaves. */
function stringKeys(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      out.set(path, child);
    } else if (child !== null && typeof child === 'object') {
      for (const [k, v] of stringKeys(child, path)) {
        out.set(k, v);
      }
    }
  }
  return out;
}

const fiKeys = stringKeys(fi);
const enKeys = stringKeys(en);

describe('message catalogs', () => {
  it('both catalogs are non-empty', () => {
    expect(fiKeys.size).toBeGreaterThan(0);
    expect(enKeys.size).toBeGreaterThan(0);
  });

  it('every key in the Finnish catalog exists in the English catalog', () => {
    const missing = [...fiKeys.keys()].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('every key in the English catalog exists in the Finnish catalog', () => {
    const missing = [...enKeys.keys()].filter((k) => !fiKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('no empty message strings in either catalog', () => {
    const emptyFi = [...fiKeys.entries()]
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => `fi.${k}`);
    const emptyEn = [...enKeys.entries()]
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => `en.${k}`);
    expect([...emptyFi, ...emptyEn]).toEqual([]);
  });

  it('locale-specific keys differ between the catalogs (translation exists)', () => {
    // Sanity guard against an accidentally duplicated catalog: most keys
    // must differ between fi and en (metadata titles may legitimately match).
    const differing = [...fiKeys.entries()].filter(
      ([k, v]) => enKeys.get(k) !== v,
    ).length;
    expect(differing / fiKeys.size).toBeGreaterThan(0.5);
  });
});

describe('sort-order description lockstep (catalog ↔ reference)', () => {
  const orders = Object.keys(SORT_ORDER_DESCRIPTIONS) as SortOrder[];

  it('the catalog covers exactly the reference sort orders', () => {
    const catalogOrders = Object.keys(
      (en as { SortOrders: Record<string, unknown> }).SortOrders,
    ).sort();
    expect(catalogOrders).toEqual([...orders].sort());
  });

  for (const order of orders) {
    it(`en.SortOrders.${order}.description matches the backend-locked reference`, () => {
      expect(enKeys.get(`SortOrders.${order}.description`)).toBe(
        SORT_ORDER_DESCRIPTIONS[order],
      );
    });

    it(`fi.SortOrders.${order}.description exists and differs from English`, () => {
      const fiText = fiKeys.get(`SortOrders.${order}.description`);
      expect(typeof fiText).toBe('string');
      expect(fiText).not.toBe(SORT_ORDER_DESCRIPTIONS[order]);
    });
  }
});

// ---------------------------------------------------------------------------
// Layout and navigation completeness (task 9.6 — extends the global parity
// tests above with the key SETS the shared chrome, the age gate, and the
// page navigation depend on, plus a translated-not-copied check per key).
// ---------------------------------------------------------------------------

describe('layout and navigation catalog completeness', () => {
  type Catalog = Record<string, Record<string, string>>;
  const fiTop = fi as unknown as Catalog;
  const enTop = en as unknown as Catalog;

  /** Assert a namespace exists in both locales with exactly `keys`. */
  function expectNamespaceKeys(namespace: string, keys: readonly string[]): void {
    expect(Object.keys(fiTop[namespace] ?? {}).sort()).toEqual([...keys].sort());
    expect(Object.keys(enTop[namespace] ?? {}).sort()).toEqual([...keys].sort());
  }

  /** Every key in the namespace is non-empty and genuinely translated. */
  function expectTranslated(namespace: string, allowSame: readonly string[] = []): void {
    for (const key of Object.keys(fiTop[namespace] ?? {})) {
      const fiText = fiKeys.get(`${namespace}.${key}`);
      const enText = enKeys.get(`${namespace}.${key}`);
      expect(typeof fiText).toBe('string');
      expect(fiText!.trim().length).toBeGreaterThan(0);
      expect(typeof enText).toBe('string');
      expect(enText!.trim().length).toBeGreaterThan(0);
      if (!allowSame.includes(key)) {
        // A copied string means one locale would render the other's
        // language — the translation is missing in practice.
        expect(enText).not.toBe(fiText);
      }
    }
  }

  it('SiteHeader carries the five base destinations and the flag-gated event, trip, and what-if destinations plus the nav label', () => {
    expectNamespaceKeys('SiteHeader', [
      'navLabel',
      'calculator',
      'compare',
      'basket',
      'event',
      'trip',
      'whatIf',
      'account',
      'ranking',
    ]);
    expectTranslated('SiteHeader');
  });

  it('SiteFooter carries the disclaimer and methodology link copy', () => {
    expectNamespaceKeys('SiteFooter', ['disclaimer', 'methodology']);
    expectTranslated('SiteFooter');
  });

  it('AgeGate carries the full dialog copy in both locales', () => {
    expectNamespaceKeys('AgeGate', [
      'title',
      'body',
      'confirm',
      'deny',
      'note',
      // age-gate-recovery: shown when a gated call is rejected after the
      // confirmation cookie expired (calculator error surface, 3.3/3.4).
      'recoveryTitle',
      'recoveryDescription',
    ]);
    expectTranslated('AgeGate');
  });

  it('the Nav namespace used by pages keeps its key set and stays translated', () => {
    expectNamespaceKeys('Nav', [
      'backToCalculator',
      'openCalculator',
      'compareProducts',
      'howRankingWorks',
      'myAccount',
      'calculateAnother',
    ]);
    expectTranslated('Nav');
  });

  it('default-document Metadata exists in both locales (title may match)', () => {
    expectNamespaceKeys('Metadata', ['title', 'description']);
    expectTranslated('Metadata', ['title']);
    // Finnish is the default locale's catalog — its description must exist.
    expect(fiKeys.get('Metadata.description')!.length).toBeGreaterThan(0);
  });
});
