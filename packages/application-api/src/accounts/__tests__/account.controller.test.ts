/**
 * AccountController tests.
 *
 * Tests the controller directly with mocked AccountService and
 * DataExportService, following the same pattern as sibling tests
 * (no @nestjs/testing — direct instantiation with manual mocks).
 * Handlers receive the server-derived AuthenticatedAccount (task 2.2) —
 * the guard-level cases (missing cookie, legacy header) live in
 * session-auth.guard.test.ts.
 *
 * @module AccountControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { AccountController } from '../account.controller';
import type { AccountService } from '../account.service';
import type { DataExportService } from '../data-export.service';
import type { Account, Basket, BasketItem, SavedScenario, SubscriptionStatus } from '../account.types';
import type { AuthenticatedAccount } from '../current-user.decorator';
import type { DataExport } from '../data-export.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'test-user-123';
const ANOTHER_USER_ID = 'other-user-456';

/** AuthenticatedAccount the SessionAuthGuard would attach for a userId. */
function user(userId: string): AuthenticatedAccount {
  return { accountId: 1, userId, tier: 'FREE', verified: false };
}

const mockBasket: Basket = {
  id: 'basket-1',
  name: 'Test Basket',
  createdAt: new Date('2026-01-15'),
  items: [{ productId: 1, productName: 'Beer', quantity: 6 }],
};

const mockSubscription: SubscriptionStatus = {
  userId: USER_ID,
  plan: 'FREE',
  active: true,
};

const mockAccount: Account = {
  userId: USER_ID,
  email: `${USER_ID}@placeholder.local`,
  tier: 'FREE',
  savedBaskets: [mockBasket],
  calculationHistory: [1001, 1002],
  subscription: mockSubscription,
  createdAt: new Date('2026-01-01'),
  lastActiveAt: new Date('2026-06-01'),
};

const mockScenario: SavedScenario = {
  id: 1,
  name: 'Weekend run',
  inputs: { productId: 1, quantity: 6, destination: 'FI' },
  createdAt: new Date('2026-06-01'),
  updatedAt: new Date('2026-06-10'),
};

