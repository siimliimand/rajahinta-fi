/**
 * Pipeline gate contract over the golden failure-shape fixtures
 * (task 1.4, change data-quality-and-publication-trust).
 *
 * Drives the REAL ingestion pipeline as far as this package's unit
 * suite reaches — alks adapter fetch → parse → map (price floor) →
 * orchestrate (offer-less upsert) — over the golden failure rows in
 * `__fixtures__/ingestion-gate-rejections.fixture.ts`, and asserts for
 * EACH observed failure shape that nothing broken publishes: no zero
 * price becomes an offer, no bundle name becomes a product, no
 * category-implausible volume is normalized away on this layer's watch.
 *
 * Gate-ownership boundary, pinned here as documentation: the
 * volume-ceiling gate itself lives downstream in the api-worker
 * (ingestion-steps.ts `volumeCeilingGateStep`, pre-upsert) and is
 * pinned there against the same incident shapes
 * (ingestion.workflow.test.ts). What data-acquisition owns — and this
 * contract pins — is that the fixture rows reach that boundary in the
 * exact shape the gate keys on: a true per-unit volume, the mapper's
 * own offer rejections intact, and a bundle row held before mapping.
 *
 * @module PipelineGateContractTest
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import { FeedIngestionService } from '../services/feed-ingestion.service';
import { DataMappingService } from '../services/data-mapping.service';
import { DataQualityService } from '../services/data-quality.service';
import { ContentLintService } from '../content/content-lint.service';
import { AlksFeedAdapter } from '../adapters/alks.adapter';
import type { MerchantConfig } from '../interfaces/merchant-config.interface';
import type {
  IUpsertRepository,
  UpsertOfferInput,
  UpsertProductInput,
} from '../interfaces/upsert-port.interface';
import type {
  PermissionCheckResult,
  SourceGovernanceService,
} from '@rajahinta/core-domain';
import { ReliabilityService } from '@rajahinta/core-domain';
import {
  ALKS_GATE_REJECTION_PAYLOAD,
  ALKS_GATE_REJECTION_PRODUCTS,
} from '../__fixtures__/ingestion-gate-rejections.fixture';

// ---------------------------------------------------------------------------
// Fixtures — registry parity with the merchant seed
// ---------------------------------------------------------------------------

const ALKS_REGISTRY_CONFIG: MerchantConfig = {
  merchantId: 'alks',
  name: 'Alks',
  country: 'DE',
  feedUrl: 'https://alks.fi',
  feedFormat: 'json',
  pollingIntervalMs: 86_400_000,
};

const CONTROL = ALKS_GATE_REJECTION_PRODUCTS[0];
const ZERO_PRICE = ALKS_GATE_REJECTION_PRODUCTS[1];
const IMPLAUSIBLE_VOLUME = ALKS_GATE_REJECTION_PRODUCTS[2];
const STACKED = ALKS_GATE_REJECTION_PRODUCTS[3];
const BUNDLE = ALKS_GATE_REJECTION_PRODUCTS[4];

// ---------------------------------------------------------------------------
// Helpers — real pipeline, recording upsert port (alko golden parity)
// ---------------------------------------------------------------------------

/** Serves the fixture payload as the walk's single Store API page. */
function serveFixturePage(payload: readonly unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string): string | null =>
          name.toLowerCase() === 'x-wp-totalpages' ? '1' : null,
      },
      json: async () => payload,
    })),
  );
}

function grantedGovernance(): SourceGovernanceService {
  return {
    checkPermission: vi.fn().mockResolvedValue({
      merchantId: ALKS_REGISTRY_CONFIG.merchantId,
      permissionStatus: 'GRANTED',
      sources: [{ id: 1 }],
      hasWarnings: false,
    } as unknown as PermissionCheckResult),
  } as unknown as SourceGovernanceService;
}

/** Recording upsert port: captures every product/offer that would publish. */
function recordingUpsert(): {
  repo: IUpsertRepository;
  products: UpsertProductInput[];
  offers: UpsertOfferInput[];
} {
  const products: UpsertProductInput[] = [];
  const offers: UpsertOfferInput[] = [];
  const repo = {
    upsertProduct: vi.fn().mockImplementation((input: UpsertProductInput) => {
      products.push(input);
      return Promise.resolve({ productId: products.length, created: true });
    }),
    upsertOffer: vi.fn().mockImplementation((input: UpsertOfferInput) => {
      offers.push(input);
      return Promise.resolve({ offerId: offers.length, changed: true });
    }),
  } as unknown as IUpsertRepository;
  return { repo, products, offers };
}

/**
 * The fixture pipeline, end to end through the real services: adapter
 * fetch (fixture page) → parse → map → orchestrate over a recording
 * upsert port.
 */
