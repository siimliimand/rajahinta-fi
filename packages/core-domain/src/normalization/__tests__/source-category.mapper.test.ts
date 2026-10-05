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
