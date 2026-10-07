/**
 * Sitemap fetch + parse (task 1.1, change sitemap-crawl-merchants).
 *
 * The scheduled cycle fetches its merchant's sitemap at most once (spec:
 * polite discovery) through the same injectable fetcher the detail walk
 * uses, under the crawler User-Agent. A failed or unusable sitemap is a
 * collected error with an empty entry set — never a throw — so the
 * cycle degrades to "nothing crawled this cycle" and the watermark is
 * left untouched.
 *
 * @module SitemapFetch
 */

import { CRAWLER_USER_AGENT, type PageFetcher } from './crawl-walker';
import { parseSitemapXml, type SitemapEntry } from './sitemap.parse';

export interface SitemapFetchResult {
  readonly entries: readonly SitemapEntry[];
  readonly errors: readonly string[];
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export async function fetchSitemap(
  sitemapUrl: string,
  fetcher: PageFetcher,
): Promise<SitemapFetchResult> {
  const label = `sitemap ${sitemapUrl}`;

  let response: Response;
  try {
    response = await fetcher(sitemapUrl, {
      headers: { 'user-agent': CRAWLER_USER_AGENT },
    });
  } catch (err) {
    return { entries: [], errors: [`${label} fetch failed: ${errorOf(err)}`] };
  }

  if (!response.ok) {
    return {
      entries: [],
      errors: [
        `${label} returned HTTP ${response.status}: ${response.statusText}`,
      ],
    };
  }

  let xml: string;
  try {
    xml = await response.text();
  } catch (err) {
    return { entries: [], errors: [`${label} body read failed: ${errorOf(err)}`] };
  }

  const { entries, error } = parseSitemapXml(xml);
  return error === null
    ? { entries, errors: [] }
    : { entries, errors: [`${label}: ${error}`] };
}
