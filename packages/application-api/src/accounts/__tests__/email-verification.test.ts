/**
 * Email-verification groundwork tests (task 2.4, change
 * technical-assessment-remediation; design D5).
 *
 * - Verification state derivation from the account-row email column
 *   (placeholder ⇒ anonymous/disposable, real address ⇒ verified).
 * - Email-format validation for the upgrade endpoint.
 * - AccountService.verifyEmail upgrade path through a fake
 *   VerifiedEmailStore (the durable binding is a pending data-platform
 *   addition — see verified-email.store.ts).
 *
 * @module EmailVerificationTest
 */

import { describe, it, expect } from 'vitest';
import type { AccountRepository } from '@rajahinta/data-platform';
import { AccountService } from '../account.service';
import { VerifiedEmailStore } from '../verified-email.store';
import {
  isAccountVerified,
  isPlaceholderEmail,
  isValidEmailFormat,
  PLACEHOLDER_EMAIL_SUFFIX,
} from '../email-verification';

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

describe('email-verification state derivation', () => {
  it('placeholder email ⇒ unverified (anonymous, disposable)', () => {
    expect(isPlaceholderEmail(`abc-123${PLACEHOLDER_EMAIL_SUFFIX}`)).toBe(true);
    expect(isAccountVerified(`abc-123${PLACEHOLDER_EMAIL_SUFFIX}`)).toBe(false);
  });

  it('a real address on the row ⇒ verified', () => {
    expect(isPlaceholderEmail('user@example.com')).toBe(false);
    expect(isAccountVerified('user@example.com')).toBe(true);
  });

  it('empty email is unverified, not a crash', () => {
    expect(isAccountVerified('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Format validation
// ---------------------------------------------------------------------------

describe('isValidEmailFormat', () => {
  it.each([
    'user@example.com',
    'first.last+tag@sub.domain.org',
    'a_b-c@fi.example.co',
  ])('accepts %s', (email) => {
    expect(isValidEmailFormat(email)).toBe(true);
  });

  it.each([
    '',
    'no-at-sign',
    '@missing-local',
    'missing-domain@',
    'no-tld@localhost',
    'two@at@signs.com',
    'space in@address.com',
    'a'.repeat(321) + '@example.com',
  ])('rejects %s', (email) => {
    expect(isValidEmailFormat(email)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AccountService.verifyEmail — anonymous upgrade path
// ---------------------------------------------------------------------------

class FakeVerifiedEmailStore extends VerifiedEmailStore {
  readonly writes: Array<{ userId: string; email: string }> = [];

  async setVerifiedEmail(userId: string, email: string): Promise<void> {
    this.writes.push({ userId, email });
  }
}

/** AccountRepository double that fails if verifyEmail tries to route through it. */
class UnusedAccountRepository implements AccountRepository {
  async create(): Promise<never> {
    throw new Error('unexpected create');
  }
  async findById(): Promise<null> {
    return null;
  }
  async findByUserId(): Promise<null> {
    return null;
  }
  async updateLastActive() {}
  async delete() {}
  async findAllUserIds(): Promise<string[]> {
    return [];
  }
  async anonymize() {}
}

describe('AccountService.verifyEmail — upgrade path', () => {
  it('persists the verified email through the store (DB path)', async () => {
    const store = new FakeVerifiedEmailStore();
    const service = new AccountService(new UnusedAccountRepository(), undefined, undefined, undefined, store);

    await service.verifyEmail('user-1', 'user-1@example.com');

    expect(store.writes).toEqual([{ userId: 'user-1', email: 'user-1@example.com' }]);
  });

  it('updates the in-memory account in the test fallback (no repos at all)', async () => {
    const service = new AccountService();
    await service.verifyEmail('mem-user', 'mem@example.com');

    const account = await service.getAccount('mem-user');
    expect(account.email).toBe('mem@example.com');
    expect(isAccountVerified(account.email)).toBe(true);
  });

  it('repository-bound but store-less ⇒ explicit error, not a silent no-op', async () => {
    const service = new AccountService(new UnusedAccountRepository());
    await expect(
      service.verifyEmail('user-1', 'user-1@example.com'),
    ).rejects.toThrow(/VerifiedEmailStore/);
  });
});
