/**
 * Tests for the source-category mapper (task 7.1).
 *
 * High-liability: a wrong mapping sends products down the wrong excise
 * category (wrong duty), and a silent fallback mapping hides unmappable
 * feeds. Swedish strings come from the Systembolaget assortment
 * vocabulary; golden behaviour is pinned per group.
 *
 * @module SourceCategoryMapperTests
 */
import { describe, it, expect } from 'vitest';
import {
  mapSourceCategory,
  isKnownTaxCategory,
  SWEDISH_SOURCE_CATEGORY_MAP,
} from '../source-category.mapper';
import { TAX_CATEGORY_KEYS } from '../../tax/tax-categories';

describe('mapSourceCategory — Swedish assortment categories', () => {
  it('maps "Öl" to the canonical beer category the excise engine keys on', () => {
    const result = mapSourceCategory('Öl');
    expect(result).not.toBeNull();
    expect(result!.canonicalCategory).toBe('beer');
    expect(result!.taxCategory).toBe('beer');
  });

  it('maps "Vin" to still wine', () => {
    const result = mapSourceCategory('Vin');
    expect(result!.canonicalCategory).toBe('wine');
    expect(result!.taxCategory).toBe('wine_still');
  });

  it('maps "Mousserande vin" to sparkling wine — never the fallback rate', () => {
    const result = mapSourceCategory('Mousserande vin');
    expect(result!.canonicalCategory).toBe('sparkling-wine');
    expect(result!.taxCategory).toBe('wine_sparkling');
  });

  it('maps "Sprit" to spirits', () => {
    const result = mapSourceCategory('Sprit');
    expect(result!.canonicalCategory).toBe('spirits');
    expect(result!.taxCategory).toBe('spirits');
  });

  it('maps "Cider och blanddrycker" to cider / other fermented', () => {
    const result = mapSourceCategory('Cider och blanddrycker');
    expect(result!.canonicalCategory).toBe('cider');
    expect(result!.taxCategory).toBe('other_fermented');
  });

  it('maps "Starkvin" and "Glögg" to fortified wine / intermediate products', () => {
    expect(mapSourceCategory('Starkvin')!.taxCategory).toBe('intermediate_products');
    expect(mapSourceCategory('Glögg')!.taxCategory).toBe('intermediate_products');
  });

  it('maps "Likör" to liqueur (spirits tax category)', () => {
    const result = mapSourceCategory('Likör');
    expect(result!.canonicalCategory).toBe('liqueur');
    expect(result!.taxCategory).toBe('spirits');
  });

  it('maps "Alkoholfritt" to non-alcoholic', () => {
    expect(mapSourceCategory('Alkoholfritt')!.canonicalCategory).toBe('non-alcoholic');
  });

  it('matches case-insensitively and trims surrounding whitespace', () => {
    expect(mapSourceCategory('  öl ')).toEqual(mapSourceCategory('Öl'));
  });

  it('every Swedish map entry resolves to a valid tax category', () => {
    for (const [token] of Object.entries(SWEDISH_SOURCE_CATEGORY_MAP)) {
      const result = mapSourceCategory(token);
      expect(result, `token "${token}" must map`).not.toBeNull();
      expect(TAX_CATEGORY_KEYS).toContain(result!.taxCategory);
    }
  });
});

describe('mapSourceCategory — non-Swedish sources keep working', () => {
  it('maps English and Finnish tokens already known to normalizeCategory', () => {
    expect(mapSourceCategory('beer')!.taxCategory).toBe('beer');
    expect(mapSourceCategory('olut')!.taxCategory).toBe('beer');
    expect(mapSourceCategory('cider')!.canonicalCategory).toBe('cider');
  });

  it('maps explicit "other" tokens', () => {
    expect(mapSourceCategory('other')!.canonicalCategory).toBe('other');
    expect(mapSourceCategory('annat')!.canonicalCategory).toBe('other');
    expect(mapSourceCategory('muu')!.canonicalCategory).toBe('other');
  });
});

