/**
 * Robots rules tests (price-intelligence-roadmap task 6.2; rules from
 * task 9.5).
 *
 * Pins the crawler contract: everything public is allowed, the
 * session-scoped and prompt-only surfaces are disallowed for BOTH
 * locales, the sitemap is advertised — and no sitemap-advertised static
 * destination is accidentally disallowed.
 *
 * @module RobotsTest
 */


import { describe, expect, it } from 'vitest';
import robots from './robots';

/** The disallow list task 9.5 established, per locale. */
const DISALLOWED = [
  '/account',
  '/en/account',
  '/group-order',
  '/en/group-order',
  '/age-gate',
  '/en/age-gate',
] as const;

/** The single rule robots() emits, guarded against the array shape. */
function firstRule() {
  const { rules } = robots();
  return (Array.isArray(rules) ? rules : [rules])[0];
}

describe('robots rules (task 6.2)', () => {
  it('allows every crawler on the public surface', () => {
    const rule = firstRule();
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
  });

  it('disallows exactly the session-scoped and prompt-only surfaces, both locales', () => {
    const rule = firstRule();
    expect(rule.disallow).toEqual([...DISALLOWED]);
  });

  it('advertises the sitemap', () => {
    expect(robots().sitemap).toBe('https://rajahinta.fi/sitemap.xml');
  });

  it('no public SEO route is disallowed', () => {
    const rule = firstRule();
    const disallowed = new Set(
      Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow],
    );
    // The public routes task 6.2 smoke-tests for unique metadata, in
    // both URL spaces (unprefixed Finnish, /en-prefixed English).
    for (const route of [
      '/calculator',
      '/compare',
      '/basket',
      '/trip',
      '/event',
      '/what-if',
      '/ranking',
      '/value',
      '/about',
      '/contact',
      '/products',
      '/blog',
      '/guides',
    ]) {
      expect(disallowed.has(route), `${route} stays crawlable`).toBe(false);
      expect(disallowed.has(`/en${route}`), `/en${route} stays crawlable`).toBe(false);
    }
  });
});