const mockDataExport: DataExport = {
  userId: USER_ID,
  exportDate: '2026-06-15T12:00:00.000Z',
  account: {
    userId: USER_ID,
    email: `${USER_ID}@placeholder.local`,
    tier: 'FREE',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-06-01T00:00:00.000Z',
  },
  savedBaskets: [mockBasket],
  savedScenarios: [mockScenario],
  calculationHistory: [
    {
      calculationId: 1001,
      timestamp: new Date('2026-06-14'),
      totalCents: 0,
      productName: 'calculation-1001',
      quantity: 1,
    },
    {
      calculationId: 1002,
      timestamp: new Date('2026-06-13'),
      totalCents: 0,
      productName: 'calculation-1002',
      quantity: 1,
    },
  ],
  subscription: mockSubscription,
};

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMockAccountService(): Partial<AccountService> {
  const savedBaskets: Basket[] = [{ ...mockBasket }];
  const calculationHistory: number[] = [1001, 1002];

  return {
    getAccount: vi.fn(async (userId: string): Promise<Account> => {
      if (userId === USER_ID) {
        return {
          ...mockAccount,
          savedBaskets,
          calculationHistory,
        };
      }
      // Phase 1: auto-create for any userId
      return {
        userId,
        email: `${userId}@placeholder.local`,
        tier: 'FREE',
        savedBaskets: [],
        calculationHistory: [],
        subscription: { userId, plan: 'FREE', active: true },
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
    }),
    getSavedBaskets: vi.fn(async (userId: string): Promise<Basket[]> => {
      if (userId === USER_ID) return savedBaskets;
      return [];
    }),
    saveBasket: vi.fn(async (_userId: string, _basket: Basket): Promise<void> => {
      savedBaskets.push(_basket);
    }),
  };
}

function createMockDataExportService(): Partial<DataExportService> {
  return {
    exportUserData: vi.fn(async (userId: string): Promise<DataExport> => {
      if (userId === USER_ID) return { ...mockDataExport, userId };
      throw new NotFoundException(`User "${userId}" not found`);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountController', () => {
  let controller: AccountController;
  let mockAccountService: ReturnType<typeof createMockAccountService>;
  let mockDataExportService: ReturnType<typeof createMockDataExportService>;

  beforeEach(() => {
    mockAccountService = createMockAccountService();
    mockDataExportService = createMockDataExportService();
    controller = new AccountController(
      mockDataExportService as unknown as DataExportService,
      mockAccountService as unknown as AccountService,
    );
  });

  // -----------------------------------------------------------------------
  // GET /baskets — listBaskets
  // -----------------------------------------------------------------------

  describe('GET /baskets — listBaskets', () => {
    it('returns saved baskets for the authenticated user', async () => {
      const result = await controller.listBaskets(user(USER_ID));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('basket-1');
      expect(result[0].name).toBe('Test Basket');
      expect(mockAccountService.getSavedBaskets).toHaveBeenCalledWith(USER_ID);
    });

    it('returns empty array for a user with no baskets', async () => {
      const result = await controller.listBaskets(user(ANOTHER_USER_ID));

      expect(result).toEqual([]);
    });

    it('scopes reads to the authenticated identity only', async () => {
      // The userId comes from the guard-attached context — a request
      // authenticated as ANOTHER_USER can never read USER_ID's baskets.
      const result = await controller.listBaskets(user(ANOTHER_USER_ID));
      expect(result).toEqual([]);
      expect(mockAccountService.getSavedBaskets).toHaveBeenCalledWith(ANOTHER_USER_ID);
    });
  });

  // -----------------------------------------------------------------------
  // POST /baskets — saveBasket
  // -----------------------------------------------------------------------

  describe('POST /baskets — saveBasket', () => {
    const validBody = {
      name: 'New Basket',
      items: [{ productId: 2, productName: 'Wine', quantity: 3 }] as BasketItem[],
    };

    it('saves a basket for the authenticated user and body', async () => {
      await controller.saveBasket(validBody, user(USER_ID));

      expect(mockAccountService.saveBasket).toHaveBeenCalledTimes(1);
      const [savedFor, savedBasket] = (mockAccountService.saveBasket as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(savedFor).toBe(USER_ID);
      expect(savedBasket.name).toBe('New Basket');
      expect(savedBasket.items).toEqual(validBody.items);
      expect(savedBasket.id).toBeDefined();
      expect(savedBasket.createdAt).toBeInstanceOf(Date);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /baskets/:basketId — deleteBasket
  // -----------------------------------------------------------------------

  describe('DELETE /baskets/:basketId — deleteBasket', () => {
    it('deletes an existing basket', async () => {
      await controller.deleteBasket(user(USER_ID), 'basket-1');

      // Verify basket is no longer in the account
      const account = await mockAccountService.getAccount!(USER_ID);
      expect(account.savedBaskets.find((b) => b.id === 'basket-1')).toBeUndefined();
    });

    it('throws NotFoundException when basket does not exist', async () => {
      await expect(
        controller.deleteBasket(user(USER_ID), 'nonexistent-basket'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with correct error shape', async () => {
      try {
        await controller.deleteBasket(user(USER_ID), 'ghost-basket');
        expect.unreachable('Expected NotFoundException');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).getResponse()).toMatchObject({
          statusCode: 404,
          message: 'Basket "ghost-basket" not found',
          error: 'BasketNotFound',
        });
      }
    });
  });

  // -----------------------------------------------------------------------
  // GET /history — getHistory
  // -----------------------------------------------------------------------

  describe('GET /history — getHistory', () => {
    it('returns calculation history IDs for the authenticated user', async () => {
      const result = await controller.getHistory(user(USER_ID));

      expect(result).toEqual([1001, 1002]);
    });

    it('returns empty array for a user with no history', async () => {
      const result = await controller.getHistory(user(ANOTHER_USER_ID));

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /subscription — getSubscription
  // -----------------------------------------------------------------------

  describe('GET /subscription — getSubscription', () => {
    it('returns subscription for the authenticated user', async () => {
      const result = await controller.getSubscription(user(USER_ID));

      expect(result.userId).toBe(USER_ID);
      expect(result.plan).toBe('FREE');
      expect(result.active).toBe(true);
    });

    it('returns default subscription for a new user', async () => {
      const result = await controller.getSubscription(user(ANOTHER_USER_ID));

      expect(result.plan).toBe('FREE');
      expect(result.active).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /export — exportData
  // -----------------------------------------------------------------------

  describe('GET /export — exportData', () => {
    it('returns data export for the authenticated user', async () => {
      const result = await controller.exportData(user(USER_ID));

      expect(result.userId).toBe(USER_ID);
      expect(result.account.email).toBe(`${USER_ID}@placeholder.local`);
      expect(result.savedBaskets).toHaveLength(1);
      expect(result.calculationHistory).toHaveLength(2);
      expect(result.subscription.plan).toBe('FREE');
      expect(mockDataExportService.exportUserData).toHaveBeenCalledWith(USER_ID);
    });

    it('re-throws NotFoundException from DataExportService', async () => {
      // The mock throws NotFoundException for unknown users, but in Phase 1
      // the AccountService auto-creates accounts. We force a NotFoundException
      // by making the mock reject for a truly unknown user.
      (mockDataExportService.exportUserData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new NotFoundException('User "ghost" not found'),
      );

      await expect(controller.exportData(user('ghost'))).rejects.toThrow(NotFoundException);
    });

    it('wraps unknown errors in InternalServerErrorException', async () => {
      (mockDataExportService.exportUserData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      await expect(controller.exportData(user(USER_ID))).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /verify-email — anonymous → verified upgrade (task 2.4)
  // -----------------------------------------------------------------------

  describe('POST /verify-email — verifyEmail', () => {
    it('persists a valid email and confirms the upgrade', async () => {
      const verifyEmail = vi.fn(async (): Promise<void> => undefined);
      (mockAccountService as { verifyEmail?: unknown }).verifyEmail = verifyEmail;

      const result = await controller.verifyEmail(
        { email: 'user@example.com' },
        user(USER_ID),
      );

      expect(result).toEqual({ verified: true, email: 'user@example.com' });
      expect(verifyEmail).toHaveBeenCalledWith(USER_ID, 'user@example.com');
    });

    it('rejects a malformed email with BadRequestException', async () => {
      await expect(
        controller.verifyEmail({ email: 'not-an-email' }, user(USER_ID)),
      ).rejects.toThrow('email');
    });

    it('rejects a missing email with BadRequestException', async () => {
      await expect(
        controller.verifyEmail({} as { email: string }, user(USER_ID)),
      ).rejects.toThrow('email');
    });

    it('scopes the upgrade to the authenticated identity', async () => {
      const verifyEmail = vi.fn(async (): Promise<void> => undefined);
      (mockAccountService as { verifyEmail?: unknown }).verifyEmail = verifyEmail;

      await controller.verifyEmail(
        { email: 'other@example.com' },
        user(ANOTHER_USER_ID),
      );

      expect(verifyEmail).toHaveBeenCalledWith(ANOTHER_USER_ID, 'other@example.com');
    });
  });
});
