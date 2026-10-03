import { describe, expect, it } from 'vitest';
import {
  HASH_BYTES,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  derivePbkdf2Sha256,
  hashPassword,
  isCommonPassword,
  isPasswordLengthValid,
  isValidPassword,
  verifyPassword,
} from '../password';
import {
  COMMON_PASSWORDS,
  COMMON_PASSWORD_BLOCKLIST_VERSION,
} from '../common-passwords';

/** Fixed 16-byte salt for every known-answer vector (hex 0f1e2d…e1f0). */
const KAT_SALT = Uint8Array.from([
  0x0f, 0x1e, 0x2d, 0x3c, 0x4b, 0x5a, 0x69, 0x78, 0x87, 0x96, 0xa5, 0xb4, 0xc3,
  0xd2, 0xe1, 0xf0,
]);
const KAT_SALT_B64URL = 'Dx4tPEtaaXiHlqW0w9Lh8A';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * RFC 7914 §11 PBKDF2-HMAC-SHA-256 vectors (first 32 bytes of each dkLen=64
 * vector — PBKDF2 output is a prefix, so the shorter derive matches), plus
 * the production-parameter vector cross-checked against an independent
 * implementation (hashlib.pbkdf2_hmac). These pin the primitive to the
 * public spec rather than to itself.
 */
const RFC_VECTORS: readonly {
  password: string;
  salt: string;
  iterations: number;
  expectedHex: string;
}[] = [
  {
    password: 'passwd',
    salt: 'salt',
    iterations: 1,
    expectedHex:
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc',
  },
  {
    password: 'passwd',
    salt: 'salt',
    iterations: 2,
    expectedHex:
      '2d412f896e76685e30df569f0a740634e31f031f749d607d9e44210bffb91a6a',
  },
  {
    password: 'Password',
    salt: 'NaCl',
    iterations: 80_000,
    expectedHex:
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56',
  },
];

describe('derivePbkdf2Sha256 (WebCrypto PBKDF2-SHA-256)', () => {
  for (const vector of RFC_VECTORS) {
    it(`matches RFC 7914 §11: ${JSON.stringify(vector.password)}/salt=${JSON.stringify(vector.salt)}, c=${vector.iterations}`, async () => {
      const derived = await derivePbkdf2Sha256(
        vector.password,
        new TextEncoder().encode(vector.salt),
        vector.iterations,
      );
      expect(bytesToHex(derived)).toBe(vector.expectedHex);
    });
  }

  it('matches the known answer for the production parameters (fixed salt, 100 000 iterations)', async () => {
    const derived = await derivePbkdf2Sha256(
      'correct horse battery staple',
      KAT_SALT,
      100_000,
    );
    expect(derived).toHaveLength(32);
    expect(bytesToHex(derived)).toBe(
      'f54e46978b9881b9984f8f4300ee7b9c12568070cc1b8d86d4f7c1dae758d0ac',
    );
  });
});