describe('mapSourceCategory — alks.fi catalog vocabulary (sweep patch 2026-09-09)', () => {
  it('maps the strong-alcohol departments and spirit nouns to spirits', () => {
    for (const term of [
      'Väkevä',
      'EE-str',
      'Akvavit',
      'Rommi',
      'Viski',
      'Calvados',
      'Armagnac',
      'Rakija',
    ]) {
      const result = mapSourceCategory(term);
      expect(result, `term "${term}" must map`).not.toBeNull();
      expect(result!.canonicalCategory).toBe('spirits');
      expect(result!.taxCategory).toBe('spirits');
    }
  });

  it('maps Finnish wine nouns and the sparkling group to the wine family', () => {
    expect(mapSourceCategory('Punaviini')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('Valkoviini')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('Kuohuviini ja samppanja')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });

  it('maps the Finnish vermouth spelling to fortified wine', () => {
    expect(mapSourceCategory('Vermutti')).toEqual({
      canonicalCategory: 'fortified-wine',
      taxCategory: 'intermediate_products',
    });
  });

  it('maps plural and shop-group beer terms like their singular', () => {
    expect(mapSourceCategory('Oluet')!.canonicalCategory).toBe('beer');
    expect(mapSourceCategory('Oluet')!.taxCategory).toBe('beer');
    expect(mapSourceCategory('EE-olutit')!.taxCategory).toBe('beer');
  });

  it('maps the plural "Cocktails" and "Juomasekoitus" like their singular — long drink', () => {
    expect(mapSourceCategory('Cocktails')).toEqual({
      canonicalCategory: 'long-drink',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Juomasekoitus')!.canonicalCategory).toBe('long-drink');
  });

  it('maps non-alcoholic beverage groups to non-alcoholic', () => {
    for (const term of [
      'Virvoitusjuomat',
      'Soft drinks',
      'Energy drink',
      'Alkoholittomat juomat',
    ]) {
      expect(mapSourceCategory(term)!.canonicalCategory).toBe('non-alcoholic');
    }
  });

  it('maps the explicit "other drinks" spellings to other — never a guessed type', () => {
    for (const term of ['Muut', 'Muut juomat', 'Other drinks']) {
      expect(mapSourceCategory(term)!.canonicalCategory).toBe('other');
      expect(mapSourceCategory(term)!.taxCategory).toBe('other_fermented');
    }
  });

  it('still refuses merchandising groups with no beverage meaning', () => {
    for (const term of ['Joulutuotteet', 'Tulevat tuotteet', 'Countries', 'Siirappi']) {
      expect(mapSourceCategory(term), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — longero.fi catalog vocabulary (sweep patch 2026-09-14)', () => {
  it('maps the Finnish rosé spellings to still wine — the sweep\'s only vocabulary-driven drop', () => {
    expect(mapSourceCategory('Roseeviini')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('roseeviini')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('Roseeviinit')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
  });

  it('keeps country merchandising terms unmapped — first-mappable-in-payload-order rule', () => {
    for (const term of ['Germany', 'USA', 'Italy']) {
      expect(mapSourceCategory(term), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — kippis.fi catalog vocabulary (sweep patch 2026-09-15)', () => {
  it('maps the wine-department plurals to still wine — never the fallback rate', () => {
    expect(mapSourceCategory('Punaviinit')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('valkoviinit')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
  });

  it('maps the sparkling-department plural like the Swedish mousserande terms', () => {
    expect(mapSourceCategory('Kuohuviinit')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });

  it('maps the spirit-department plurals and the vodka-and-viina department to spirits', () => {
    for (const term of ['Viskit', 'Rommit', 'Konjakit', 'Ginit', 'Vodkat ja Viinat']) {
      const result = mapSourceCategory(term);
      expect(result, `term "${term}" must map`).not.toBeNull();
      expect(result!.canonicalCategory).toBe('spirits');
      expect(result!.taxCategory).toBe('spirits');
    }
  });

  it('maps the liqueur plural like its singular — liqueur canonical, spirits tax', () => {
    expect(mapSourceCategory('Liköörit')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
  });

  it('maps the aperitif department to fortified wine like the Swedish aperitif entries', () => {
    expect(mapSourceCategory('Aperitiivit')).toEqual({
      canonicalCategory: 'fortified-wine',
      taxCategory: 'intermediate_products',
    });
  });

  it('maps the cider-long-drink-seltzer department like "Cider och blanddrycker"', () => {
    expect(mapSourceCategory('Siiderit lonkerot ja seltzerit')).toEqual({
      canonicalCategory: 'cider',
      taxCategory: 'other_fermented',
    });
  });

  it('maps the non-alcoholic departments like their existing singular terms', () => {
    for (const term of ['Virvoitusjuomat ja mikserit', 'Energiajuomat']) {
      expect(mapSourceCategory(term)!.canonicalCategory).toBe('non-alcoholic');
      expect(mapSourceCategory(term)!.taxCategory).toBe('other_fermented');
    }
  });

  it('matches the live feed\'s inconsistent casing and whitespace', () => {
    expect(mapSourceCategory('  valkoviinit ')).toEqual(mapSourceCategory('Valkoviinit'));
    expect(mapSourceCategory('vodkat ja viinat')).toEqual(mapSourceCategory('Vodkat ja Viinat'));
  });

  it('leaves gift cards and the upsell group unmapped — merchandising, never a guess', () => {
    expect(mapSourceCategory('Lahjakortti')).toBeNull();
    expect(mapSourceCategory('Upsell')).toBeNull();
  });

  it('changes no existing mapping — singulars and Swedish terms behave as before', () => {
    expect(mapSourceCategory('Valkoviini')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('Viski')).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Likör')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Mousserande vin')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });
});

describe('mapSourceCategory — mydrink.ee catalog vocabulary (sweep patch 2026-09-27)', () => {
  it('maps the strong-alcohol department and spirit nouns to spirits', () => {
    for (const term of ['Kange alkohol ▾', 'Vodka', 'Konjak', 'Rumm', 'Gin']) {
      const result = mapSourceCategory(term);
      expect(result, `term "${term}" must map`).not.toBeNull();
      expect(result!.canonicalCategory).toBe('spirits');
      expect(result!.taxCategory).toBe('spirits');
    }
  });

  it('maps the Estonian double-ö "Liköör" to liqueur — the Swedish single-ö key does not match it', () => {
    expect(mapSourceCategory('Liköör')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
    // Both spellings are distinct keys over the same canonical category.
    expect(SWEDISH_SOURCE_CATEGORY_MAP['liköör']).toBe('liqueur');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['likör']).toBe('liqueur');
  });

  it('maps the still-wine leaves to still wine — never the fallback rate', () => {
    for (const term of ['Punased', 'Valged', 'Pakiveinid']) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'wine',
        taxCategory: 'wine_still',
      });
    }
  });

  it('maps the sparkling leaves to sparkling wine — kept apart from still wine for the excise split', () => {
    expect(mapSourceCategory('Vahuveinid')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
    expect(mapSourceCategory('Shampanjad')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });

  it('maps the beer, cider and non-alcoholic departments', () => {
    expect(mapSourceCategory('Õlu ▾')).toEqual({
      canonicalCategory: 'beer',
      taxCategory: 'beer',
    });
    expect(mapSourceCategory('Siider')).toEqual({
      canonicalCategory: 'cider',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Alkoholivaba ▾')).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Karastusjoogid')).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
    });
  });

  it('matches the ▾-decorated keys case-insensitively with surrounding whitespace', () => {
    expect(mapSourceCategory('  kange alkohol ▾ ')).toEqual(mapSourceCategory('Kange alkohol ▾'));
    expect(mapSourceCategory('  õlu ▾ ')).toEqual(mapSourceCategory('Õlu ▾'));
    expect(mapSourceCategory('alkoholivaba ▾')).toEqual(mapSourceCategory('  Alkoholivaba ▾ '));
  });

  it('changes no existing mapping — the Swedish viski/likör keys behave as before', () => {
    expect(mapSourceCategory('Viski')).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Likör')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
  });

  it('leaves the "Veinid ▾" wine parent unmapped — first-mappable-in-payload-order would misfile sparkling rows as still', () => {
    expect(mapSourceCategory('Veinid ▾')).toBeNull();
  });

  it('leaves RTD cocktails unmapped — tax-ambiguous, the correction queue owns them', () => {
    expect(mapSourceCategory('Kokteilijoogid')).toBeNull();
    expect(mapSourceCategory('Kokteil')).toBeNull();
  });

  it('leaves promo and navigational terms unmapped — never a guessed category', () => {
    for (const term of ['☝️ Lahja alkohol', '☝️ Kange', '☝️ Pakkumised ▾', 'Kingiideed ▾', 'Avaleht', 'Pandipakend', 'Prantsuse']) {
      expect(mapSourceCategory(term), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — araxes.ee catalog vocabulary (sweep patch 2026-10-07)', () => {
  it('maps the strong-alcohol parent and the Estonian spirit nouns to spirits at any ABV', () => {
    for (const term of [
      'Kange alkohol',
      'Viin',
      'Brändi',
      'Džinn',
      'Tekiila',
      'Kalvados',
      'Armanjakk',
      'Absint',
    ]) {
      for (const abv of [undefined, 0.58]) {
        const result = mapSourceCategory(term, abv);
        expect(result, `term "${term}" at abv ${abv} must map`).not.toBeNull();
        expect(result!.canonicalCategory, `"${term}" at ${abv}`).toBe('spirits');
        expect(result!.taxCategory, `"${term}" at ${abv}`).toBe('spirits');
        // Keyword outcomes at any ABV — never boundary-rule re-assignments.
        expect(result!.boundaryApplied, `"${term}" at ${abv}`).toBeUndefined();
      }
    }
  });

  it('maps the still-wine leaf terms to still wine — never the fallback rate', () => {
    for (const term of ['Punane vein', 'Valge vein', 'Roosa vein', 'Puuvilja- ja marjavein']) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'wine',
        taxCategory: 'wine_still',
      });
    }
  });

  it('maps the sparkling leaves to sparkling wine — kept apart from still wine for the excise split', () => {
    expect(mapSourceCategory('Vahuvein')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
    expect(mapSourceCategory('Šampanja')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });

  it('maps the fortified leaf terms to fortified wine / intermediate products', () => {
    for (const term of ['Hõõgvein', 'Vermut', 'Liköörvein, portvein, šerri']) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'fortified-wine',
        taxCategory: 'intermediate_products',
      });
    }
  });

  it('maps the beer term and the long-drink term', () => {
    expect(mapSourceCategory('Õlu')).toEqual({
      canonicalCategory: 'beer',
      taxCategory: 'beer',
    });
    expect(mapSourceCategory('Long drink')).toEqual({
      canonicalCategory: 'long-drink',
      taxCategory: 'other_fermented',
    });
  });

  it('maps the non-alcoholic section and its children — one tax family', () => {
    for (const term of [
      'Alkoholivaba',
      'Energiajook',
      'Karastusjook',
      'Mahl',
      'Vesi',
      'Alkoholivaba õlu',
      'Alkoholivaba vein',
      'Alkoholivaba vahuvein',
    ]) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'non-alcoholic',
        taxCategory: 'other_fermented',
      });
    }
  });

  it('bounds the fermented-bucket terms at 22 % exactly like the older vocabulary', () => {
    // The boundary is inclusive below, re-assigning above:
    expect(mapSourceCategory('Alkoholivaba', 0.22)!.taxCategory).toBe('other_fermented');
    expect(mapSourceCategory('Long drink', 0.25)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    });
    expect(mapSourceCategory('Alkoholivaba vahuvein', 0.3)!.boundaryApplied).toBe(true);
    // Spirit and wine outcomes are never fermented buckets, so the guard
    // does not touch them:
    expect(mapSourceCategory('Punane vein', 0.13)).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
  });

  it('matches the bare Estonian terms case-insensitively with surrounding whitespace', () => {
    expect(mapSourceCategory('  kange alkohol ')).toEqual(mapSourceCategory('Kange alkohol'));
    expect(mapSourceCategory('  õlu ')).toEqual(mapSourceCategory('Õlu'));
    expect(mapSourceCategory('šampanja')).toEqual(mapSourceCategory('Šampanja'));
    // The bare and the mydrink-decorated forms are distinct keys over
    // the same canonical categories.
    expect(SWEDISH_SOURCE_CATEGORY_MAP['kange alkohol']).toBe('spirits');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['kange alkohol ▾']).toBe('spirits');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['õlu']).toBe('beer');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['õlu ▾']).toBe('beer');
  });

  it('changes no existing mapping — the mydrink and shared keys behave as before', () => {
    expect(mapSourceCategory('Vahuveinid')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
    expect(mapSourceCategory('Viski')).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Liköör')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Siider')).toEqual({
      canonicalCategory: 'cider',
      taxCategory: 'other_fermented',
    });
  });

  it('leaves the wine parent-and-leaf term, the low-alcohol parent and RTD cocktails unmapped at sub-22 %', () => {
    // 'vein': parent and its identically named leaf share one lowercase
    // key; first-mappable-in-payload-order would misfile sparkling rows
    // as still. 'lahja alkohol': heterogeneous children resolve from
    // their own leaves. 'kokteilid': RTD spans tax families.
    for (const term of ['Vein', 'Lahja alkohol', 'Kokteilid']) {
      expect(mapSourceCategory(term, 0.2), `term "${term}" must stay unmapped`).toBeNull();
      expect(mapSourceCategory(term), `term "${term}" must stay unmapped`).toBeNull();
    }
  });

  it('leaves the merch terms unmapped at sub-22 % — never a guessed category', () => {
    for (const term of ['Suupisted', 'Krõpsud', 'Pähklid', 'Lihasnäkid', 'Kommid', 'Pakend']) {
      expect(mapSourceCategory(term, 0.2), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — bottleofitaly.com catalog vocabulary (sweep patch 2026-10-08)', () => {
  it('maps the IT product_type wine leaves to still wine — never the fallback rate', () => {
    for (const term of ['Vino Rosso', 'Vino Bianco', 'Vino Rosato']) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'wine',
        taxCategory: 'wine_still',
      });
    }
  });

  it('maps "Bollicine" to sparkling wine — kept apart from still wine for the excise split', () => {
    expect(mapSourceCategory('Bollicine')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });

  it('maps "Spirits" to spirits — pinned from the feed vocabulary, a keyword outcome at any ABV', () => {
    for (const abv of [undefined, 0.43]) {
      const result = mapSourceCategory('Spirits', abv);
      expect(result, `spirits at abv ${abv} must map`).toEqual({
        canonicalCategory: 'spirits',
        taxCategory: 'spirits',
      });
      // Keyword outcome, never a boundary-rule re-assignment.
      expect(result!.boundaryApplied, `spirits at ${abv}`).toBeUndefined();
    }
  });

  it('maps "Birra" to beer — the 1.1 census term the probe-page list missed', () => {
    expect(mapSourceCategory('Birra')).toEqual({
      canonicalCategory: 'beer',
      taxCategory: 'beer',
    });
  });

  it('matches the census casing exactly after trim/lowercase — the lowercase stray hits the same key', () => {
    expect(mapSourceCategory('  vino bianco ')).toEqual(mapSourceCategory('Vino Bianco'));
    expect(mapSourceCategory('bollicine')).toEqual(mapSourceCategory('Bollicine'));
  });

  it('changes no existing mapping — the Swedish and Estonian keys behave as before', () => {
    expect(mapSourceCategory('Sprit')).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Punane vein')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
  });

  it('leaves the merch pair and the heterogeneous buckets unmapped — correction queue owns them', () => {
    for (const term of ['Olio', 'Aceto', 'Altro', 'Gadget', 'Buoni regalo', 'Vino']) {
      expect(mapSourceCategory(term, 0.2), `term "${term}" must stay unmapped`).toBeNull();
      expect(mapSourceCategory(term), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — kuhns.shop catalog vocabulary (sweep patch 2026-10-08)', () => {
  it('maps the DE wine and beer terms', () => {
    expect(mapSourceCategory('Wein')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('Bier')).toEqual({
      canonicalCategory: 'beer',
      taxCategory: 'beer',
    });
  });

  it('maps "Sekt" to sparkling wine — kept apart from still wine for the excise split', () => {
    expect(mapSourceCategory('Sekt')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
  });

  it('maps "Whisky" and "Rum" to spirits — keyword outcomes at any ABV', () => {
    for (const term of ['Whisky', 'whisky', 'Rum']) {
      for (const abv of [undefined, 0.46]) {
        const result = mapSourceCategory(term, abv);
        expect(result, `term "${term}" at abv ${abv} must map`).toEqual({
          canonicalCategory: 'spirits',
          taxCategory: 'spirits',
        });
        expect(result!.boundaryApplied, `"${term}" at ${abv}`).toBeUndefined();
      }
    }
  });

  it('the census "Likör" and "Vodka" spellings already map through the existing entries — no new key', () => {
    expect(SWEDISH_SOURCE_CATEGORY_MAP['likör']).toBe('liqueur');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['vodka']).toBe('spirits');
    expect(mapSourceCategory('Likör')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Vodka')).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
  });

  it('matches the census casing and whitespace exactly after trim/lowercase', () => {
    expect(mapSourceCategory('  wein ')).toEqual(mapSourceCategory('Wein'));
    expect(mapSourceCategory('sekt')).toEqual(mapSourceCategory('Sekt'));
  });

  it('changes no existing mapping — the Swedish single-ö "Likör" behaves as before', () => {
    expect(mapSourceCategory('Likör')).toEqual({
      canonicalCategory: 'liqueur',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Viski')).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
  });

  it('leaves the untyped-majority merch and non-beverage terms unmapped — title inference (3.2) owns the rest', () => {
    for (const term of [
      'Bio Direktsaft',
      'Apfelsaft',
      'Iced Tea',
      'Wasser',
      'Limo',
      'Bundle',
      'giftbox_ghost_product',
      'Apfelwein',
      'champangne',
      'Portwein',
    ]) {
      expect(mapSourceCategory(term, 0.2), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — lmdw/whisky.fr m3 vocabulary (sweep patch 2026-10-08, onboard-lmdw-crawl-merchant 2.1)', () => {
  it('maps the whisky family spellings to spirits — keyword outcomes at any ABV', () => {
    for (const term of [
      'Single Malt Whisky',
      'Blended Whisky',
      'Blended Malt Whisky',
      'Single Grain Whisky',
      'single-blended-whisky', // the subfamily's hyphenated census spelling
      'Autres Whisky',
      'Bourbon',
      'Rye Whiskey',
      'Corn Whisky',
      // The bare census spelling rides the existing kuhns key:
      'Whisky',
    ]) {
      for (const abv of [undefined, 0.43]) {
        const result = mapSourceCategory(term, abv);
        expect(result, `term "${term}" at abv ${abv} must map`).toEqual({
          canonicalCategory: 'spirits',
          taxCategory: 'spirits',
        });
        // Keyword outcomes at any ABV — never boundary-rule re-assignments.
        expect(result!.boundaryApplied, `"${term}" at ${abv}`).toBeUndefined();
      }
    }
  });

  it('maps the rhum family spellings to spirits — the FR "rh" forms are distinct keys from "rum"', () => {
    for (const term of ['Rhum', 'Rhum Agricole', 'Agricole Rum', 'Rhum Pur Jus de Canne', 'Clairin', 'Cachaca']) {
      const result = mapSourceCategory(term);
      expect(result, `term "${term}" must map`).toEqual({
        canonicalCategory: 'spirits',
        taxCategory: 'spirits',
      });
    }
    expect(SWEDISH_SOURCE_CATEGORY_MAP['rhum']).toBe('spirits');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['rum']).toBe('spirits');
  });

  it('maps the gin/tequila/vodka family compounds to spirits — bare forms already resolve', () => {
    for (const term of [
      'Distilled Gin',
      'London Dry Gin',
      'Old Tom Gin',
      'Autres Gin',
      'Tequila 100% Agave',
      'Mezcal',
      'Vodka de Cereale',
      'Vodka de Pomme de Terre',
      'Vodka Aromatisee',
      // Bare census spellings through the existing keys / normalizeCategory:
      'Gin',
      'Vodka',
      'Tequila',
    ]) {
      const result = mapSourceCategory(term);
      expect(result, `term "${term}" must map`).toEqual({
        canonicalCategory: 'spirits',
        taxCategory: 'spirits',
      });
    }
  });

  it('maps the bitters/amaro family to spirits at any ABV — the keyword-family rule', () => {
    for (const term of ['Amers', 'Bitters Cocktails', 'Autres Amers', 'Amaro']) {
      for (const abv of [undefined, 0.05, 0.58]) {
        const result = mapSourceCategory(term, abv);
        expect(result, `term "${term}" at abv ${abv} must map`).toEqual({
          canonicalCategory: 'spirits',
          taxCategory: 'spirits',
        });
      }
    }
  });

  it('maps the brandy plurals and the residual spirit terms to spirits', () => {
    for (const term of [
      'Armagnacs', // FR plural; 'armagnac' does not match it
      'Cognacs', // FR plural; 'cognac' does not match it
      'Autres Spiritueux', // "other spirits" — self-identifying
      'Aquavit de Pomme de Terre', // 'aquavit' itself resolves in normalizeCategory
      'Absinthe',
      'Absinthe Blanche',
      'Pastis',
      'Anises',
      'Sambuka', // census spelling [sic] of sambuca
      'Shochu',
      'Shochu de Patate Douce',
      'Eaux de Vie de Fruits',
      'Eaux de Vie de Plantes',
      'Autres Eaux de Vie de Pomme & de Poire',
      'Autres Eaux de Vie de Canne',
    ]) {
      const result = mapSourceCategory(term);
      expect(result, `term "${term}" must map`).toEqual({
        canonicalCategory: 'spirits',
        taxCategory: 'spirits',
      });
    }
  });

  it('maps the liqueur family plurals and compounds to the canonical liqueur category', () => {
    for (const term of [
      'Liqueurs',
      'Autres Liqueurs',
      "Liqueurs d'Agrumes",
      'Liqueurs Herbales',
      'Liqueurs de Fleurs',
      'Liqueurs de Whisky',
      'Liqueurs de Fruits',
      'Cremes',
      'Cremes de Fruits',
    ]) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'liqueur',
        taxCategory: 'spirits',
      });
    }
  });

  it('maps "Sakes" and the sake subfamilies to the canonical sake category — the taxonomy has a sake home', () => {
    expect(mapSourceCategory('Sakes')).toEqual({
      canonicalCategory: 'sake',
      taxCategory: 'other_fermented',
    });
    for (const term of [
      'Sake Moderne',
      'sake-moderne', // the subfamily's hyphenated census spelling — a distinct key
      'Sake Nature',
      'sake-nature',
      'Sake Traditionnel Eau',
      'sake-traditionnel-eau',
      'Sake Traditionnel Riz',
      'sake-traditionnel-riz',
      'Sake Vintage',
      'sake-vintage',
      'Sake Sparkling',
      'sake-sparkling',
    ]) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'sake',
        taxCategory: 'other_fermented',
      });
    }
    // The 22 % boundary bounds the fermented bucket exactly like the
    // singular 'Sake' keyword path:
    expect(mapSourceCategory('Sakes', 0.22)!.taxCategory).toBe('other_fermented');
    expect(mapSourceCategory('sake-moderne', 0.41)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    });
  });

  it('maps the beer, wine, sparkling and fortified families to their own categories', () => {
    expect(mapSourceCategory('Bieres')).toEqual({ canonicalCategory: 'beer', taxCategory: 'beer' });
    expect(mapSourceCategory('Pale Ale')).toEqual({ canonicalCategory: 'beer', taxCategory: 'beer' });
    expect(mapSourceCategory('Vins Tranquilles')).toEqual({
      canonicalCategory: 'wine',
      taxCategory: 'wine_still',
    });
    expect(mapSourceCategory('Vins Effervescents')).toEqual({
      canonicalCategory: 'sparkling-wine',
      taxCategory: 'wine_sparkling',
    });
    for (const term of [
      'Porto',
      'Xeres',
      'Vins Fortifies',
      'Vins Fortifies Aromatises',
      'Vins de Liqueur',
      'Vins Mutes',
      'Pineau des Charentes',
      'Vermouth Rouge',
      'Aperitivo', // the Italian spelling of the fortified 'aperitif' family
    ]) {
      expect(mapSourceCategory(term), `term "${term}" must map`).toEqual({
        canonicalCategory: 'fortified-wine',
        taxCategory: 'intermediate_products',
      });
    }
    // Census spellings that already resolve — 'vermouth' fortified,
    // 'champagne' sparkling:
    expect(mapSourceCategory('Vermouth')!.canonicalCategory).toBe('fortified-wine');
    expect(mapSourceCategory('Champagne')!.canonicalCategory).toBe('sparkling-wine');
  });

  it('maps "Punch au rhum" to long-drink — the premixed RTD home, bounded at 22 %', () => {
    expect(mapSourceCategory('Punch au Rhum')).toEqual({
      canonicalCategory: 'long-drink',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Punch au Rhum', 0.3)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    });
  });

  it('maps the non-alcoholic census terms to non-alcoholic — one tax family', () => {
    // The census spells this one uppercase; matching lowercases.
    expect(mapSourceCategory('BOISSONS SANS ALCOOL')).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Spiritueux sans alcool')!.canonicalCategory).toBe('non-alcoholic');
    expect(mapSourceCategory('Sodas')!.canonicalCategory).toBe('non-alcoholic');
    // The non-alcoholic guard passes its own category through without a hold:
    expect(mapSourceCategory('BOISSONS SANS ALCOOL', 0)).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
    });
  });

  it('matches the census casing and whitespace exactly after trim/lowercase', () => {
    expect(mapSourceCategory('  boissons sans alcool ')).toEqual(mapSourceCategory('BOISSONS SANS ALCOOL'));
    expect(mapSourceCategory('  Liqueurs ')).toEqual(mapSourceCategory('liqueurs'));
    expect(mapSourceCategory('tequila 100% agave')).toEqual(mapSourceCategory('Tequila 100% Agave'));
  });

  it('changes no existing mapping — the kuhns/mydrink keys still carry the bare census spellings', () => {
    expect(SWEDISH_SOURCE_CATEGORY_MAP['whisky']).toBe('spirits');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['gin']).toBe('spirits');
    expect(SWEDISH_SOURCE_CATEGORY_MAP['vodka']).toBe('spirits');
    expect(mapSourceCategory('Whisky')).toEqual({ canonicalCategory: 'spirits', taxCategory: 'spirits' });
    expect(mapSourceCategory('Vermutti')).toEqual({
      canonicalCategory: 'fortified-wine',
      taxCategory: 'intermediate_products',
    });
    expect(mapSourceCategory('Siider')).toEqual({
      canonicalCategory: 'cider',
      taxCategory: 'other_fermented',
    });
  });

  it('leaves the division, navigation and merch labels unmapped — the correction queue owns them', () => {
    for (const term of [
      'liquide', // m3_division — no beverage type, 291 pages
      'solide', // m3_division — the food/merch branch
      'Types de produit', // generic navigation family
      'Verres', // glassware
      'Verres de Degustation',
      'Bartools',
      'Autres Bartools',
      'Magazine',
      'Sirops/Cordials', // cocktail syrups — the alks 'Siirappi' precedent
      'SPICED', // a bare adjective, no beverage family on its own
      'Autres Alcools Sucrees', // heterogeneous bucket — 'lahja alkohol' precedent
      // Design D3's gift-box rule, attested nowhere in this sample but kept:
      'Coffret Cadeau',
    ]) {
      expect(mapSourceCategory(term, 0.2), `term "${term}" must stay unmapped`).toBeNull();
      expect(mapSourceCategory(term), `term "${term}" must stay unmapped`).toBeNull();
    }
  });

  it('rejects near-miss spellings — exact matching, no accent/casing/apostrophe forgiveness', () => {
    for (const term of [
      'boisson sans alcool', // singular — the census label is the plural
      'vodka de céréale', // accented — the census spelling is unaccented
      'tequila 100 % agave', // space before the % — the census has none
      'single malt whiskies', // over-pluralized
      'whisky single malt', // word order — controlled vocabulary, not free text
      'rhum vieux',
      'liqueurs d\u2019agrumes', // typographic apostrophe — the census one is ASCII
      'xérès', // accented — the census spelling is unaccented
      'punch rhum', // dropped "au"
    ]) {
      expect(mapSourceCategory(term, 0.2), `term "${term}" must stay unmapped`).toBeNull();
    }
  });
});

describe('mapSourceCategory — unmappable categories', () => {
  it('returns null for an unrecognized string — flagged, never fallback-assigned', () => {
    expect(mapSourceCategory('Kaffe')).toBeNull();
    expect(mapSourceCategory('melon-flavoured something')).toBeNull();
  });

  it('returns null for an empty or whitespace-only string', () => {
    expect(mapSourceCategory('')).toBeNull();
    expect(mapSourceCategory('   ')).toBeNull();
  });
});

describe('isKnownTaxCategory', () => {
  it('accepts the canonical tax keys', () => {
    for (const key of TAX_CATEGORY_KEYS) {
      expect(isKnownTaxCategory(key)).toBe(true);
    }
  });

  it('rejects non-members', () => {
    expect(isKnownTaxCategory('wine')).toBe(false);
    expect(isKnownTaxCategory('unknown')).toBe(false);
  });
});

describe('mapSourceCategory — spirit-family keywords (task 1.1, first-impression-pass)', () => {
  it('maps every spirit-family spelling to spirits at any ABV', () => {
    for (const term of [
      'Bitter',
      'Bitteri',
      'Bitterit',
      'Katkero',
      'Katkerot',
      'Snaps',
      'Snapsi',
      'Brannvin',
      'Sambuca',
      'Arrak',
      'Akvaviitit',
      // Already-mapped family members keep working:
      'Akvavit',
      'Aquavit',
      'Akvaviitti',
      'Bitters',
    ]) {
      for (const abv of [undefined, 0.05, 0.58]) {
        const result = mapSourceCategory(term, abv);
        expect(result, `term "${term}" at abv ${abv} must map`).not.toBeNull();
        expect(result!.canonicalCategory, `"${term}" at ${abv}`).toBe('spirits');
        expect(result!.taxCategory, `"${term}" at ${abv}`).toBe('spirits');
      }
    }
  });

  it('attributes keyword outcomes to the keyword, never the boundary rule', () => {
    // A 58 % arrak is spirits because the keyword says so:
    expect(mapSourceCategory('Arrak', 0.58)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
    });
    expect(mapSourceCategory('Sambuca', 0.38)!.boundaryApplied).toBeUndefined();
  });
});

describe('mapSourceCategory — the 22 % intermediate-products boundary (design D1)', () => {
  it('keeps a fermented-bucket keyword outcome at exactly 22 % — the boundary is inclusive', () => {
    expect(mapSourceCategory('Muut juomat', 0.22)).toEqual({
      canonicalCategory: 'other',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Siideri', 0.22)!.taxCategory).toBe('other_fermented');
  });

  it('re-assigns a fermented-bucket keyword outcome to spirits just above the boundary', () => {
    // 22.0001 % — the task-pinned boundary value:
    expect(mapSourceCategory('Muut juomat', 0.220001)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    });
  });

  it('bounds every keyword path into the fermented bucket — the live misclassification families', () => {
    // Source strings measured on the live misclassified rows:
    expect(mapSourceCategory('Muut juomat', 0.41)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    }); // Aalborg Taffel Akvavit 41 %, 1-ENKELT Bitter 35 %
    expect(mapSourceCategory('Other drinks', 0.432)!.boundaryApplied).toBe(true); // Montelobos Mezcal 43.2 %
    expect(mapSourceCategory('Juomasekoitus', 0.25)!.boundaryApplied).toBe(true); // Smirnoff Crush 25 %
    expect(mapSourceCategory('Siideri', 0.3)!.canonicalCategory).toBe('spirits');
    expect(mapSourceCategory('Lonkero', 0.3)!.taxCategory).toBe('spirits');
    expect(mapSourceCategory('Sake', 0.41)!.boundaryApplied).toBe(true);
    // Honest non-alcoholic keywords cannot outvote the ABV either:
    expect(mapSourceCategory('Alkoholivaba ▾', 0.41)!.taxCategory).toBe('spirits');
  });

  it('resolves an unmapped string to spirits under the boundary rule above 22 %', () => {
    // Above 22 % a fermented bucket is not lawful, so "unknown" is
    // spirits by taxonomy law — not a guess. Attributable:
    expect(mapSourceCategory('Kaffe', 0.45)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    });
  });

  it('still queues unmapped strings at or below the boundary — the correction queue owns them', () => {
    expect(mapSourceCategory('Kaffe', 0.22)).toBeNull();
    expect(mapSourceCategory('Kaffe')).toBeNull();
    // An empty string is structural — no source string at all — and
    // stays null at any ABV.
    expect(mapSourceCategory('', 0.45)).toBeNull();
  });

  it('does not touch outcomes that are not the fermented bucket', () => {
    // The guard bounds the fermented bucket only; beer, wines and
    // fortified wines key on their own duty categories.
    expect(mapSourceCategory('Olut', 0.41)!.taxCategory).toBe('beer');
    expect(mapSourceCategory('Viini', 0.41)!.taxCategory).toBe('wine_still');
    expect(mapSourceCategory('Vermutti', 0.41)!.taxCategory).toBe('intermediate_products');
    expect(mapSourceCategory('Viski', 0.41)!.boundaryApplied).toBeUndefined();
  });

  it('rejects a wrong-scale ABV instead of silently re-keying every row', () => {
    // 41 as a percentage-scale value must throw, not read as 41 × the
    // boundary and flip every mapping to spirits.
    expect(() => mapSourceCategory('Olut', 41)).toThrow(RangeError);
    expect(() => mapSourceCategory('Olut', -0.1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
// design D3) — category eligibility: a keyed-zero or unparseable (null)
// ABV can never be placed in a typed alcohol category
// ---------------------------------------------------------------------------

describe('mapSourceCategory — non-alcoholic ingestion guard (nonalcoholic-catalog-hygiene)', () => {
  it('re-keys a typed alcohol outcome to non-alcoholic on a keyed-zero ABV, attributable', () => {
    expect(mapSourceCategory('Olut', 0)).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
      nonAlcoholicHold: true,
    });
    expect(mapSourceCategory('Siideri', 0)!.nonAlcoholicHold).toBe(true);
    expect(mapSourceCategory('Viski', 0)!.canonicalCategory).toBe('non-alcoholic');
  });

  it('re-keys on an unparseable ABV (null — the adapters\u2019 explicit value)', () => {
    expect(mapSourceCategory('Olut', null)).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
      nonAlcoholicHold: true,
    });
  });

  it('stays unkeyed when no ABV was offered (undefined) — historical outcome stands', () => {
    expect(mapSourceCategory('Olut')).toEqual({
      canonicalCategory: 'beer',
      taxCategory: 'beer',
    });
  });

  it('any ABV above zero keeps the keyword outcome entirely', () => {
    expect(mapSourceCategory('Olut', 0.0001)).toEqual({
      canonicalCategory: 'beer',
      taxCategory: 'beer',
    });
  });

  it('non-alcoholic and explicit-other outcomes pass through without a hold', () => {
    expect(mapSourceCategory('Energiajuomat', 0)).toEqual({
      canonicalCategory: 'non-alcoholic',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Muut juomat', 0)).toEqual({
      canonicalCategory: 'other',
      taxCategory: 'other_fermented',
    });
    expect(mapSourceCategory('Alkoholfritt', null)!.nonAlcoholicHold).toBeUndefined();
  });

  it('never fights the boundary rule — above 22 % the ABV is above zero anyway', () => {
    expect(mapSourceCategory('Muut juomat', 0.41)).toEqual({
      canonicalCategory: 'spirits',
      taxCategory: 'spirits',
      boundaryApplied: true,
    });
  });
});
