/**
 * Tests for the producer-links curated seed import (task 6.2, change
 * product-roadmap-phases-1-4) — schema-strict validation, URL
 * reachability, product resolution, and the idempotency/lifecycle
 * guarantees of the write path (spec: producer-matching, design R9).
 *
 * Runs against the migrated in-memory D1 harness so the repository
 * write path, its CHECKs, and the FKs are the real thing.
 *
 * @module ProducerLinksImportTests
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  checkSourceUrlReachable,
  dryRunProducerLinkImport,
  importProducerLinkCases,
  openD1SqliteDatabase,
  parseProducerLinksImportFile,
  PRODUCER_LINKS_IMPORT_MAX_CASES,
  resolveCaseProducts,
  type ProducerLinkImportCase,
} from '../producer-links-import';
import { D1ProducerLinksRepository } from '../../repositories/d1/producer-links.repository';
import { openMigratedD1 } from '../../repositories/d1/__tests__/d1-test-harness';
import type { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVIEWER = 'test-reviewer';
const REVIEWED_AT = '2026-09-05T00:00:00.000Z';

function makeCase(overrides: Partial<ProducerLinkImportCase> = {}): ProducerLinkImportCase {
  return {
    alkoProductId: 101,
    alkoProductName: 'Alko Testbeer 4.7%',
    producerKey: 'Testbrew',
    manufacturer: 'Test Brewery Ltd',
    siblingProductId: 202,
    siblingMerchant: 'systembolaget',
    siblingProductName: 'Systembolaget Testbeer',
    sourceUrl: 'https://shop.example/products/202',
    ...overrides,
  };
}

function makeFileJson(cases: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    bootstrap: true,
    reviewer: REVIEWER,
    reviewedAt: REVIEWED_AT,
    cases,
    ...extra,
  });
}

function parseFile(cases: unknown[], extra: Record<string, unknown> = {}) {
  return parseProducerLinksImportFile(makeFileJson(cases, extra));
}

function insertProduct(db: DatabaseSync, id: number, name: string): void {
  db.prepare(
    'INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification) ' +
      "VALUES (?, ?, 'Fixture Manufacturer', 'Fixture Brand', 'beer', 0.33, 'glass', 'beer')",
  ).run(id, name);
}

// ---------------------------------------------------------------------------
// Schema-strict file validation
// ---------------------------------------------------------------------------

describe('parseProducerLinksImportFile', () => {
  it('accepts a valid file and applies the documented normalization', () => {
    const { file, errors } = parseFile([makeCase({ producerKey: '  Testbrew  ', manufacturer: ' Test Brewery Ltd ' })]);
    expect(errors).toEqual([]);
    expect(file).not.toBeNull();
    expect(file!.reviewer).toBe(REVIEWER);
    // reviewedAt canonicalized to ISO-8601 even from a date-only input.
    const { file: dateOnly } = parseProducerLinksImportFile(
      makeFileJson([makeCase()]).replace(REVIEWED_AT, '2026-09-05'),
    );
    expect(dateOnly!.reviewedAt).toBe(REVIEWED_AT);
    // Evidence text is trimmed.
    expect(file!.cases[0]!.producerKey).toBe('Testbrew');
    expect(file!.cases[0]!.manufacturer).toBe('Test Brewery Ltd');
  });

  it('rejects unknown keys at file and case level (schema-strict)', () => {
    expect(parseFile([makeCase()], { confidence: 0.9 }).errors.join(' ')).toContain('<root>');
    expect(parseFile([makeCase({ similarityScore: 0.9 } as unknown as Partial<ProducerLinkImportCase>)]).errors.join(' ')).toContain(
      'cases.0',
    );
  });

  it('rejects a wrong formatVersion', () => {
    const raw = makeFileJson([makeCase()]).replace('"formatVersion":1', '"formatVersion":2');
    expect(parseProducerLinksImportFile(raw).errors.join(' ')).toContain('formatVersion');
  });

  it('rejects non-http(s) source URLs and invalid review metadata', () => {
    expect(parseFile([makeCase({ sourceUrl: 'ftp://shop.example/202' })]).errors.join(' ')).toContain('sourceUrl');
    expect(parseFile([makeCase({ sourceUrl: 'javascript:alert(1)' })]).errors.join(' ')).toContain('sourceUrl');
    expect(parseFile([makeCase()], { reviewedAt: 'not-a-date' }).errors.join(' ')).toContain('reviewedAt');
    expect(parseFile([makeCase()], { reviewer: '   ' }).errors.join(' ')).toContain('reviewer');
  });

  it('rejects empty evidence and self-pairs', () => {
    expect(parseFile([makeCase({ producerKey: '   ' })]).errors.join(' ')).toContain('producerKey');
    expect(parseFile([makeCase({ alkoProductId: 101, siblingProductId: 101 })]).errors.join(' ')).toContain(
      'trivial sibling',
    );
  });

  it('rejects non-integer product references and oversized case sets', () => {
    expect(parseFile([makeCase({ alkoProductId: 1.5 })]).errors.join(' ')).toContain('integer');
    const flood = Array.from({ length: PRODUCER_LINKS_IMPORT_MAX_CASES + 1 }, () => makeCase());
    expect(parseFile(flood).errors.join(' ')).toContain('at most');
  });

  it('pins the committed bootstrap file to the documented format', () => {
    const candidates = [
      path.resolve(process.cwd(), 'src/seed/producer-links/producer-links-bootstrap.json'),
      path.resolve(process.cwd(), 'packages/data-platform/src/seed/producer-links/producer-links-bootstrap.json'),
    ];
    const file = candidates.find((candidate) => {
      try {
        readFileSync(candidate);
        return true;
      } catch {
        return false;
      }
    });
    expect(file, `bootstrap file not found from cwd ${process.cwd()}`).toBeDefined();
    const { errors } = parseProducerLinksImportFile(readFileSync(file!, 'utf8'));
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Source URL reachability (online mode)
// ---------------------------------------------------------------------------

describe('checkSourceUrlReachable', () => {
  function fakeFetch(responses: Array<{ method: string; status: number }>, calls: string[]) {
    let index = 0;
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${String(url)}`);
      const response = responses[index] ?? responses[responses.length - 1]!;
      index += 1;
      if (response.status < 0) {
        throw new Error('network down');
      }
      return { status: response.status } as Response;
    }) as unknown as typeof fetch;
  }

  it('accepts a reachable URL via HEAD alone', async () => {
    const calls: string[] = [];
    const result = await checkSourceUrlReachable('https://shop.example/a', {
      fetchImpl: fakeFetch([{ method: 'HEAD', status: 200 }], calls),
    });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls).toEqual(['HEAD https://shop.example/a']);
  });

  it('falls back to GET when HEAD is rejected (405)', async () => {
    const calls: string[] = [];
    const result = await checkSourceUrlReachable('https://shop.example/b', {
      fetchImpl: fakeFetch(
        [
          { method: 'HEAD', status: 405 },
          { method: 'GET', status: 200 },
        ],
        calls,
      ),
    });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls).toEqual(['HEAD https://shop.example/b', 'GET https://shop.example/b']);
  });

  it('falls back to GET when the HEAD request errors', async () => {
    const calls: string[] = [];
    const result = await checkSourceUrlReachable('https://shop.example/c', {
      fetchImpl: fakeFetch([{ method: 'HEAD', status: -1 }, { method: 'GET', status: 200 }], calls),
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['HEAD https://shop.example/c', 'GET https://shop.example/c']);
  });

  it('treats 4xx/5xx as unreachable without a GET retry', async () => {
    const calls: string[] = [];
    const result = await checkSourceUrlReachable('https://shop.example/gone', {
      fetchImpl: fakeFetch([{ method: 'HEAD', status: 404 }], calls),
    });
    expect(result).toEqual({ ok: false, status: 404, reason: 'HTTP 404' });
    expect(calls).toEqual(['HEAD https://shop.example/gone']);
  });

  it('reports timeouts as unreachable', async () => {
    const neverFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const result = await checkSourceUrlReachable('https://shop.example/slow', {
      fetchImpl: neverFetch,
      timeoutMs: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('timeout');
  });
});

// ---------------------------------------------------------------------------
// Resolution + import over the migrated D1 harness
// ---------------------------------------------------------------------------

describe('resolveCaseProducts + importProducerLinkCases', () => {
  it('inserts DRAFT rows with normalized keys and complete evidence', async () => {
    const { db, d1 } = openMigratedD1();
    insertProduct(db, 101, 'Alko Testbeer 4.7%');
    insertProduct(db, 202, 'Systembolaget Testbeer');
    const repo = new D1ProducerLinksRepository(d1);
    const { file } = parseFile([makeCase({ producerKey: '  Testbrew  ' })]);
    expect(file).not.toBeNull();

    const resolutions = await resolveCaseProducts(d1, file!.cases);
    expect(resolutions[0]!.alkoProduct).toEqual({ id: 101, name: 'Alko Testbeer 4.7%' });
    expect(resolutions[0]!.siblingProduct).toEqual({ id: 202, name: 'Systembolaget Testbeer' });

    const { results, counts } = await importProducerLinkCases(repo, file!, resolutions);
    expect(counts).toEqual({
      inserted: 1,
      skippedExistingDraft: 0,
      skippedExistingPublished: 0,
      skippedMissingProduct: 0,
    });
    expect(results[0]!.outcome).toEqual({ kind: 'inserted', linkId: expect.any(Number) });

    const [stored] = await repo.listAll();
    expect(stored!.status).toBe('DRAFT');
    expect(stored!.producerKey).toBe('testbrew');
    expect(stored!.manufacturer).toBe('Test Brewery Ltd');
    expect(stored!.sourceUrl).toBe('https://shop.example/products/202');
    expect(stored!.reviewer).toBe(REVIEWER);
    expect(stored!.reviewedAt.toISOString()).toBe(REVIEWED_AT);
  });

  it('skips pairs that already exist as DRAFT on re-run (idempotent, no duplicates)', async () => {
    const { db, d1 } = openMigratedD1();
    insertProduct(db, 101, 'Alko Testbeer 4.7%');
    insertProduct(db, 202, 'Systembolaget Testbeer');
    const repo = new D1ProducerLinksRepository(d1);
    const { file } = parseFile([makeCase()]);
    const resolutions = await resolveCaseProducts(d1, file!.cases);

    const first = await importProducerLinkCases(repo, file!, resolutions);
    expect(first.counts).toMatchObject({ inserted: 1 });
    const second = await importProducerLinkCases(repo, file!, resolutions);
    expect(second.counts).toMatchObject({ inserted: 0, skippedExistingDraft: 1 });
    expect((await repo.listAll()).length).toBe(1);
  });

  it('never overwrites a PUBLISHED row and skips it on re-run', async () => {
    const { db, d1 } = openMigratedD1();
    insertProduct(db, 101, 'Alko Testbeer 4.7%');
    insertProduct(db, 202, 'Systembolaget Testbeer');
    const repo = new D1ProducerLinksRepository(d1);
    const { file } = parseFile([makeCase()]);
    const resolutions = await resolveCaseProducts(d1, file!.cases);
    const { results } = await importProducerLinkCases(repo, file!, resolutions);
    const linkId = (results[0]!.outcome as { kind: 'inserted'; linkId: number }).linkId;
    const published = await repo.publish(linkId);
    expect(published!.status).toBe('PUBLISHED');

    // Re-run with CONFLICTING evidence in the file — the stored evidence must win.
    const { file: conflicting } = parseFile([
      makeCase({ sourceUrl: 'https://shop.example/REWRITTEN', manufacturer: 'Different Brewery' }),
    ]);
    const resolutions2 = await resolveCaseProducts(d1, conflicting!.cases);
    const { counts } = await importProducerLinkCases(repo, conflicting!, resolutions2);
    expect(counts).toMatchObject({ inserted: 0, skippedExistingPublished: 1 });

    const after = await repo.findById(linkId);
    expect(after!.sourceUrl).toBe('https://shop.example/products/202');
    expect(after!.manufacturer).toBe('Test Brewery Ltd');
    expect(after!.status).toBe('PUBLISHED');
  });

  it('reports missing products as skips instead of writing fabricated references', async () => {
    const { db, d1 } = openMigratedD1();
    insertProduct(db, 101, 'Alko Testbeer 4.7%'); // sibling 999 does not exist
    const repo = new D1ProducerLinksRepository(d1);
    const { file } = parseFile([makeCase({ siblingProductId: 999 })]);
    const resolutions = await resolveCaseProducts(d1, file!.cases);
    const { results, counts } = await importProducerLinkCases(repo, file!, resolutions);
    expect(results[0]!.outcome).toEqual({ kind: 'skippedMissingProduct', which: 'siblingProductId', id: 999 });
    expect(counts).toMatchObject({ inserted: 0, skippedMissingProduct: 1 });
    expect(await repo.listAll()).toEqual([]);
  });

  it('dry-run computes outcomes without writing anything', async () => {
    const { db, d1 } = openMigratedD1();
    insertProduct(db, 101, 'Alko Testbeer 4.7%');
    insertProduct(db, 202, 'Systembolaget Testbeer');
    const repo = new D1ProducerLinksRepository(d1);
    const { file } = parseFile([makeCase(), makeCase({ alkoProductId: 404, alkoProductName: 'Ghost Product' })]);
    const resolutions = await resolveCaseProducts(d1, file!.cases);
    const dry = await dryRunProducerLinkImport(repo, resolutions);
    expect(dry.counts).toEqual({
      inserted: 1,
      skippedExistingDraft: 0,
      skippedExistingPublished: 0,
      skippedMissingProduct: 1,
    });
    expect(await repo.listAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The node:sqlite D1 handle the CLI uses
// ---------------------------------------------------------------------------

describe('openD1SqliteDatabase', () => {
  it('exposes the prepare/bind/run/all D1 surface over node:sqlite', async () => {
    const { db, d1 } = openD1SqliteDatabase(':memory:');
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    await d1.prepare('INSERT INTO probe (value) VALUES (?)').bind('x').run();
    const row = await d1.prepare('SELECT id, value FROM probe WHERE value = ?').bind('x').first<{ id: number; value: string }>();
    expect(row).toEqual({ id: 1, value: 'x' });
    db.close();
  });
});
