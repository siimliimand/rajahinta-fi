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
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
