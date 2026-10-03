/**
 * Alko storefront adapter tests (change
 * data-quality-and-publication-trust).
 *
 * The golden fixture IS the payload contract, rebuilt from the live
 * alko.fi storefront search API (2026-09-30 sweep, 11,307 rows): these
 * assertions pin the parser's exact output so any drift — a contract
 * change on the storefront's side — fails here instead of corrupting
 * the domestic reference data.
 *
 * Also pins the governance-relevant behaviour: the skip/@odata.count
 * page walk (sequential, capped, page-level failures collected instead
 * of thrown), the data-driven group-token tables covering the probed
 * live vocabulary, EAN-less records (the storefront carries no EAN),
 * per-item rejection of unmappable groups and price-less rows, and
 * EUR-native provenance (no FX version).
 *
 * @module AlkoFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AlkoFeedAdapter,
  parseAlkoAssortment,
  ALKO_PRODUCT_GROUP_CATEGORY,
  ALKO_MAIN_GROUP_CATEGORY,
  ALKO_PACKAGE_CONTAINER,
  ALKO_UNMAPPED_GROUPS,
} from '../adapters/alko.adapter';
import {
  ALKO_GOLDEN_PAYLOAD,
  ALKO_GOLDEN_ROWS,
} from '../adapters/__fixtures__/alko-assortment.fixture';
import { mapSourceCategory } from '@rajahinta/core-domain';
import type { SourceGovernanceService, PermissionCheckResult } from '@rajahinta/core-domain';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import { FeedIngestionService } from '../services/feed-ingestion.service';
import { DataMappingService } from '../services/data-mapping.service';
import { DataQualityService } from '../services/data-quality.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { ContentLintService } from '../content/content-lint.service';
import type { IUpsertRepository } from '../interfaces/upsert-port.interface';

const CONFIG = {
  feedUrl: 'https://www.alko.fi/api/search/product?lang=fi',
  feedFormat: 'json' as const,
};

// ---------------------------------------------------------------------------
// Store API stub — one spec per skip offset, defaults for the rest
// ---------------------------------------------------------------------------

interface PageSpec {
  status?: number;
  statusText?: string;
  payload?: unknown;
  jsonError?: Error;
  networkError?: Error;
}

function stubSearchApi(
  pageSpecs: Record<number, PageSpec>,
  defaultSpec: PageSpec = {},
): { fetchMock: ReturnType<typeof vi.fn>; calls: Array<{ skip: number; top: number }> } {
  const calls: Array<{ skip: number; top: number }> = [];
  const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { skip?: number; top?: number };
    const skip = body.skip ?? 0;
    calls.push({ skip, top: body.top ?? -1 });
    const spec: PageSpec = { ...defaultSpec, ...pageSpecs[skip] };
    if (spec.networkError) throw spec.networkError;
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: spec.statusText ?? 'OK',
      json: async () => {
        if (spec.jsonError) throw spec.jsonError;
        return spec.payload ?? { '@odata.count': 0, value: [] };
      },
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** A minimal valid storefront row; every generated row parses cleanly. */
function storeRow(globalIndex: number): Record<string, unknown> {
  return {
    id: String(700000 + globalIndex),
    name: 'Bulk Beer 4,7%',
    abv: 4.7,
    price: 2.19,
    volume: 0.33,
    mainGroupName: ['panimotuotteet'],
    productGroupName: ['oluet'],
    packageTypes: ['packageTypeId|packageType_tölkki|tölkki'],
    countryName: 'Suomi',
    webshopStock: 10,
  };
}

