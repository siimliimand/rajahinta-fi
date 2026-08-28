/**
 * Tests for the pure FX effective-window and rate-selection policy.
 *
 * These are high-liability formulas (design D2): an offer must convert at
 * the rate effective on its observation date, and pair inversion is a
 * domain decision. Pure functions — no DB, no mocks.
 *
 * @module FxRateWindowTests
 */
import { describe, it, expect } from 'vitest';
import { isEffectiveOn, resolveEffectiveDataset, resolveRateFromEntries } from '../fx-rate-window';
import type { FxDatasetVersion, FxRateEntry } from '../fx-dataset.types';

function dataset(overrides: Partial<FxDatasetVersion>): FxDatasetVersion {
  return {
    id: 1,
    versionLabel: 'ecb-2026-01-01.1',
    sourceName: 'ecb-reference-rates',
    sourceUrl: null,
    referenceDate: '2026-01-01',
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
    confirmedBy: 'operator@rajahinta.fi',
    confirmedAt: new Date('2026-01-02T08:00:00Z'),
    createdAt: new Date('2026-01-01T16:05:00Z'),
    ...overrides,
  };
}

const EUR_SEK: FxRateEntry = { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.2 };

describe('isEffectiveOn', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-02-01T00:00:00Z');

  it('covers dates inside the window (inclusive start)', () => {
    expect(isEffectiveOn({ effectiveFrom: from, effectiveTo: to }, from)).toBe(true);
    expect(isEffectiveOn({ effectiveFrom: from, effectiveTo: to }, new Date('2026-01-15T12:00:00Z'))).toBe(true);
  });

  it('excludes the end boundary (exclusive end)', () => {
    expect(isEffectiveOn({ effectiveFrom: from, effectiveTo: to }, to)).toBe(false);
  });

  it('excludes dates before the window', () => {
    expect(isEffectiveOn({ effectiveFrom: from, effectiveTo: to }, new Date('2025-12-31T23:59:59Z'))).toBe(false);
  });

  it('treats a null end as open-ended', () => {
    expect(isEffectiveOn({ effectiveFrom: from, effectiveTo: null }, new Date('2030-06-01T00:00:00Z'))).toBe(true);
  });
});

describe('resolveEffectiveDataset', () => {
  const january = dataset({ id: 1, versionLabel: 'v-jan', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2026-02-01T00:00:00Z') });
  const february = dataset({ id: 2, versionLabel: 'v-feb', effectiveFrom: new Date('2026-02-01T00:00:00Z'), effectiveTo: null });

  it('selects the dataset whose window covers the observation date, not the newest one', () => {
    const midJanuary = new Date('2026-01-15T00:00:00Z');
    expect(resolveEffectiveDataset([january, february], midJanuary)?.versionLabel).toBe('v-jan');

    const midFebruary = new Date('2026-02-15T00:00:00Z');
    expect(resolveEffectiveDataset([january, february], midFebruary)?.versionLabel).toBe('v-feb');
  });

  it('prefers the most recent effectiveFrom when windows overlap transiently', () => {
    const overlapping = dataset({ id: 3, versionLabel: 'v-late-jan', effectiveFrom: new Date('2026-01-20T00:00:00Z'), effectiveTo: null });
    expect(resolveEffectiveDataset([january, overlapping], new Date('2026-01-25T00:00:00Z'))?.versionLabel).toBe('v-late-jan');
  });

  it('ignores PENDING_CONFIRMATION versions even when their window covers the date', () => {
    const pending = dataset({ id: 4, versionLabel: 'v-pending', status: 'PENDING_CONFIRMATION', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null });
    expect(resolveEffectiveDataset([pending], new Date('2026-01-15T00:00:00Z'))).toBeNull();
  });

  it('returns null when nothing covers the date', () => {
    expect(resolveEffectiveDataset([january], new Date('2026-03-01T00:00:00Z'))).toBeNull();
    expect(resolveEffectiveDataset([], new Date('2026-01-15T00:00:00Z'))).toBeNull();
  });
});

describe('resolveRateFromEntries', () => {
  const ds = dataset({});

  it('resolves a direct pair entry', () => {
    const result = resolveRateFromEntries([EUR_SEK], ds, 'EUR', 'SEK');
    expect(result).not.toBeNull();
    expect(result!.rate).toBe(11.2);
    expect(result!.inverted).toBe(false);
    expect(result!.dataset.versionLabel).toBe(ds.versionLabel);
  });

  it('normalises currency casing and surrounding whitespace', () => {
    const result = resolveRateFromEntries([EUR_SEK], ds, ' eur ', 'sek');
    expect(result).not.toBeNull();
    expect(result!.baseCurrency).toBe('EUR');
    expect(result!.quoteCurrency).toBe('SEK');
  });

  it('inverts an oppositely-stored pair (ECB stores EUR as base)', () => {
    const result = resolveRateFromEntries([EUR_SEK], ds, 'SEK', 'EUR');
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(1 / 11.2, 12);
    expect(result!.inverted).toBe(true);
  });

  it('returns null for an absent pair — never a 1:1 assumption', () => {
    expect(resolveRateFromEntries([EUR_SEK], ds, 'EUR', 'JPY')).toBeNull();
  });

  it('returns null for empty entries', () => {
    expect(resolveRateFromEntries([], ds, 'EUR', 'SEK')).toBeNull();
  });
});
