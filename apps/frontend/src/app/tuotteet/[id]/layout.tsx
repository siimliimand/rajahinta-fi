import { setRequestLocale } from 'next-intl/server';
import LocaleChrome from '@/app/_chrome/LocaleChrome';

/**
 * Root layout of the middleware-bypassed Finnish product tree
 * (fi-path-isr task 3.1).
 *
 * `/tuotteet/<id>` leaves the locale-negotiation middleware (matcher
 * excludes exactly `tuotteet/[^/]+`), so its ISR key is the literal URL
 * and no middleware rewrite stands between the request and this route.
 * This layout is the tree's document root — there is deliberately no
 * `app/layout.tsx`: a shared document root provably opts every tree into
 * dynamic rendering on this stack (see LocaleChrome's docblock), so each
 * tree keeps its own root that owns its locale. The Finnish default
 * locale is pinned here, never read: `getLocale()`/`headers()` in a
 * document root is exactly what killed the ISR windows.
 *
 * No segment config here on purpose: the tree's ISR window comes solely
 * from the page's own `revalidate = 300` (no 60 s layout above this
 * tree), so the emitted shared-cache header is the page's window shape —
 * `s-maxage=300, stale-while-revalidate=31535700` under `next start`.
 */
export default async function FiProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Static rendering (next-intl): primes the request locale BEFORE the
  // chrome renders — SiteFooter inside LocaleChrome calls getLocale(),
  // which unprimed falls back to reading headers() and would flip this
  // route to dynamic, killing exactly the ISR this change exists for.
  // Also feeds the request config so its `fi` fallback resolves fi.json
  // without a negotiation round-trip.
  setRequestLocale('fi');

  return <LocaleChrome locale="fi">{children}</LocaleChrome>;
}
