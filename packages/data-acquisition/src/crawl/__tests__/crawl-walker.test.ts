/**
 * Product-page walker tests (task 1.1, change sitemap-crawl-merchants;
 * design D2 / spec "Sitemap crawl sources discover products politely").
 *
 * Pins: strictly sequential fetches with the ≥ 1 s spacing BEFORE every
 * request after the first, the descriptive User-Agent on every request,
 * the maxFetches bound, and failure collection — network errors, HTTP
 * errors, unreadable bodies, and throwing page processors each cost
 * one page, never the walk, and the walker never throws.
 *
 * All timing and HTTP are injected; no test waits for real milliseconds.
 *
 * @module CrawlWalkerTest
 */
import { describe, it, expect } from 'vitest';
import {
  CRAWLER_USER_AGENT,
  MIN_REQUEST_SPACING_MS,
  walkProductPages,
  type PageFetcher,
  type PageProcessor,
} from '../crawl-walker';
import type { RawFeedRecord } from '../../interfaces/feed-adapter.interface';

const URLS = [
  'https://example.com/p/1.html',
  'https://example.com/p/2.html',
  'https://example.com/p/3.html',
];

interface PageSpec {
  status?: number;
  statusText?: string;
  body?: string;
  networkError?: Error;
  textError?: Error;
}

function stubFetcher(pageSpecs: Record<string, PageSpec>, timeline: string[]) {
  const headers: Array<string | undefined> = [];
  const fetcher = async (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    timeline.push(url);
    headers.push(init?.headers?.['user-agent']);
    const spec: PageSpec = pageSpecs[url] ?? {};
    if (spec.networkError) throw spec.networkError;
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: spec.statusText ?? 'OK',
      text: async () => {
        if (spec.textError) throw spec.textError;
        return spec.body ?? '<html></html>';
      },
    };
  };
  return { headers, fetcher: fetcher as unknown as PageFetcher };
}

function record(url: string): RawFeedRecord {
  return {
    productId: url,
    productName: 'Test Product 5% 0,33 l',
    manufacturer: '',
    brand: '',
    category: 'beer',
    alcoholByVolume: 0.05,
    volumeMl: 330,
    containerType: 'other',
    regulatoryClassification: 'beer',
    depositSystem: false,
    ean: null,
    priceCents: 199,
    currency: 'EUR',
    originalPriceCents: 199,
    originalCurrency: 'EUR',
    availability: 'in_stock',
    sourceUrl: url,
  };
}

function processor(map: Record<string, PageProcessor>): PageProcessor {
  return (url, body) => map[url]?.(url, body) ?? { record: null };
}

describe('walkProductPages — polite pacing (design D2)', () => {
  it('spec: sequential fetches in sitemap order with ≥ 1 s spacing before every request after the first', async () => {
    const timeline: string[] = [];
    const { fetcher } = stubFetcher({}, timeline);
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      timeline.push(`sleep:${ms}`);
    };

    const { records, errors } = await walkProductPages({
      errorLabel: 'test',
      urls: URLS,
      processPage: processor({}),
      fetcher,
      sleep,
    });

    expect(timeline).toEqual([
      URLS[0],
      `sleep:${MIN_REQUEST_SPACING_MS}`,
      URLS[1],
      `sleep:${MIN_REQUEST_SPACING_MS}`,
      URLS[2],
    ]);
    expect(sleeps).toEqual([MIN_REQUEST_SPACING_MS, MIN_REQUEST_SPACING_MS]);
    expect(errors).toEqual([]);
    expect(records).toEqual([]);
  });

  it('the descriptive User-Agent rides every request', async () => {
    const timeline: string[] = [];
    const { headers, fetcher } = stubFetcher({}, timeline);

    await walkProductPages({
      errorLabel: 'test',
      urls: URLS,
      processPage: processor({}),
      fetcher,
      sleep: async () => {},
    });

    expect(headers).toHaveLength(3);
    for (const ua of headers) {
      expect(ua).toBe(CRAWLER_USER_AGENT);
    }
  });

  it('an injected minSpacingMs overrides the default (injectable pacing)', async () => {
    const timeline: string[] = [];
    const { fetcher } = stubFetcher({}, timeline);
    const sleeps: number[] = [];

    await walkProductPages({
      errorLabel: 'test',
      urls: URLS,
      processPage: processor({}),
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      minSpacingMs: 0,
    });

    expect(sleeps).toEqual([0, 0]);
  });

  it('spec: maxFetches bounds the walk (the D5 chunk cap cuts the tail)', async () => {
    const timeline: string[] = [];
    const { fetcher } = stubFetcher({}, timeline);

    const calls = await walkProductPages({
      errorLabel: 'test',
      urls: URLS,
      processPage: processor({}),
      fetcher,
      sleep: async () => {},
      maxFetches: 2,
    });

    expect(calls.errors).toEqual([]);
    expect(calls.records).toEqual([]);
    expect(timeline).toEqual([URLS[0], URLS[1]]);
  });
});

const URL_FOUR = 'https://example.com/p/4.html';
const URL_FIVE = 'https://example.com/p/5.html';

describe('walkProductPages — failure collection, never throws', () => {
  it('spec: network error, HTTP error, unreadable body, and a throwing processor each cost one page', async () => {
    const timeline: string[] = [];
    const { fetcher } = stubFetcher(
      {
        [URLS[1]]: { networkError: new Error('connection reset') },
        [URLS[2]]: { status: 503, statusText: 'Service Unavailable' },
      },
      timeline,
    );
    const processorThrows = processor({});

    const { records, errors } = await walkProductPages({
      errorLabel: 'test',
      urls: [...URLS, URL_FOUR, URL_FIVE],
      processPage: (url, _body) => {
        if (url === URL_FOUR) throw new Error('bad body');
        if (url === URL_FIVE) {
          return { record: record(url), errors: ['row-level correction'] };
        }
        return processorThrows(url, _body);
      },
      fetcher,
      sleep: async () => {},
      minSpacingMs: 0,
    });

    expect(timeline).toHaveLength(5);
    expect(errors).toEqual([
      `test ${URLS[1]} fetch failed: connection reset`,
      `test ${URLS[2]} returned HTTP 503: Service Unavailable`,
      `test ${URL_FOUR} processing failed: bad body`,
      'row-level correction',
    ]);
    expect(records).toEqual([record(URL_FIVE)]);
  });

  it('a body read failure is collected and the walk continues', async () => {
    const timeline: string[] = [];
    const { fetcher } = stubFetcher(
      { [URLS[0]]: { textError: new Error('body stream interrupted') } },
      timeline,
    );

    const { errors } = await walkProductPages({
      errorLabel: 'test',
      urls: URLS,
      processPage: processor({}),
      fetcher,
      sleep: async () => {},
      minSpacingMs: 0,
    });

    expect(timeline).toEqual(URLS);
    expect(errors).toEqual([
      `test ${URLS[0]} body read failed: body stream interrupted`,
    ]);
  });
});
