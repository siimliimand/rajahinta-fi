/**
 * Password hashing port — PBKDF2-SHA256 via WebCrypto (task 2.1, change
 * email-password-auth; design D1).
 *
 * The stored form in accounts.password_hash is self-describing —
 * `pbkdf2-sha256$<iterations>$<salt-b64url>$<hash-b64url>` — so iteration
 * counts can rise later without a rehash migration: verifyPassword parses
 * the header (algorithm + iteration count) and re-derives with the stored
 * parameters rather than hardcoding the current settings.
 *
 * Pure WebCrypto plus web-standard encodings (no node:crypto) so the same
 * module runs unchanged in `wrangler dev`, production Workers, and the
 * Vitest node pool. The constant-time comparison mirrors the email
 * Worker's secretsMatch (apps/email-worker/src/app.ts).
 *
 * @module password
 */

/**
 * Iteration count for NEW hashes — verify reads the stored header instead.
 *
 * 100 000 is the workerd platform ceiling, not a policy choice: the
 * runtime rejects PBKDF2 above it outright ("iteration counts above
 * 100000 are not supported" — NotSupportedError at request time, which
 * `wrangler deploy --dry-run` cannot catch). The 600 000 figure from the
 * original task spec is unreachable on Workers; if it ever matters, the
 * self-describing storage format accepts a per-hash raise (or a KDF
 * migration) without rehashing every row.
 */
export const PBKDF2_ITERATIONS = 100_000;

/** Per-user random salt length in bytes. */
export const SALT_BYTES = 16;

/** Derived hash length in bytes — pinned by the pbkdf2-sha256 label. */
export const HASH_BYTES = 32;

/** NIST SP 800-63B: memorized secrets SHOULD be at least 12 characters. */
export const MIN_PASSWORD_LENGTH = 12;

/** NIST SP 800-63B: verifiers SHOULD permit at least 64; 128 allows passphrases. */
export const MAX_PASSWORD_LENGTH = 128;

/** First field of the stored hash — the only algorithm label parsed. */
const ALGORITHM_LABEL = 'pbkdf2-sha256';

/**
 * Upper bound on the iteration count accepted on verify. The count comes
 * from a stored (potentially corrupt or attacker-controlled) string; the
 * cap stops a tampered row from pinning the Worker's CPU for hours.
 * Comfortably above PBKDF2_ITERATIONS so legitimate future raises fit.
 */
const MAX_VERIFIED_ITERATIONS = 10_000_000;

/** Minimum salt length accepted on verify (NIST SP 800-132: ≥ 128 bits). */
const MIN_VERIFIED_SALT_BYTES = 8;

/**
 * PBKDF2-HMAC-SHA-256 through WebCrypto. Exported for known-answer tests;
 * production callers use {@link hashPassword}/{@link verifyPassword}.
 */
export async function derivePbkdf2Sha256(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Unpadded base64url — the storage format's byte encoding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Strict unpadded-base64url decode; null when the string is not valid. */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null;
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    // Structurally invalid base64 (e.g. length % 4 === 1).
    return null;
  }
}

/**
 * Hash a password for storage: 16-byte random per-user salt, PBKDF2-SHA-256
 * at the current {@link PBKDF2_ITERATIONS}, 32-byte output, rendered in the
 * self-describing `pbkdf2-sha256$<iter>$<salt>$<hash>` format.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePbkdf2Sha256(password, salt, PBKDF2_ITERATIONS);
  return `${ALGORITHM_LABEL}$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** A parsed stored-hash header: the parameters the hash was derived with. */
interface ParsedStoredHash {
  readonly iterations: number;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly hash: Uint8Array<ArrayBuffer>;
}

/**
 * Parse the self-describing storage format. Returns null on any structural
 * deviation — wrong field count, unknown algorithm label, non-numeric or
 * implausible iteration count, invalid base64url, wrong hash length — so
 * verifyPassword can answer `false` without deriving.
 */
function parseStoredHash(storedHash: string): ParsedStoredHash | null {
  const parts = storedHash.split('$');
  if (parts.length !== 4) {
    return null;
  }
  const [label, iterationsRaw, saltRaw, hashRaw] = parts;
  if (label !== ALGORITHM_LABEL) {
    return null;
  }
  if (!/^[1-9][0-9]*$/.test(iterationsRaw)) {
    return null;
  }
  const iterations = Number(iterationsRaw);
  if (iterations > MAX_VERIFIED_ITERATIONS) {
    return null;
  }
  const salt = fromBase64Url(saltRaw);
  const hash = fromBase64Url(hashRaw);
  if (salt === null || salt.length < MIN_VERIFIED_SALT_BYTES) {
    return null;
  }
  if (hash === null || hash.length !== HASH_BYTES) {
    return null;
  }
  return { iterations, salt, hash };
}

/**
 * Constant-time byte comparison — the email Worker's secretsMatch pattern
 * (apps/email-worker/src/app.ts): both sides are reduced to fixed 32-byte
 * SHA-256 digests first so the comparison length never leaks information
 * about either value, then folded with XOR; any differing bit sets `diff`.
 */
async function constantTimeEquals(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', a),
    crypto.subtle.digest('SHA-256', b),
  ]);
  const bytesA: Uint8Array<ArrayBuffer> = new Uint8Array(digestA);
  const bytesB: Uint8Array<ArrayBuffer> = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i]! ^ bytesB[i]!;
  }
  return diff === 0;
}

/**
 * Verify a password against a stored hash. The header's algorithm label and
 * iteration count drive the re-derivation, so hashes written with older
 * (lower) settings keep verifying. All failures — malformed storage format,
 * unknown parameters, wrong password — are the same `false`; nothing about
 * the failure mode is observable through the return value.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  // A password longer than the policy maximum can never be in the database
  // (every write path enforces {@link isValidPassword}), so skip the
  // 600k-iteration derivation for oversized input instead of letting it
  // become a CPU-amplification vector on the login route.
  if ([...password].length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  const parsed = parseStoredHash(storedHash);
  if (parsed === null) {
    return false;
  }
  const candidate = await derivePbkdf2Sha256(
    password,
    parsed.salt,
    parsed.iterations,
  );
  return constantTimeEquals(candidate, parsed.hash);
}

/**
 * NIST SP 800-63B password policy: 12–128 characters, no composition rules
 * (length is the only strength lever — mandated character classes push
 * users toward predictable patterns). Lengths count Unicode code points.
 * Register and reset callers (tasks 2.2/2.3) gate on this before hashing.
 */
export function isValidPassword(password: string): boolean {
  const length = [...password].length;
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH;
}
