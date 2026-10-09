/**
 * Routing pathnames vocabulary tests (task 1.1, change
 * localize-fi-route-pathnames).
 *
 * The `pathnames` config is the single source of truth for URL
 * negotiation (design D1/D2): localized entries carry exactly one fi
 * segment and the internal route name as the en segment, shared entries
 * keep a single segment for both locales, and no fi segment collides
 * with an internal route name — otherwise a segment would be ambiguous
 * between locales and the middleware's wrong-locale redirect could not
 * resolve it.
 *
 * @module i18n/routing
 */

import { describe, expect, it } from 'vitest';
import { routing } from './routing';

type PathnameEntry = string | { fi: string; en: string };

const entries: [string, PathnameEntry][] = Object.entries(routing.pathnames);

const localized = entries.filter(
  (entry): entry is [string, { fi: string; en: string }] =>
    typeof entry[1] !== 'string',
);
const shared = entries.filter(
  (entry): entry is [string, string] => typeof entry[1] === 'string',
);

/** Internal route names = the pathnames keys themselves. */
const internalRouteNames = entries.map(([key]) => key);

describe('localized pathnames vocabulary (design D1)', () => {
  it('pins the localized entry count', () => {
    expect(localized).toHaveLength(21);
  });

  it('every localized entry has exactly the keys fi and en', () => {
    for (const [key, value] of localized) {
      expect(Object.keys(value).sort(), key).toEqual(['en', 'fi']);
    }
  });

  it('en segment is the internal route name', () => {
    for (const [key, value] of localized) {
      expect(value.en, key).toBe(key);
    }
  });

  it('fi segments are unique across entries', () => {
    const fiSegments = localized.map(([, value]) => value.fi);
    expect(new Set(fiSegments).size).toBe(fiSegments.length);
  });

  it('every fi segment is ASCII-slug-shaped (no ä/ö/å)', () => {
    for (const [key, value] of localized) {
      expect(value.fi, key).toMatch(/^[a-z0-9/[\]-]+$/);
    }
  });

  it('no fi segment equals an internal route name (collision guard)', () => {
    for (const [key, value] of localized) {
      // The root is locale-neutral by definition (fi segment '/' for
      // the '/' route); every other fi segment must be unambiguous.
      if (key === '/') continue;
      expect(internalRouteNames, `${key} → fi ${value.fi}`).not.toContain(
        value.fi,
      );
    }
  });
});

describe('shared pathnames (design D2)', () => {
  it('pins the shared entry count (catch-all deliberately excluded)', () => {
    expect(shared).toHaveLength(20);
  });

  it('every shared entry is a single string equal to the internal route name', () => {
    for (const [key, value] of shared) {
      expect(value, key).toBe(key);
    }
  });
});