describe('hashPassword', () => {
  it('emits the self-describing pbkdf2-sha256$<iter>$<salt>$<hash> format', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2-sha256');
    expect(parts[1]).toBe(String(PBKDF2_ITERATIONS));
    // 16-byte salt → 22 unpadded base64url chars; 32-byte hash → 43.
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('derives with a fresh random salt per call', async () => {
    const password = 'correct horse battery staple';
    const first = (await hashPassword(password)).split('$');
    const second = (await hashPassword(password)).split('$');
    expect(first[2]).not.toBe(second[2]);
    expect(first[3]).not.toBe(second[3]);
  });

  it('uses the policy salt length constant', async () => {
    expect(SALT_BYTES).toBe(16);
    expect(HASH_BYTES).toBe(32);
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
});

describe('verifyPassword', () => {
  it('accepts the known-answer storage string (fixed salt + 100 000 iterations, precomputed hash)', async () => {
    // The hash below was computed independently of this module
    // (hashlib.pbkdf2_hmac, hex f54e4697…758d0ac) and pinned here — a
    // deterministic end-to-end assertion, not a round-trip check. 100 000
    // is the production count: workerd rejects PBKDF2 above it.
    const stored =
      'pbkdf2-sha256$100000$' +
      `${KAT_SALT_B64URL}$9U5Gl4uYgbmYT49DAO57nBJWgHDMG42G1PfB2udY0Kw`;
    await expect(
      verifyPassword('correct horse battery staple', stored),
    ).resolves.toBe(true);
  });

  it('rejects a wrong password (negative known answer)', async () => {
    const stored =
      'pbkdf2-sha256$100000$' +
      `${KAT_SALT_B64URL}$9U5Gl4uYgbmYT49DAO57nBJWgHDMG42G1PfB2udY0Kw`;
    await expect(
      verifyPassword('incorrect horse battery staple', stored),
    ).resolves.toBe(false);
  });

  it('verifies hashes produced by hashPassword (round-trip smoke)', async () => {
    const password = 'correct horse battery staple';
    const stored = await hashPassword(password);
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password!!', stored)).resolves.toBe(
      false,
    );
  }, 30_000);

  it('re-derives with the stored header iteration count, not a hardcoded one', async () => {
    const password = 'correct horse battery staple';
    const hash = await derivePbkdf2Sha256(password, KAT_SALT, 1_000);
    const stored = `pbkdf2-sha256$1000$${KAT_SALT_B64URL}$${toBase64Url(hash)}`;
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
    // Same bytes under a mismatched header count must not verify — proving
    // the header drives the derivation.
    const mismatched = stored.replace('$1000$', `$${PBKDF2_ITERATIONS}$`);
    await expect(verifyPassword(password, mismatched)).resolves.toBe(false);
  });

  it.each([
    ['three fields', 'pbkdf2-sha256$600000$Dx4tPEtaaXiHlqW0w9Lh8A'],
    [
      'five fields',
      'pbkdf2-sha256$600000$Dx4tPEtaaXiHlqW0w9Lh8A$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg$extra',
    ],
    [
      'unknown algorithm label',
      'pbkdf2-sha512$600000$Dx4tPEtaaXiHlqW0w9Lh8A$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg',
    ],
    [
      'non-numeric iterations',
      'pbkdf2-sha256$sixty$Dx4tPEtaaXiHlqW0w9Lh8A$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg',
    ],
    [
      'zero iterations',
      'pbkdf2-sha256$0$Dx4tPEtaaXiHlqW0w9Lh8A$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg',
    ],
    [
      'iteration count above the verify cap',
      'pbkdf2-sha256$99999999999999$Dx4tPEtaaXiHlqW0w9Lh8A$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg',
    ],
    [
      'invalid base64url character in salt',
      'pbkdf2-sha256$600000$Dx4tPEtaaXiHlqW0w9Lh+A$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg',
    ],
    [
      'empty hash field',
      'pbkdf2-sha256$600000$Dx4tPEtaaXiHlqW0w9Lh8A$',
    ],
    [
      'truncated hash field',
      'pbkdf2-sha256$600000$Dx4tPEtaaXiHlqW0w9Lh8A$hH3AQs',
    ],
    [
      'undersized salt',
      'pbkdf2-sha256$600000$Dx4tPA$hH3AQs_4i0sGZTiTjhtQZJx5S25zQ73vv1hx4IaCsFg',
    ],
  ])('answers false (never throws) for malformed storage: %s', async (_name, malformed) => {
    await expect(verifyPassword('correct horse battery staple', malformed)).resolves.toBe(
      false,
    );
  });

  it('answers false for a password longer than the policy maximum without deriving', async () => {
    const oversized = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(oversized, stored)).resolves.toBe(false);
  }, 30_000);
});

describe('isValidPassword (D7 new-password policy: 8 floor + pinned blocklist)', () => {
  it('accepts the 8-character minimum when not blocklisted', () => {
    expect(isValidPassword('a'.repeat(8))).toBe(true);
    expect(isValidPassword('zz9xq7kd')).toBe(true);
    // No composition rules: repetition and digit-only passphrases are valid.
    expect(isValidPassword('aaaaaaaaaaaa')).toBe(true);
    expect(isValidPassword('123456789012')).toBe(true);
  });

  it('rejects a 7-character password', () => {
    expect(isValidPassword('a'.repeat(7))).toBe(false);
  });

  it('accepts up to 128 characters and rejects beyond', () => {
    expect(isValidPassword('a'.repeat(128))).toBe(true);
    expect(isValidPassword('a'.repeat(129))).toBe(false);
  });

  it('rejects the empty password', () => {
    expect(isValidPassword('')).toBe(false);
  });

  it('rejects blocklisted passwords at ANY length — length no longer compensates', () => {
    for (const common of [
      'q1w2e3r4', // 8 — exactly at the new floor
      'password', // 8
      'qwerty123', // 9
      'password1', // 9
      'salasana123', // 11
      'password123456', // 14 — above the OLD 12-character floor
    ]) {
      expect(isValidPassword(common), common).toBe(false);
    }
  });

  it('compares case-insensitively and trims the input', () => {
    expect(isValidPassword('PASSWORD')).toBe(false);
    expect(isValidPassword('Salasana123')).toBe(false);
    expect(isValidPassword('  password1  ')).toBe(false);
  });

  it('screens the Finnish family including Cyrillic-а homoglyph variants', () => {
    expect(isValidPassword('salasan\u0430')).toBe(false);
    expect(isValidPassword('salasan\u04301')).toBe(false);
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    // '🏋' is one code point but two UTF-16 units. 4 × 🏋 + 'abcd' = 8 code
    // points (16 UTF-16 units); 3 × 🏋 + 'ab' = 5 code points but 8 UTF-16
    // units — the case a UTF-16 count would wrongly accept.
    expect(isValidPassword('🏋🏋🏋🏋abcd')).toBe(true);
    expect(isValidPassword('🏋🏋🏋abc')).toBe(false);
    expect(isValidPassword('🏋🏋🏋ab')).toBe(false);
  });
});

describe('isPasswordLengthValid (login bounds — length only, no blocklist)', () => {
  it('accepts 8–128 including blocklisted passwords', () => {
    // The login gate is length-only: a pre-policy stored password that sits
    // on the blocklist must still be verifiable (existing accounts are
    // unaffected — the policy applies at set/reset time).
    expect(isPasswordLengthValid('password')).toBe(true);
    expect(isPasswordLengthValid('password123456')).toBe(true);
    expect(isPasswordLengthValid('a'.repeat(128))).toBe(true);
  });

  it('rejects below the floor and above the cap', () => {
    expect(isPasswordLengthValid('a'.repeat(7))).toBe(false);
    expect(isPasswordLengthValid('a'.repeat(129))).toBe(false);
  });
});

describe('isCommonPassword (normalized lookup)', () => {
  it('matches the trimmed, case-folded form only', () => {
    expect(isCommonPassword(' Password123 ')).toBe(true);
    expect(isCommonPassword('password1234extra')).toBe(false);
    expect(isCommonPassword('correct horse battery staple')).toBe(false);
  });
});

describe('common-password blocklist file (pinned, versioned)', () => {
  it('pins the required trivially guessable entries', () => {
    for (const entry of [
      'password',
      'salasana',
      '12345678',
      'q1w2e3r4',
      'password1',
      'qwerty123',
    ]) {
      expect(COMMON_PASSWORDS).toContain(entry);
    }
  });

  it('is versioned, duplicate-free, and sized like a real screening list', () => {
    expect(COMMON_PASSWORD_BLOCKLIST_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(200);
  });

  it('stores entries pre-normalized (lowercase, untrimmed)', () => {
    for (const entry of COMMON_PASSWORDS) {
      expect(entry).toBe(entry.toLowerCase());
      expect(entry).toBe(entry.trim());
    }
  });
});
