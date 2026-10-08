#!/usr/bin/env node
/**
 * viinarannasta.eu sitemap crawl sweep (read-only; task 5.1, change
 * sitemap-crawl-merchants).
 *
 * Fetches the product sitemap ONCE and pushes it through the
 * production discovery path — `fetchSitemap` (CDATA, namespaces,
 * image-loc tolerances) and `filterSitemapEntries` over the adapter's
 * own product-URL predicate — then reports:
 *
 *   1. Sitemap shape — total locs, product URLs after the filter
 *      (image files and CMS routes dropped), duplicates collapsed.
 *   2. lastmod coverage — entries with/without `lastmod`, and, when a
 *      date is given, how many product entries carry a `lastmod` at or
 *      after it (an estimate: production diffs verbatim strings
 *      against the persisted watermark, never parsed instants).
 *   3. With --sample — ONE product page fetched under the crawler
 *      User-Agent and pushed through the production extractor
 *      (`extractProductPage`), printing the exact record shape the
 *      pipeline would ingest. Never a bulk crawl.
 *
 * Read-only: the script issues one sitemap GET (plus one page GET with
 * --sample) and nothing else — no writes, no database, no watermark or
 * cursor rows, no ingestion.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/viinarannasta-crawl-sweep.ts [--sample] [YYYY-MM-DD]
 *
 * Exit codes: 0 complete, 1 sitemap failure or empty product set,
 * 2 usage error.
 */

import { VIINARANNASTA_PRODUCT_URL_PATTERN } from '../packages/data-acquisition/src/adapters/viinarannasta.adapter';
import {
  CRAWLER_USER_AGENT,
  defaultPageFetcher,
} from '../packages/data-acquisition/src/crawl/crawl-walker';
import { extractProductPage } from '../packages/data-acquisition/src/crawl/extract/extract-page';
import { VIINARANNASTA_EXTRACTOR_CONFIG } from '../packages/data-acquisition/src/crawl/extract/source-configs';
import {
  filterSitemapEntries,
  urlPatternPredicate,
} from '../packages/data-acquisition/src/crawl/product-url-filter';
import { fetchSitemap } from '../packages/data-acquisition/src/crawl/sitemap.fetch';
import type { SitemapEntry } from '../packages/data-acquisition/src/crawl/sitemap.parse';

/** The registry seed's feedUrl — the merchant's product sitemap. */
const SITEMAP_URL = 'https://viinarannasta.eu/1_fi_0_sitemap.xml';

/**
 * The adapter's refresh mode. False here (the sitemap carries
 * `lastmod`); the full-refresh source's sweep prints a different
 * changed-since paragraph.
 */
const FULL_REFRESH = false;

const USAGE =
  'usage: tsx ../../scripts/viinarannasta-crawl-sweep.ts [--sample] [YYYY-MM-DD]\n' +
  '  --sample    fetch exactly ONE product page and print the extraction result\n' +
  '  YYYY-MM-DD  count product URLs whose sitemap lastmod is at or after this date';

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Print the extracted record field by field — the shape ingestion sees. */
function printRecord(record: object): void {
  for (const [field, value] of Object.entries(record)) {
    const rendered =
      value === null || value === undefined ? '(null)' : String(value);
    console.log(`  ${field}: ${rendered}`);
  }
}

async function fetchSamplePage(url: string): Promise<string | null> {
  console.log(`fetching ONE product page under "${CRAWLER_USER_AGENT}": ${url}`);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'user-agent': CRAWLER_USER_AGENT },
    });
  } catch (err) {
    console.log(`  sample fetch failed: ${errorOf(err)}`);
    return null;
  }
  if (!response.ok) {
    console.log(
      `  sample page returned HTTP ${response.status}: ${response.statusText}`,
    );
    return null;
  }
  try {
    return await response.text();
  } catch (err) {
    console.log(`  sample body read failed: ${errorOf(err)}`);
    return null;
  }
}

