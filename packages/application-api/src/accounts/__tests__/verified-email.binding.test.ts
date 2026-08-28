/**
 * VerifiedEmailStore binding tests (FIX-E, change
 * technical-assessment-remediation).
 *
 * Pins the AccountModule binding: the module's VerifiedEmailStore
 * provider is the AccountRepository-backed adapter (durable write),
 * replacing the UnboundVerifiedEmailStore 503 default. The unbound
 * store itself is still exported and still fails explicitly — it is
 * the seam other tests use to assert the failure mode.
 *
 * Package convention: direct construction with fakes, plus a metadata
 * check for the module binding itself (no testing container).
 *
 * @module VerifiedEmailBindingTest
 */
import { describe, it, expect, vi } from 'vitest';
import type { AccountRepository } from '@rajahinta/data-platform';
import {
  AccountModule,
  AccountRepositoryVerifiedEmailStore,
} from '../account.module';
import {
  VerifiedEmailStore,
  UnboundVerifiedEmailStore,
} from '../verified-email.store';

function fakeAccountRepository(
  impl: (userId: string, email: string) => Promise<void> = async () => {},
): AccountRepository {
  return {
    setVerifiedEmail: vi.fn(impl),
  } as unknown as AccountRepository;
}

describe('AccountRepositoryVerifiedEmailStore (FIX-E adapter)', () => {
  it('delegates setVerifiedEmail to the AccountRepository email update', async () => {
    const accounts = fakeAccountRepository();
    const store: VerifiedEmailStore = new AccountRepositoryVerifiedEmailStore(accounts);

    await store.setVerifiedEmail('user-123', 'verified@example.invalid');

    expect(accounts.setVerifiedEmail).toHaveBeenCalledWith(
      'user-123',
      'verified@example.invalid',
    );
  });

  it('propagates persistence failures instead of swallowing them', async () => {
    const accounts = fakeAccountRepository(async () => {
      throw new Error('account not found for userId="missing"');
    });
    const store = new AccountRepositoryVerifiedEmailStore(accounts);

    await expect(
      store.setVerifiedEmail('missing', 'verified@example.invalid'),
    ).rejects.toThrow(/account not found/i);
  });
});

describe('AccountModule VerifiedEmailStore binding (metadata)', () => {
  it('binds the AccountRepository-backed adapter, not the unbound 503 default', () => {
    const providers = (Reflect.getMetadata('providers', AccountModule) ?? []) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;

    const binding = providers.find(
      (p) => p && p.provide === VerifiedEmailStore,
    );

    expect(binding).toBeDefined();
    expect(binding!.useClass).toBe(AccountRepositoryVerifiedEmailStore);
  });
});

describe('UnboundVerifiedEmailStore (failure-mode seam kept)', () => {
  it('still fails explicitly when invoked directly', async () => {
    const unbound = new UnboundVerifiedEmailStore();
    await expect(
      unbound.setVerifiedEmail('user', 'email'),
    ).rejects.toThrow(/not wired/i);
  });
});
