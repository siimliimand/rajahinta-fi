/**
 * Sitemap static-paths tests (task 3.3, change
 * price-intelligence-roadmap).
 *
 * With every backend fetch degraded (the sitemap's own degradation
 * contract), the sitemap still emits the locale-prefixed static
 * destinations — and the About + Contact pages added by task 3.3 are
 * among them for BOTH locales (unprefixed for default-locale Finnish,
 * /en-prefixed for English).
 *
 * @module SitemapStaticPathsTest
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import sitemap from './sitemap';

describe('sitemap static paths (task 3.3)', () => {
  beforeEach(() => {
    // Backend unreachable → the degradation contract yields a
    // static-routes-only sitemap (catalog/list/blog/guide fetches fail).
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes /about and /contact for the default locale (unprefixed)', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain('https://rajahinta.fi/about');
    expect(urls).toContain('https://rajahinta.fi/contact');
  });

  it('includes /about and /contact for the en locale (/en prefix)', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain('https://rajahinta.fi/en/about');
    expect(urls).toContain('https://rajahinta.fi/en/contact');
  });
});
