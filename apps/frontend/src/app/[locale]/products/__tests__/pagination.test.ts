/**
 * Pagination window tests (task 2.3, change
 * savings-first-catalog-and-prefill) — the pure slot computation the
 * catalog strip renders. Pinned contract:
 *
 *   1. Anchor budget: at most 7 page slots per view — 8 anchors with
 *      prev/next — for every page of every catalog size, the invariant
 *      that replaced render-every-page on the ~443-page live catalog.
 *   2. Edges: page 1 and the last page are always present; every
 *      emitted number stays inside [1, totalPages], strictly increasing.
 *   3. Window: ±2 around the current page, shifted so it never leaves
 *      the range near the edges.
 *   4. Gaps: ellipsis only between non-consecutive included numbers;
 *      catalogs of up to seven pages render every number with no gap.
 *
 * @module PaginationWindowTest
 */

import { describe, expect, it } from 'vitest';
import { paginationSlots, type PaginationSlot } from '../pagination';

const pageNumbers = (slots: PaginationSlot[]): number[] =>
  slots.flatMap((slot) => (slot.kind === 'page' ? [slot.page] : []));

const gapCount = (slots: PaginationSlot[]): number =>
  slots.filter((slot) => slot.kind === 'gap').length;

describe('paginationSlots anchor budget', () => {
  it('caps page slots at 7 for every page of every catalog size', () => {
    for (let totalPages = 1; totalPages <= 120; totalPages += 1) {
      for (let page = 1; page <= totalPages; page += 1) {
        // prev + next + 7 slots − the current non-link stays ≤ 9 anchors.
        expect(pageNumbers(paginationSlots(page, totalPages)).length).toBeLessThanOrEqual(7);
      }
    }
  });
});

describe('paginationSlots edges', () => {
  it('always includes page 1 and the last page, in range and strictly increasing', () => {
    for (let totalPages = 1; totalPages <= 60; totalPages += 1) {
      for (let page = 1; page <= totalPages; page += 1) {
        const numbers = pageNumbers(paginationSlots(page, totalPages));
        expect(numbers[0]).toBe(1);
        expect(numbers[numbers.length - 1]).toBe(totalPages);
        for (const number of numbers) {
          expect(number).toBeGreaterThanOrEqual(1);
          expect(number).toBeLessThanOrEqual(totalPages);
        }
        for (let i = 1; i < numbers.length; i += 1) {
          expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
        }
      }
    }
  });

  it('renders nothing for a zero- or negative-page catalog', () => {
    expect(paginationSlots(1, 0)).toEqual([]);
    expect(paginationSlots(1, -3)).toEqual([]);
  });
});

describe('paginationSlots window', () => {
  it('centers a ±2 window on a deep page and keeps both edges reachable', () => {
    expect(paginationSlots(200, 443)).toEqual([
      { kind: 'page', page: 1 },
      { kind: 'gap' },
      { kind: 'page', page: 198 },
      { kind: 'page', page: 199 },
      { kind: 'page', page: 200 },
      { kind: 'page', page: 201 },
      { kind: 'page', page: 202 },
      { kind: 'gap' },
      { kind: 'page', page: 443 },
    ]);
  });

  it('shifts the window at the first page so the strip still fills', () => {
    expect(paginationSlots(1, 20)).toEqual([
      { kind: 'page', page: 1 },
      { kind: 'page', page: 2 },
      { kind: 'page', page: 3 },
      { kind: 'page', page: 4 },
      { kind: 'page', page: 5 },
      { kind: 'gap' },
      { kind: 'page', page: 20 },
    ]);
  });

  it('shifts the window at the last page', () => {
    expect(paginationSlots(20, 20)).toEqual([
      { kind: 'page', page: 1 },
      { kind: 'gap' },
      { kind: 'page', page: 16 },
      { kind: 'page', page: 17 },
      { kind: 'page', page: 18 },
      { kind: 'page', page: 19 },
      { kind: 'page', page: 20 },
    ]);
  });
});

describe('paginationSlots small catalogs', () => {
  it('renders every number without gaps for catalogs of up to seven pages', () => {
    for (let totalPages = 1; totalPages <= 7; totalPages += 1) {
      for (let page = 1; page <= totalPages; page += 1) {
        const slots = paginationSlots(page, totalPages);
        expect(gapCount(slots)).toBe(0);
        expect(pageNumbers(slots)).toEqual(
          Array.from({ length: totalPages }, (_, index) => index + 1),
        );
      }
    }
  });

  it('drops into the windowed shape from eight pages on', () => {
    // Window 1..5 cannot reach 8 — the strip shows one ellipsis.
    expect(paginationSlots(1, 8)).toEqual([
      { kind: 'page', page: 1 },
      { kind: 'page', page: 2 },
      { kind: 'page', page: 3 },
      { kind: 'page', page: 4 },
      { kind: 'page', page: 5 },
      { kind: 'gap' },
      { kind: 'page', page: 8 },
    ]);
  });
});
