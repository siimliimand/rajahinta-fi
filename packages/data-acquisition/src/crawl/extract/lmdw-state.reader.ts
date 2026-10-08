/**
 * whisky.fr embedded state-JSON reader — the LMDW per-source normalizer
 * (task 3.1, change onboard-lmdw-crawl-merchant; design D2/D4).
 *
 * The carrier is `<script id="__NEXT_DATA__" type="application/json">`
 * — pure JSON, direct `JSON.parse` on 299/300 probed pages (no
 * assignment-slice fallback: a blob that fails the direct parse has no
 * attested shape to slice around, and rides ESTIMATED below). The
 * guarded facts, measured over the 300-page probe:
 *
 * - `volume` (litres) and `strength` (ABV percent) live at the canonical
 *   path `props.pageProps.productFromServer` on 295/300 pages. Alternate
 *   paths (2 CMS-rendered, 2 redirect-shaped) are deliberately NOT
 *   followed — the guarded walk reads the canonical path only and lets
 *   the rest fall to ESTIMATED (do not over-fit). Both fields also carry
 *   i18n-dictionary noise (`"volume":"Volume : "`) on every page, so the
 *   parse requires pure-numeric values — digit-free strings never parse.
 * - Windows are the pipeline's unit windows: 0 < litres < 100 (× 1000 →
 *   ml), 0 < ABV percent ≤ 100 (÷ 100 → fraction). `"volume":"0"` (× 2)
 *   and `strength: 0` (× 12, non-alcoholic items) reject at the window.
 * - The m3 taxonomy (`m3_category`/`m3_family`/`m3_subfamily`/
 *   `m3_division`) is the page-side product-type signal, present on
 *   300/300 probed pages including those without `productFromServer` —
 *   so the labels are collected by a bounded walk of the whole blob
 *   (the probe census's method), not the product path. Entries are
 *   `LmdwProductSelect`-shaped `{ label }` arrays.
 *
 * The state JSON's `ean` field is unread: design D4 wires the GTIN
 * through the existing JSON-LD `gtin13` path (the two attested
 * identical values on the probe; one read, not two).
 *
 * Minimization: nothing but the fields below is read; the record has no
 * field for anything else the blob carries.
 *
 * @module LmdwStateReader
 */

import { mapSourceCategory } from '@rajahinta/core-domain';
import type { SourceCategoryMapping } from '../../adapters/alks.parser';

/** The guarded page-state fields the LMDW extractor consumes. */
export interface LmdwPageState {
  /** Guarded litres → ml; null = absent, non-numeric, or out of window. */
  readonly volumeMl: number | null;
  /** Guarded percent → fraction; null = absent, non-numeric, or out of window. */
  readonly abvFraction: number | null;
  /**
   * m3 labels in candidate priority order (category → family →
   * subfamily → division), each the census's exact spelling.
   */
  readonly categoryLabels: readonly string[];
}

const NEXT_DATA_PATTERN =
  /<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i;

/** Canonical product path — `props.pageProps.productFromServer`. */
const PRODUCT_PATH = ['props', 'pageProps', 'productFromServer'] as const;

/** m3 keys in candidate priority order — broadest beverage type first. */
const M3_KEYS = [
  'm3_category',
  'm3_family',
  'm3_subfamily',
  'm3_division',
] as const;

/** Walk/label caps so a pathological blob cannot blow the extractor up. */
const MAX_WALK_DEPTH = 12;
const MAX_ARRAY_SLICE = 50;
const MAX_LABEL_SLICE = 20;

/**
 * Pure-numeric guarded decimal: a JSON number, or a string of digits
 * with one `,`/`.` decimal separator. Anything else — the i18n
 * dictionary's `"Volume : "`, unit-suffixed `"45,8 %"`, negatives,
 * exponents — is null. The pure-numeric requirement is measured, not
 * stylistic: digit-free dictionary strings appear on 300/300 pages.
 */
function parseGuardedDecimal(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed.replace(',', '.'));
}

/** Walk a fixed key path — every step must be a plain object. */
function walkPath(root: unknown, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * Bounded walk of the whole parsed blob collecting the FIRST label set
 * per m3 key (`{ label }` arrays, or a bare string) — the probe
 * census's method, so labels on pages without `productFromServer`
 * (CMS/redirect shapes) still classify. Depth- and size-capped.
 */
function collectM3Labels(root: unknown): string[] {
  const perKey = new Map<string, string[]>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || perKey.size === M3_KEYS.length) return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, MAX_ARRAY_SLICE)) {
        visit(entry, depth + 1);
      }
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((M3_KEYS as readonly string[]).includes(key) && !perKey.has(key)) {
        const labels: string[] = [];
        const entries = Array.isArray(child)
          ? child.slice(0, MAX_LABEL_SLICE)
          : [child];
        for (const entry of entries) {
          const label =
            typeof entry === 'string' && entry.trim() !== ''
              ? entry.trim()
              : typeof entry === 'object' &&
                  entry !== null &&
                  typeof (entry as Record<string, unknown>)['label'] === 'string'
                ? ((entry as Record<string, unknown>)['label'] as string).trim()
                : '';
          if (label !== '') labels.push(label);
        }
        if (labels.length > 0) perKey.set(key, labels);
      }
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return M3_KEYS.flatMap((key) => perKey.get(key) ?? []);
}

/**
 * Read the guarded page state from a whisky.fr detail page. Null when
 * the `__NEXT_DATA__` carrier is absent or unparseable — the caller
 * rides the keyed-uncertainty ESTIMATED path; nothing throws.
 */
export function readLmdwPageState(html: string): LmdwPageState | null {
  const match = NEXT_DATA_PATTERN.exec(html);
  if (match === null) return null;
  let blob: unknown;
  try {
    blob = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const product = walkPath(blob, PRODUCT_PATH);

  let volumeMl: number | null = null;
  const litres =
    product === undefined ? null : parseGuardedDecimal(
      (product as Record<string, unknown>)['volume'],
    );
  // The pipeline's unit window: 0 < unit_volume < 100 litres.
  if (litres !== null && litres > 0 && litres < 100) {
    volumeMl = Math.round(litres * 1000);
  }

  let abvFraction: number | null = null;
  const percent =
    product === undefined ? null : parseGuardedDecimal(
      (product as Record<string, unknown>)['strength'],
    );
  // The ABV window: 0 < percent ≤ 100 — zero-strength rows are the
  // non-alcoholic population and must not become zero-ABV alcohol rows.
  if (percent !== null && percent > 0 && percent <= 100) {
    abvFraction = percent / 100;
  }

  return { volumeMl, abvFraction, categoryLabels: collectM3Labels(blob) };
}

/**
 * GS1 EAN-13 check digit (positions 1..12 weighed 1,3,1,3… from the
 * left). Design D4: an accepted-form GTIN is accepted only when the
 * page's attestation is also arithmetically valid — the probe measured
 * 220/220 valid, so a failure is attestation drift, never padded away.
 */
export function isValidEan13CheckDigit(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (ean.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === ean.charCodeAt(12) - 48;
}

/**
 * First m3 label with a canonical mapping, in candidate order — the
 * same first-mappable-candidate contract the parser's category flow
 * uses. A page classifies when ANY of its labels maps; a set of only
 * deliberately-unmapped labels (solide/glassware/…) returns null and
 * the caller queues the correction naming the labels.
 */
export function categoryLabelsImpliedMapping(
  labels: readonly string[],
  abv: number | null,
): SourceCategoryMapping | null {
  for (const label of labels) {
    const mapping = mapSourceCategory(label, abv);
    if (mapping !== null) return mapping;
  }
  return null;
}
