/**
 * Robots rules tests (price-intelligence-roadmap task 6.2; rules from
 * task 9.5; group-order narrowing from consumer-clarity-and-discovery
 * task 4.1).
 *
 * Pins the crawler contract: everything public is allowed, the
 * session-scoped, prompt-only, and share-token surfaces are disallowed
 * for BOTH locales — the group-order wildcards cover token session
 * paths while the create page stays crawlable — the sitemap is
 * advertised, and no sitemap-advertised static destination is
 * accidentally disallowed.
 *
 * @module RobotsTest
 */


import { describe, expect, it } from 'vitest';
import robots from './robots';

/**
 * The disallow list, per locale. Task 9.5 disallowed the blanket
 * /group-order trees; consumer-clarity-and-discovery task 4.1 narrowed
 * the patterns to the wildcard so only token session paths are
 * excluded.
 */
const DISALLOWED = [
  '/account',
  '/en/account',
  '/group-order/*',
  '/en/group-order/*',
  '/age-gate',
  '/en/age-gate',
] as const;

/** The single rule robots() emits, guarded against the array shape. */
function firstRule() {
  const { rules } = robots();
  return (Array.isArray(rules) ? rules : [rules])[0];
}

/** The emitted disallow list, guarded against the string shape. */
function disallowList(): string[] {
  const { disallow } = firstRule();
  if (typeof disallow === 'string') return [disallow];
  return disallow ?? [];
}

/**
 * Minimal robots.txt match for the two pattern shapes this contract
 * uses: exact paths and trailing-wildcard prefixes ('/x/*' matches
 * every path under /x/ but not the bare '/x').
 */
function isDisallowed(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );
}

describe('robots rules (task 6.2)', () => {
  it('allows every crawler on the public surface', () => {
    const rule = firstRule();
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
  });

  it('disallows exactly the session-scoped, token-scoped, and prompt-only surfaces, both locales', () => {
    expect(firstRule().disallow).toEqual([...DISALLOWED]);
  });

  it('keeps the group-order create page crawlable while token sessions stay excluded', () => {
    const patterns = disallowList();
    // The blanket disallows are gone — the create page is crawlable.
    expect(patterns).not.toContain('/group-order');
    expect(patterns).not.toContain('/en/group-order');
    // The narrowed wildcards exclude token session paths, both locales,
    // but never the bare create page.
    expect(isDisallowed('/group-order', patterns)).toBe(false);
    expect(isDisallowed('/en/group-order', patterns)).toBe(false);
    expect(isDisallowed('/group-order/tok_abc123', patterns)).toBe(true);
    expect(isDisallowed('/en/group-order/tok_abc123', patterns)).toBe(true);
  });

  it('advertises the sitemap', () => {
    expect(robots().sitemap).toBe('https://rajahinta.fi/sitemap.xml');
  });

  it('no public SEO route is disallowed', () => {
    const patterns = disallowList();
    const disallowed = new Set(patterns);
    // The public routes task 6.2 smoke-tests for unique metadata, in
    // both URL spaces (unprefixed Finnish, /en-prefixed English) — plus
    // the group-order create page (consumer-clarity-and-discovery
    // task 4.1).
    for (const route of [
      '/calculator',
      '/compare',
      '/basket',
      '/trip',
      '/event',
      '/what-if',
      '/group-order',
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
      expect(isDisallowed(route, patterns), `${route} stays crawlable`).toBe(false);
      expect(isDisallowed(`/en${route}`, patterns), `/en${route} stays crawlable`).toBe(false);
    }
  });
});
