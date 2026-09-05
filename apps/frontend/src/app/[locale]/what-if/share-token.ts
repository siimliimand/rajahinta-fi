/**
 * What-if share-token codec — frontend mirror of the codec exported by
 * `apps/api-worker/src/routes/what-if.routes.ts` (task 8.2, change
 * product-roadmap-phases-1-4).
 *
 * The token format is a CROSS-APP CONTRACT, not shared code: importing
 * the worker's route module would drag its Hono/D1 module graph into the
 * frontend bundle, so the codec is re-declared here and pinned to the
 * worker's output byte-for-byte by `share-token.test.ts` (which embeds
 * tokens produced by the worker's own tests as compatibility vectors).
 *
 * Format: `wi1.<base64url(JSON envelope)>.<fnv1a32-checksum>` — a
 * versioned envelope of the scenario INPUTS only (never results, never
 * rule rows). Deterministic: encode∘decode is the identity. The
 * checksum is a plain FNV-1a corruption check — the payload is
 * non-sensitive, user-supplied input that is re-validated against the
 * SAME bounds the POST endpoint enforces and recomputed server-side, so
 * no cryptographic tamper-proofing is required (a forged-but-valid
 * token can only produce a different hypothetical, never an exposure or
 * a stored row). Tokens over MAX_SHARE_TOKEN_CHARS are rejected before
 * parsing.
 *
 * The bounds validation below hand-rolls the exact zod schema of the
 * worker's route module (the frontend has no zod dependency — the
 * dependency set is deliberately unchanged): same caps, same trim
 * semantics on ids, same integer requirements, same duplicate-id
 * rejection, unknown envelope keys ignored (zod object stripping).
 *
 * @module WhatIfShareToken
 */

import type { WhatIfCategoryKey, WhatIfProductInput, WhatIfScenarioRequest } from './what-if.types';

const SHARE_TOKEN_PREFIX = 'wi1';
/** Size bound — mirrors the worker's MAX_SHARE_TOKEN_CHARS. */
const MAX_SHARE_TOKEN_CHARS = 8192;
/** Mirrors the worker's scenario bounds. */
const MAX_HYPOTHETICAL_RATE = 1000;
const MAX_PRODUCTS = 20;
const MAX_PRICE_CENTS = 10_000_000;
const MAX_VOLUME_LITRES = 10_000;
const MAX_ID_LENGTH = 100;

const CATEGORY_KEYS: readonly WhatIfCategoryKey[] = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'spirits',
  'intermediate_products',
  'other_fermented',
];

/** The token is malformed, corrupted, oversized, or violates the bounds. */
export class WhatIfShareTokenError extends Error {
  constructor(detail: string) {
    super(`invalid what-if share token: ${detail}`);
    this.name = 'WhatIfShareTokenError';
  }
}

/** Versioned envelope — field order IS the canonical encoding order. */
interface ShareEnvelope {
  v: 1;
  rate: number;
  p: unknown[];
}

