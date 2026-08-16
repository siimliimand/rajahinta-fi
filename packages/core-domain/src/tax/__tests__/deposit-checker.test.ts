/**
 * Tests for DepositChecker — pure function, three paths.
 */
import { describe, it, expect } from 'vitest';
import { checkDepositExemption } from '../services/deposit-checker';

describe('checkDepositExemption', () => {
  describe('depositSystemStatus === true', () => {
    it('returns exempted = true', () => {
      const result = checkDepositExemption(true);
      expect(result.exempted).toBe(true);
    });

    it('returns VERIFIED reliability', () => {
      const result = checkDepositExemption(true);
      expect(result.reliability).toBe('VERIFIED');
    });

    it('returns clear exemption reason', () => {
      const result = checkDepositExemption(true);
      expect(result.reason).toContain('exempted');
      expect(result.reason).toContain('deposit-return');
    });
  });

  describe('depositSystemStatus === false', () => {
    it('returns exempted = false', () => {
      const result = checkDepositExemption(false);
      expect(result.exempted).toBe(false);
    });

    it('returns VERIFIED reliability', () => {
      const result = checkDepositExemption(false);
      expect(result.reliability).toBe('VERIFIED');
    });

    it('returns clear applied reason', () => {
      const result = checkDepositExemption(false);
      expect(result.reason).toContain('applied');
      expect(result.reason).toContain('does not participate');
    });
  });

  describe('depositSystemStatus === null (unknown)', () => {
    it('returns exempted = false (does not assume exemption)', () => {
      const result = checkDepositExemption(null);
      expect(result.exempted).toBe(false);
    });

    it('returns ESTIMATED reliability', () => {
      const result = checkDepositExemption(null);
      expect(result.reliability).toBe('ESTIMATED');
    });

    it('returns clear estimated reason', () => {
      const result = checkDepositExemption(null);
      expect(result.reason).toContain('estimated');
      expect(result.reason).toContain('could not be determined');
    });
  });
});