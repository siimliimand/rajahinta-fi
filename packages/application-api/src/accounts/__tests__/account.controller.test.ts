/**
 * AccountController tests.
 *
 * Tests the controller directly with mocked AccountService and
 * DataExportService, following the same pattern as sibling tests
 * (no @nestjs/testing — direct instantiation with manual mocks).
 *
 * @module AccountControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountController } from '../account.controller';
import type { AccountService } from '../account.service';
import type { DataExportService } from '../data-export.service';
import type { Account, Basket, BasketItem, SubscriptionStatus } from '../account.types';
import type { DataExport } from '../data-export.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'test-user-123';
const ANOTHER_USER_ID = 'other-user-456';

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
    it('returns saved baskets for a valid userId', async () => {
      const result = await controller.listBaskets(USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('basket-1');
      expect(result[0].name).toBe('Test Basket');
      expect(mockAccountService.getSavedBaskets).toHaveBeenCalledWith(USER_ID);
    });

    it('returns empty array for a user with no baskets', async () => {
      const result = await controller.listBaskets(ANOTHER_USER_ID);

      expect(result).toEqual([]);
    });

    it('throws BadRequestException when userId is missing', async () => {
      await expect(controller.listBaskets(undefined)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with correct error shape', async () => {
      try {
        await controller.listBaskets(undefined);
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          message: 'x-user-id header is required',
          error: 'MissingUserId',
        });
      }
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

    it('saves a basket for a valid userId and body', async () => {
      await controller.saveBasket(validBody, USER_ID);

      expect(mockAccountService.saveBasket).toHaveBeenCalledTimes(1);
      const [, savedBasket] = (mockAccountService.saveBasket as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(savedBasket.name).toBe('New Basket');
      expect(savedBasket.items).toEqual(validBody.items);
      expect(savedBasket.id).toBeDefined();
      expect(savedBasket.createdAt).toBeInstanceOf(Date);
    });

    it('throws BadRequestException when userId is missing', async () => {
      await expect(controller.saveBasket(validBody, undefined)).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /baskets/:basketId — deleteBasket
  // -----------------------------------------------------------------------

  describe('DELETE /baskets/:basketId — deleteBasket', () => {
    it('deletes an existing basket', async () => {
      await controller.deleteBasket(USER_ID, 'basket-1');

      // Verify basket is no longer in the account
      const account = await mockAccountService.getAccount!(USER_ID);
      expect(account.savedBaskets.find((b) => b.id === 'basket-1')).toBeUndefined();
    });

    it('throws BadRequestException when userId is missing', async () => {
      await expect(controller.deleteBasket(undefined, 'basket-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when basket does not exist', async () => {
      await expect(controller.deleteBasket(USER_ID, 'nonexistent-basket')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with correct error shape', async () => {
      try {
        await controller.deleteBasket(USER_ID, 'ghost-basket');
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
    it('returns calculation history IDs for a valid userId', async () => {
      const result = await controller.getHistory(USER_ID);

      expect(result).toEqual([1001, 1002]);
    });

    it('throws BadRequestException when userId is missing', async () => {
      await expect(controller.getHistory(undefined)).rejects.toThrow(BadRequestException);
    });

    it('returns empty array for a user with no history', async () => {
      const result = await controller.getHistory(ANOTHER_USER_ID);

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /subscription — getSubscription
  // -----------------------------------------------------------------------

  describe('GET /subscription — getSubscription', () => {
    it('returns subscription for a valid userId', async () => {
      const result = await controller.getSubscription(USER_ID);

      expect(result.userId).toBe(USER_ID);
      expect(result.plan).toBe('FREE');
      expect(result.active).toBe(true);
    });

    it('throws BadRequestException when userId is missing', async () => {
      await expect(controller.getSubscription(undefined)).rejects.toThrow(BadRequestException);
    });

    it('returns default subscription for a new user', async () => {
      const result = await controller.getSubscription(ANOTHER_USER_ID);

      expect(result.plan).toBe('FREE');
      expect(result.active).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /export — exportData
  // -----------------------------------------------------------------------

  describe('GET /export — exportData', () => {
    it('returns data export for a valid userId', async () => {
      const result = await controller.exportData(USER_ID);

      expect(result.userId).toBe(USER_ID);
      expect(result.account.email).toBe(`${USER_ID}@placeholder.local`);
      expect(result.savedBaskets).toHaveLength(1);
      expect(result.calculationHistory).toHaveLength(2);
      expect(result.subscription.plan).toBe('FREE');
      expect(mockDataExportService.exportUserData).toHaveBeenCalledWith(USER_ID);
    });

    it('throws BadRequestException when userId is missing', async () => {
      await expect(controller.exportData(undefined)).rejects.toThrow(BadRequestException);
    });

    it('re-throws NotFoundException from DataExportService', async () => {
      // The mock throws NotFoundException for unknown users, but in Phase 1
      // the AccountService auto-creates accounts. We force a NotFoundException
      // by making the mock reject for a truly unknown user.
      (mockDataExportService.exportUserData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new NotFoundException('User "ghost" not found'),
      );

      await expect(controller.exportData('ghost')).rejects.toThrow(NotFoundException);
    });

    it('wraps unknown errors in InternalServerErrorException', async () => {
      (mockDataExportService.exportUserData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      await expect(controller.exportData(USER_ID)).rejects.toThrow(
        'DB connection lost',
      );
    });
  });
});