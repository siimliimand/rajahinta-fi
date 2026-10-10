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

  it('SiteHeader carries every destination plus the nav label', () => {
    expectNamespaceKeys('SiteHeader', [
      'navLabel',
      // three-task-navigation 1.2: the three task-group trigger labels
      // (task language) and the panel item labels (tool names).
      'groupShopping',
      'groupTrip',
      'groupEvent',
      'savings',
      'value',
      'calculator',
      'compare',
      'basket',
      'products',
      'event',
      'trip',
      'allowances',
      // Demoted from the header by three-task-navigation: 2.1 removed the
      // whatIf/ranking catalog keys — no code renders them (the footer's
      // linkWhatIf and methodology keys cover those destinations).
      // `account` stays until its follow-up task re-homes it.
      'account',
      // add-product-favorites 5.1: the account-area favorites quick link
      // (rendered beside `account` by SiteHeader since task 4.2).
      'favorites',
      // The locale switcher's accessible label.
      'localeSwitcherLabel',
    ]);
    expectTranslated('SiteHeader');
  });

  it('SiteFooter carries the disclaimer and methodology link copy', () => {
    expectNamespaceKeys('SiteFooter', [
      'disclaimer',
      // funnel-evidence-and-value-surfaces 1.4: the anonymous, session-scoped
      // product-analytics disclosure line under the disclaimer.
      'privacyAnalytics',
      'methodology',
      'tagline',
      'servicesHeading',
      'aboutHeading',
      'linkCalculator',
      'linkCompare',
      'linkBasket',
      'linkTrip',
      'linkEvent',
      // consumer-clarity-and-discovery 4.1: the group-order tool joins the
      // footer's services column.
      'linkGroupOrder',
      'linkValue',
      'linkBlog',
      // honest-trust-surfaces 4.1: the footer carries a guides link whose
      // visibility is gated on the locale's published-guide count.
      'linkGuides',
      // about-contact: 3.3 adds both pages to the footer nav.
      'linkAbout',
      'linkContact',
      // three-task-navigation D6: the scenario calculator joins the
      // footer's About column.
      'linkWhatIf',
      'copyright',
    ]);
    expectTranslated('SiteFooter', ['copyright']);
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

// ---------------------------------------------------------------------------
// Honest-state catalog keys (data-quality-and-publication-trust 3.1 +
// 3.2; three-task-navigation 3.2): the calculator's transport-unavailable
// line and the homepage task-card copy (heading, three task-language
// titles, bodies, and the shopping card's pending/unavailable variants)
// must exist as full key sets in BOTH locales — parity is what the honest
// states render from.
// ---------------------------------------------------------------------------

describe('honest-state catalog key parity (3.1 + 3.2)', () => {
  const top = (locale: unknown): Record<string, Record<string, unknown>> =>
    locale as Record<string, Record<string, unknown>>;

  function expectParity(
    namespace: string,
    group: string | null,
    keys: readonly string[],
  ): void {
    for (const catalog of [fi, en]) {
      const table = group
        ? (top(catalog)[namespace]?.[group] as Record<string, unknown> | undefined)
        : top(catalog)[namespace];
      // Group scopes are exact key sets; shared namespaces are checked
      // as a subset (other tasks own the remaining keys).
      const actual = Object.keys(table ?? {}).sort();
      if (group) {
        expect(actual).toEqual([...keys].sort());
      } else {
        for (const key of keys) {
          expect(actual).toContain(key);
        }
      }
      for (const key of keys) {
        const text = table?.[key];
        expect(typeof text).toBe('string');
        expect((text as string).trim().length).toBeGreaterThan(0);
      }
    }
    // Genuinely translated, not copied.
    for (const key of keys) {
      const fiText = group
        ? (top(fi)[namespace]?.[group] as Record<string, unknown>)?.[key]
        : top(fi)[namespace]?.[key];
      const enText = group
        ? (top(en)[namespace]?.[group] as Record<string, unknown>)?.[key]
        : top(en)[namespace]?.[key];
      expect(enText).not.toBe(fiText);
    }
  }

  it('CalculatorResult.transportPending carries the same keys in both locales', () => {
    expectParity('CalculatorResult', 'transportPending', [
      'notIncluded',
      'explanation',
    ]);
  });

  it('Home carries the full task-card key set in parity (three-task-navigation 3.2)', () => {
    expectParity('Home', null, [
      'taskCardsHeading',
      'taskCardsShoppingTitle',
      'taskCardsShoppingBody',
      'taskCardsShoppingPendingBody',
      'taskCardsShoppingUnavailableBody',
      'taskCardsTripTitle',
      'taskCardsTripBody',
      'taskCardsEventTitle',
      'taskCardsEventBody',
    ]);
  });

  // ── Traveller mode (task 2.1, change finnish-first-client-experience):
  // the buying-mode toggle, the honest no-dataset state, the PERSONAL
  // result provenance lines, and the delivery-mode callout render only
  // from these keys — both locales must carry the exact sets. ──

  it('Calculator.buyingMode carries the same keys in both locales', () => {
    expectParity('Calculator', 'buyingMode', [
      'label',
      // consumer-clarity-and-discovery 3.3: the fieldset description states
      // the price fork between the two modes.
      'description',
      'sellerArranged',
      'sellerArrangedDescription',
      'personal',
      'personalDescription',
    ]);
  });

  it('Calculator carries the traveller-mode honest-state copy in parity', () => {
    expectParity('Calculator', null, [
      'travellerUnavailableTitle',
      'travellerUnavailableBody',
    ]);
  });

  it('CalculatorResult.allowance carries the same keys in both locales', () => {
    expectParity('CalculatorResult', 'allowance', [
      'datasetVersion',
      'singleTravellerNote',
      'lineWithin',
      'lineSurplus',
    ]);
  });

  it('CalculatorResult.travellerAlternative carries the same keys in both locales', () => {
    expectParity('CalculatorResult', 'travellerAlternative', [
      'label',
      'estimateWithin',
      'estimatePartial',
      'tryLink',
    ]);
  });

  // ── Localized classification display (consumer-clarity-and-discovery
  // 3.2): the label localizes from the ClassificationLabel enum and the
  // evidence composes locale sentences from the closed evidence-code set —
  // both locales must carry the exact sets the mapping reads from. ──

  it('CalculatorResult.classification carries exactly the ClassificationLabel set in both locales', () => {
    expectParity('CalculatorResult', 'classification', [
      'DistanceSelling',
      'DistanceBuying',
      'TravellerImport',
    ]);
  });

  it('CalculatorResult.evidence carries the closed code set plus data labels in both locales', () => {
    const codes = [
      'BUYER_TRAVELLING',
      'PERSONAL_ALLOWANCE_APPLIES',
      'SELLER_CARRIAGE',
      'BUYER_CARRIAGE',
      'SELLER_NOT_INVOLVED',
      'SELLER_IDENTITY_CONFIRMED',
      'SELLER_IDENTITY_UNVERIFIED',
      'TRANSPORT_UNDETERMINED',
    ] as const;
    const dataKeys = [
      'carrier',
      'sellerCountry',
      'buyerCountry',
      'destination',
      'seller',
      'transportArrangement',
      'personalTransport',
      'carrierUnavailable',
      'noCarrierIdentified',
      'sellerNotInvolvedInShipping',
      'sellerIdentifierMissing',
    ] as const;

    for (const catalog of [fi, en]) {
      const table = top(catalog).CalculatorResult?.evidence as
        | Record<string, unknown>
        | undefined;
      expect(Object.keys(table ?? {}).sort()).toEqual([...codes, 'data'].sort());
      for (const code of codes) {
        expect(typeof table?.[code]).toBe('string');
      }
      const data = table?.data as Record<string, unknown> | undefined;
      expect(Object.keys(data ?? {}).sort()).toEqual([...dataKeys].sort());
      for (const key of dataKeys) {
        expect(typeof data?.[key]).toBe('string');
      }
    }
    // Genuinely translated, not copied.
    for (const code of codes) {
      const fiTable = top(fi).CalculatorResult?.evidence as Record<string, unknown>;
      const enTable = top(en).CalculatorResult?.evidence as Record<string, unknown>;
      expect(enTable[code]).not.toBe(fiTable[code]);
    }
  });

  // ── Outcome nudge (honest-trust-surfaces task 3.3): the post-
  // calculation prompt renders only from these keys — both locales must
  // carry the exact set. ──

  it('CalculatorResult.outcomeNudge carries the same keys in both locales', () => {
    expectParity('CalculatorResult', 'outcomeNudge', [
      'bodySignedIn',
      'bodyAnonymous',
      'ctaSignedIn',
      'ctaAnonymous',
      'dismiss',
    ]);
  });

  it('did-you-mean banner copy exists in both locales (task 3.3)', () => {
    expectParity('ProductSearch', null, ['didYouMean']);
    expectParity('ProductsPage', null, ['didYouMean']);
  });
});

// ---------------------------------------------------------------------------
// Product-page enum labels (unit-integrity task 4.2): category and
// containerType render through these keys, so both locales must carry
// exactly the storage value sets — the D1 schema's PRODUCT_CATEGORIES and
// the product_master_container_type_check CHECK — no more, no fewer.
// ---------------------------------------------------------------------------

describe('ProductPage enum label key parity', () => {
  const catalog = (locale: 'fi' | 'en'): Record<string, unknown> =>
    (locale === 'fi' ? fi : en) as unknown as Record<string, unknown>;

  const expectedCategoryKeys = [
    'beer',
    'wine_still',
    'wine_sparkling',
    'intermediate_products',
    'other_fermented',
    'spirits',
  ];
  const expectedContainerTypeKeys = [
    'glass',
    'plastic',
    'metal',
    'carton',
    'can',
    'bottle',
    'other',
  ];

  function expectEnumKeySet(group: 'category' | 'containerType', keys: readonly string[]): void {
    for (const locale of ['fi', 'en'] as const) {
      const table = (catalog(locale).ProductPage ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      expect(Object.keys(table[group] ?? {}).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(typeof table[group]?.[key]).toBe('string');
      }
    }
  }

  it('ProductPage.category covers exactly the canonical categories in both locales', () => {
    expectEnumKeySet('category', expectedCategoryKeys);
  });

  it('ProductPage.containerType covers exactly the container-type CHECK values in both locales', () => {
    expectEnumKeySet('containerType', expectedContainerTypeKeys);
  });
});