/** FNV-1a 32-bit — corruption check only, not a cryptographic MAC. */
function fnv1a32(input: string): string {
  let hash = 0x0811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Encode scenario inputs into the opaque share token (deterministic).
 * The caller supplies already-valid input; a scenario the API would
 * reject still encodes (mirroring the worker), and only the size bound
 * throws here.
 */
export function encodeWhatIfShareToken(scenario: WhatIfScenarioRequest): string {
  const envelope: ShareEnvelope = {
    v: 1,
    rate: scenario.hypotheticalRate,
    p: scenario.products.map((product) => ({
      id: product.id,
      category: product.category,
      abv: product.abv,
      volumeLitres: product.volumeLitres,
      alkoPriceCents: product.alkoPriceCents,
      importPriceCents: product.importPriceCents,
    })),
  };
  const payload = JSON.stringify(envelope);
  const token = `${SHARE_TOKEN_PREFIX}.${base64UrlEncode(payload)}.${fnv1a32(payload)}`;
  if (token.length > MAX_SHARE_TOKEN_CHARS) {
    throw new WhatIfShareTokenError(
      `encoded scenario exceeds the ${MAX_SHARE_TOKEN_CHARS}-character token bound`,
    );
  }
  return token;
}

/** zod `.number().int()` parity: integers only, no ±Infinity (JSON never carries those, guard anyway). */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** One product inside a token — zod-parity validation, unknown keys stripped. */
function validateProduct(raw: unknown, index: number): WhatIfProductInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WhatIfShareTokenError(`products[${index}] is not an object`);
  }
  const record = raw as Record<string, unknown>;

  // z.string().trim().min(1).max(100) parity: trim first, validate the
  // trimmed value, and hand the trimmed value onward like zod's output.
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id.length < 1 || id.length > MAX_ID_LENGTH) {
    throw new WhatIfShareTokenError(`products[${index}].id must be 1–${MAX_ID_LENGTH} characters`);
  }
  const category = record.category;
  if (
    typeof category !== 'string' ||
    !CATEGORY_KEYS.includes(category as WhatIfCategoryKey)
  ) {
    throw new WhatIfShareTokenError(`products[${index}].category is not a canonical category`);
  }
  const abv = record.abv;
  if (typeof abv !== 'number' || !Number.isFinite(abv) || abv < 0 || abv > 1) {
    throw new WhatIfShareTokenError(`products[${index}].abv must be a fraction in [0, 1]`);
  }
  const volumeLitres = record.volumeLitres;
  if (
    typeof volumeLitres !== 'number' ||
    !Number.isFinite(volumeLitres) ||
    volumeLitres < 0 ||
    volumeLitres > MAX_VOLUME_LITRES
  ) {
    throw new WhatIfShareTokenError(`products[${index}].volumeLitres is out of bounds`);
  }
  const alkoPriceCents = record.alkoPriceCents;
  const importPriceCents = record.importPriceCents;
  if (!isInteger(alkoPriceCents) || alkoPriceCents < 0 || alkoPriceCents > MAX_PRICE_CENTS) {
    throw new WhatIfShareTokenError(`products[${index}].alkoPriceCents is out of bounds`);
  }
  if (
    !isInteger(importPriceCents) ||
    importPriceCents < 0 ||
    importPriceCents > MAX_PRICE_CENTS
  ) {
    throw new WhatIfShareTokenError(`products[${index}].importPriceCents is out of bounds`);
  }

  return {
    id,
    category: category as WhatIfCategoryKey,
    abv,
    volumeLitres,
    alkoPriceCents,
    importPriceCents,
  };
}

/**
 * Decode a share token back to its scenario inputs — READ-ONLY: nothing
 * is computed, fetched, or stored here; the caller recomputes through
 * the API. Throws {@link WhatIfShareTokenError} on any malformation,
 * corruption, oversize, or bound violation.
 */
export function decodeWhatIfShareToken(token: string): WhatIfScenarioRequest {
  if (token.length > MAX_SHARE_TOKEN_CHARS) {
    throw new WhatIfShareTokenError(`token exceeds the ${MAX_SHARE_TOKEN_CHARS}-character bound`);
  }
  const segments = token.split('.');
  if (segments.length !== 3 || segments[0] !== SHARE_TOKEN_PREFIX) {
    throw new WhatIfShareTokenError('malformed token envelope');
  }
  const [, payloadSegment, checksumSegment] = segments;

  let payload: string;
  try {
    payload = base64UrlDecode(payloadSegment);
  } catch {
    throw new WhatIfShareTokenError('payload is not valid base64url');
  }
  if (fnv1a32(payload) !== checksumSegment) {
    throw new WhatIfShareTokenError('checksum mismatch — token corrupted or altered');
  }

  let envelope: ShareEnvelope;
  try {
    envelope = JSON.parse(payload) as ShareEnvelope;
  } catch {
    throw new WhatIfShareTokenError('payload is not valid JSON');
  }
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    envelope.v !== 1 ||
    typeof envelope.rate !== 'number' ||
    !Number.isFinite(envelope.rate) ||
    !Array.isArray(envelope.p)
  ) {
    throw new WhatIfShareTokenError('unknown payload shape');
  }

  // Re-validate against the SAME bounds the POST endpoint enforces — a
  // token can never smuggle in a scenario the API itself would reject.
  const hypotheticalRate = envelope.rate;
  if (hypotheticalRate < 0 || hypotheticalRate > MAX_HYPOTHETICAL_RATE) {
    throw new WhatIfShareTokenError(
      `hypotheticalRate must be between 0 and ${MAX_HYPOTHETICAL_RATE}`,
    );
  }
  if (envelope.p.length < 1 || envelope.p.length > MAX_PRODUCTS) {
    throw new WhatIfShareTokenError(`products must carry 1–${MAX_PRODUCTS} entries`);
  }
  const products = envelope.p.map(validateProduct);
  const seen = new Set<string>();
  for (const product of products) {
    if (seen.has(product.id)) {
      throw new WhatIfShareTokenError(`products carries the id "${product.id}" more than once`);
    }
    seen.add(product.id);
  }

  return { hypotheticalRate, products };
}
