import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale negotiation middleware: redirects `/en`-less English requests,
 * normalises `/fi/...` to the unprefixed Finnish default, and prefixes
 * paths with the active locale internally. API and static assets are
 * excluded.
 */
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except:
  // - /api routes (backend lives on a separate origin, but excluded anyway)
  // - Next.js internals and static files
  // - the Finnish product detail tree, exactly one segment deep
  //   (fi-path-isr task 3.1): `/tuotteet/<id>` is a physical route whose
  //   ISR key must be the literal URL — a middleware rewrite here would
  //   negotiate the locale and kill the on-demand ISR cache. `/tuotteet`
  //   (the listing) and every other path stay middleware-managed.
  // - the sitemap tree, exactly one segment deep (sitemap-tree-coverage
  //   4.2): `/sitemaps/<tree>` is a physical Route Handler with the same
  //   literal-URL ISR requirement (revalidate 900) — left to the
  //   middleware it is locale-negotiated into a 404 page, since
  //   `sitemaps` is not a routing pathname. `/sitemap.xml` needs no
  //   entry: the dot-path file exclusion above already exempts it.
  // - `/mcp` (webmcp follow-up): a physical POST Route Handler — the
  //   same-origin path the Cloudflare WebMCP bridge calls. Locale
  //   negotiation turned it into a `[locale]`-tree 404; JSON-RPC has no
  //   locale.
  matcher: '/((?!api|_next|_vercel|.*\\..*|tuotteet/[^/]+|sitemaps/[^/]+|mcp).*)',
};
