/**
 * Pure share-snapshot domain logic — public-id generation, frozen-copy
 * assembly, and the personal-data strip assertion (task 6.1, change
 * trust-and-reach-roadmap; spec share-permalinks).
 *
 * No I/O: randomness enters as an injected byte source so generation is
 * deterministic and testable; assembly and the assertion are pure
 * functions over plain values. Persistence lives in the
 * ShareSnapshotRepository (data-platform); the API route composes the
 * three.
 *
 * @module Sharing
 */

import {
  PersonalDataFieldError,
  PUBLIC_ID_CHARSET,
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_RANDOM_BYTES,
  type ShareSnapshotPayload,
  type ShareSnapshotSource,
} from './sharing.types';

// ---------------------------------------------------------------------------
// Public-id generation
// ---------------------------------------------------------------------------

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Derive the 22-character public id from exactly 16 random bytes —
 * base64url alphabet, no padding. 16 bytes → 128 bits of entropy: a
 * brute-force guess over the public URL space is computationally
 * hopeless, which is what makes an unauthenticated share page safe.
 *
 * The byte source is injected (crypto.getRandomValues at the call site,
 * a deterministic sequence in tests). The length and charset contract
 * is pinned here — a generator bug is a typed rejection, never a row.
 */
export function publicIdFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== PUBLIC_ID_RANDOM_BYTES) {
    throw new Error(
      `share public id needs exactly ${PUBLIC_ID_RANDOM_BYTES} random bytes, got ${bytes.length}`,
    );
  }
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      out += BASE64URL[(value >>> (bits - 6)) & 0x3f];
      bits -= 6;
    }
  }
  // 16 bytes = 128 bits = 21 groups of 6 + 2 remaining bits — the final
  // partial group pads with zeros on the right (standard base64 behavior,
  // no '=' padding character).
  if (bits > 0) {
    out += BASE64URL[(value << (6 - bits)) & 0x3f];
  }
  return out;
}

/** Fresh 16 bytes from the runtime CSPRNG (Workers and Node both provide it). */
export function randomBytes16(): Uint8Array {
  const bytes = new Uint8Array(PUBLIC_ID_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** A fresh random public id (22 chars, base64url). */
export function generatePublicId(): string {
  return publicIdFromBytes(randomBytes16());
}

/**
 * Whether a string is syntactically a public id — exactly 22 chars over
 * the base64url alphabet. The public lookup route rejects other shapes
 * outright: a malformed id can never exist, so answering not-found
 * without a database round-trip leaks nothing.
 */
export function isValidPublicId(candidate: string): boolean {
  return candidate.length === PUBLIC_ID_LENGTH && PUBLIC_ID_CHARSET.test(candidate);
}

// ---------------------------------------------------------------------------
// Frozen-copy assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the frozen public copy from the record facts. The payload is
 * a CLOSED projection — there is deliberately no passthrough shape, so
 * an account column cannot ride along: no record id, no session id, no
 * account id, no user id, no email. The result must be JSON-safe and
 * immutable by convention (the repository never updates it).
 */
export function assembleShareSnapshot(source: ShareSnapshotSource): ShareSnapshotPayload {
  return {
    type: 'landed-cost-snapshot',
    product: {
      name: source.productName,
      brand: source.productBrand,
      category: source.productCategory,
    },
    quantity: source.quantity,
    totalCents: source.totalCents,
    currency: 'EUR',
    breakdown: source.breakdown,
    confidence: source.confidence,
    destination: source.destination,
    disclaimer: source.disclaimer,
    calculatedAt: source.calculatedAt,
  };
}

// ---------------------------------------------------------------------------
// Personal-data strip assertion
// ---------------------------------------------------------------------------

/**
 * Keys that must never appear anywhere inside a snapshot, at any depth.
 * Matched exactly, case-insensitively — `UserId`, `user_id`, and
 * `userid` are all personal-data faces of the same field.
 */
const PERSONAL_DATA_KEYS: ReadonlySet<string> = new Set([
  'userid',
  'user_id',
  'accountid',
  'account_id',
  'sessionid',
  'session_id',
  'sessiontoken',
  'session_token',
  'email',
  'token',
  'password',
]);

/**
 * Assert the assembled snapshot carries no personal data, recursively.
 * Runs BEFORE persistence (the share route's strip assertion): the
 * assembly's closed projection is the first line of defence, this walk
 * is the second — including over free-form payloads (the record's
 * breakdown lines) the assembler does not structurally control.
 *
 * Throws {@link PersonalDataFieldError} naming the offending path;
 * nothing is stored when it throws.
 */
export function assertNoPersonalData(payload: unknown): void {
  visit(payload, '', new Set<unknown>());
}

function visit(node: unknown, path: string, seen: Set<unknown>): void {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return; // cycle guard
  seen.add(node);

  for (const [key, value] of Object.entries(node)) {
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    if (PERSONAL_DATA_KEYS.has(key.toLowerCase())) {
      throw new PersonalDataFieldError(childPath);
    }
    visit(value, childPath, seen);
  }
}