function changedSince(
  entries: readonly SitemapEntry[],
  cutoff: number,
): { readonly changed: number; readonly undated: number } {
  let changed = 0;
  let undated = 0;
  for (const entry of entries) {
    if (entry.lastmod === null) {
      undated++;
      continue;
    }
    const instant = Date.parse(entry.lastmod);
    if (!Number.isNaN(instant) && instant >= cutoff) changed++;
  }
  return { changed, undated };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  let sample = false;
  let sinceArg: string | null = null;
  for (const arg of argv) {
    if (arg === '--sample') {
      sample = true;
      continue;
    }
    if (arg.startsWith('--') || sinceArg !== null) {
      console.error(USAGE);
      process.exit(2);
    }
    sinceArg = arg;
  }

  let cutoff: number | null = null;
  if (sinceArg !== null) {
    cutoff = Date.parse(`${sinceArg}T00:00:00.000Z`);
    if (Number.isNaN(cutoff)) {
      console.error(`not a YYYY-MM-DD date: ${sinceArg}`);
      console.error(USAGE);
      process.exit(2);
    }
  }

  console.log(
    '[viinarannasta-sweep] sitemap sweep — read-only GETs, never a bulk crawl',
  );

  const sitemap = await fetchSitemap(SITEMAP_URL, defaultPageFetcher);
  console.log('');
  console.log('=== viinarannasta.eu sitemap crawl sweep (read-only) ===');
  console.log(`sitemap: ${SITEMAP_URL}`);
  console.log(`user-agent: ${CRAWLER_USER_AGENT}`);
  console.log('');

  if (sitemap.errors.length > 0) {
    for (const error of sitemap.errors) console.log(`sitemap error: ${error}`);
    console.log(
      '=== sweep INCOMPLETE — unusable sitemap; nothing was crawled ===',
    );
    process.exitCode = 1;
    return;
  }

  const totalLocs = sitemap.entries.length;
  const withLastmod = sitemap.entries.filter((e) => e.lastmod !== null).length;
  const productEntries = filterSitemapEntries(
    sitemap.entries,
    urlPatternPredicate(VIINARANNASTA_PRODUCT_URL_PATTERN),
  );
  const uniqueLocs = new Set(sitemap.entries.map((e) => e.loc)).size;

  console.log('-- Sitemap --');
  console.log(`total locs: ${totalLocs}`);
  console.log(
    `product URLs after filter: ${productEntries.length} ` +
      `(non-product dropped: ${uniqueLocs - productEntries.length}, ` +
      `duplicate locs collapsed: ${totalLocs - uniqueLocs})`,
  );
  console.log(
    `entries with lastmod: ${withLastmod} | without: ${totalLocs - withLastmod}`,
  );
  if (productEntries.length > 0) {
    const minutes = Math.round(productEntries.length / 60);
    console.log(
      `a full first crawl of this set costs ~${minutes} min at the polite ` +
        '1 req/s (chunked, resumable in production; this script fetches none of it)',
    );
  }
  console.log('');

  if (cutoff !== null) {
    console.log(
      `-- Changed since ${sinceArg} (lastmod >= ${sinceArg}T00:00:00Z) --`,
    );
    if (FULL_REFRESH) {
      console.log(
        'source is configured full-refresh (no usable sitemap lastmod); ' +
          'every cycle crawls the full set and a date filter does not apply',
      );
    } else {
      const { changed, undated } = changedSince(productEntries, cutoff);
      console.log(
        `changed (lastmod at/after the date): ${changed} ` +
          `(${pct(changed, productEntries.length)} of product URLs)`,
      );
      console.log(
        `without usable lastmod: ${undated} — production compares verbatim ` +
          'strings against the persisted watermark, so treat this count as an estimate',
      );
    }
    console.log('');
  }

  if (productEntries.length === 0) {
    console.log(
      '=== sweep INCOMPLETE — zero product URLs after the filter; ' +
        'check the predicate against the live sitemap ===',
    );
    process.exitCode = 1;
    return;
  }

  if (sample) {
    const url = productEntries[0].loc;
    console.log('-- Sample page (exactly one fetch) --');
    const body = await fetchSamplePage(url);
    if (body !== null) {
      const { record, errors } = extractProductPage(
        url,
        body,
        VIINARANNASTA_EXTRACTOR_CONFIG,
      );
      if (record === null) {
        console.log('extraction: no record');
      } else {
        console.log('extraction: 1 record, fields as ingestion would see them:');
        printRecord(record);
      }
      for (const error of errors) console.log(`extraction error: ${error}`);
    }
    console.log('');
  }

  console.log(
    '=== sweep COMPLETE — numbers above describe the live sitemap, ' +
      're-measure on each run ===',
  );
}

main().catch((err: unknown) => {
  console.error(
    `[viinarannasta-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`,
  );
  process.exit(1);
});
