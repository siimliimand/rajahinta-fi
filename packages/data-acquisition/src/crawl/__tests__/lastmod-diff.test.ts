/**
 * Lastmod diff tests (task 1.1, change sitemap-crawl-merchants; design
 * D4 / spec "Incremental sync uses sitemap lastmod where available").
 *
 * Pins: first crawl = full set, steady-state cycles crawl only changed
 * and new URLs, full-refresh sources always get the full set, and the
 * returned watermark reflects the CURRENT sitemap (added URLs in,
 * removed URLs out).
 *
 * @module LastmodDiffTest
 */
import { describe, it, expect } from 'vitest';
import { diffSitemapEntries } from '../lastmod-diff';
import type { SitemapEntry } from '../sitemap.parse';

function entry(loc: string, lastmod: string | null = null): SitemapEntry {
  return { loc, lastmod };
}

const FIRST = 'https://example.com/a.html';
const SECOND = 'https://example.com/b.html';
const THIRD = 'https://example.com/c.html';

describe('diffSitemapEntries', () => {
  it('spec: first crawl (empty previous) yields the full set', () => {
    const { urlsToCrawl, nextWatermark } = diffSitemapEntries(
      new Map(),
      [entry(FIRST, '2026-09-30'), entry(SECOND)],
      { fullRefresh: false },
    );

    expect(urlsToCrawl).toEqual([FIRST, SECOND]);
    expect(Object.fromEntries(nextWatermark)).toEqual({
      [FIRST]: '2026-09-30',
      [SECOND]: null,
    });
  });

  it('spec: steady state crawls only changed and new URLs, unchanged skipped', () => {
    const previous = new Map<string, string | null>([
      [FIRST, '2026-09-30'],
      [SECOND, '2026-09-29'],
    ]);

    const { urlsToCrawl } = diffSitemapEntries(
      previous,
      [
        entry(FIRST, '2026-09-30'), // unchanged
        entry(SECOND, '2026-10-01'), // lastmod moved
        entry(THIRD, '2026-09-28'), // new
      ],
      { fullRefresh: false },
    );

    expect(urlsToCrawl).toEqual([SECOND, THIRD]);
  });

  it('spec: a full-refresh source always receives the full set', () => {
    const previous = new Map<string, string | null>([
      [FIRST, '2026-09-30'],
      [SECOND, '2026-09-30'],
    ]);

    const { urlsToCrawl } = diffSitemapEntries(
      previous,
      [entry(FIRST, '2026-09-30'), entry(SECOND, '2026-09-30')],
      { fullRefresh: true },
    );

    expect(urlsToCrawl).toEqual([FIRST, SECOND]);
  });

  it('a vanished lastmod counts as changed; a URL dropped from the sitemap leaves the watermark', () => {
    const previous = new Map<string, string | null>([
      [FIRST, '2026-09-30'],
      [SECOND, '2026-09-29'],
    ]);

    const { urlsToCrawl, nextWatermark } = diffSitemapEntries(
      previous,
      [entry(FIRST), entry(THIRD, '2026-09-28')],
      { fullRefresh: false },
    );

    expect(urlsToCrawl).toEqual([FIRST, THIRD]);
    expect(Object.fromEntries(nextWatermark)).toEqual({
      [FIRST]: null,
      [THIRD]: '2026-09-28',
    });
  });

  it('duplicate locs collapse to the first occurrence and crawl once', () => {
    const { urlsToCrawl, nextWatermark } = diffSitemapEntries(
      new Map(),
      [entry(FIRST, '2026-09-30'), entry(FIRST, '2026-10-01')],
      { fullRefresh: false },
    );

    expect(urlsToCrawl).toEqual([FIRST]);
    expect(nextWatermark.get(FIRST)).toBe('2026-09-30');
  });

  it('a lastmod-only date change with identical string skips (string comparison, never date math)', () => {
    const previous = new Map<string, string | null>([[FIRST, '2026-09-30T00:00:00+00:00']]);

    const { urlsToCrawl } = diffSitemapEntries(
      previous,
      [entry(FIRST, '2026-09-30T00:00:00+00:00')],
      { fullRefresh: false },
    );

    expect(urlsToCrawl).toEqual([]);
  });
});
