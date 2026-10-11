/**
 * Ferry onboard-price curated source — dataset sanity pins (task 2.2,
 * change ferry-onboard-prices).
 *
 * The dataset is transcribed by hand from the operators' publicly
 * browsable shops, so the tests act as the transcription review: the
 * per-operator row counts of the first transcription, the citation
 * contract, the upsert-identity uniqueness, the shared review date, and
 * the designed Viking empty state. Every later transcription must keep
 * these pins true (update the counts when rows legitimately move).
 *
 * @module FerryPriceSourceTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildFerryPriceObservations,
  FERRY_OBSERVED_AT,
  FERRY_OPERATOR_KEYS,
} from '../adapters/ferry-price.source';

const rows = buildFerryPriceObservations();

describe('ferry curated dataset (first transcription 2026-10-11)', () => {
  it('transcribes the verified Tallink and Eckerö rows — and no Viking rows (designed empty state)', () => {
    // 42 Tallink rows had their product URLs verified against the
    // operator's own product sitemap; 2 category-served rows the sitemap
    // did not confirm were dropped, not guessed. Eckerö: 16 strong-alcohol
    // + 12 long-drink tiles. Viking: bot-gated shop, zero rows by design.
    expect(rows.filter((r) => r.operator === 'tallink')).toHaveLength(42);
    expect(rows.filter((r) => r.operator === 'eckero')).toHaveLength(28);
    expect(rows.filter((r) => r.operator === 'viking')).toHaveLength(0);
    expect(rows).toHaveLength(70);
  });

  it('carries only the three governed operator keys', () => {
    // The operator key is the source_governance key the refresh cron
    // checks — an unlisted operator would ingest ungoverned.
    for (const row of rows) {
      expect(FERRY_OPERATOR_KEYS).toContain(row.operator);
    }
  });

  it('stamps every row with the review-date constant the cron skip-check compares against', () => {
    expect(FERRY_OBSERVED_AT.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    for (const row of rows) {
      expect(row.observedAt).toBe(FERRY_OBSERVED_AT);
    }
  });

  it('keeps prices positive EUR minor units (the schema CHECKs mirror this)', () => {
    // price_cents > 0 is a migration CHECK; a transcribed zero or
    // negative "price" is a transcription bug, never an observation.
    for (const row of rows) {
      expect(Number.isInteger(row.priceCents)).toBe(true);
      expect(row.priceCents).toBeGreaterThan(0);
    }
  });

  it('cites every row: shop name + product page URL + access date', () => {
    // An uncited price is unrepresentable at rest (citation CHECK) — the
    // dataset must not even try. Each citation names the transcribed shop
    // and resolves to the page the price was read from.
    for (const row of rows) {
      expect(row.citation).toContain('accessed 2026-10-11');
      expect(row.citation).toMatch(/^https?:\/\/\S+|^[^,]+, https?:\/\//);
      expect(row.citation).toContain(', ');
      if (row.operator === 'tallink') {
        expect(row.citation).toContain('Tallink MyStar onboard shop');
        expect(row.citation).toContain(
          'https://shopping-onboard.tallink.com/en/mystar/product/',
        );
      }
      if (row.operator === 'eckero') {
        expect(row.citation).toContain('Eckerö Market pre-order shop');
        expect(row.citation).toContain(
          'https://www.eckeroline.com/shopping/preorder/',
        );
      }
    }
  });

  it('keeps the observation identity unique within one revision', () => {
    // The upsert key is (operator, route, label, observedAt) — a within-
    // dataset collision would make the second row silently overwrite the
    // first, so the transcription review catches it here instead.
    const identities = new Set(
      rows.map((r) => `${r.operator}|${r.route}|${r.label}|${r.observedAt.toISOString()}`),
    );
    expect(identities.size).toBe(rows.length);
  });

  it('records both transcribed operators on their real routes', () => {
    // Tallink rows come from the MyStar onboard shop (Helsinki–Tallinn
    // vessel); Eckerö is a single-route operator (M/S Finlandia). The en
    // dash is the route taxonomy both shops use.
    for (const operator of ['tallink', 'eckero'] as const) {
      const routes = new Set(
        rows.filter((r) => r.operator === operator).map((r) => r.route),
      );
      expect([...routes]).toEqual(['Helsinki–Tallinn']);
    }
  });

  it('stores display labels verbatim — non-empty, no EAN, no synthetic names', () => {
    for (const row of rows) {
      expect(row.label.trim()).toHaveLength(row.label.trim().length);
      expect(row.label.length).toBeGreaterThan(0);
      // Tallink's custom1 field carries the EAN; data minimization forbids
      // storing it — a bare 13-14 digit label means it leaked into a label.
      expect(row.label).not.toMatch(/^\d{13,14}$/);
    }
  });
});

describe('buildFerryPriceObservations', () => {
  it('filters by operator and is pure (two calls produce identical rows)', () => {
    const tallink = buildFerryPriceObservations('tallink');
    expect(tallink).toHaveLength(42);
    expect(tallink.every((r) => r.operator === 'tallink')).toBe(true);

    const viking = buildFerryPriceObservations('viking');
    expect(viking).toEqual([]);

    expect(buildFerryPriceObservations()).toEqual(
      buildFerryPriceObservations(),
    );
  });
});
