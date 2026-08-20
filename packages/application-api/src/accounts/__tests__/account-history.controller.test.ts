/**
 * AccountController — calculation history append endpoint tests.
 *
 * Tests POST /api/v1/account/history directly with a mocked AccountService,
 * following the same pattern as sibling tests
 * (no @nestjs/testing — direct instantiation with manual mocks).
 *
 * @module AccountHistoryControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AccountController } from '../account.controller';
import type { AccountService } from '../account.service';
import type { DataExportService } from '../data-export.service';
import type { Account, Basket } from '../account.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = 'history-test-user';
const ANOTHER_USER_ID = 'history-test-user-2';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMockAccountService(): Partial<AccountService> {
  const calculationHistory: number[] = [1001, 1002];

  return {
    getAccount: vi.fn(async (userId: string): Promise<Account> => ({
      userId,
      email: `${userId}@placeholder.local`,
      tier: 'FREE',
      savedBaskets: [],
      calculationHistory,
      subscription: { userId, plan: 'FREE', active: true },
      createdAt: new Date(),
      lastActiveAt: new Date(),
    })),
    addCalculationToHistory: vi.fn(
      async (_userId: string, recordId: number): Promise<void> => {
        calculationHistory.push(recordId);
      },
    ),
  };
}

function createMockDataExportService(): Partial<DataExportService> {
  return {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountController — POST /history — addHistory', () => {
  let controller: AccountController;
  let mockAccountService: ReturnType<typeof createMockAccountService>;

  beforeEach(() => {
    mockAccountService = createMockAccountService();
    controller = new AccountController(
      createMockDataExportService() as unknown as DataExportService,
      mockAccountService as unknown as AccountService,
    );
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  describe('valid payload', () => {
    it('appends a calculation record and returns success', async () => {
      const result = await controller.addHistory({ recordId: 123 }, USER_ID);

      expect(result).toEqual({ success: true, recordId: 123 });
      expect(mockAccountService.addCalculationToHistory).toHaveBeenCalledWith(
        USER_ID,
        123,
      );
    });

    it('preserves existing history when appending', async () => {
      // Verify initial state
      const before = await controller.getHistory(USER_ID);
      expect(before).toEqual([1001, 1002]);

      // Append
      await controller.addHistory({ recordId: 456 }, USER_ID);

      // Verify appended state
      const after = await controller.getHistory(USER_ID);
      expect(after).toEqual([1001, 1002, 456]);
    });

    it('appends multiple recordIds sequentially', async () => {
      await controller.addHistory({ recordId: 10 }, USER_ID);
      await controller.addHistory({ recordId: 20 }, USER_ID);
      await controller.addHistory({ recordId: 30 }, USER_ID);

      const history = await controller.getHistory(USER_ID);
      expect(history).toEqual([1001, 1002, 10, 20, 30]);
      expect(mockAccountService.addCalculationToHistory).toHaveBeenCalledTimes(
        3,
      );
    });

    it('returns 201 status code semantics via response shape', async () => {
      // The method returns { success: true, recordId } — the @ApiResponse
      // decorator marks this as 201, which is framework-managed. We verify
      // the response shape is correct for the happy path.
      const result = await controller.addHistory({ recordId: 789 }, USER_ID);
      expect(result).toMatchObject({
        success: true,
        recordId: 789,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Missing x-user-id header
  // -----------------------------------------------------------------------

  describe('missing x-user-id header', () => {
    it('throws BadRequestException when userId is undefined', async () => {
      await expect(
        controller.addHistory({ recordId: 123 }, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with correct error shape', async () => {
      try {
        await controller.addHistory({ recordId: 123 }, undefined);
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

    it('does not call service when userId is missing', async () => {
      try {
        await controller.addHistory({ recordId: 123 }, undefined);
      } catch {
        // expected
      }
      expect(
        mockAccountService.addCalculationToHistory,
      ).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Invalid recordId
  // -----------------------------------------------------------------------

  describe('invalid recordId', () => {
    it('throws BadRequestException when recordId is a float', async () => {
      await expect(
        controller.addHistory({ recordId: 3.14 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when recordId is zero', async () => {
      await expect(
        controller.addHistory({ recordId: 0 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when recordId is negative', async () => {
      await expect(
        controller.addHistory({ recordId: -1 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with correct error shape for invalid recordId', async () => {
      const cases = [
        { recordId: -5 },
        { recordId: 0 },
        { recordId: 3.14 },
      ];

      for (const body of cases) {
        try {
          await controller.addHistory(body, USER_ID);
          expect.unreachable(
            `Expected BadRequestException for recordId=${body.recordId}`,
          );
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          expect(
            (err as BadRequestException).getResponse(),
          ).toMatchObject({
            statusCode: 400,
            message: 'recordId must be a positive integer',
            error: 'InvalidRecordId',
          });
        }
      }
    });

    it('does not call service when recordId is invalid', async () => {
      try {
        await controller.addHistory({ recordId: -1 }, USER_ID);
      } catch {
        // expected
      }
      expect(
        mockAccountService.addCalculationToHistory,
      ).not.toHaveBeenCalled();
    });
  });
});