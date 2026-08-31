/**
 * Shared fixtures for the guard-middleware parity tests (task 3.2) —
 * deliberately free of app AND vitest imports so unit-level suites do not
 * drag the whole entry (DO classes, analytics) into their module graph,
 * and so Node typings stay unmerged here (vitest's bundled types distort
 * `Buffer`, so opaque-token minting lives in this vitest-free module).
 *
 * @module guard-test-fixtures
 */

import type { AuthenticatedAccount } from '../../auth/authenticated-account';

/** An obviously-fake bearer token / secret for fixtures. */
export const FAKE_OPS_TOKEN = 'fake-ops-bearer-token';

/**
 * Mint an opaque 256-bit token exactly like SessionTokenService.mintToken
 * (32 random bytes, base64url). WebCrypto-based so the module carries no
 * node:crypto typing dependency (vitest's bundled types merge Buffer into
 * a shape without the encoding-overload on toString).
 */
export function mintOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** An AuthenticatedAccount fixture (shape parity with the Nest decorator). */
export function accountFixture(
  overrides: Partial<AuthenticatedAccount> = {},
): AuthenticatedAccount {
  return {
    accountId: 7,
    userId: 'user-7',
    tier: 'FREE',
    verified: true,
    ...overrides,
  };
}
