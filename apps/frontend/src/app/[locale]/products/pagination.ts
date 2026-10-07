/**
 * Windowed pagination slots (task 2.3, change
 * savings-first-catalog-and-prefill) — the pure page-list computation
 * behind the catalog pagination strip. The live catalog spans hundreds
 * of pages; linking every number scaled with the catalog, so the strip
 * renders a clamped ±2 window with page 1 and the last page always
 * reachable and ellipsis gaps between them — at most seven page slots
 * (eight anchors with prev/next) no matter how deep the catalog grows.
 *
 * A separate module because an App Router page file may only export
 * route fields; this stays importable by both the page and its tests.
 *
 * @module pagination
 */

/** One rendered slot in the pagination strip: a numbered page or an
 *  ellipsis gap. */
export type PaginationSlot =
  | { kind: 'page'; page: number }
  | { kind: 'gap' };

/** Pages shown either side of the current one. */
const WINDOW_RADIUS = 2;
const WINDOW_SIZE = WINDOW_RADIUS * 2 + 1;

/** At or below this page count the whole range fits the strip. */
const FULL_RANGE_PAGES = WINDOW_SIZE + 2;

/**
 * The rendered sequence for (page, totalPages): page 1, the current
 * page's window, and the last page, in order, with a 'gap' slot where
 * the included numbers are not consecutive. Catalogs of up to
 * FULL_RANGE_PAGES pages render every number with no gap; deeper ones
 * shift the window so it never leaves the range. Every emitted page is
 * inside [1, totalPages]; 1 and totalPages are always present.
 */
export function paginationSlots(
  page: number,
  totalPages: number,
): PaginationSlot[] {
  if (totalPages <= 0) return [];

  if (totalPages <= FULL_RANGE_PAGES) {
    return Array.from({ length: totalPages }, (_, index) => ({
      kind: 'page' as const,
      page: index + 1,
    }));
  }

  const windowStart = Math.max(
    1,
    Math.min(page - WINDOW_RADIUS, totalPages - WINDOW_SIZE + 1),
  );
  const windowEnd = Math.min(totalPages, windowStart + WINDOW_SIZE - 1);

  const numbers = new Set<number>([1, totalPages]);
  for (let p = windowStart; p <= windowEnd; p += 1) numbers.add(p);

  const ordered = [...numbers].sort((a, b) => a - b);
  const slots: PaginationSlot[] = [];
  for (const [index, current] of ordered.entries()) {
    if (index > 0 && current - ordered[index - 1] > 1) {
      slots.push({ kind: 'gap' });
    }
    slots.push({ kind: 'page', page: current });
  }
  return slots;
}
