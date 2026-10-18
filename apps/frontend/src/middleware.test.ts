/**
 * Middleware matcher contract (fi-path-isr task 3.2; sitemap-tree-coverage
 * task 4.2).
 *
 * The matcher literal is what keeps `/tuotteet/<id>` out of locale
 * negotiation (fi-path-isr 3.1): a rewrite there would negotiate the
 * locale and kill the route's on-demand ISR cache, whose key must be
 * the literal URL. No test pinned the matcher before, so a careless
 * edit could silently re-enroute the FI tree — these pins make that a
 * failing test, from both sides: the excluded path shape and the
 * everyday paths that must stay middleware-managed.
 *
 * sitemap-tree-coverage 4.2 extends the same protection to the sitemap
 * tree: `/sitemaps/<tree>` is a physical Route Handler (ISR revalidate
 * 900) that the locale negotiation 404s — found live on staging, where
 * every tree child served the not-found page while `/sitemap.xml`
 * (dot-path exempt) served fine.
 *
 * @module MiddlewareMatcherTest
 */
import { describe, expect, it, vi } from 'vitest';
import { config } from './middleware';

// next-intl's middleware entry imports next/server, which has no
// runtime under vitest (the negotiation handler is never invoked
// here). The pins below target OUR config literal in ./middleware.ts,
// so stubbing the third-party factory keeps the module importable
// without weakening what is asserted.
vi.mock('next-intl/middleware', () => ({
  default: () => () => undefined,
}));

describe('middleware matcher (fi-path-isr 3.2)', () => {
  // Next anchors the matcher against the full request pathname, so the
  // behavioral assertions run the same string as an anchored regex.
  const matcher = new RegExp(`^${config.matcher}$`);

  it('pins the matcher literal (drift here is a routing change)', () => {
    expect(config.matcher).toBe(
      '/((?!api|_next|_vercel|.*\\..*|tuotteet/[^/]+|sitemaps/[^/]+|mcp).*)',
    );
  });

  it('excludes the /mcp proxy route from negotiation (webmcp follow-up)', () => {
    expect(matcher.test('/mcp')).toBe(false);
    // Same-origin JSON-RPC POST — no locale, no negotiation round-trip.
    // A middleware rewrite here 404'd the live endpoint (found in
    // production, same failure class as the sitemap tree above).
  });

  it('excludes the FI product detail tree from negotiation', () => {
    expect(matcher.test('/tuotteet/1532')).toBe(false);
    // The exclusion is one segment deep by intent, but the lookahead
    // (`tuotteet/[^/]+`) fails for anything whose first two segments
    // are tuotteet/<segment>, so deeper paths are excluded too. No
    // route exists below /tuotteet/<id>/ (nothing to negotiate), so
    // the blanket exclusion is harmless — noted, not accidental.
    expect(matcher.test('/tuotteet/1532/sub')).toBe(false);
  });

  it('keeps the everyday paths middleware-managed', () => {
    // The FI listing (no id) is a [locale] route — negotiation applies.
    expect(matcher.test('/tuotteet')).toBe(true);
    expect(matcher.test('/laskuri')).toBe(true);
    expect(matcher.test('/en/products/1')).toBe(true);
    expect(matcher.test('/')).toBe(true);
  });

  it('excludes the sitemap tree Route Handler from negotiation (4.2)', () => {
    // Every tree child the index references — pages, products-N, and
    // any future slug — must reach the Route Handler, not the locale
    // negotiation that 404s non-pathnames.
    expect(matcher.test('/sitemaps/pages')).toBe(false);
    expect(matcher.test('/sitemaps/products-0')).toBe(false);
    // Out-of-vocabulary slugs take the Route Handler's own notFound()
    // 404, so they are excluded from negotiation too.
    expect(matcher.test('/sitemaps/nope')).toBe(false);
    // The index route itself never needed an entry: the dot-path file
    // exclusion already exempts it (sitemap.xml contains a dot).
    expect(matcher.test('/sitemap.xml')).toBe(false);
    // Same lookahead shape as the tuotteet pin: `sitemaps/[^/]+` fails
    // for anything below the first two segments too, so deeper paths are
    // excluded as well. No route exists below /sitemaps/<tree>/ (nothing
    // to negotiate) — the blanket exclusion is harmless, as recorded for
    // the FI tree.
    expect(matcher.test('/sitemaps/products-0/extra')).toBe(false);
  });
});
