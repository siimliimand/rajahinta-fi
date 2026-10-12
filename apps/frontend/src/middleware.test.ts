/**
 * Middleware matcher contract (fi-path-isr task 3.2).
 *
 * The matcher literal is what keeps `/tuotteet/<id>` out of locale
 * negotiation (fi-path-isr 3.1): a rewrite there would negotiate the
 * locale and kill the route's on-demand ISR cache, whose key must be
 * the literal URL. No test pinned the matcher before, so a careless
 * edit could silently re-enroute the FI tree — these pins make that a
 * failing test, from both sides: the excluded path shape and the
 * everyday paths that must stay middleware-managed.
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
      '/((?!api|_next|_vercel|.*\\..*|tuotteet/[^/]+).*)',
    );
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
});
