/**
 * Event → group-order estimate handoff contract tests (change
 * seasonal-occasion-templates, task 3.1).
 *
 * Pins the URL handshake at both ends:
 *   1. The builder reduces a COMPUTED estimate to names + quantities
 *      only (one row per purchasable line; purchase-less lines and
 *      NO_PUBLISHED_NORMS carry nothing).
 *   2. The serialization round-trips through the forgiving parser, and
 *      absent / blank / malformed / partially damaged parameter values
 *      degrade to empty or intact-prefix results — never an error.
 *
 * @module EstimateHandoffTest
 */
import { describe, expect, it } from 'vitest';
import type { EventCalcResponse } from './event.types';
import {
  estimateHandoffItems,
  isEstimateHandoffItemName,
  parseEstimateHandoffParam,
  serializeEstimateHandoffItems,
} from './estimate-handoff';

const DISCLAIMER = {
  text: 'Ostoslista perustuu yleisiin kulutusnormeihin.',
  language: 'fi' as const,
  version: '1.0',
};

function computed(
  lines: {
    drinkType: string;
    totalUnits: number;
  }[],
): EventCalcResponse {
  return {
    status: 'COMPUTED',
    eventDate: '2026-06-20',
    eventProfile: 'juhannus',
    guests: 10,
    durationHours: 12,
    normsVersion: 'seasonal-occasions-fi-2026.1',
    lines: lines.map((line) => ({
      drinkType: line.drinkType,
      needMl: 1000,
      needLitres: 1,
      plannedUnits: [
        {
          sizeMl: 330,
          sizeLitres: 0.33,
          description: '0.33 l can',
          quantity: line.totalUnits,
        },
      ],
      totalUnits: line.totalUnits,
      purchasedMl: line.totalUnits * 330,
      surplusMl: Math.max(0, line.totalUnits * 330 - 1000),
      surplusLitres: Math.max(0, line.totalUnits * 330 - 1000) / 1000,
      versionLabel: 'seasonal-occasions-fi-2026.1',
    })),
    disclaimer: DISCLAIMER,
  };
}

describe('estimateHandoffItems', () => {
  it('reduces a COMPUTED estimate to one name+quantity row per purchasable line', () => {
    const items = estimateHandoffItems(
      computed([
        { drinkType: 'beer', totalUnits: 24 },
        { drinkType: 'wine_sparkling', totalUnits: 2 },
      ]),
    );
    expect(items).toEqual([
      { name: 'beer', quantity: 24 },
      { name: 'wine_sparkling', quantity: 2 },
    ]);
  });

  it('drops lines with nothing to buy', () => {
    const items = estimateHandoffItems(
      computed([
        { drinkType: 'beer', totalUnits: 6 },
        { drinkType: 'spirits', totalUnits: 0 },
      ]),
    );
    expect(items).toEqual([{ name: 'beer', quantity: 6 }]);
  });

  it('carries nothing for a NO_PUBLISHED_NORMS result', () => {
    const items = estimateHandoffItems({
      status: 'NO_PUBLISHED_NORMS',
      eventDate: '2026-06-20',
      eventProfile: 'juhannus',
      guests: 10,
      durationHours: 12,
      disclaimer: DISCLAIMER,
    });
    expect(items).toEqual([]);
  });

  it('names are canonical drink-type keys and quantities are positive integers', () => {
    const items = estimateHandoffItems(
      computed([
        { drinkType: 'beer', totalUnits: 1000 },
        { drinkType: 'other_fermented', totalUnits: 30 },
      ]),
    );
    for (const item of items) {
      expect(isEstimateHandoffItemName(item.name)).toBe(true);
      expect(Number.isInteger(item.quantity)).toBe(true);
      expect(item.quantity).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('serialize + parse round trip', () => {
  it('serializes to name:quantity pairs joined by commas', () => {
    expect(
      serializeEstimateHandoffItems([
        { name: 'beer', quantity: 24 },
        { name: 'wine_still', quantity: 3 },
      ]),
    ).toBe('beer:24,wine_still:3');
  });

  it('serializes nothing when there is nothing to share', () => {
    expect(serializeEstimateHandoffItems([])).toBe('');
  });

  it('round-trips the serialized form back to the same rows', () => {
    const items = [
      { name: 'beer', quantity: 24 },
      { name: 'wine_sparkling', quantity: 2 },
    ];
    expect(parseEstimateHandoffParam(serializeEstimateHandoffItems(items))).toEqual(
      items,
    );
  });
});

describe('parseEstimateHandoffParam', () => {
  it('yields empty for absent, blank, and separator-less values', () => {
    expect(parseEstimateHandoffParam(null)).toEqual([]);
    expect(parseEstimateHandoffParam(undefined)).toEqual([]);
    expect(parseEstimateHandoffParam('')).toEqual([]);
    expect(parseEstimateHandoffParam('   ')).toEqual([]);
    expect(parseEstimateHandoffParam('garbage')).toEqual([]);
    expect(parseEstimateHandoffParam('beer:')).toEqual([]);
    expect(parseEstimateHandoffParam(':24')).toEqual([]);
  });

  it('drops malformed pairs and keeps the intact ones', () => {
    expect(
      parseEstimateHandoffParam('beer:24,broken,wine_still:x,wine_sparkling:2'),
    ).toEqual([
      { name: 'beer', quantity: 24 },
      { name: 'wine_sparkling', quantity: 2 },
    ]);
  });

  it('rejects non-positive and absurd quantities', () => {
    expect(parseEstimateHandoffParam('beer:0')).toEqual([]);
    expect(parseEstimateHandoffParam('beer:-3')).toEqual([]);
    expect(parseEstimateHandoffParam('beer:2.5')).toEqual([]);
    expect(parseEstimateHandoffParam('beer:1000000')).toEqual([]);
    expect(parseEstimateHandoffParam('beer:999999')).toEqual([
      { name: 'beer', quantity: 999999 },
    ]);
  });

  it('accepts unknown names as ordinary rows — the checklist is free-text', () => {
    expect(parseEstimateHandoffParam('savusauna-olut:12')).toEqual([
      { name: 'savusauna-olut', quantity: 12 },
    ]);
  });

  it('caps the row count for hand-carved URLs', () => {
    const raw = Array.from({ length: 60 }, (_, i) => `beer:${String(i + 1)}`).join(',');
    expect(parseEstimateHandoffParam(raw)).toHaveLength(50);
  });
});