/** Pages of 200 rows up to totalProducts, @odata.count on page 1. */
function fullCatalogPages(totalProducts: number): Record<number, PageSpec> {
  const pages: Record<number, PageSpec> = {};
  for (let skip = 0; skip < totalProducts; skip += 200) {
    const start = skip;
    const length = Math.min(200, totalProducts - start);
    pages[skip] = {
      payload: {
        '@odata.count': totalProducts,
        value: Array.from({ length }, (_, i) => storeRow(start + i)),
      },
    };
  }
  return pages;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Golden dataset
// ---------------------------------------------------------------------------

describe('parseAlkoAssortment — golden dataset', () => {
  const { records, errors } = parseAlkoAssortment(ALKO_GOLDEN_PAYLOAD);

  it('maps every well-formed golden row — 10 records, 2 per-item rejections', () => {
    expect(records).toHaveLength(10);
    expect(errors).toHaveLength(2);
  });

  it('produces exactly these canonical records (category → EUR cents)', () => {
    expect(records).toEqual([
      // Beer: plural "oluet" → historical "olut" → tax beer; percent ABV →
      // fraction, litres → ml, tölkki → can.
      expect.objectContaining({ productId: '700439', category: 'beer', priceCents: 219, alcoholByVolume: 0.047, volumeMl: 330, containerType: 'can', regulatoryClassification: 'beer' }),
      expect.objectContaining({ productId: '001793', category: 'wine_still', priceCents: 1048, alcoholByVolume: 0.135, volumeMl: 750, containerType: 'bottle' }),
      expect.objectContaining({ productId: '000312', category: 'wine_sparkling', priceCents: 4498, alcoholByVolume: 0.12 }),
      expect.objectContaining({ productId: '009038', category: 'spirits', priceCents: 1699, alcoholByVolume: 0.4 }),
      expect.objectContaining({ productId: '003145', category: 'other_fermented', priceCents: 199 }),
      expect.objectContaining({ productId: '004361', category: 'other_fermented', priceCents: 249 }),
      // Liqueur shares the spirits tax key.
      expect.objectContaining({ productId: '006102', category: 'spirits', priceCents: 1298, alcoholByVolume: 0.17 }),
      // Zero-ABV non-alcoholic beer.
      expect.objectContaining({ productId: '006857', category: 'other_fermented', priceCents: 129, alcoholByVolume: 0 }),
      // Merged productGroup bucket resolves through the välituotteet fallback.
      expect.objectContaining({ productId: '003591', category: 'intermediate_products', priceCents: 1298, alcoholByVolume: 0.175 }),
      // Unmapped 'grapat' resolves through its sibling leaf (gin family).
      expect.objectContaining({ productId: '904045', category: 'spirits', priceCents: 4174 }),
    ]);
  });

  it('carries EUR-native provenance: original equals canonical, no FX version', () => {
    for (const record of records) {
      expect(record.currency).toBe('EUR');
      expect(record.originalCurrency).toBe('EUR');
      expect(record.originalPriceCents).toBe(record.priceCents);
      expect(record.fxDatasetVersion).toBeUndefined();
    }
  });

  it('keeps every record EAN-less with the no-pantti flag — the storefront carries no EAN', () => {
    for (const record of records) {
      expect(record.ean).toBeNull();
      expect(record.depositSystem).toBe(false);
    }
  });

  it('leaves manufacturer and brand empty — the storefront carries neither field', () => {
    for (const record of records) {
      expect(record.manufacturer).toBe('');
      expect(record.brand).toBe('');
    }
  });

  it('derives availability from webshopStock', () => {
    expect(records.find((r) => r.productId === '700439')?.availability).toBe('in_stock');
    expect(records.find((r) => r.productId === '000312')?.availability).toBe('out_of_stock');
  });

  it('has no product page URL in the payload — sourceUrl stays null', () => {
    for (const record of records) {
      expect(record.sourceUrl).toBeNull();
    }
  });

  it('rejects the unmappable accessory group per-item to the correction queue', () => {
    expect(errors[0]).toContain('833275');
    expect(errors[0]).toContain('juomatarvikkeet');
    expect(errors[0]).toContain('correction queue');
  });

  it('rejects a price-less row per-item', () => {
    expect(errors[1]).toContain('833310');
    expect(errors[1]).toContain('invalid price');
  });

  it('golden fixture stays exhaustive — every fixture row appears once', () => {
    const mapped = new Set(records.map((r) => r.productId));
    const rejected = new Set(
      errors.map((e) => e.match(/product ([^:\s]+)/)?.[1]).filter(Boolean),
    );
    for (const row of ALKO_GOLDEN_ROWS) {
      expect(mapped.has(row.id) || rejected.has(row.id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Parser contract guards
// ---------------------------------------------------------------------------

describe('parseAlkoAssortment — contract guards', () => {
  it('rejects a non-object payload', () => {
    const { records, errors } = parseAlkoAssortment('<html>Azure WAF challenge</html>');
    expect(records).toEqual([]);
    expect(errors).toEqual([expect.stringContaining('not a JSON object')]);
  });

  it('rejects payloads without a value array (whole-page failure, no throw)', () => {
    const { records, errors } = parseAlkoAssortment({ error: 'rest_no_route' });
    expect(records).toEqual([]);
    expect(errors).toEqual([expect.stringContaining('no value array')]);
  });

  it('availability is unknown when webshopStock is absent', () => {
    const { records } = parseAlkoAssortment({
      '@odata.count': 1,
      value: [{
        id: '1',
        name: 'Mystery',
        abv: 5,
        price: 1,
        volume: 0.33,
        productGroupName: ['oluet'],
        mainGroupName: ['panimotuotteet'],
      }],
    });
    expect(records[0].availability).toBe('unknown');
  });
});

describe('parseAlkoAssortment — ABV-guarded category (first-impression-pass 1.2)', () => {
  // The storefront payload carries ABV in PERCENT; 'juomasekoitukset'
  // resolves to the long-drink bucket (other_fermented below the 22 %
  // boundary) — an above-boundary row in that group is the audited
  // misclassification shape.
  const guardRow = (overrides: Record<string, unknown> = {}) => ({
    id: '990001',
    name: 'Long Drink 41%',
    abv: 41,
    price: 3.49,
    volume: 0.5,
    productGroupName: ['juomasekoitukset'],
    mainGroupName: ['panimotuotteet'], // deliberately unmapped at main level
    packageTypes: ['packageTypeId|packageType_tölkki|tölkki'],
    webshopStock: 5,
    ...overrides,
  });

  const parseOne = (row: Record<string, unknown>) =>
    parseAlkoAssortment({ '@odata.count': 1, value: [row] });

  it('above-boundary long-drink group (41 %) re-keys to spirits — the 00:00 UTC cron cannot re-misclassify', () => {
    const { records, errors } = parseOne(guardRow());
    expect(errors).toEqual([]);
    expect(records[0].category).toBe('spirits');
    expect(records[0].regulatoryClassification).toBe('spirits');
    expect(records[0].alcoholByVolume).toBe(0.41);
  });

  it('ABV absent leaves the guard unkeyed — the fermented bucket stands (honest unknown)', () => {
    const { records, errors } = parseOne(guardRow({ abv: undefined }));
    expect(errors).toEqual([]);
    expect(records[0].category).toBe('other_fermented');
    expect(records[0].alcoholByVolume).toBeNull();
  });

  it('below-boundary long-drink group keeps the honest fermented bucket', () => {
    const { records, errors } = parseOne(guardRow({ name: 'Long Drink 5,5%', abv: 5.5 }));
    expect(errors).toEqual([]);
    expect(records[0].category).toBe('other_fermented');
    expect(records[0].alcoholByVolume).toBe(0.055);
  });

  it('an ABV over 100 is garbage in either scale — the guard is never fed it and nothing throws', () => {
    const { records, errors } = parseOne(guardRow({ abv: 145 }));
    expect(errors).toEqual([]);
    // Category resolves without the boundary; the record carries the raw
    // ABV for the existing downstream validation to judge.
    expect(records[0].category).toBe('other_fermented');
    expect(records[0].alcoholByVolume).toBe(1.45);
  });
});

// ---------------------------------------------------------------------------
// Sequential skip/@odata.count pagination
// ---------------------------------------------------------------------------

describe('AlkoFeedAdapter — sequential pagination', () => {
  it('spec: 450 products → 3 pages requested in order, union returned', async () => {
    const { fetchMock, calls } = stubSearchApi(fullCatalogPages(450));
    const adapter = new AlkoFeedAdapter();

    expect(adapter.merchantId).toBe('alko');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.map((c) => c.skip)).toEqual([0, 200, 400]);
    for (const call of calls) {
      expect(call.top).toBe(200);
    }
    // POST to the registry-configured feedUrl, storefront body shape.
    expect(fetchMock.mock.calls[0][0]).toBe(CONFIG.feedUrl);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      filters: [],
      skip: 0,
      top: 200,
    });
    expect(records).toHaveLength(450);
    expect(errors).toEqual([]);
    expect(records[0]).toMatchObject({ productId: '700000', priceCents: 219 });
    expect(records[449]).toMatchObject({ productId: '700449' });
  });

  it('spec: page at skip 200 HTTP 500 — error appended, walk continues, successful pages returned', async () => {
    const specs = fullCatalogPages(450);
    specs[200] = { status: 500, statusText: 'Internal Server Error' };
    const { calls } = stubSearchApi(specs);

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(calls.map((c) => c.skip)).toEqual([0, 200, 400]);
    // 250 rows from the successful pages — the failed page's 200 are
    // the only ones lost.
    expect(records).toHaveLength(250);
    expect(errors).toEqual([
      expect.stringContaining('skip 200'),
    ]);
    expect(errors[0]).toContain('HTTP 500');
  });

  it('a whole-payload failure on the first page is errors[] and never a throw', async () => {
    // A 500 comes back as a WAF/HTML error page — unusable JSON, no count.
    stubSearchApi({
      0: {
        status: 500,
        statusText: 'Internal Server Error',
        jsonError: new Error('Unexpected token < in JSON'),
      },
    });

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(records).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no usable @odata.count');
    expect(errors[0]).toContain('HTTP 500');
  });

  it('a missing @odata.count stops after the first page whose rows still count', async () => {
    stubSearchApi({
      0: { payload: { value: [storeRow(1), storeRow(2)] } },
    });

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2);
    expect(errors).toEqual([
      expect.stringContaining('no usable @odata.count'),
    ]);
  });

  it('a network failure on the first page does not throw', async () => {
    stubSearchApi({ 0: { networkError: new Error('connection reset') } });

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(records).toEqual([]);
    expect(errors).toEqual([
      expect.stringContaining('fetch failed: connection reset'),
    ]);
  });

  it('invalid JSON on a later page is a collected error; earlier pages still count', async () => {
    stubSearchApi(
      {
        0: { payload: { '@odata.count': 450, value: [storeRow(0)] } },
        200: { jsonError: new Error('Unexpected token < in JSON') },
        400: { payload: { '@odata.count': 450, value: [storeRow(401)] } },
      },
    );

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2);
    expect(errors).toEqual([
      expect.stringContaining('returned invalid JSON'),
    ]);
    expect(errors[0]).toContain('skip 200');
  });

  it('an empty page while the count claims more rows stops the walk with an error', async () => {
    stubSearchApi({
      0: { payload: { '@odata.count': 1000, value: [storeRow(0)] } },
      200: { payload: { '@odata.count': 1000, value: [] } },
    });

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('returned no rows although @odata.count is 1000'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Data-driven group-token tables vs the probed live vocabulary
// ---------------------------------------------------------------------------

describe('ALKO group-token tables vs the probed live catalog', () => {
  // The complete distinct productGroupName values from the 2026-09-30
  // full-catalog sweep (11,307 rows, 83 distinct values), verbatim.
  const PROBED_PRODUCT_GROUPS = [
    'akvaviitit', 'alkoholipitoiset makeiset ja muut alkoholituotteet',
    'alkoholittomat', 'alkoholittomat kuohuviinit', 'alkoholittomat oluet',
    'alkoholittomat punaviinit', 'alkoholittomat siiderit',
    'alkoholittomat valko- ja roseeviinit', 'amerikkalaiset viskit',
    'anistisleet', 'armanjakit', 'aromatisoidut viinit', 'blended-viskit',
    'brandyt', 'brandyt, armanjakit ja calvadosit', 'calvadosit', 'ginit',
    'ginit ja maustetut viinat', 'glögit', 'grapat', 'grogikatkerot',
    'hanapakkaukset', 'hedelmä- ja aromatisoidut viinit',
    'hedelmäkuohuviinit', 'hedelmäliköörit', 'hedelmätisleet',
    'juomasekoitukset', 'juomatarvikkeet', 'jälkiruokaviinit',
    'jälkiruokaviinit, väkevöidyt ja muut viinit', 'kahviliköörit',
    'katkerot', 'kermaliköörit', 'konjakit', 'kuohuviinit',
    'kuohuviinit ja samppanjat', 'lahjapakkaaminen', 'liköörit',
    'liköörit ja katkerot', 'long drink', 'madeirat',
    'maha- ja maustekatkerot', 'mallasviskit', 'marjaliköörit',
    'mausteliköörit', 'maustettu long drink', 'maustetut viinat',
    'maustetut vodkat', 'mikserit', 'muut konjakit', 'muut viinijuomat',
    'muut viinit', 'muut viskit', 'oluet', 'ostospakkaaminen',
    'portviinit', 'punaviinit', 'ready to drink', 'rommit',
    'roseekuohuviini', 'roseesamppanja', 'roseeviinit', 'saket',
    'salmiakkiliköörit', 'samppanjat', 'sherryt', 'siiderit', 'Tequilat',
    'Tumma rommi', 'vaalea rommi', 'valkoviinit',
    'vedet, mehut ja muut alkoholittomat', 'vermutit', 'viina',
    'viinijuomat', 'viskit', 'vodka', 'vodkat ja viinat', 'vs-konjakit',
    'vsop-konjakit', 'väkevät viinit', 'xo-konjakit', 'yrttiliköörit',
  ];

  // The complete distinct mainGroupName values (6).
  const PROBED_MAIN_GROUPS = [
    'alkoholittomat', 'lahja- ja juomatarvikkeet', 'panimotuotteet',
    'viinit', 'väkevät', 'välituotteet',
  ];

  // The complete distinct packageTypes last segments (11).
  const PROBED_PACKAGE_SEGMENTS = [
    'hanapakkaus', 'kartonkitölkki', 'keraaminen pullo', 'lasipullo',
    'lasipurkki', 'muovipullo', 'muu', 'paperipullo', 'pullo', 'tölkki',
    'viinipussi',
  ];

  it('every mapped token resolves through mapSourceCategory — no dead table rows', () => {
    for (const singular of Object.values(ALKO_PRODUCT_GROUP_CATEGORY)) {
      expect(mapSourceCategory(singular)).not.toBeNull();
    }
    for (const singular of Object.values(ALKO_MAIN_GROUP_CATEGORY)) {
      expect(mapSourceCategory(singular)).not.toBeNull();
    }
  });

  it('covers the probed productGroup vocabulary minus the documented unmapped set', () => {
    const known = new Set(Object.keys(ALKO_PRODUCT_GROUP_CATEGORY));
    for (const probed of PROBED_PRODUCT_GROUPS) {
      const key = probed.trim().toLowerCase();
      expect(known.has(key) || ALKO_UNMAPPED_GROUPS.includes(key)).toBe(true);
    }
  });

  it('covers the probed mainGroup vocabulary minus the documented unmapped set', () => {
    const known = new Set(Object.keys(ALKO_MAIN_GROUP_CATEGORY));
    for (const probed of PROBED_MAIN_GROUPS) {
      const key = probed.trim().toLowerCase();
      expect(known.has(key) || ALKO_UNMAPPED_GROUPS.includes(key)).toBe(true);
    }
  });

  it('every probed package segment maps into the product_master CHECK vocabulary', () => {
    const CHECK_VOCABULARY = new Set([
      'glass', 'plastic', 'metal', 'carton', 'other', 'can', 'bottle',
    ]);
    for (const container of Object.values(ALKO_PACKAGE_CONTAINER)) {
      expect(CHECK_VOCABULARY.has(container)).toBe(true);
    }
    expect(Object.keys(ALKO_PACKAGE_CONTAINER).sort()).toEqual(
      [...PROBED_PACKAGE_SEGMENTS].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Governance-gated pipeline
// ---------------------------------------------------------------------------

describe('Alko through the governance-gated pipeline', () => {
  function grantedGovernance(): SourceGovernanceService {
    return {
      checkPermission: vi.fn().mockResolvedValue({
        merchantId: 'alko',
        permissionStatus: 'GRANTED',
        sources: [{ id: 1 }],
        hasWarnings: false,
      } as unknown as PermissionCheckResult),
    } as unknown as SourceGovernanceService;
  }

  function pipelineWith(
    governance: SourceGovernanceService,
    upsert: IUpsertRepository,
  ): PipelineOrchestratorService {
    const adapters = new Map();
    adapters.set('alko', new AlkoFeedAdapter());
    return new PipelineOrchestratorService(
      new FeedIngestionService(adapters),
      new DataMappingService(),
      new DataQualityService(new ReliabilityService()),
      upsert,
      governance,
      new ContentLintService(),
    );
  }

  const ALKO_REGISTRY_CONFIG = {
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    feedUrl: CONFIG.feedUrl,
    feedFormat: 'json' as const,
    pollingIntervalMs: 3_600_000,
  };

  it('GRANTED: golden offers enter comparison data with reliability status and provenance', async () => {
    stubSearchApi({ 0: { payload: ALKO_GOLDEN_PAYLOAD } });
    const upserts: Array<Record<string, unknown>> = [];
    const upsert: IUpsertRepository = {
      upsertProduct: vi.fn().mockImplementation((_input) => {
        const productId = upserts.length + 1;
        return Promise.resolve({ productId, created: true });
      }),
      upsertOffer: vi.fn().mockImplementation((input) => {
        upserts.push(input as Record<string, unknown>);
        return Promise.resolve({ offerId: upserts.length, changed: true });
      }),
    };

    const report = await pipelineWith(grantedGovernance(), upsert)
      .runForMerchant(ALKO_REGISTRY_CONFIG);

    // 10 well-formed golden rows upserted; the 2 rejected rows surface
    // as fetch errors, never as silent drops.
    expect(report.recordsAdded).toBe(10);
    expect(report.recordsFetched).toBe(10);
    expect(report.errors).toHaveLength(2);
    expect(report.gateResult).toBeUndefined();

    for (const offer of upserts) {
      expect(offer.merchant).toBe('alko');
      expect(offer.country).toBe('FI');
      expect(offer.currency).toBe('EUR');
      expect(offer.reliabilityStatus).toBe('ESTIMATED');
      expect(typeof offer.priceCents).toBe('number');
    }
  });

  it('not GRANTED: the gate skips the domestic reference merchant before any fetch', async () => {
    const { fetchMock } = stubSearchApi({ 0: { payload: ALKO_GOLDEN_PAYLOAD } });
    const upsert: IUpsertRepository = {
      upsertProduct: vi.fn(),
      upsertOffer: vi.fn(),
    };
    const pending = {
      checkPermission: vi.fn().mockResolvedValue({
        merchantId: 'alko',
        permissionStatus: 'PENDING',
        sources: [{ id: 1 }],
        hasWarnings: false,
      } as unknown as PermissionCheckResult),
    } as unknown as SourceGovernanceService;

    const report = await pipelineWith(pending, upsert).runForMerchant(ALKO_REGISTRY_CONFIG);

    expect(report.recordsFetched).toBe(0);
    expect(report.gateResult?.permitted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert.upsertOffer).not.toHaveBeenCalled();
  });
});