async function runFixturePipeline(): Promise<{
  report: Awaited<ReturnType<PipelineOrchestratorService['runForMerchant']>>;
  products: UpsertProductInput[];
  offers: UpsertOfferInput[];
}> {
  serveFixturePage(ALKS_GATE_REJECTION_PAYLOAD);
  const upsert = recordingUpsert();
  const adapters = new Map();
  adapters.set('alks', new AlksFeedAdapter());
  const report = await new PipelineOrchestratorService(
    new FeedIngestionService(adapters),
    new DataMappingService(),
    new DataQualityService(new ReliabilityService()),
    upsert.repo,
    grantedGovernance(),
    new ContentLintService(),
  ).runForMerchant(ALKS_REGISTRY_CONFIG);
  return { report, ...upsert };
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe('pipeline gate contract — golden failure shapes publish nothing (task 1.4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zero price: the product publishes offer-less and the drift error names the source value', async () => {
    const { report, products, offers } = await runFixturePipeline();

    // The product still upserts — offer-less, honestly sorting last.
    expect(
      products.filter((p) => p.name === ZERO_PRICE.name),
    ).toHaveLength(1);

    // Its offer never does: no published offer carries the zero price.
    expect(offers.map((o) => o.priceCents)).not.toContain(0);

    // The rejection rides the run's error collection, naming the gate
    // and the offending source value ("0").
    const drift = report.errors.filter((e) => e.includes('price drift'));
    expect(drift).toHaveLength(2); // zero-price row + the stacked row
    const ruinartDrift = drift.find((e) => e.includes(ZERO_PRICE.name));
    expect(ruinartDrift).toBeDefined();
    expect(ruinartDrift).toContain('"0"');
    expect(ruinartDrift).toContain('offer rejected');
  });

  it('category-implausible volume: the row reaches the storage boundary as a true per-unit 33 l beer — never normalized plausible', async () => {
    const { products, offers } = await runFixturePipeline();

    // The multipack parse feeds the gate the honest reading of the live
    // incident: ONE unit of 33 l (pack count 24) — not 24 × 0,33 l and
    // not 24 × 33 l. 33 l beer is the gate's trigger state.
    const karhu = products.find((p) => p.name === IMPLAUSIBLE_VOLUME.name);
    expect(karhu).toBeDefined();
    expect(karhu?.unitVolume).toBe('33');
    expect(karhu?.unitVolume).not.toBe(String((24 * 330) / 1000));
    expect(karhu?.category).toBe('beer');

    // At this layer the row keeps its offer — by committed design the
    // implausible VOLUME is what must never publish, and withholding it
    // (unavailable encoding + review flag, pre-upsert) is the api-worker
    // volume-ceiling gate's act, pinned there against this same shape.
    expect(offers.some((o) => o.priceCents === 2999)).toBe(true);
  });

  it('bundle name: nothing publishes — held for review, no product with parsed ABV/volume', async () => {
    const { report, products } = await runFixturePipeline();

    // The parser drops the row before mapping: no product record exists,
    // so no arbitrarily parsed ABV/volume pair can publish under a
    // two-product name.
    expect(products.some((p) => p.name === BUNDLE.name)).toBe(false);

    // One row fewer reaches the pipeline than the payload carries.
    expect(report.recordsFetched).toBe(ALKS_GATE_REJECTION_PAYLOAD.length - 1);

    // The hold-for-review error rides the run's error collection.
    const held = report.errors.filter((e) => e.includes('multi-product bundle'));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain(BUNDLE.name);
    expect(held[0]).toContain('held for review');
    expect(held[0]).toContain('correction queue');
  });

  it('the gates hold together: one run, a stacked row failing both gates, no resurrection, control unaffected', async () => {
    const { report, products, offers } = await runFixturePipeline();

    // Row accounting over the whole fixture: 4 parsed (bundle held at
    // parse), 4 products upserted (zero-price + stacked offer-less),
    // 2 offers published (control + volume row), exactly 3 gate errors
    // (1 bundle review + 2 price drifts).
    expect(report.recordsFetched).toBe(4);
    expect(report.recordsAdded).toBe(4);
    expect(offers).toHaveLength(2);
    expect(report.errors).toHaveLength(3);
    expect(report.offersChanged).toBe(2);
    expect(report.qualityReport).toBeDefined();
    expect(report.qualityReport!.totalOffers).toBe(2);

    // The stacked row reaches the boundary with BOTH gate signals on
    // one pair: the implausible per-unit volume (33 l beer) AND the
    // mapper's price-floor rejection — the ceiling gate's copy preserves
    // the latter, so a rejected offer is never resurrected downstream.
    const stacked = products.find((p) => p.name === STACKED.name);
    expect(stacked).toBeDefined();
    expect(stacked?.unitVolume).toBe('33');
    const stackedDrift = report.errors.find((e) => e.includes(STACKED.name));
    expect(stackedDrift).toContain('price drift');
    expect(offers.map((o) => o.priceCents)).not.toContain(0);

    // The control row proves the gates are row-level: the well-formed
    // sibling in the SAME run publishes product and offer unchanged.
    const control = products.find((p) => p.name === CONTROL.name);
    expect(control?.unitVolume).toBe('0.5');
    expect(offers.some((o) => o.priceCents === 549)).toBe(true);
  });
});
